// Link + time parsing for every supported source. Pure functions, no DOM — see tests/parse.test.mjs
//
// A video is { kind, id, start }.
//   kind: 'youtube' | 'twitch' (live channel) | 'twitchvod' | 'vimeo' | 'file' (direct media URL)
//   start: seconds into the video (for a live stream: seconds behind live)

const YT_ID = /^[\w-]{11}$/;
const MEDIA_EXT = /\.(mp4|m4v|mov|webm|ogv|ogg|mp3|m4a|wav|m3u8)$/i;
const TWITCH_RESERVED = new Set(['directory', 'videos', 'settings', 'p', 'downloads', 'jobs', 'store', 'turbo', 'search', 'subscriptions', 'wallet', 'privacy', 'friends', 'inventory', 'drops', 'embed']);

export const SOURCE_LABEL = { youtube: 'YouTube', twitch: 'Twitch live', twitchvod: 'Twitch video', vimeo: 'Vimeo', file: 'Video file' };

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

export function trimNumber(n) {
  return String(Math.round(n * 10) / 10);
}

function toUrl(text) {
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
}

/** The short form used in links: YouTube IDs stay bare (ViewSync compatible), others get a prefix. */
export function toToken(video) {
  switch (video.kind) {
    case 'youtube': return video.id;
    case 'twitch': return `tw:${video.id}`;
    case 'twitchvod': return `tv:${video.id}`;
    case 'vimeo': return `vm:${video.id}`;
    case 'file': return `file:${encodeURIComponent(video.id)}`;
    default: return '';
  }
}

export function parseToken(token) {
  const text = String(token || '');
  if (YT_ID.test(text)) return { kind: 'youtube', id: text };
  const cut = text.indexOf(':');
  if (cut < 0) return null;
  const prefix = text.slice(0, cut);
  const rest = text.slice(cut + 1);
  if (prefix === 'tw' && /^\w{2,25}$/.test(rest)) return { kind: 'twitch', id: rest.toLowerCase() };
  if (prefix === 'tv' && /^\d+$/.test(rest)) return { kind: 'twitchvod', id: rest };
  if (prefix === 'vm' && /^\d+(\/[0-9a-f]+)?$/.test(rest)) return { kind: 'vimeo', id: rest };
  if (prefix === 'file') {
    let url;
    try { url = new URL(decodeURIComponent(rest)); } catch { return null; }
    return /^https?:$/.test(url.protocol) ? { kind: 'file', id: url.href } : null;
  }
  return null;
}

export const videoKey = (video) => `${video.kind}:${video.id}`;

/** Where to open the original. */
export function sourceUrl(video) {
  switch (video.kind) {
    case 'youtube': return `https://www.youtube.com/watch?v=${video.id}`;
    case 'twitch': return `https://www.twitch.tv/${video.id}`;
    case 'twitchvod': return `https://www.twitch.tv/videos/${video.id}`;
    case 'vimeo': return `https://vimeo.com/${video.id}`;
    default: return video.id;
  }
}

/** A short human name before the real title is known. */
export function shortName(video) {
  if (video.kind === 'twitch') return video.id;
  if (video.kind === 'file') {
    try { return decodeURIComponent(new URL(video.id).pathname.split('/').pop()) || video.id; } catch { return video.id; }
  }
  return video.id;
}

/** Ordered v/t pairs: ?v=A&t=10&v=tw:name&t=0 */
export function parsePairs(searchParams) {
  const videos = [];
  for (const [key, value] of searchParams) {
    if (key === 'v') {
      const parsed = parseToken(value);
      videos.push(parsed ? { ...parsed, start: 0 } : null); // null keeps position so a following t= is not misapplied
    } else if (key === 't' && videos.length) {
      const last = videos[videos.length - 1];
      if (last) last.start = parseTime(value);
    }
  }
  return videos.filter(Boolean);
}

/** One pasted item -> list of videos (a multi-video link expands to several). */
export function parseLine(line) {
  const text = String(line || '').trim();
  if (!text) return [];
  const token = parseToken(text);
  if (token && token.kind !== 'file') return [{ ...token, start: 0 }];

  const url = toUrl(text);
  if (!url || !/^https?:$/.test(url.protocol) || !url.hostname.includes('.')) return [];
  const host = url.hostname.replace(/^(www|m|music|go)\./, '');
  const params = url.searchParams;
  const seg = url.pathname.split('/').filter(Boolean);
  const start = parseTime(params.get('t') || params.get('start'));

  if (host === 'youtu.be') {
    return YT_ID.test(seg[0]) ? [{ kind: 'youtube', id: seg[0], start }] : [];
  }
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (['live', 'shorts', 'embed', 'v'].includes(seg[0]) && YT_ID.test(seg[1])) return [{ kind: 'youtube', id: seg[1], start }];
    const id = params.get('v');
    return YT_ID.test(id) ? [{ kind: 'youtube', id, start }] : [];
  }
  if (host === 'twitch.tv') {
    if (seg[0] === 'videos' && /^\d+$/.test(seg[1])) return [{ kind: 'twitchvod', id: seg[1], start }];
    if (seg.length >= 1 && /^\w{2,25}$/.test(seg[0]) && !TWITCH_RESERVED.has(seg[0].toLowerCase())) {
      if (seg[1] === 'v' && /^\d+$/.test(seg[2])) return [{ kind: 'twitchvod', id: seg[2], start }];
      return [{ kind: 'twitch', id: seg[0].toLowerCase(), start: 0 }];
    }
    return [];
  }
  if (host === 'player.twitch.tv') {
    const video = (params.get('video') || '').replace(/^v/, '');
    if (/^\d+$/.test(video)) return [{ kind: 'twitchvod', id: video, start }];
    const channel = params.get('channel');
    return /^\w{2,25}$/.test(channel || '') ? [{ kind: 'twitch', id: channel.toLowerCase(), start: 0 }] : [];
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const nums = seg.filter((s) => /^\d+$/.test(s));
    if (!nums.length) return [];
    const id = nums[nums.length - 1];
    const after = seg[seg.indexOf(id) + 1];
    const hash = params.get('h') || (/^[0-9a-f]{6,}$/.test(after || '') ? after : '');
    const hashTime = parseTime((url.hash.match(/t=([\dhms.:]+)/) || [])[1]);
    return [{ kind: 'vimeo', id: hash ? `${id}/${hash}` : id, start: start || hashTime }];
  }
  if (MEDIA_EXT.test(url.pathname)) {
    const hashTime = parseTime((url.hash.match(/t=([\d.]+)/) || [])[1]);
    return [{ kind: 'file', id: url.href, start: hashTime }];
  }
  // Anything else: a multi-video link (ViewSync or MultiSync) if it carries v= pairs.
  return parsePairs(params);
}

/** Many lines (or whitespace-separated links) -> videos. */
export function parseInput(text) {
  return String(text || '').split(/[\s,]+/).flatMap(parseLine);
}

export function buildQuery(videos, options = {}) {
  const parts = [];
  for (const v of videos) {
    parts.push(`v=${toToken(v)}`);
    parts.push(`t=${trimNumber(v.start || 0)}`);
  }
  if (options.audio && options.audio !== 'solo') parts.push(`audio=${options.audio}`);
  return parts.join('&');
}

export function parseWatch(search) {
  const params = new URLSearchParams(search);
  return { videos: parsePairs(params), audio: params.get('audio') === 'all' ? 'all' : 'solo' };
}
