import { parseWatch, parseInput, buildQuery, formatTime, videoKey, sourceUrl, shortName, SOURCE_LABEL } from './parse.js';
import { computeRects, stackRects, shouldStack } from './layout.js';
import { STATE, planCorrections, sharedDuration, targetTime, clamp } from './sync.js';
import { loadSettings, saveSettings, rememberSession } from './store.js';
import { createPlayer, chatUrl } from './sources.js';
import { hydrateIcons, setIcon, icon } from './icons.js';
import { setTheme, getTheme, onTheme, resolvedTheme } from './theme.js';

const $ = (id) => document.getElementById(id);
const stage = $('stage');
const settings = loadSettings();
const session = parseWatch(location.search);
const MAX_VIDEOS = 16;
const GAP = 8;
/** Height of the label strip on each tile; the stylesheet owns the value. */
const headHeight = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--head')) || 30;

/** One entry per video, in display order. */
const tiles = [];
let nextUid = 1;

const state = {
  phase: 'loading', // loading -> ready -> priming -> running
  playing: false,
  T: 0, // shared clock: seconds since every video's start point
  rate: 1,
  audio: session.audio, // 'solo' | 'all'
  solo: null, // the tile that is heard in 'solo' mode
  mutedAll: false,
  focus: null, // the enlarged tile, or null for the grid
  scrubbing: false,
  chat: null, // the tile whose chat is open
  barHidden: false,
};

// ---------- small helpers ----------

const safe = (fn, fallback) => {
  try {
    const v = fn();
    return v == null ? fallback : v;
  } catch {
    return fallback;
  }
};

let toastTimer;
function toast(text) {
  $('toast').textContent = text;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($('toast').hidden = true), 2200);
}

function banner(text) {
  $('banner').textContent = text;
  $('banner').hidden = false;
}

const usable = () => tiles.filter((t) => t.usable && t.ready);
const recorded = () => usable().filter((t) => !t.live);
const number = (t) => tiles.indexOf(t) + 1;

function snapshot() {
  return tiles.map((t) => ({
    start: t.start,
    usable: t.usable && t.ready,
    live: t.live,
    time: t.ready ? safe(() => t.player.time(), 0) : 0,
    state: t.ready ? safe(() => t.player.state(), STATE.UNSTARTED) : STATE.UNSTARTED,
    duration: t.ready ? safe(() => t.player.duration(), 0) : 0,
  }));
}

// ---------- layout ----------

function layout() {
  const width = stage.clientWidth;
  const height = stage.parentElement.clientHeight;
  const focusIndex = tiles.indexOf(state.focus);
  const head = headHeight();
  const stack = focusIndex < 0 && shouldStack(tiles.length, width, height, GAP, head);
  const rects = stack ? stackRects(tiles.length, width, GAP, head) : computeRects(tiles.length, width, height, focusIndex < 0 ? null : focusIndex, GAP, head);
  stage.classList.toggle('scroll', stack);
  tiles.forEach((t, i) => {
    Object.assign(t.el.style, { left: `${rects[i].x}px`, top: `${rects[i].y}px`, width: `${rects[i].w}px`, height: `${rects[i].h}px` });
    t.parts.num.textContent = i + 1;
  });
  $('grid').hidden = focusIndex < 0;
}

function setFocus(tile) {
  state.focus = state.focus === tile ? null : tile;
  tiles.forEach((t) => t.parts.focus.classList.toggle('on', t === state.focus));
  layout();
}

// ---------- tiles ----------

function tool(iconName, label, onClick, extraClass = '') {
  const b = document.createElement('button');
  b.className = `tool ${extraClass}`.trim();
  if (iconName.startsWith('text:')) b.textContent = iconName.slice(5);
  else b.innerHTML = icon(iconName);
  b.title = label;
  b.setAttribute('aria-label', label);
  b.addEventListener('click', onClick);
  return b;
}

