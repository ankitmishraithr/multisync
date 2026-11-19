import { parseWatch, buildQuery, formatTime } from './parse.js';
import { computeRects } from './layout.js';
import { STATE, planCorrections, sharedDuration, targetTime, clamp } from './sync.js';
import { loadSettings, saveSettings, rememberSession } from './store.js';

const $ = (id) => document.getElementById(id);
const stage = $('stage');
const settings = loadSettings();
const session = parseWatch(location.search);

const ERRORS = {
  2: 'This video ID is not valid.',
  5: 'This video cannot be played in the browser.',
  100: 'This video was removed or is private.',
  101: 'This video cannot be played on other sites (the owner turned that off, or it is a finished live stream with no recording).',
  150: 'This video cannot be played on other sites (the owner turned that off, or it is a finished live stream with no recording).',
  153: 'YouTube refused the player. Open this page from a web server (http://…), not from a file.',
};

/** One entry per video. `start` = seconds into the video (or seconds behind live for a stream). */
const tiles = session.videos.map((video, index) => ({
  index, id: video.id, start: video.start,
  player: null, ready: false, usable: true, live: false, primed: false,
  title: '', lastFix: 0, lastKick: 0, el: null, parts: {},
}));

const state = {
  phase: 'loading', // loading -> ready -> priming -> running
  playing: false,
  T: 0, // shared clock: seconds since every video's start point
  audio: session.audio, // 'solo' | 'all'
  solo: 0,
  mutedAll: false,
  focus: null,
  scrubbing: false,
};

// ---------- small helpers ----------

let toastTimer;
function toast(text) {
  $('toast').textContent = text;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($('toast').hidden = true), 1800);
}

function banner(html) {
  $('banner').innerHTML = html;
  $('banner').hidden = false;
  layout();
}

const usable = () => tiles.filter((t) => t.usable && t.ready);
const recorded = () => usable().filter((t) => !t.live);
const safe = (fn, fallback) => {
  try {
    const v = fn();
    return v == null ? fallback : v;
  } catch {
    return fallback;
  }
};

function snapshot() {
  return tiles.map((t) => ({
    start: t.start,
    usable: t.usable && t.ready,
    live: t.live,
    time: t.ready ? safe(() => t.player.getCurrentTime(), 0) : 0,
    state: t.ready ? safe(() => t.player.getPlayerState(), STATE.UNSTARTED) : STATE.UNSTARTED,
    duration: t.ready ? safe(() => t.player.getDuration(), 0) : 0,
  }));
}

// ---------- layout ----------

function layout() {
  const rects = computeRects(tiles.length, stage.clientWidth, stage.clientHeight, state.focus);
  tiles.forEach((t, i) => {
    Object.assign(t.el.style, { left: `${rects[i].x}px`, top: `${rects[i].y}px`, width: `${rects[i].w}px`, height: `${rects[i].h}px` });
  });
  $('grid').hidden = state.focus == null;
}

function setFocus(index) {
  state.focus = state.focus === index ? null : index;
  tiles.forEach((t) => t.parts.focus.classList.toggle('on', t.index === state.focus));
  layout();
}

// ---------- tiles ----------

function button(text, title, onClick) {
  const b = document.createElement('button');
  b.textContent = text;
  b.title = title;
  b.addEventListener('click', onClick);
  return b;
}

function buildTile(t) {
  const el = document.createElement('div');
  el.className = 'tile';
  el.dataset.index = t.index;
  el.innerHTML = `
    <div class="frame"><div id="player-${t.index}"></div></div>
    <div class="bar">
      <span class="num">${t.index + 1}</span>
      <span class="title">Loading…</span>
      <span class="badge" hidden>LIVE</span>
      <span class="drift"></span>
      <span class="tools"></span>
    </div>
    <div class="msg" hidden></div>`;
  const tools = el.querySelector('.tools');
  t.parts = {
    title: el.querySelector('.title'),
    badge: el.querySelector('.badge'),
    drift: el.querySelector('.drift'),
    msg: el.querySelector('.msg'),
    audio: button('Sound', 'Hear this video', () => chooseAudio(t.index)),
    focus: button('Focus', 'Make this video big', () => setFocus(t.index)),
    minus: button('−0.1s', 'Shift this video 0.1s earlier (hold Shift for 1s)', (e) => nudge(t, e.shiftKey ? -1 : -0.1)),
    plus: button('+0.1s', 'Shift this video 0.1s later (hold Shift for 1s)', (e) => nudge(t, e.shiftKey ? 1 : 0.1)),
  };
  tools.append(t.parts.audio, t.parts.focus, t.parts.minus, t.parts.plus);
  t.el = el;
  stage.append(el);
}

