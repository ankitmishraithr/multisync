// YouTube search through the official YouTube Data API v3, using the user's own free key.
// The top half is pure (tested in tests/ytsearch.test.mjs); the bottom half talks to the network.

const API = 'https://www.googleapis.com/youtube/v3';
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Search results arrive with HTML entities in titles ("Tom &amp; Jerry"). Turn them back into text. */
export function decodeEntities(text) {
  return String(text || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code) => {
    if (code[0] !== '#') return NAMED[code.toLowerCase()] ?? whole;
    const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
  });
}

/** "PT1H2M3S" -> 3723. Live streams report "P0D" -> 0. */
export function parseIsoDuration(iso) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(iso || ''));
  if (!m) return 0;
  return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
}

export function searchUrl({ q, key, live = false, pageToken = '', max = 12 }) {
  const p = new URLSearchParams({ part: 'snippet', type: 'video', videoEmbeddable: 'true', maxResults: String(max), q, key });
  if (live) p.set('eventType', 'live');
  if (pageToken) p.set('pageToken', pageToken);
  return `${API}/search?${p}`;
}

export function videosUrl(ids, key) {
  return `${API}/videos?${new URLSearchParams({ part: 'contentDetails', id: ids.join(','), key })}`;
}

/** API response -> the few fields the page shows. Anything malformed is skipped. */
export function mapSearch(json) {
  const items = (json && Array.isArray(json.items) ? json.items : [])
    .filter((it) => it && it.id && /^[\w-]{11}$/.test(it.id.videoId || ''))
    .map((it) => {
      const s = it.snippet || {};
      const thumb = (s.thumbnails && (s.thumbnails.medium || s.thumbnails.default) || {}).url || '';
      return {
        id: it.id.videoId,
        title: decodeEntities(s.title),
        channel: decodeEntities(s.channelTitle),
        thumb: /^https:\/\//.test(thumb) ? thumb : '',
        live: s.liveBroadcastContent === 'live',
        upcoming: s.liveBroadcastContent === 'upcoming',
        duration: 0,
      };
    });
  return { items, next: (json && typeof json.nextPageToken === 'string' && json.nextPageToken) || '' };
}

/** id -> seconds, from a videos.list response. */
export function mapDurations(json) {
  const out = {};
  for (const it of (json && Array.isArray(json.items) ? json.items : [])) {
    if (it && it.id && it.contentDetails) out[it.id] = parseIsoDuration(it.contentDetails.duration);
  }
  return out;
}

/** Turn an API failure into one plain sentence, plus whether the key itself is the problem. */
export function explainError(status, json) {
  const err = (json && json.error) || {};
  const reason = (err.errors && err.errors[0] && err.errors[0].reason) || '';
  const message = String(err.message || '');
  if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded' || reason === 'rateLimitExceeded') {
    return { text: "Today's free searches are used up. They reset at midnight US Pacific time (early afternoon in India). Pasting links still works.", badKey: false };
  }
  if (reason === 'keyInvalid' || /API key not valid/i.test(message)) {
    return { text: 'YouTube did not accept that key. Check that you copied all of it, then save it again.', badKey: true };
  }
  if (reason === 'accessNotConfigured' || /has not been used|is disabled/i.test(message)) {
    return { text: 'The key is fine, but "YouTube Data API v3" is not switched on for its project. Enable it in Google Cloud, wait a minute, and search again.', badKey: false };
  }
  if (/referer|referrer|IP address/i.test(message) || reason === 'ipRefererBlocked') {
    return { text: `The key is limited to other websites. In Google Cloud, add ${typeof location === 'undefined' ? 'this site' : location.origin}/* to the key's allowed websites.`, badKey: false };
  }
  return { text: `YouTube search failed (error ${status}). Try again in a moment.`, badKey: false };
}

// ---------- network ----------

export class SearchError extends Error {
  constructor(info) {
    super(info.text);
    this.badKey = Boolean(info.badKey);
    this.local = Boolean(info.local); // the keyless search through MultiSync's own server failed
  }
}

