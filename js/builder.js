import { parseInput, parseTime, formatTime, buildQuery, parseWatch, sourceUrl, shortName, SOURCE_LABEL } from './parse.js';
import { loadRecent, clearRecent, loadSaved, saveNamed, removeSaved } from './store.js';
import { hydrateIcons, setIcon, icon } from './icons.js';
import { cycleTheme, onTheme } from './theme.js';

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

function thumb(video) {
  if (video.kind === 'youtube') {
    const img = el('img', { className: 'thumb', src: `https://i.ytimg.com/vi/${video.id}/mqdefault.jpg`, alt: '', loading: 'lazy' });
    img.addEventListener('error', () => img.replaceWith(el('div', { className: 'thumb', textContent: 'YouTube' })));
    return img;
  }
  return el('div', { className: 'thumb', textContent: SOURCE_LABEL[video.kind] });
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
    const meta = el('div', {}, [
      el('a', { className: 'name', href: sourceUrl(video), target: '_blank', rel: 'noopener', textContent: shortName(video) }),
      el('span', { className: 'kind', textContent: SOURCE_LABEL[video.kind] }),
    ]);
    if (!live) meta.append(el('label', { className: 'start', htmlFor: `start-${i}`, textContent: 'Start at' }, [time]));
    list.append(
      el('li', {}, [
        el('span', { className: 'n', textContent: i + 1 }),
        thumb(video),
        meta,
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
  $('options').hidden = !ready;
  $('clear').hidden = videos.length < 2;
  $('list-title').textContent = ready ? `Your videos (${videos.length})` : 'Your videos';
  $('count').textContent = ready ? `${videos.length} video${videos.length === 1 ? '' : 's'} ready` : 'Add at least one video';
  $('go').href = ready ? watchUrl() : '#';
  $('go').setAttribute('aria-disabled', String(!ready));
  $('copy').disabled = !ready;
  $('audio').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.value === audio));
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
  const label = $('copy').lastChild;
  try {
    await navigator.clipboard.writeText(watchUrl());
    label.textContent = 'Copied';
  } catch {
    label.textContent = 'Copy failed';
  }
  setTimeout(() => (label.textContent = 'Copy link'), 1500);
});

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
