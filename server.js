// MultiSync's own small server. Run it with:  npm start   (or double-click start.command)
//
// It does two things, both only for this computer (it listens on 127.0.0.1, not the network):
//   1. serves the files in this folder, like any static server
//   2. /api/search — fetches YouTube's public results page for a query and returns the videos,
//      so searching needs no API key. The browser cannot do this itself (YouTube does not
//      allow other sites to read that page), which is why a local helper is needed.
//
// No dependencies. Needs Node 18 or newer for search; older Node still serves the files.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseResultsPage, resultsUrl } from './js/ytscrape.js';

const ROOT = normalize(join(fileURLToPath(import.meta.url), '..'));
const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '127.0.0.1';
const YT_ORIGIN = process.env.MULTISYNC_YT_ORIGIN || 'https://www.youtube.com'; // overridden only by the tests
const CAN_SEARCH = typeof fetch === 'function';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
};

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

// ---------- search ----------

const cache = new Map(); // "query|live" -> { at, page }
const CACHE_MS = 5 * 60 * 1000;
let lastFetch = 0;

async function search(query, live) {
  const key = `${query.toLowerCase()}|${live}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.page;

  // Be a polite visitor: never more than about one request a second.
  const wait = lastFetch + 1000 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastFetch = Date.now();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  let html;
  try {
    const response = await fetch(resultsUrl(query, live, YT_ORIGIN), {
      signal: controller.signal,
      headers: {
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
        'accept-language': 'en-US,en;q=0.9',
        cookie: 'CONSENT=YES+1', // skips the cookie-consent page YouTube shows in some countries
      },
    });
    if (!response.ok) throw new Error(`YouTube answered ${response.status}`);
    html = await response.text();
  } finally {
    clearTimeout(timer);
  }
  const page = parseResultsPage(html);
  if (!page.understood) throw new Error('YouTube sent a page this version cannot read');
  if (cache.size > 60) cache.delete(cache.keys().next().value);
  cache.set(key, { at: Date.now(), page });
  return page;
}

async function handleApi(url, res) {
  if (url.pathname === '/api/health') return sendJson(res, 200, { ok: true, search: CAN_SEARCH });
  if (url.pathname === '/api/search') {
    const query = (url.searchParams.get('q') || '').trim();
    if (!query || query.length > 200) return sendJson(res, 400, { error: 'Type something to search for (up to 200 characters).' });
    if (!CAN_SEARCH) return sendJson(res, 501, { error: 'Search without a key needs Node 18 or newer.' });
    try {
      const page = await search(query, url.searchParams.get('live') === '1');
      return sendJson(res, 200, { items: page.items, next: '' });
    } catch (error) {
      const reason = error && error.name === 'AbortError' ? 'YouTube took too long to answer' : String((error && error.message) || error);
      return sendJson(res, 502, { error: reason });
    }
  }
  return sendJson(res, 404, { error: 'Unknown address' });
}

// ---------- files ----------

async function handleFile(url, req, res) {
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    pathname = '/';
  }
  if (pathname.endsWith('/')) pathname += 'index.html';
  const file = normalize(join(ROOT, pathname));
  const inside = file.startsWith(ROOT + sep);
  const hidden = pathname.split('/').some((part) => part.startsWith('.')); // .git and friends are never served
  if (!inside || hidden) return res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
  try {
    if (!(await stat(file)).isFile()) throw new Error('not a file');
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-cache', // always check for the latest version, so updates show on refresh
      'content-length': body.length,
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.writeHead(405, { 'content-type': 'text/plain' }).end('Method not allowed');
  const work = url.pathname.startsWith('/api/') ? handleApi(url, res) : handleFile(url, req, res);
  Promise.resolve(work).catch(() => {
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('Server error');
  });
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') console.error(`Port ${PORT} is already in use. MultiSync may already be running: open http://localhost:${PORT}`);
  else console.error(error.message);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`MultiSync is running at http://localhost:${PORT}`);
  console.log(CAN_SEARCH ? 'YouTube search works without a key.' : 'This Node version is too old for keyless search; pasted links still work.');
  console.log('Press Ctrl+C to stop.');
});
