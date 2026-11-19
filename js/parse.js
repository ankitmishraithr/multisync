// URL + time parsing. Pure functions, no DOM — covered by tests/parse.test.mjs

const ID_RE = /^[\w-]{11}$/;

/** "90", "90s", "1h2m3s", "1:02:03", "12.5" -> seconds (>= 0). Bad input -> 0. */
export function parseTime(value) {
  if (value == null) return 0;
  const str = String(value).trim().toLowerCase();
  if (!str) return 0;
  if (/^\d+(\.\d+)?s?$/.test(str)) return parseFloat(str);
  if (/^\d+(:\d{1,2}){1,2}(\.\d+)?$/.test(str)) {
    return str.split(':').reduce((acc, part) => acc * 60 + parseFloat(part), 0);
  }
  const m = str.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?$/);
  if (m && (m[1] || m[2] || m[3])) {
    return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (parseFloat(m[3]) || 0);
  }
  return 0;
}

/** seconds -> "1:02:03" / "2:03" (tenths shown only when asked) */
export function formatTime(seconds, tenths = false) {
  const total = Math.max(0, Number(seconds) || 0);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const sec = tenths ? s.toFixed(1).padStart(4, '0') : String(Math.floor(s)).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** Compact number for links: 12 -> "12", 12.30 -> "12.3" */
export function trimNumber(n) {
  return String(Math.round(n * 10) / 10);
}

function toUrl(text) {
  try {
    return new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
}

/** Read ordered v/t pairs: ?v=A&t=10&v=B&t=20s (the ViewSync link format). */
export function parsePairs(searchParams) {
  const videos = [];
  for (const [key, value] of searchParams) {
    if (key === 'v') {
      if (ID_RE.test(value)) videos.push({ id: value, start: 0 });
      else videos.push(null); // keep position so a following t= is not misapplied
    } else if (key === 't' && videos.length) {
      const last = videos[videos.length - 1];
      if (last) last.start = parseTime(value);
    }
  }
  return videos.filter(Boolean);
}

/**
 * One pasted line -> list of {id, start}.
 * Accepts: bare ID, watch / youtu.be / live / shorts / embed links,
 * and multi-video links (ViewSync or MultiSync) which expand to several.
 */
export function parseLine(line) {
  const text = String(line || '').trim();
  if (!text) return [];
  if (ID_RE.test(text)) return [{ id: text, start: 0 }];

  const url = toUrl(text);
  if (!url) return [];
  const host = url.hostname.replace(/^(www|m|music)\./, '');
  const params = url.searchParams;
  const start = parseTime(params.get('t') || params.get('start'));

  if (host === 'youtu.be') {
    const id = url.pathname.split('/')[1];
    return ID_RE.test(id) ? [{ id, start }] : [];
  }
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const seg = url.pathname.split('/').filter(Boolean);
    if (['live', 'shorts', 'embed', 'v'].includes(seg[0]) && ID_RE.test(seg[1])) {
      return [{ id: seg[1], start }];
    }
    const id = params.get('v');
    return ID_RE.test(id) ? [{ id, start }] : [];
  }
  // Any other host: treat as a multi-video link if it carries v= pairs.
  return parsePairs(params);
}

/** Many lines (or whitespace-separated links) -> videos, duplicates kept in order. */
export function parseInput(text) {
  return String(text || '')
    .split(/[\s,]+/)
    .flatMap(parseLine);
}

/** Build the query string for the watch page. */
export function buildQuery(videos, options = {}) {
  const parts = [];
  for (const v of videos) {
    parts.push(`v=${v.id}`);
    parts.push(`t=${trimNumber(v.start || 0)}`);
  }
  if (options.audio && options.audio !== 'solo') parts.push(`audio=${options.audio}`);
  return parts.join('&');
}

export function parseWatch(search) {
  const params = new URLSearchParams(search);
  return {
    videos: parsePairs(params),
    audio: params.get('audio') === 'all' ? 'all' : 'solo',
  };
}
