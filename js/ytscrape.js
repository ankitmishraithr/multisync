// Reads YouTube's own search results page (the one youtube.com shows) and pulls out the videos.
// Used only by server.js, on the user's own computer. Pure functions — see tests/ytscrape.test.mjs.
//
// This is not an official API. YouTube can change the page at any time; when it does,
// parseResultsPage() returns no items and the app falls back to the free-key search.

const YT_ID = /^[\w-]{11}$/;

/** The address of a results page. `live` adds YouTube's own "Live" filter. */
export function resultsUrl(query, live = false, origin = 'https://www.youtube.com') {
  const params = new URLSearchParams({ search_query: query, hl: 'en' });
  if (live) params.set('sp', 'EgJAAQ=='); // the value youtube.com puts in the address bar for Filters > Live
  return `${origin}/results?${params}`;
}

/** Find the big JSON object the page assigns to ytInitialData. Returns null if it is not there. */
export function extractInitialData(html) {
  const marker = String(html || '').search(/ytInitialData\s*=\s*\{/);
  if (marker < 0) return null;
  const start = html.indexOf('{', marker);
  // Walk to the matching closing brace, skipping over anything inside strings.
  let depth = 0;
  let inString = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) {
      try {
        return JSON.parse(html.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

const text = (node) => {
  if (!node) return '';
  if (typeof node.simpleText === 'string') return node.simpleText;
  return Array.isArray(node.runs) ? node.runs.map((r) => (r && typeof r.text === 'string' ? r.text : '')).join('') : '';
};

/** "1:02:03" -> 3723 */
function clock(value) {
  if (!/^\d+(:\d{1,2}){1,2}$/.test(value)) return 0;
  return value.split(':').reduce((acc, part) => acc * 60 + Number(part), 0);
}

function toItem(v) {
  if (!v || !YT_ID.test(v.videoId || '')) return null;
  const badges = Array.isArray(v.badges) ? v.badges.map((b) => b && b.metadataBadgeRenderer && b.metadataBadgeRenderer.style) : [];
  const overlays = Array.isArray(v.thumbnailOverlays) ? v.thumbnailOverlays.map((o) => o && o.thumbnailOverlayTimeStatusRenderer && o.thumbnailOverlayTimeStatusRenderer.style) : [];
  const title = text(v.title).slice(0, 300);
  if (!title) return null;
  return {
    id: v.videoId,
    title,
    channel: text(v.ownerText || v.longBylineText || v.shortBylineText).slice(0, 120),
    // Built from the ID rather than copied from the page, so nothing unexpected is ever loaded.
    thumb: `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`,
    live: badges.includes('BADGE_STYLE_TYPE_LIVE_NOW') || overlays.includes('LIVE'),
    upcoming: Boolean(v.upcomingEventData) || overlays.includes('UPCOMING'),
    duration: clock(text(v.lengthText)),
  };
}

/** Collect every ordinary video result, in page order, without duplicates. Ads, Shorts and channels are skipped. */
export function mapResults(data, limit = 20) {
  const items = [];
  const seen = new Set();
  const walk = (node, depth) => {
    if (!node || typeof node !== 'object' || depth > 40 || items.length >= limit) return;
    if (Array.isArray(node)) return node.forEach((child) => walk(child, depth + 1));
    if (node.videoRenderer) {
      const item = toItem(node.videoRenderer);
      if (item && !seen.has(item.id)) {
        seen.add(item.id);
        items.push(item);
      }
      return;
    }
    if (node.adSlotRenderer || node.reelShelfRenderer || node.promotedVideoRenderer) return;
    for (const key of Object.keys(node)) walk(node[key], depth + 1);
  };
  walk(data, 0);
  return items.slice(0, limit);
}

/** html -> { items, next } in the same shape the key-based search returns. */
export function parseResultsPage(html) {
  const data = extractInitialData(html);
  return { items: data ? mapResults(data) : [], next: '', understood: Boolean(data) };
}