async function getJson(url) {
  let response;
  try {
    response = await fetch(url);
  } catch {
    throw new SearchError({ text: 'Could not reach YouTube. Check your connection or ad blocker.', badKey: false });
  }
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new SearchError(explainError(response.status, json));
  return json;
}

const cache = new Map(); // the same search asked twice in one visit costs nothing

/** One page of results. Uses 1 search from the daily allowance, plus a cheap lookup for durations. */
export async function searchYouTube({ q, key, live = false, pageToken = '' }) {
  const cacheKey = JSON.stringify([q.toLowerCase(), live, pageToken]);
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  const page = mapSearch(await getJson(searchUrl({ q, key, live, pageToken })));
  const ids = page.items.filter((it) => !it.live && !it.upcoming).map((it) => it.id);
  if (ids.length) {
    try {
      const durations = mapDurations(await getJson(videosUrl(ids, key)));
      page.items.forEach((it) => (it.duration = durations[it.id] || 0));
    } catch {
      /* durations are a nicety; results are still useful without them */
    }
  }
  cache.set(cacheKey, page);
  return page;
}

// ---------- search without a key, through MultiSync's own server (server.js) ----------

let localSearch = null; // unknown until asked once

/** True when the page was opened from MultiSync's own server, which can search without a key. */
export async function localSearchAvailable() {
  if (localSearch != null) return localSearch;
  try {
    const response = await fetch('api/health');
    const json = response.ok ? await response.json() : null;
    localSearch = Boolean(json && json.search);
  } catch {
    localSearch = false;
  }
  return localSearch;
}

export async function searchLocal({ q, live = false }) {
  const cacheKey = JSON.stringify(['local', q.toLowerCase(), live]);
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  let response;
  try {
    response = await fetch(`api/search?${new URLSearchParams({ q, ...(live ? { live: '1' } : {}) })}`);
  } catch {
    throw new SearchError({ text: 'MultiSync on this computer has stopped. Start it again, then search.', local: true });
  }
  const json = await response.json().catch(() => null);
  if (!response.ok || !json || !Array.isArray(json.items)) {
    throw new SearchError({ text: `Search could not read YouTube just now${json && json.error ? ` (${String(json.error).slice(0, 120)})` : ''}.`, local: true });
  }
  // Keep only well-formed entries; this data came from a web page, not a contract.
  const items = json.items
    .filter((it) => it && /^[\w-]{11}$/.test(it.id || '') && typeof it.title === 'string')
    .map((it) => ({ id: it.id, title: it.title, channel: String(it.channel || ''), thumb: `https://i.ytimg.com/vi/${it.id}/mqdefault.jpg`, live: Boolean(it.live), upcoming: Boolean(it.upcoming), duration: Number(it.duration) || 0 }));
  const page = { items, next: '' };
  cache.set(cacheKey, page);
  return page;
}

let jsonpCount = 0;
/**
 * Search suggestions as you type. Needs no key. This is the same public endpoint
 * youtube.com's own search box uses; it is not a documented API, so any failure
 * simply means "no suggestions".
 */
export function suggest(q) {
  return new Promise((resolve) => {
    const name = `__multisyncSuggest${++jsonpCount}`;
    const script = document.createElement('script');
    const done = (list) => {
      clearTimeout(timer);
      delete window[name];
      script.remove();
      resolve(list);
    };
    const timer = setTimeout(() => done([]), 4000);
    window[name] = (data) => {
      const raw = Array.isArray(data) && Array.isArray(data[1]) ? data[1] : [];
      done(raw.map((row) => (Array.isArray(row) ? row[0] : row)).filter((s) => typeof s === 'string').slice(0, 7));
    };
    script.src = `https://suggestqueries.google.com/complete/search?client=youtube&ds=yt&q=${encodeURIComponent(q)}&jsonp=${name}`;
    script.onerror = () => done([]);
    document.head.append(script);
  });
}
