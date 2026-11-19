import { parseInput, parseTime, formatTime, buildQuery, parseWatch, sourceUrl, shortName, videoKey, SOURCE_LABEL } from './parse.js';
import { loadRecent, clearRecent, loadSaved, saveNamed, removeSaved } from './store.js';
import { hydrateIcons, setIcon, icon } from './icons.js';
import { cycleTheme, onTheme } from './theme.js';
import { computeRects } from './layout.js';

const $ = (id) => document.getElementById(id);
const MAX_VIDEOS = 16;

// Arriving from the watch page's "Edit" brings the videos along.
const incoming = parseWatch(location.search);
let videos = incoming.videos.slice(0, MAX_VIDEOS);
let audio = incoming.audio;

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function iconButton(name, label, onClick, disabled = false) {
  const b = el('button', { className: 'icon-btn', title: label, disabled, onclick: onClick });
  b.innerHTML = icon(name);
  b.setAttribute('aria-label', label);
  return b;
}

function watchUrl() {
  const url = new URL('watch.html', location.href);
  url.search = buildQuery(videos, { audio });
  return url.href;
}

// ---------- titles ----------
// Asked from the video's own site (YouTube / Vimeo oEmbed), so no extra party learns anything.
// If the lookup fails the list simply keeps showing the ID.
const titles = new Map();
const OEMBED = {
  youtube: (v) => `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(sourceUrl(v))}`,
  vimeo: (v) => `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(sourceUrl(v))}`,
};

function lookupTitle(video) {
  const key = videoKey(video);
  if (titles.has(key) || !OEMBED[video.kind]) return;
  titles.set(key, null); // asked; no answer yet
  fetch(OEMBED[video.kind](video))
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (!data || !data.title) return;
      titles.set(key, { title: String(data.title), author: String(data.author_name || ''), thumb: /^https:\/\//.test(data.thumbnail_url || '') ? data.thumbnail_url : '' });
      // Don't redraw the list under someone who is typing a start time; wait until they leave the field.
      const typing = document.activeElement?.closest?.('#videos input');
      if (typing) typing.addEventListener('blur', () => setTimeout(render, 0), { once: true });
      else render();
    })
    .catch(() => {});
}

function thumbUrl(video) {
  if (video.kind === 'youtube') return `https://i.ytimg.com/vi/${video.id}/mqdefault.jpg`;
  return titles.get(videoKey(video))?.thumb || '';
}

function thumb(video) {
  const src = thumbUrl(video);
  if (src) {
    const img = el('img', { className: 'thumb', src, alt: '', loading: 'lazy' });
    img.addEventListener('error', () => img.replaceWith(el('div', { className: 'thumb', textContent: SOURCE_LABEL[video.kind] })));
    return img;
  }
  return el('div', { className: 'thumb', textContent: SOURCE_LABEL[video.kind] });
}

/** The preview: where each video will sit on the screen, using the same layout maths as the viewer. */
function renderWall() {
  const wall = $('wall');
  if (!videos.length) {
    wall.replaceChildren(el('p', { className: 'wall-empty', textContent: 'Your screen. Each link you add takes a place here.' }));
    return;
  }
  const pad = 8;
  const rects = computeRects(videos.length, wall.clientWidth - pad * 2, wall.clientHeight - pad * 2, null, 4, 0);
  // Reuse slots so they glide to their new places when the list changes.
  const slots = [...wall.querySelectorAll('.slot')];
  wall.querySelector('.wall-empty')?.remove();
  videos.forEach((video, i) => {
    const slot = slots[i] || wall.appendChild(el('div', { className: 'slot' }, [el('span', { className: 'num' }), el('em')]));
    Object.assign(slot.style, { left: `${rects[i].x + pad}px`, top: `${rects[i].y + pad}px`, width: `${rects[i].w}px`, height: `${rects[i].h}px` });
    const src = thumbUrl(video);
    slot.style.backgroundImage = src ? `url("${src}")` : '';
    slot.querySelector('span').textContent = i + 1;
    slot.querySelector('em').textContent = src ? '' : SOURCE_LABEL[video.kind];
  });
  slots.slice(videos.length).forEach((slot) => slot.remove());
}

