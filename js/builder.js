import { parseInput, parseTime, formatTime, buildQuery, parseWatch } from './parse.js';
import { loadRecent, clearRecent } from './store.js';

const $ = (id) => document.getElementById(id);
const MAX_VIDEOS = 16;

// Arriving from the watch page's "Edit" button brings the videos along.
const incoming = parseWatch(location.search);
let videos = incoming.videos;
if (incoming.audio === 'all') document.querySelector('input[name=audio][value=all]').checked = true;

function audioMode() {
  return document.querySelector('input[name=audio]:checked').value;
}

function watchUrl() {
  const url = new URL('watch.html', location.href);
  url.search = buildQuery(videos, { audio: audioMode() });
  return url.href;
}

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function render() {
  const list = $('videos');
  list.replaceChildren();
  videos.forEach((video, i) => {
    const time = el('input', { type: 'text', value: formatTime(video.start, video.start % 1 !== 0), id: `start-${i}` });
    time.addEventListener('change', () => {
      video.start = parseTime(time.value);
      render();
    });
    const move = (delta) => () => {
      const j = i + delta;
      [videos[i], videos[j]] = [videos[j], videos[i]];
      render();
    };
    list.append(
      el('li', {}, [
        el('span', { className: 'n', textContent: i + 1 }),
        el('img', { src: `https://i.ytimg.com/vi/${video.id}/mqdefault.jpg`, alt: '', loading: 'lazy' }),
        el('div', { className: 'meta' }, [
          el('a', { href: `https://www.youtube.com/watch?v=${video.id}`, target: '_blank', rel: 'noopener', textContent: video.id }),
          el('label', { htmlFor: `start-${i}`, textContent: 'Start at ' }, [time]),
        ]),
        el('div', { className: 'acts' }, [
          el('button', { textContent: '↑', title: 'Move up', ariaLabel: `Move video ${i + 1} up`, disabled: i === 0, onclick: move(-1) }),
          el('button', { textContent: '↓', title: 'Move down', ariaLabel: `Move video ${i + 1} down`, disabled: i === videos.length - 1, onclick: move(1) }),
          el('button', { textContent: 'Remove', onclick: () => { videos.splice(i, 1); render(); } }),
        ]),
      ]),
    );
  });
  $('empty').hidden = videos.length > 0;
  const ready = videos.length > 0;
  $('link').value = ready ? watchUrl() : '';
  $('go').href = ready ? watchUrl() : '#';
  $('go').setAttribute('aria-disabled', String(!ready));
  $('go').style.opacity = ready ? 1 : 0.45;
  $('copy').disabled = !ready;
}

function addFromPaste() {
  const text = $('paste').value;
  const found = parseInput(text);
  const error = $('paste-error');
  error.textContent = '';
  if (!text.trim()) return;
  if (!found.length) {
    error.textContent = 'No YouTube video found in that text. Paste a link like https://www.youtube.com/watch?v=…';
    return;
  }
  const room = MAX_VIDEOS - videos.length;
  if (found.length > room) error.textContent = `Only ${MAX_VIDEOS} videos fit in one session — added the first ${Math.max(0, room)}.`;
  videos.push(...found.slice(0, Math.max(0, room)));
  $('paste').value = '';
  render();
}

$('add').addEventListener('click', addFromPaste);
$('paste').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addFromPaste();
});
$('paste').addEventListener('paste', () => setTimeout(addFromPaste, 0));
document.querySelectorAll('input[name=audio]').forEach((r) => r.addEventListener('change', render));
$('go').addEventListener('click', (e) => {
  if (!videos.length) e.preventDefault();
});
$('copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('link').value);
    $('copy').textContent = 'Copied';
  } catch {
    $('link').select();
    $('copy').textContent = 'Press Ctrl/Cmd+C';
  }
  setTimeout(() => ($('copy').textContent = 'Copy link'), 1500);
});

function renderRecent() {
  const items = loadRecent();
  $('recent-card').hidden = items.length === 0;
  $('recent').replaceChildren(
    ...items.map((item) => {
      const count = parseWatch('?' + item.query).videos.length;
      return el('li', {}, [
        el('a', { href: `watch.html?${item.query}`, textContent: item.label || `${count} video${count === 1 ? '' : 's'}` }),
        el('time', { textContent: new Date(item.at).toLocaleString() }),
      ]);
    }),
  );
}
$('clear-recent').addEventListener('click', () => {
  clearRecent();
  renderRecent();
});

render();
renderRecent();