function addTile(video) {
  const t = {
    uid: nextUid++, video: { kind: video.kind, id: video.id }, start: video.start || 0,
    player: null, ready: false, usable: true, live: video.kind === 'twitch', primed: false,
    title: '', volume: 100, lastFix: 0, lastKick: 0, el: null, parts: {},
  };
  const el = document.createElement('div');
  el.className = 'tile';
  el.innerHTML = `
    <div class="tile-head">
      <button class="num" title="Hear this video"></button>
      <span class="title"></span>
      <span class="badge" hidden>LIVE</span>
      <span class="drift"></span>
      <span class="tools"></span>
    </div>
    <div class="tile-body">
      <div class="frame"></div>
      <div class="msg" hidden></div>
    </div>`;
  t.el = el;
  const q = (sel) => el.querySelector(sel);
  t.parts = { frame: q('.frame'), num: q('.num'), title: q('.title'), badge: q('.badge'), drift: q('.drift'), msg: q('.msg') };
  t.parts.title.textContent = shortName(t.video);
  t.parts.badge.hidden = !t.live;

  t.parts.volume = Object.assign(document.createElement('input'), { type: 'range', min: 0, max: 100, value: 100, className: 'tile-volume', title: 'Volume of this video' });
  t.parts.volume.setAttribute('aria-label', 'Volume of this video');
  t.parts.volume.addEventListener('input', () => {
    t.volume = Number(t.parts.volume.value);
    applyAudio();
  });
  t.parts.audio = tool('volume', 'Hear this video', () => chooseAudio(t));
  t.parts.focus = tool('focus', 'Make this video big', () => setFocus(t));
  t.parts.focus.classList.add('focus');
  t.parts.minus = tool('text:−0.1s', 'Shift 0.1s earlier (Shift-click: 1s)', (e) => nudge(t, e.shiftKey ? -1 : -0.1), 'nudge');
  t.parts.plus = tool('text:+0.1s', 'Shift 0.1s later (Shift-click: 1s)', (e) => nudge(t, e.shiftKey ? 1 : 0.1), 'nudge');
  t.parts.remove = tool('close', 'Remove this video', () => removeTile(t));
  t.parts.num.addEventListener('click', () => chooseAudio(t));
  q('.tools').append(t.parts.volume, t.parts.audio, t.parts.minus, t.parts.plus, t.parts.focus, t.parts.remove);

  tiles.push(t);
  stage.append(el);
  if (!state.solo) state.solo = t;

  t.player = createPlayer({ ...t.video, start: t.start }, t.parts.frame, {
    onReady: () => {
      t.ready = true;
      readInfo(t);
      if (state.phase === 'running') joinRunning(t);
      else updateGate();
    },
    onState: (code) => onPlayerState(t, code),
    onError: (message) => failTile(t, message),
  });
  // A video that never answers must not hold the others hostage.
  setTimeout(() => {
    if (tiles.includes(t) && t.usable && !t.ready) failTile(t, 'This video did not load in time.');
  }, 20000);
  return t;
}

function removeTile(t) {
  const index = tiles.indexOf(t);
  if (index < 0) return;
  safe(() => t.player.destroy());
  t.el.remove();
  tiles.splice(index, 1);
  if (state.focus === t) state.focus = null;
  if (state.chat === t) closeChat();
  if (state.solo === t) state.solo = tiles.find((x) => x.usable) || tiles[0] || null;
  layout();
  applyAudio();
  refreshChatButton();
  updateGate();
  syncUrl();
  toast('Video removed');
}

function failTile(t, message) {
  t.usable = false;
  t.parts.msg.hidden = false;
  t.parts.msg.replaceChildren();
  const strong = Object.assign(document.createElement('strong'), { textContent: `${SOURCE_LABEL[t.video.kind]} can't be shown here` });
  const text = Object.assign(document.createElement('span'), { textContent: message });
  const open = Object.assign(document.createElement('a'), { className: 'btn', target: '_blank', rel: 'noopener', href: sourceUrl(t.video), textContent: 'Open original' });
  const drop = Object.assign(document.createElement('button'), { className: 'btn', textContent: 'Remove' });
  drop.addEventListener('click', () => removeTile(t));
  const row = document.createElement('div');
  row.className = 'row';
  row.append(open, drop);
  t.parts.msg.append(strong, text, row);
  if (state.solo === t) state.solo = tiles.find((x) => x.usable) || state.solo;
  applyAudio();
  refreshChatButton();
  updateGate();
}