function failTile(t, message) {
  t.usable = false;
  t.parts.title.textContent = 'Unavailable';
  t.parts.msg.hidden = false;
  t.parts.msg.innerHTML = `<strong>Video ${t.index + 1} can't be shown here</strong><span></span>
    <a class="btn" target="_blank" rel="noopener" href="https://www.youtube.com/watch?v=${t.id}">Open on YouTube</a>`;
  t.parts.msg.querySelector('span').textContent = message;
  if (state.audio === 'solo' && state.solo === t.index) {
    const next = tiles.find((x) => x.usable);
    if (next) state.solo = next.index;
  }
  applyAudio();
  checkReady();
}

function readInfo(t) {
  const data = safe(() => t.player.getVideoData(), null);
  if (!data) return;
  if (data.title) {
    t.title = data.title;
    t.parts.title.textContent = data.author ? `${data.title} — ${data.author}` : data.title;
    t.parts.title.title = t.parts.title.textContent;
  }
  const wasLive = t.live;
  t.live = Boolean(data.isLive);
  t.parts.badge.hidden = !t.live;
  if (t.live !== wasLive) {
    t.parts.minus.title = t.live ? 'Move 0.1s closer to live' : 'Shift this video 0.1s earlier (hold Shift for 1s)';
    t.parts.plus.title = t.live ? 'Move 0.1s further behind live' : 'Shift this video 0.1s later (hold Shift for 1s)';
    $('golive').hidden = !tiles.some((x) => x.live);
  }
}

// ---------- audio ----------

function applyAudio() {
  for (const t of tiles) {
    const audible = !state.mutedAll && t.usable && (state.audio === 'all' || t.index === state.solo);
    t.el.classList.toggle('audio', audible && state.audio === 'solo');
    t.parts.audio.classList.toggle('on', audible);
    if (!t.ready || state.phase !== 'running') continue;
    safe(() => t.player.setVolume(settings.volume));
    safe(() => (audible ? t.player.unMute() : t.player.mute()));
  }
  $('mute').textContent = state.mutedAll ? 'Unmute' : 'Mute';
  $('mute').classList.toggle('on', state.mutedAll);
  $('audio').value = state.audio;
}

function chooseAudio(index) {
  if (!tiles[index] || !tiles[index].usable) return;
  state.mutedAll = false;
  state.audio = 'solo';
  state.solo = index;
  applyAudio();
  syncUrl();
}

// ---------- playback ----------

function seekTile(t, T) {
  if (t.live) return;
  safe(() => t.player.seekTo(targetTime(t.start, T), true));
}

function seekAll(T) {
  const max = sharedDuration(snapshot());
  state.T = max > 0 ? clamp(T, 0, max) : Math.max(0, T);
  recorded().forEach((t) => seekTile(t, state.T));
  render();
}

function play() {
  state.playing = true;
  usable().forEach((t) => safe(() => t.player.playVideo()));
  render();
}