function render() {
  const list = $('videos');
  list.replaceChildren();
  videos.forEach((video, i) => {
    const live = video.kind === 'twitch';
    const time = el('input', { type: 'text', value: formatTime(video.start, video.start % 1 !== 0), id: `start-${i}`, inputMode: 'decimal' });
    time.addEventListener('change', () => {
      video.start = parseTime(time.value);
      render();
    });
    const move = (delta) => () => {
      const j = i + delta;
      [videos[i], videos[j]] = [videos[j], videos[i]];
      render();
    };
    lookupTitle(video);
    const known = titles.get(videoKey(video));
    const sub = el('div', { className: 'sub' }, [el('span', { className: 'kind', textContent: SOURCE_LABEL[video.kind] })]);
    if (known?.author && known.author !== 'Vimeo') sub.append(el('span', { textContent: known.author }));
    if (!live) sub.append(el('label', { className: 'start', htmlFor: `start-${i}`, textContent: 'starts at' }, [time]));
    list.append(
      el('li', {}, [
        el('span', { className: 'num', textContent: i + 1 }),
        thumb(video),
        el('div', {}, [el('a', { className: 'name', href: sourceUrl(video), target: '_blank', rel: 'noopener', textContent: known?.title || shortName(video) }), sub]),
        el('div', { className: 'acts' }, [
          iconButton('up', `Move video ${i + 1} up`, move(-1), i === 0),
          iconButton('down', `Move video ${i + 1} down`, move(1), i === videos.length - 1),
          iconButton('close', `Remove video ${i + 1}`, () => { videos.splice(i, 1); render(); }),
        ]),
      ]),
    );
  });

  const ready = videos.length > 0;
  $('empty').hidden = ready;
  $('save').hidden = !ready;
  $('clear').hidden = videos.length < 2;
  $('list-title').textContent = ready ? `Your videos (${videos.length})` : 'Your videos';
  $('go').href = ready ? watchUrl() : '#';
  $('go').setAttribute('aria-disabled', String(!ready));
  $('copy').disabled = !ready;
  $('audio').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.value === audio));
  renderWall();
}

function addFromPaste() {
  const text = $('paste').value;
  const found = parseInput(text);
  const error = $('paste-error');
  error.textContent = '';
  if (!text.trim()) return;
  if (!found.length) {
    error.textContent = 'No video found in that text. Supported: YouTube, Twitch, Vimeo, and direct video file links (.mp4, .webm).';
    return;
  }
  const room = Math.max(0, MAX_VIDEOS - videos.length);
  if (found.length > room) error.textContent = `One session holds up to ${MAX_VIDEOS} videos. Added the first ${room}.`;
  videos.push(...found.slice(0, room));
  $('paste').value = '';
  render();
}

$('add').addEventListener('click', addFromPaste);
$('paste').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    addFromPaste();
  }
});
$('paste').addEventListener('paste', () => setTimeout(addFromPaste, 0));
$('clear').addEventListener('click', () => { videos = []; render(); });
$('audio').addEventListener('click', (e) => {
  const value = e.target.closest('button')?.dataset.value;
  if (value) { audio = value; render(); }
});
$('go').addEventListener('click', (e) => { if (!videos.length) e.preventDefault(); });
$('copy').addEventListener('click', async () => {
  let message = 'Link copied';
  try {
    await navigator.clipboard.writeText(watchUrl());
  } catch {
    message = 'Could not copy. Open the session and copy from the address bar.';
  }
  const error = $('paste-error');
  $('copy').title = message;
  $('copy').classList.add('on');
  $('copy').setAttribute('aria-label', message);
  setTimeout(() => { $('copy').classList.remove('on'); $('copy').title = 'Copy link'; $('copy').setAttribute('aria-label', 'Copy link'); }, 1500);
  if (message !== 'Link copied') error.textContent = message;
});
new ResizeObserver(renderWall).observe($('wall'));

// ---------- saved sets and recent sessions (this browser only) ----------

function sessionRow(query, label, right) {
  const count = parseWatch('?' + query).videos.length;
  return el('li', {}, [el('a', { href: `watch.html?${query}`, textContent: label || `${count} video${count === 1 ? '' : 's'}` }), ...right]);
}

function renderLists() {
  const saved = loadSaved();
  $('saved-section').hidden = saved.length === 0;
  $('saved').replaceChildren(...saved.map((item) => sessionRow(item.query, item.name, [
    iconButton('edit', `Edit ${item.name}`, () => { location.href = `index.html?${item.query}`; }),
    iconButton('close', `Delete ${item.name}`, () => { removeSaved(item.name); renderLists(); }),
  ])));
  const recent = loadRecent();
  $('recent-section').hidden = recent.length === 0;
  $('recent').replaceChildren(...recent.map((item) => sessionRow(item.query, item.label, [
    el('time', { textContent: new Date(item.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) }),
  ])));
}

$('clear-recent').addEventListener('click', () => { clearRecent(); renderLists(); });
$('save').addEventListener('click', () => {
  $('save-name').value = '';
  $('save-dialog').showModal();
});
$('save-cancel').addEventListener('click', () => $('save-dialog').close());
$('save-form').addEventListener('submit', () => {
  // Read the name now: by the time the dialog's close event fires, focus has already moved on.
  const name = $('save-name').value.trim();
  if (!name || !videos.length) return;
  saveNamed(name, buildQuery(videos, { audio }));
  renderLists();
});

$('theme').addEventListener('click', cycleTheme);
onTheme((mode) => {
  setIcon($('theme'), { auto: 'auto', light: 'sun', dark: 'moon' }[mode]);
  const label = { auto: 'Theme: follows your device', light: 'Theme: day', dark: 'Theme: night' }[mode];
  $('theme').title = label;
  $('theme').setAttribute('aria-label', label);
});

hydrateIcons();
render();
renderLists();