function readInfo(t) {
  const info = safe(() => t.player.info(), null);
  if (!info) return;
  if (info.title && info.title !== t.title) {
    t.title = info.title;
    t.parts.title.textContent = info.title;
    t.parts.title.title = info.title;
    if (info.author && info.author !== 'Twitch' && info.author !== 'Vimeo') {
      t.parts.title.append(Object.assign(document.createElement('small'), { textContent: info.author }));
      t.parts.title.title = `${info.title} — ${info.author}`;
    }
  }
  if (info.live !== t.live) {
    t.live = info.live;
    t.parts.badge.hidden = !t.live;
  }
  const canNudge = !t.live || t.player.canSeekLive;
  t.parts.minus.hidden = t.parts.plus.hidden = !canNudge;
  if (t.live) {
    t.parts.minus.title = 'Move 0.1s closer to live';
    t.parts.plus.title = 'Move 0.1s further behind live';
  }
  $('golive').hidden = !tiles.some((x) => x.live && x.usable);
  refreshChatButton();
}

// ---------- audio ----------

function applyAudio() {
  for (const t of tiles) {
    const audible = !state.mutedAll && t.usable && (state.audio === 'all' || t === state.solo);
    t.el.classList.toggle('audio', audible && tiles.length > 1);
    t.parts.audio.classList.toggle('on', audible);
    t.parts.audio.innerHTML = icon(audible ? 'volume' : 'mute');
    t.parts.volume.hidden = state.audio !== 'all';
    if (!t.ready || state.phase !== 'running') continue;
    safe(() => t.player.setVolume((settings.volume * t.volume) / 100));
    safe(() => t.player.setMuted(!audible));
  }
  setIcon($('mute'), state.mutedAll ? 'mute' : 'volume');
  $('mute').classList.toggle('on', state.mutedAll);
  $('audio').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.value === state.audio));
}

function chooseAudio(t) {
  if (!t || !t.usable) return;
  state.mutedAll = false;
  if (state.audio === 'all') {
    // In "all videos" mode the button mutes or unmutes just this one.
    t.volume = t.volume > 0 ? 0 : 100;
    t.parts.volume.value = t.volume;
  } else {
    state.solo = t;
  }
  applyAudio();
}

// ---------- playback ----------

function seekTile(t, T) {
  if (t.live) return;
  safe(() => t.player.seek(targetTime(t.start, T)));
}

function seekAll(T) {
  const max = sharedDuration(snapshot());
  state.T = max > 0 ? clamp(T, 0, max) : Math.max(0, T);
  recorded().forEach((t) => seekTile(t, state.T));
  render();
}

function play() {
  state.playing = true;
  usable().forEach((t) => safe(() => t.player.play()));
  render();
  poke();
}

function pause() {
  state.playing = false;
  usable().forEach((t) => safe(() => t.player.pause()));
  render();
  poke();
}

function togglePlay() {
  if (state.phase === 'ready') return start();
  if (state.phase !== 'running') return;
  state.playing ? pause() : play();
}

function currentT() {
  const plan = planCorrections(snapshot(), settings.threshold);
  return plan.T == null ? state.T : plan.T;
}

function resync() {
  if (state.phase !== 'running') return;
  seekAll(currentT());
  toast('Re-synced');
}

function liveSeek(t) {
  if (!t.player.canSeekLive) return;
  const edge = safe(() => t.player.liveEdge(), 0);
  if (edge > 0) safe(() => t.player.seek(Math.max(0, edge - t.start)));
}