function pause() {
  state.playing = false;
  usable().forEach((t) => safe(() => t.player.pauseVideo()));
  render();
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

function goLive() {
  usable().filter((t) => t.live).forEach((t) => {
    const edge = safe(() => t.player.getDuration(), 0);
    if (edge > 0) safe(() => t.player.seekTo(Math.max(0, edge - t.start), true));
    safe(() => t.player.playVideo());
  });
  toast('Jumped to live');
}

/** Shift one video against the others, apply it at once, and keep it in the link. */
function nudge(t, delta) {
  t.start = Math.max(0, Math.round((t.start + delta) * 10) / 10);
  if (state.phase === 'running') {
    if (t.live) {
      const edge = safe(() => t.player.getDuration(), 0);
      if (edge > 0) safe(() => t.player.seekTo(Math.max(0, edge - t.start), true));
    } else {
      seekTile(t, currentT());
    }
  }
  t.lastFix = performance.now();
  toast(t.live ? `Video ${t.index + 1}: ${t.start.toFixed(1)}s behind live` : `Video ${t.index + 1} starts at ${formatTime(t.start, true)}`);
  syncUrl();
}

function syncUrl() {
  const query = buildQuery(tiles.map((t) => ({ id: t.id, start: t.start })), { audio: state.audio });
  history.replaceState(null, '', `?${query}`);
  $('edit').href = `index.html?${query}`;
  const label = tiles.map((t) => t.title).filter(Boolean).join(' + ').slice(0, 90);
  rememberSession(tiles.map((t) => t.id).join(','), query, label);
}

// ---------- start-up: get every video buffered, then release them together ----------

function checkReady() {
  if (state.phase !== 'loading') return;
  const pending = tiles.some((t) => t.usable && !t.ready);
  if (pending) return;
  if (!tiles.some((t) => t.usable)) {
    $('start').textContent = 'No playable videos';
    $('gate-note').textContent = 'None of these videos can be played here. Use Edit to change the list.';
    return;
  }
  state.phase = 'ready';
  $('start').disabled = false;
  $('start').textContent = usable().length > 1 ? `Start all ${usable().length} videos` : 'Start video';
  $('play').disabled = false;
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
  $('start').textContent = 'Getting every video ready…';

  // Muted playback is always allowed, so each video can buffer its start point.
  usable().forEach((t) => {
    safe(() => t.player.mute());
    safe(() => t.player.playVideo());
  });
  // YouTube sometimes drops the first play request (seen in real testing), so ask again every 1.5s.
  let asked = 0;
  const allPrimed = await waitUntil(() => usable().every((t) => t.primed), 8000, (elapsed) => {
    if (elapsed - asked < 1500) return;
    asked = elapsed;
    usable().filter((t) => !t.primed).forEach((t) => safe(() => t.player.playVideo()));
  });

  usable().forEach((t) => {
    readInfo(t);
    if (t.live) {
      if (t.start > 0) {
        const edge = safe(() => t.player.getDuration(), 0);
        if (edge > 0) safe(() => t.player.seekTo(Math.max(0, edge - t.start), true));
      }
    } else {
      safe(() => t.player.seekTo(t.start, true));
    }
  });

  state.phase = 'running';
  state.T = 0;
  $('gate').hidden = true;
  for (const id of ['back', 'fwd', 'resync']) $(id).disabled = false;
  applyAudio();
  play();
  syncUrl();
  if (!allPrimed) toast('Some videos are slow to load — they will catch up');
}

function onPlayerState(t, code) {
  if (code === STATE.PLAYING) t.lastKick = performance.now();
  if (state.phase === 'priming' && code === STATE.PLAYING && !t.primed) {
    t.primed = true;
    readInfo(t);
    if (!t.live) safe(() => t.player.pauseVideo()); // hold recorded videos; live keeps buffering
  }
  if (state.phase === 'running' && code === STATE.PLAYING) readInfo(t);
}

// ---------- the sync loop ----------

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
      safe(() => t.player.seekTo(fix.to + 0.05, true));
    }
  }

  // A video that never got going (YouTube dropped the play request) is asked again.
  // One the user paused inside its own player is left alone.
  if (state.playing) {
    tiles.forEach((t, i) => {
      const stuck = snap[i].usable && (snap[i].state === STATE.UNSTARTED || snap[i].state === STATE.CUED);
      if (stuck && now - t.lastKick > 2000) {
        t.lastKick = now;
        safe(() => t.player.playVideo());
      }
    });
  }

  // If every video stopped, show Play.
  const anyActive = snap.some((s) => s.usable && (s.state === STATE.PLAYING || s.state === STATE.BUFFERING));
  if (state.playing && !anyActive && snap.some((s) => s.usable) && now - lastCommand > 1500) state.playing = false;

  const status = $('status');
  const waiting = snap.some((s) => s.usable && !s.live && s.state !== STATE.PLAYING && s.state !== STATE.ENDED);
  if (!state.playing || plan.T == null || recorded().length < 2) status.textContent = '';
  else if (waiting) status.textContent = 'Waiting for a video…';
  else if (worst <= settings.threshold) status.textContent = 'In sync';
  else status.textContent = settings.autoSync ? 'Syncing…' : `Out of sync by ${worst.toFixed(1)}s`;
  status.classList.toggle('ok', status.textContent === 'In sync');
  render(snap);
}

let lastCommand = 0;
function render(snap = snapshot()) {
  const total = sharedDuration(snap);
  const timeline = $('timeline');
  timeline.disabled = !(state.phase === 'running' && total > 0);
  timeline.max = total;
  $('total').textContent = total > 0 ? formatTime(total) : tiles.some((t) => t.live) ? 'LIVE' : '0:00';
  if (!state.scrubbing) {
    timeline.value = clamp(state.T, 0, total || 0);
    $('now').textContent = formatTime(Math.max(0, state.T));
  }
  $('play').textContent = state.playing ? 'Pause' : 'Play';
}

// ---------- wiring ----------

function command(fn) {
  return (...args) => {
    lastCommand = performance.now();
    fn(...args);
  };
}