function goLive() {
  usable().filter((t) => t.live).forEach((t) => {
    liveSeek(t);
    safe(() => t.player.play());
  });
  toast('Jumped to live');
}

/** Shift one video against the others, apply it at once, and keep it in the link. */
function nudge(t, delta) {
  t.start = Math.max(0, Math.round((t.start + delta) * 10) / 10);
  if (state.phase === 'running') t.live ? liveSeek(t) : seekTile(t, currentT());
  t.lastFix = performance.now();
  toast(t.live ? `Video ${number(t)}: ${t.start.toFixed(1)}s behind live` : `Video ${number(t)} starts at ${formatTime(t.start, true)}`);
  syncUrl();
}

/**
 * "I lined them up by hand": take where every video is right now as the new sync point.
 * Useful with auto-sync off — pause each video on the same moment, then press this.
 */
function lockSync() {
  if (state.phase !== 'running') return;
  const snap = snapshot();
  const T = state.T;
  let changed = 0;
  tiles.forEach((t, i) => {
    if (!snap[i].usable || t.live) return;
    t.start = Math.max(0, Math.round((snap[i].time - T) * 10) / 10);
    changed++;
  });
  syncUrl();
  toast(changed ? 'Saved. These positions are now the sync point.' : 'Nothing to save yet');
}

function sessionQuery() {
  return buildQuery(tiles.map((t) => ({ ...t.video, start: t.start })), { audio: state.audio });
}

function syncUrl() {
  const query = sessionQuery();
  history.replaceState(null, '', query ? `?${query}` : location.pathname);
  $('edit').href = `index.html${query ? `?${query}` : ''}`;
  if (!tiles.length) return;
  const label = tiles.map((t) => t.title || shortName(t.video)).join(' + ').slice(0, 90);
  rememberSession(tiles.map((t) => videoKey(t.video)).join(','), query, label);
}

// ---------- start-up: get every video buffered, then release them together ----------

function updateGate() {
  if (state.phase !== 'loading' && state.phase !== 'ready') return;
  const gate = $('gate');
  gate.hidden = false;
  const startBtn = $('start');
  if (!tiles.length) {
    state.phase = 'loading';
    $('gate-title').textContent = 'No videos yet';
    $('gate-note').textContent = 'Add a YouTube, Twitch, Vimeo or video file link to begin.';
    startBtn.disabled = false;
    startBtn.lastChild.textContent = 'Add a video';
    setIcon(startBtn, 'plus');
    startBtn.dataset.action = 'add';
    $('play').disabled = true;
    return;
  }
  setIcon(startBtn, 'play');
  startBtn.dataset.action = 'start';
  const pending = tiles.some((t) => t.usable && !t.ready);
  const count = usable().length;
  if (pending) {
    state.phase = 'loading';
    $('gate-title').textContent = 'Loading videos…';
    startBtn.disabled = true;
    startBtn.lastChild.textContent = 'Start';
  } else if (!count) {
    state.phase = 'loading';
    $('gate-title').textContent = 'None of these videos can be played here';
    $('gate-note').textContent = 'Remove the ones that failed, or add another link.';
    startBtn.disabled = false;
    startBtn.lastChild.textContent = 'Add a video';
    setIcon(startBtn, 'plus');
    startBtn.dataset.action = 'add';
  } else {
    state.phase = 'ready';
    $('gate-title').textContent = count > 1 ? `${count} videos ready` : 'Video ready';
    $('gate-note').textContent = 'Browsers only allow sound after a click, so one click here starts every video together.';
    startBtn.disabled = false;
    startBtn.lastChild.textContent = count > 1 ? `Start all ${count}` : 'Start';
  }
  $('play').disabled = state.phase !== 'ready';
}

function waitUntil(test, timeoutMs, everyTick = () => {}) {
  return new Promise((resolve) => {
    const began = performance.now();
    const timer = setInterval(() => {
      everyTick(performance.now() - began);
      if (test() || performance.now() - began > timeoutMs) {
        clearInterval(timer);
        resolve(test());
      }
    }, 100);
  });
}

async function start() {
  if (state.phase !== 'ready') return;
  state.phase = 'priming';
  $('start').disabled = true;
  $('gate-title').textContent = 'Getting every video ready…';

  // Muted playback is always allowed, so each video can buffer its start point.
  usable().forEach((t) => {
    safe(() => t.player.setMuted(true));
    safe(() => t.player.play());
  });
  // Players sometimes drop the first play request (seen with real YouTube), so ask again every 1.5s.
  let asked = 0;
  const allPrimed = await waitUntil(() => usable().every((t) => t.primed), 8000, (elapsed) => {
    if (elapsed - asked < 1500) return;
    asked = elapsed;
    usable().filter((t) => !t.primed).forEach((t) => safe(() => t.player.play()));
  });

  usable().forEach((t) => {
    readInfo(t);
    if (t.live) { if (t.start > 0) liveSeek(t); }
    else safe(() => t.player.seek(t.start));
  });

  state.phase = 'running';
  state.T = 0;
  $('gate').hidden = true;
  for (const id of ['play', 'back', 'fwd', 'resync']) $(id).disabled = false;
  applyRate();
  applyAudio();
  play();
  syncUrl();
  if (!allPrimed) toast('Some videos are slow to load. They will catch up.');
}

/** A video added while the session is already running slots straight in. */
function joinRunning(t) {
  t.primed = true;
  safe(() => t.player.setMuted(true));
  if (!t.live) seekTile(t, currentT());
  if (state.rate !== 1 && t.player.canRate) safe(() => t.player.setRate(state.rate));
  if (state.playing) safe(() => t.player.play());
  applyAudio();
  syncUrl();
}

function onPlayerState(t, code) {
  if (code === STATE.PLAYING) t.lastKick = performance.now();
  if (state.phase === 'priming' && code === STATE.PLAYING && !t.primed) {
    t.primed = true;
    readInfo(t);
    if (!t.live) safe(() => t.player.pause()); // hold recorded videos; live keeps buffering
  }
  if (state.phase === 'running' && code === STATE.PLAYING) readInfo(t);
}

function applyRate() {
  recorded().forEach((t) => t.player.canRate && safe(() => t.player.setRate(state.rate)));
}

// ---------- the sync loop ----------

let lastCommand = 0;

function tick() {
  if (state.phase !== 'running') return;
  const snap = snapshot();
  const plan = planCorrections(snap, settings.threshold);
  if (plan.T != null) state.T = plan.T;

  const now = performance.now();
  let worst = 0;
  tiles.forEach((t, i) => {
    const s = snap[i];
    let label = '';
    if (s.usable && !t.live && plan.T != null && s.state === STATE.PLAYING && i !== plan.ref) {
      const drift = s.time - targetTime(t.start, plan.T);
      worst = Math.max(worst, Math.abs(drift));
      label = `${drift >= 0 ? '+' : '−'}${Math.abs(drift).toFixed(1)}s`;
      t.parts.drift.classList.toggle('bad', Math.abs(drift) > settings.threshold);
    } else if (s.usable && s.state === STATE.BUFFERING) {
      label = 'buffering';
    }
    t.parts.drift.textContent = label;
  });

  if (settings.autoSync && state.playing) {
    for (const fix of plan.fixes) {
      const t = tiles[fix.index];
      if (now - t.lastFix < 2500) continue; // give a seek time to land before judging again
      t.lastFix = now;
      safe(() => t.player.seek(fix.to + 0.05));
    }
  }

  // A video that never got going (the player dropped the play request) is asked again.
  // One the user paused inside its own player is left alone.
  if (state.playing) {
    tiles.forEach((t, i) => {
      const stuck = snap[i].usable && (snap[i].state === STATE.UNSTARTED || snap[i].state === STATE.CUED);
      if (stuck && now - t.lastKick > 2000) {
        t.lastKick = now;
        safe(() => t.player.play());
      }
    });
  }

  // If every video stopped, show Play.
  const anyActive = snap.some((s) => s.usable && (s.state === STATE.PLAYING || s.state === STATE.BUFFERING));
  if (state.playing && !anyActive && snap.some((s) => s.usable) && now - lastCommand > 1500) state.playing = false;

  const status = $('status');
  const waiting = snap.some((s) => s.usable && !s.live && s.state !== STATE.PLAYING && s.state !== STATE.ENDED);
  let text = '';
  let tone = '';
  if (state.playing && plan.T != null && recorded().length > 1) {
    if (waiting) text = 'Waiting for a video…';
    else if (worst <= settings.threshold) { text = 'In sync'; tone = 'ok'; }
    else { text = settings.autoSync ? 'Syncing…' : `Off by ${worst.toFixed(1)}s`; tone = 'warn'; }
  }
  status.textContent = text;
  status.dataset.tone = tone;
  render(snap);
}