function wire() {
  $('start').addEventListener('click', command(start));
  $('play').addEventListener('click', command(togglePlay));
  $('back').addEventListener('click', command(() => seekAll(currentT() - 10)));
  $('fwd').addEventListener('click', command(() => seekAll(currentT() + 10)));
  $('resync').addEventListener('click', command(resync));
  $('golive').addEventListener('click', command(goLive));
  $('grid').addEventListener('click', () => state.focus != null && setFocus(state.focus));

  const timeline = $('timeline');
  timeline.addEventListener('input', () => {
    state.scrubbing = true;
    $('now').textContent = formatTime(Number(timeline.value));
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
  $('volume').value = settings.volume;
  $('volume').addEventListener('input', (e) => {
    settings.volume = Number(e.target.value);
    saveSettings(settings);
    applyAudio();
  });
  $('audio').addEventListener('change', (e) => {
    state.audio = e.target.value;
    state.mutedAll = false;
    applyAudio();
    syncUrl();
  });
  $('mute').addEventListener('click', () => {
    state.mutedAll = !state.mutedAll;
    applyAudio();
  });
  $('speed').addEventListener('change', (e) => {
    const rate = Number(e.target.value);
    recorded().forEach((t) => safe(() => t.player.setPlaybackRate(rate)));
  });
  $('share').addEventListener('click', async () => {
    syncUrl();
    try {
      await navigator.clipboard.writeText(location.href);
      toast('Link copied');
    } catch {
      toast('Copy the link from the address bar');
    }
  });
  $('full').addEventListener('click', toggleFullscreen);

  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const key = e.key.toLowerCase();
    const target = e.target instanceof Element ? e.target : null;
    // Let form fields keep their own keys, and let Space/Enter press a focused button as usual.
    if (target?.closest('input, select, textarea')) return;
    if (target?.closest('button, a') && (key === ' ' || key === 'enter')) return;
    if (key === ' ') { e.preventDefault(); command(togglePlay)(); }
    else if (key === 'arrowleft' && state.phase === 'running') { e.preventDefault(); command(() => seekAll(currentT() - 10))(); }
    else if (key === 'arrowright' && state.phase === 'running') { e.preventDefault(); command(() => seekAll(currentT() + 10))(); }
    else if (key === 'm') $('mute').click();
    else if (key === 's') command(resync)();
    else if (key === 'f') toggleFullscreen();
    else if (key === 'g' && state.focus != null) setFocus(state.focus);
    else if (/^[1-9]$/.test(key)) chooseAudio(Number(key) - 1);
  });

  // After a mouse click, hand focus back to the page so Space keeps meaning play/pause.
  // (Keyboard users who tabbed to a button keep their focus: their clicks have detail 0.)
  document.addEventListener('click', (e) => {
    if (e.detail > 0) e.target.closest?.('button')?.blur();
  });

  new ResizeObserver(layout).observe(stage);
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.().catch(() => toast('Full screen is not available here'));
}

function loadYouTubeApi() {
  return new Promise((resolve, reject) => {
    if (window.YT && window.YT.Player) return resolve();
    const timer = setTimeout(() => reject(new Error('timeout')), 15000);
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      clearTimeout(timer);
      previous?.();
      resolve();
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = () => {
      clearTimeout(timer);
      reject(new Error('blocked'));
    };
    document.head.append(script);
  });
}

function createPlayers() {
  for (const t of tiles) {
    t.player = new window.YT.Player(`player-${t.index}`, {
      host: 'https://www.youtube-nocookie.com', // YouTube's privacy-enhanced player
      videoId: t.id,
      width: '100%',
      height: '100%',
      playerVars: { playsinline: 1, rel: 0, start: Math.floor(t.start), origin: location.origin },
      events: {
        onReady: () => {
          t.ready = true;
          readInfo(t);
          if (!t.title) t.parts.title.textContent = `Video ${t.index + 1}`;
          checkReady();
        },
        onStateChange: (e) => onPlayerState(t, e.data),
        onError: (e) => failTile(t, ERRORS[e.data] || `YouTube reported error ${e.data}.`),
      },
    });
  }
}

async function main() {
  if (!tiles.length) {
    $('gate').innerHTML = '<p>No videos in this link.</p><a class="btn primary" href="index.html">Add videos</a>';
    return;
  }
  $('edit').href = `index.html${location.search}`;
  tiles.forEach(buildTile);
  wire();
  layout();
  applyAudio();
  if (location.protocol === 'file:') {
    banner('This page is opened as a file, and YouTube blocks players on file pages. Run <code>npm start</code> in the project folder and open <code>http://localhost:8080</code> instead.');
  }
  try {
    await loadYouTubeApi();
  } catch {
    banner('The YouTube player could not be loaded. Check your connection, or allow youtube.com in your ad blocker, then reload.');
    $('start').textContent = 'YouTube player blocked';
    return;
  }
  createPlayers();
  setInterval(tick, 500);
  // A video that never answers must not hold the others hostage.
  setTimeout(() => {
    tiles.filter((t) => t.usable && !t.ready).forEach((t) => failTile(t, 'This video did not load in time.'));
  }, 20000);
}

main();