function render(snap = snapshot()) {
  const total = sharedDuration(snap);
  const timeline = $('timeline');
  timeline.disabled = !(state.phase === 'running' && total > 0);
  timeline.max = total;
  $('total').textContent = total > 0 ? formatTime(total) : tiles.some((t) => t.live) ? 'LIVE' : '0:00';
  if (!state.scrubbing) {
    const value = clamp(state.T, 0, total || 0);
    timeline.value = value;
    timeline.style.setProperty('--fill', total > 0 ? `${(value / total) * 100}%` : '0%');
    $('now').textContent = formatTime(Math.max(0, state.T));
  }
  const playBtn = $('play');
  if (playBtn.dataset.icon !== (state.playing ? 'pause' : 'play')) setIcon(playBtn, state.playing ? 'pause' : 'play');
  playBtn.setAttribute('aria-label', state.playing ? 'Pause' : 'Play');
}

// ---------- chat ----------

function chatTiles() {
  return tiles.filter((t) => t.live && t.usable && chatUrl(t.video, true));
}

function refreshChatButton() {
  const list = chatTiles();
  $('chat-btn').hidden = list.length === 0;
  if (state.chat && !list.includes(state.chat)) closeChat();
  else if (state.chat) drawChatTabs();
}

function drawChatTabs() {
  const list = chatTiles();
  const tabs = $('chat-tabs');
  tabs.replaceChildren(...list.map((t) => {
    const b = Object.assign(document.createElement('button'), { textContent: number(t), title: t.title || shortName(t.video) });
    b.classList.toggle('on', t === state.chat);
    b.addEventListener('click', () => openChat(t));
    return b;
  }));
  tabs.hidden = list.length < 2;
}

function openChat(t = chatTiles()[0]) {
  if (!t) return;
  const changed = state.chat !== t;
  state.chat = t;
  $('chat').hidden = false;
  $('chat-btn').classList.add('on');
  if (changed) $('chat-frame').src = chatUrl(t.video, resolvedTheme() === 'dark');
  drawChatTabs();
  layout();
}

function closeChat() {
  state.chat = null;
  $('chat').hidden = true;
  $('chat-frame').removeAttribute('src');
  $('chat-btn').classList.remove('on');
  layout();
}

// ---------- popovers ----------

function closePops(except) {
  for (const id of ['menu', 'adder']) if (id !== except) $(id).hidden = true;
  $('more').setAttribute('aria-expanded', String(!$('menu').hidden));
}

function togglePop(id) {
  const el = $(id);
  const show = el.hidden;
  closePops(id);
  el.hidden = !show;
  $('more').setAttribute('aria-expanded', String(!$('menu').hidden));
  if (show && id === 'adder') {
    $('add-error').textContent = '';
    $('add-input').focus();
  }
  poke();
}

function addFromInput() {
  const input = $('add-input');
  const found = parseInput(input.value);
  const error = $('add-error');
  error.textContent = '';
  if (!input.value.trim()) return;
  if (!found.length) {
    error.textContent = 'No video found in that link. Supported: YouTube, Twitch, Vimeo, and direct video files (.mp4, .webm).';
    return;
  }
  const room = MAX_VIDEOS - tiles.length;
  if (room <= 0) {
    error.textContent = `A session holds up to ${MAX_VIDEOS} videos. Remove one first.`;
    return;
  }
  found.slice(0, room).forEach(addTile);
  input.value = '';
  $('adder').hidden = true;
  layout();
  applyAudio();
  updateGate();
  syncUrl();
  toast(found.length > 1 ? `${Math.min(found.length, room)} videos added` : 'Video added');
}

// ---------- auto-hide of the control bar ----------

let idleTimer;
function setBarHidden(hidden) {
  if (state.barHidden === hidden) return;
  state.barHidden = hidden;
  document.body.classList.toggle('bar-hidden', hidden);
}

/** Any activity shows the bar again and restarts the countdown. */
function poke() {
  clearTimeout(idleTimer);
  setBarHidden(false);
  if (!settings.autoHide) return;
  idleTimer = setTimeout(() => {
    const busy = !$('menu').hidden || !$('adder').hidden || $('help').open || state.scrubbing;
    if (state.playing && state.phase === 'running' && !busy) setBarHidden(true);
  }, 3500);
}

// ---------- wiring ----------

function command(fn) {
  return (...args) => {
    lastCommand = performance.now();
    fn(...args);
  };
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => toast('Full screen is not available here'));
  else toast('Full screen is not available on this device');
}

function wire() {
  $('start').addEventListener('click', command(() => ($('start').dataset.action === 'add' ? togglePop('adder') : start())));
  $('play').addEventListener('click', command(togglePlay));
  $('back').addEventListener('click', command(() => seekAll(currentT() - 10)));
  $('fwd').addEventListener('click', command(() => seekAll(currentT() + 10)));
  $('resync').addEventListener('click', command(resync));
  $('menu-resync').addEventListener('click', command(() => { resync(); closePops(); }));
  $('golive').addEventListener('click', command(goLive));
  $('grid').addEventListener('click', () => state.focus && setFocus(state.focus));
  $('lock').addEventListener('click', () => { lockSync(); closePops(); });

  const timeline = $('timeline');
  timeline.addEventListener('input', () => {
    state.scrubbing = true;
    const value = Number(timeline.value);
    timeline.style.setProperty('--fill', `${(value / (Number(timeline.max) || 1)) * 100}%`);
    $('now').textContent = formatTime(value);
  });
  timeline.addEventListener('change', command(() => {
    state.scrubbing = false;
    seekAll(Number(timeline.value));
  }));

  $('autosync').checked = settings.autoSync;
  $('autosync').addEventListener('change', (e) => {
    settings.autoSync = e.target.checked;
    saveSettings(settings);
  });
  $('threshold').value = String(settings.threshold);
  $('threshold').addEventListener('change', (e) => {
    settings.threshold = Number(e.target.value) || 0.5;
    saveSettings(settings);
  });
  $('autohide').checked = settings.autoHide;
  $('autohide').addEventListener('change', (e) => {
    settings.autoHide = e.target.checked;
    saveSettings(settings);
    poke();
  });
  $('volume').value = settings.volume;
  $('volume').addEventListener('input', (e) => {
    settings.volume = Number(e.target.value);
    saveSettings(settings);
    if (state.mutedAll && settings.volume > 0) state.mutedAll = false;
    applyAudio();
  });
  $('audio').addEventListener('click', (e) => {
    const value = e.target.closest('button')?.dataset.value;
    if (!value) return;
    state.audio = value;
    state.mutedAll = false;
    applyAudio();
    syncUrl();
  });
  $('mute').addEventListener('click', () => {
    state.mutedAll = !state.mutedAll;
    applyAudio();
  });
  $('speed').addEventListener('change', (e) => {
    state.rate = Number(e.target.value) || 1;
    applyRate();
    if (usable().some((t) => !t.live && !t.player.canRate)) toast('Twitch videos cannot change speed, so they will be re-synced often');
  });
  $('theme').addEventListener('click', (e) => {
    const value = e.target.closest('button')?.dataset.value;
    if (value) setTheme(value);
  });
  onTheme((mode) => {
    Object.assign(settings, { theme: mode });
    $('theme').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.value === mode));
    if (state.chat) $('chat-frame').src = chatUrl(state.chat.video, resolvedTheme() === 'dark');
  });

  $('share').addEventListener('click', async () => {
    syncUrl();
    closePops();
    try {
      await navigator.clipboard.writeText(location.href);
      toast('Link copied');
    } catch {
      toast('Copy the link from the address bar');
    }
  });
  $('full').addEventListener('click', toggleFullscreen);
  $('menu-full').addEventListener('click', () => { closePops(); toggleFullscreen(); });
  $('more').addEventListener('click', () => togglePop('menu'));
  $('add').addEventListener('click', () => togglePop('adder'));
  $('add-go').addEventListener('click', addFromInput);
  $('add-input').addEventListener('keydown', (e) => e.key === 'Enter' && addFromInput());
  $('help-btn').addEventListener('click', () => { closePops(); $('help').showModal(); });
  $('chat-btn').addEventListener('click', () => (state.chat ? closeChat() : openChat()));
  $('chat-close').addEventListener('click', closeChat);

  document.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('.pop, #more, #add, #start')) closePops();
  });
  for (const type of ['pointermove', 'pointerdown', 'keydown', 'touchstart']) document.addEventListener(type, poke, { passive: true });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closePops(); return; }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const key = e.key.toLowerCase();
    const target = e.target instanceof Element ? e.target : null;
    // Let form fields keep their own keys, and let Space/Enter press a focused button as usual.
    if (target?.closest('input, select, textarea, dialog')) return;
    if (target?.closest('button, a') && (key === ' ' || key === 'enter')) return;
    const running = state.phase === 'running';
    if (key === ' ') { e.preventDefault(); command(togglePlay)(); }
    else if (key === 'arrowleft' && running) { e.preventDefault(); command(() => seekAll(currentT() - 10))(); }
    else if (key === 'arrowright' && running) { e.preventDefault(); command(() => seekAll(currentT() + 10))(); }
    else if (key === ',' && running) command(() => seekAll(currentT() - 1))();
    else if (key === '.' && running) command(() => seekAll(currentT() + 1))();
    else if (key === 'm') $('mute').click();
    else if (key === 's') command(resync)();
    else if (key === 'f') toggleFullscreen();
    else if (key === 'g' && state.focus) setFocus(state.focus);
    else if (key === 'a') { e.preventDefault(); togglePop('adder'); }
    else if (key === 'c' && !$('chat-btn').hidden) $('chat-btn').click();
    else if (key === 'h') { settings.autoHide = !settings.autoHide; $('autohide').checked = settings.autoHide; saveSettings(settings); poke(); toast(settings.autoHide ? 'Controls hide while playing' : 'Controls stay visible'); }
    else if (key === '?') $('help').showModal();
    else if (/^[1-9]$/.test(key) && tiles[Number(key) - 1]) {
      state.audio = 'solo';
      chooseAudio(tiles[Number(key) - 1]);
    }
  });

  // After a mouse click, hand focus back to the page so Space keeps meaning play/pause.
  // (Keyboard users who tabbed to a button keep their focus: their clicks have detail 0.)
  document.addEventListener('click', (e) => {
    if (e.detail > 0) e.target.closest?.('button')?.blur();
  });

  new ResizeObserver(layout).observe(stage.parentElement);
}

function main() {
  hydrateIcons();
  wire();
  if (location.protocol === 'file:') {
    banner('This page is opened as a file, and video sites block players on file pages. Run "npm start" in the project folder and open http://localhost:8080 instead.');
  }
  session.videos.slice(0, MAX_VIDEOS).forEach(addTile);
  $('edit').href = `index.html${location.search}`;
  layout();
  applyAudio();
  updateGate();
  setInterval(tick, 500);
}

main();
