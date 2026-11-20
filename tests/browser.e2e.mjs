// End-to-end checks of both pages in a real browser, using offline stand-ins for the video sites.
// Run: npm run test:browser   (needs Playwright: npm i -D playwright)
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || '/opt/npm-tools/node_modules/playwright')); }

// A real 120-second silent WAV, built in memory, to exercise the plain <video> adapter.
function silentWav(seconds, rate = 8000) {
  const data = Buffer.alloc(seconds * rate, 128);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVEfmt ', 8);
  head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24); head.writeUInt32LE(rate, 28); head.writeUInt16LE(1, 32); head.writeUInt16LE(8, 34);
  head.write('data', 36); head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}
const WAV = silentWav(120);

const root = normalize(join(fileURLToPath(import.meta.url), '..', '..'));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.mjs': 'text/javascript' };
const server = http.createServer(async (req, res) => {
  const path = normalize(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
  if (path === 'media/clip.wav') {
    const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
    if (!m) return res.writeHead(200, { 'content-type': 'audio/wav', 'accept-ranges': 'bytes', 'content-length': WAV.length }).end(WAV);
    const from = Number(m[1]);
    const to = m[2] ? Number(m[2]) : WAV.length - 1;
    return res.writeHead(206, { 'content-type': 'audio/wav', 'accept-ranges': 'bytes', 'content-range': `bytes ${from}-${to}/${WAV.length}`, 'content-length': to - from + 1 }).end(WAV.subarray(from, to + 1));
  }
  try {
    const body = await readFile(join(root, path));
    res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end('not found'); }
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;
const FILE = `file:${encodeURIComponent(`${base}/media/clip.wav`)}`;

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] }).catch(() => chromium.launch());
const results = [];
const problems = [];

async function open(path, { mock = true, viewport = { width: 1280, height: 720 }, context, theme } = {}) {
  const ctx = context || (await browser.newContext({ viewport, colorScheme: theme || 'dark' }));
  await ctx.route(/ytimg\.com|youtube\.com|twitch\.tv|vimeo\.com|googleapis\.com|suggestqueries/, (route) => route.abort());
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`${path}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/ERR_FAILED|Failed to load resource/.test(m.text()) && problems.push(`${path}: ${m.text()}`));
  if (mock) await page.addInitScript({ path: join(root, 'tests', 'mock-players.js') });
  await page.goto(base + path);
  return page;
}
async function check(name, fn) {
  try { await fn(); results.push(`ok   ${name}`); }
  catch (e) { results.push(`FAIL ${name}\n     ${e.message.split('\n')[0]}`); process.exitCode = 1; }
}
const players = (page) => page.evaluate(() => Object.fromEntries(Object.entries(window.__players).map(([id, p]) => [id, { t: p.t, state: p.state, muted: p.muted, rate: p.rate, vol: p.volume, seeks: p.seeks, behind: Date.now() / 1000 - p.reference() }])));
const begin = async (page) => {
  await page.waitForFunction(() => document.getElementById('start').dataset.action === 'start' && !document.getElementById('start').disabled);
  await page.click('#start');
  await page.waitForSelector('#gate', { state: 'hidden' });
};
const inSync = (page) => page.waitForFunction(() => document.getElementById('status').textContent === 'In sync');
const tool = (page, n, title) => page.locator('.tile').nth(n).locator(`.tool[title^="${title}"]`);
const boxes = (page) => page.locator('.tile-body').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }));
const A = 'AAAAAAAAAAA', B = 'BBBBBBBBBBB', C = 'CCCCCCCCCCC';

await check('builder: mixed sources, start times, link, errors, save, theme', async () => {
  const page = await open('/index.html', { theme: 'light' });
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light');
  await page.fill('#paste', [`https://youtu.be/${A}?t=1m5s`, `https://viewsync.net/watch?v=${B}&t=20s&v=${C}&t=0`, 'https://www.twitch.tv/SomeChannel', 'https://vimeo.com/76979871', 'https://cdn.example.com/My%20Clip.mp4'].join('\n'));
  await page.click('#add');
  assert.equal(await page.locator('#videos li').count(), 6);
  assert.equal(await page.inputValue('#start-0'), '1:05');
  assert.deepEqual(await page.locator('#videos .kind').allTextContents(), ['YouTube', 'YouTube', 'YouTube', 'Twitch live', 'Vimeo', 'Video file']);
  assert.equal(await page.locator('#videos li').nth(5).locator('.name').textContent(), 'My Clip.mp4');
  assert.equal(await page.locator('#start-3').count(), 0, 'a live channel has no start time');
  await page.fill('#start-2', '1m30s');
  await page.locator('#start-2').blur();
  const link = await page.getAttribute('#go', 'href');
  assert.ok(link.includes(`watch.html?v=${A}&t=65&v=${B}&t=20&v=${C}&t=90&v=tw:somechannel&t=0&v=vm:76979871&t=0&v=file:https%3A%2F%2Fcdn.example.com`), link);
  await page.fill('#paste', 'https://example.com/not-a-video');
  assert.equal((await page.textContent('#add')).trim(), 'Search', 'anything that is not a video link is treated as a search');
  await page.fill('#paste', '');
  await page.locator('#videos li').nth(0).getByLabel('Remove video 1').click();
  assert.equal(await page.locator('#videos li').count(), 5);
  assert.equal(await page.textContent('#list-title'), 'Your videos (5)');
  assert.equal(await page.locator('#wall .slot').count(), 5, 'preview shows a place for each video');
  // titles come from the video site's own lookup when it answers
  const titled = await open(`/index.html?v=${A}&t=5`, { theme: 'light' });
  assert.equal(await titled.locator('#videos .name').textContent(), A, 'falls back to the ID when the lookup is blocked');
  await titled.route(/youtube\.com\/oembed/, (r) => r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ title: 'Morning <b>market</b> stream', author_name: 'Some Channel' }) }));
  await titled.reload();
  await titled.waitForFunction(() => document.querySelector('#videos .name').textContent.startsWith('Morning'));
  assert.equal(await titled.locator('#videos .name').textContent(), 'Morning <b>market</b> stream', 'shown as plain text');
  assert.equal(await titled.inputValue('#start-0'), '0:05', 'start time survives the re-draw');
  await titled.context().close();
  // save a named set
  await page.click('#save');
  await page.fill('#save-name', 'Morning streams');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#saved li a').textContent(), 'Morning streams');
  // theme cycles auto -> day -> night and is remembered
  await page.click('#theme');
  await page.click('#theme');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  await page.reload();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  assert.equal(await page.locator('#saved li').count(), 1);
  await page.context().close();
});

await check('watch: one click starts everything, in sync, one audio source', async () => {
  const page = await open(`/watch.html?v=${A}&t=10&v=SLOWBBBBBBB&t=100&v=${C}&t=0`);
  await page.waitForFunction(() => !document.getElementById('start').disabled);
  assert.equal((await page.textContent('#start')).trim(), 'Start all 3');
  await begin(page);
  // the slow video buffers again after release; the sync loop must pull it level by itself
  await page.waitForFunction(() => Object.values(window.__players).every((x) => x.state === 1));
  await inSync(page);
  const p = await players(page);
  const offs = [p[A].t - 10, p.SLOWBBBBBBB.t - 100, p[C].t - 0];
  assert.ok(Math.max(...offs) - Math.min(...offs) < 0.3, `spread ${offs.map((x) => x.toFixed(2))}`);
  assert.deepEqual([p[A].muted, p.SLOWBBBBBBB.muted, p[C].muted], [false, true, true]);
  assert.equal(await page.getAttribute('#play', 'aria-label'), 'Pause');
  assert.equal(await page.textContent('#total'), '8:20'); // 600 - 100

  await page.evaluate(() => window.__players.CCCCCCCCCCC.skew(3)); // drift repair
  await page.waitForTimeout(1500);
  let q = await players(page);
  assert.ok(Math.abs(q[C].t - (q[A].t - 10)) < 0.4, `drift left ${(q[C].t - (q[A].t - 10)).toFixed(2)}`);
  await inSync(page);

  const before = q[A].t;
  await page.click('#fwd');
  await page.waitForTimeout(300);
  q = await players(page);
  assert.ok(q[A].t - before > 9.5 && q[A].t - before < 11.5, `jump ${q[A].t - before}`);

  await page.locator('body').press('2'); // keyboard: 2 moves sound, space pauses
  q = await players(page);
  assert.deepEqual([q[A].muted, q.SLOWBBBBBBB.muted], [true, false]);
  await page.locator('body').press(' ');
  await page.waitForTimeout(200);
  q = await players(page);
  assert.ok(Object.values(q).every((x) => x.state === 2), 'all paused');
  assert.equal(await page.getAttribute('#play', 'aria-label'), 'Play');

  await page.locator('#timeline').fill('200'); // scrub while paused
  await page.locator('#timeline').dispatchEvent('change');
  q = await players(page);
  assert.equal(Math.round(q[A].t), 210);
  assert.equal(Math.round(q[C].t), 200);
  assert.equal(await page.textContent('#now'), '3:20');

  await page.locator('.tile').nth(2).hover(); // nudge is written to the link
  await tool(page, 2, 'Shift 0.1s later').click();
  assert.match(page.url(), /v=CCCCCCCCCCC&t=0\.1/);
  q = await players(page);
  assert.ok(Math.abs(q[C].t - 200.1) < 0.01);

  await page.click('#more'); // sound mode, speed, mute
  await page.click('#audio button[data-value=all]');
  await page.selectOption('#speed', '1.5');
  q = await players(page);
  assert.ok(Object.values(q).every((x) => !x.muted && x.rate === 1.5));
  assert.match(page.url(), /audio=all/);
  await page.keyboard.press('Escape');
  assert.ok(await page.locator('#menu').isHidden());
  await page.locator('.tile').nth(0).hover(); // per-video volume in "all" mode
  await page.locator('.tile').nth(0).locator('.tile-volume').fill('50');
  q = await players(page);
  assert.equal(q[A].vol, 50);
  await page.click('#mute');
  q = await players(page);
  assert.ok(Object.values(q).every((x) => x.muted));
  await page.context().close();
});

await check('watch: a blocked video does not stop the others; live is recognised; chat opens', async () => {
  const page = await open(`/watch.html?v=${A}&t=0&v=BLOCKBBBBBB&t=0&v=LIVECCCCCCC&t=0&v=${B}&t=5`);
  await page.waitForFunction(() => document.getElementById('start').dataset.action === 'start' && !document.getElementById('start').disabled);
  assert.equal((await page.textContent('#start')).trim(), 'Start all 3');
  assert.match(await page.locator('.tile').nth(1).locator('.msg').textContent(), /has ended and left no recording, or its owner does not allow/);
  await begin(page);
  await page.waitForTimeout(800);
  const p = await players(page);
  assert.equal(p[A].state, 1);
  assert.equal(p.LIVECCCCCCC.state, 1);
  assert.ok(Math.abs(p[B].t - 5 - p[A].t) < 0.3);
  assert.equal(await page.locator('.tile').nth(2).locator('.badge').getAttribute('hidden'), null);
  assert.ok(await page.locator('#golive').isVisible());
  assert.equal(await page.textContent('#total'), '9:55'); // live + blocked ignored
  await page.waitForTimeout(1500); // live stream is never dragged around by the sync loop
  assert.equal((await players(page)).LIVECCCCCCC.seeks, 0);

  const wide = (await boxes(page))[0].w;
  await page.click('#chat-btn');
  assert.match(await page.getAttribute('#chat-frame', 'src'), /youtube\.com\/live_chat\?v=LIVECCCCCCC&embed_domain=localhost&dark_theme=1/);
  await page.waitForTimeout(350);
  assert.ok((await boxes(page))[0].w < wide, 'videos make room for chat');
  await page.click('#chat-close');
  assert.ok(await page.locator('#chat').isHidden());

  await page.locator('.tile').nth(1).locator('.msg').getByText('Remove').click(); // drop the broken one
  assert.equal(await page.locator('.tile').count(), 3);
  assert.ok(!page.url().includes('BLOCK'));
  await page.context().close();
});

await check('watch: a video that ignores the first play request still starts in sync', async () => {
  const page = await open(`/watch.html?v=${A}&t=0&v=FLAKYBBBBBB&t=50`);
  await page.waitForFunction(() => !document.getElementById('start').disabled);
  const t0 = Date.now();
  await begin(page);
  assert.ok(Date.now() - t0 < 4000, `start took ${Date.now() - t0}ms`);
  await inSync(page);
  const p = await players(page);
  assert.ok(Math.abs(p.FLAKYBBBBBB.t - 50 - p[A].t) < 0.3);
  await page.context().close();
});

await check('watch: YouTube + Vimeo + Twitch video + a real media file stay in sync together', async () => {
  const page = await open(`/watch.html?v=${A}&t=30&v=vm:12345&t=10&v=tv:999&t=20&v=${FILE}&t=5&v=tw:somechannel&v=tw:offlinechan`);
  await begin(page);
  await inSync(page);
  await page.waitForTimeout(1200);
  const p = await players(page);
  const fileTime = await page.evaluate(() => document.querySelector('video').currentTime);
  const offs = [p[A].t - 30, p.vimeo12345.t - 10, p['999'].t - 20, fileTime - 5];
  assert.ok(Math.max(...offs) - Math.min(...offs) < 0.5, `spread ${offs.map((x) => x.toFixed(2))}`);
  assert.equal(await page.evaluate(() => document.querySelector('video').paused), false);
  assert.equal(p.somechannel.state, 1);
  assert.deepEqual(await page.evaluate(() => window.__twitchOptions.parent), ['localhost']);
  assert.equal(await page.textContent('#total'), '1:55'); // the 120s file minus its 5s start is the shortest
  assert.match(await page.locator('.tile').nth(5).locator('.msg').textContent(), /offline/);
  assert.equal(await page.locator('.tile').nth(1).locator('.title').textContent(), 'Vimeo title 12345');
  assert.equal(await page.locator('.tile').nth(3).locator('.title').textContent(), 'clip.wav');
  assert.equal(await tool(page, 4, 'Shift 0.1s later').count(), 0, 'no nudge on a Twitch live channel');
  // seek everything, including the real file
  await page.locator('#timeline').fill('60');
  await page.locator('#timeline').dispatchEvent('change');
  await page.waitForTimeout(900);
  const q = await players(page);
  const ft = await page.evaluate(() => document.querySelector('video').currentTime);
  assert.ok(Math.abs(q.vimeo12345.t - 10 - (q[A].t - 30)) < 0.5 && Math.abs(ft - 5 - (q[A].t - 30)) < 0.5, `after seek ${(ft - 5).toFixed(2)} vs ${(q[A].t - 30).toFixed(2)}`);
  assert.ok(ft > 64 && ft < 68);
  await page.context().close();
});

await check('watch: add and remove videos without restarting the others', async () => {
  const page = await open(`/watch.html?v=${A}&t=10&v=${B}&t=0`);
  await begin(page);
  await inSync(page);
  await page.click('#add');
  await page.fill('#add-input', `https://youtu.be/${C}?t=40`);
  assert.equal((await page.textContent('#add-go')).trim(), 'Add');
  await page.keyboard.press('Enter');
  assert.ok(await page.locator('#adder').isHidden(), 'closes after adding a pasted link');
  assert.equal(await page.locator('.tile').count(), 3);
  await page.waitForFunction(() => window.__players.CCCCCCCCCCC && window.__players.CCCCCCCCCCC.state === 1);
  await inSync(page);
  let p = await players(page);
  assert.ok(Math.abs(p[C].t - 40 - (p[A].t - 10)) < 0.4, 'new video joined in sync');
  assert.equal(p[C].muted, true);
  assert.equal(p[A].seeks <= 2, true, 'existing videos were not restarted');
  assert.match(page.url(), /v=CCCCCCCCCCC&t=40/);
  await page.locator('.tile').nth(0).hover();
  await tool(page, 0, 'Remove this video').click();
  assert.equal(await page.locator('.tile').count(), 2);
  assert.ok(!page.url().includes(A));
  p = await players(page);
  assert.equal(p[B].state, 1);
  assert.equal(p[B].muted, false, 'sound moved to a remaining video');
  assert.deepEqual(await page.locator('.tile .num').allTextContents(), ['1', '2']);
  await page.context().close();

  const empty = await open('/watch.html');
  assert.match(await empty.textContent('#gate'), /No videos yet/);
  await empty.click('#start');
  assert.ok(await empty.locator('#adder').isVisible());
  await empty.fill('#add-input', A);
  await empty.keyboard.press('Enter');
  await begin(empty);
  await empty.waitForFunction(() => window.__players.AAAAAAAAAAA.state === 1);
  await empty.context().close();
});

await check('live: delay is shown, a pause or stall is caught up automatically, and it can be switched off', async () => {
  const page = await open(`/watch.html?v=LIVEAAAAAAA&v=${B}&t=5`);
  await begin(page);
  const drift = page.locator('.tile').nth(0).locator('.drift');
  await page.waitForFunction(() => /behind real time/.test(document.querySelector('.tile .drift').textContent));
  assert.match(await drift.textContent(), /^1[4-6]s behind real time$/);
  let p = await players(page);
  assert.ok(p.LIVEAAAAAAA.behind < 16, `starts at the live point (${p.LIVEAAAAAAA.behind.toFixed(1)}s)`);
  assert.equal(p.LIVEAAAAAAA.seeks, 0, 'a level stream is never touched');

  // Pause stops the recorded video only; the live stream keeps playing and stays level
  await page.locator('body').press(' ');
  await page.waitForTimeout(2500);
  p = await players(page);
  assert.deepEqual([p.LIVEAAAAAAA.state, p[B].state], [1, 2], 'live keeps playing while the recording is paused');
  assert.equal(await page.getAttribute('#play', 'aria-label'), 'Play');
  assert.ok(p.LIVEAAAAAAA.behind < 16 && p.LIVEAAAAAAA.rate === 1 && p.LIVEAAAAAAA.seeks === 0, 'and it did not fall behind');
  await page.locator('body').press(' ');
  await page.waitForFunction((id) => window.__players[id].state === 1, B);

  // a short stall (2.5s behind): back level by playing slightly fast, no jump
  await page.evaluate(() => window.__players.LIVEAAAAAAA.skew(-2.5));
  await page.waitForFunction(() => window.__players.LIVEAAAAAAA.rate > 1, null, { timeout: 5000 });
  assert.match(await drift.textContent(), /catching up/);
  await page.waitForFunction(() => window.__players.LIVEAAAAAAA.rate === 1 && /^\d+s behind/.test(document.querySelector('.tile .drift').textContent), null, { timeout: 20000 });
  p = await players(page);
  assert.ok(p.LIVEAAAAAAA.behind < 16.2, `level again after a short stall (${p.LIVEAAAAAAA.behind.toFixed(1)}s)`);
  assert.equal(p.LIVEAAAAAAA.seeks, 0);
  assert.equal(p[B].rate, 1, 'the recorded video keeps normal speed');

  // a long stall (10s behind): jumps to live, then closes the last few seconds
  await page.evaluate(() => window.__players.LIVEAAAAAAA.skew(-10));
  await page.waitForFunction(() => window.__players.LIVEAAAAAAA.seeks === 1, null, { timeout: 5000 });
  await page.waitForFunction(() => window.__players.LIVEAAAAAAA.rate === 1 && /^\d+s behind/.test(document.querySelector('.tile .drift').textContent), null, { timeout: 25000 });
  p = await players(page);
  assert.ok(p.LIVEAAAAAAA.behind < 16.2, `level again after a stall (${p.LIVEAAAAAAA.behind.toFixed(1)}s)`);

  // switched off: the page only reports the delay
  await page.click('#more');
  await page.uncheck('#staylive');
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__players.LIVEAAAAAAA.skew(-10));
  await page.waitForTimeout(2500);
  p = await players(page);
  assert.ok(p.LIVEAAAAAAA.behind > 24 && p.LIVEAAAAAAA.rate === 1 && p.LIVEAAAAAAA.seeks === 1, 'left alone when switched off');
  assert.match(await drift.textContent(), /^2[4-6]s behind real time$/);
  await page.click('#golive'); // the button still works by hand
  await page.waitForFunction(() => window.__players.LIVEAAAAAAA.seeks === 2);

  // a live stream that is hours behind (the player started from an old point) is brought to live
  await page.click('#more');
  await page.check('#staylive');
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__players.LIVEAAAAAAA.skew(-3000));
  await page.waitForFunction(() => Date.now() / 1000 - window.__players.LIVEAAAAAAA.reference() < 25, null, { timeout: 8000 });
  await page.waitForFunction(() => /^\d+s behind/.test(document.querySelector('.tile .drift').textContent), null, { timeout: 25000 });
  assert.match(await drift.textContent(), /^1\ds behind real time$/, 'the old point is never accepted as normal');

  // the broadcaster ends the stream: the tile says so, and offers the recording
  const badge = page.locator('.tile').nth(0).locator('.badge');
  assert.equal(await badge.textContent(), 'LIVE');
  await page.evaluate(() => window.__players.LIVEAAAAAAA.end());
  await page.waitForSelector('.tile .ended-note:not([hidden])');
  assert.equal(await badge.textContent(), 'ENDED');
  assert.match(await page.locator('.tile').nth(0).locator('.ended-note').textContent(), /This live stream has ended/);
  assert.equal(await drift.textContent(), '');
  assert.ok(await page.locator('#golive').isHidden(), 'no live streams left, so no Go live button');
  assert.equal((await players(page))[B].state, 1, 'the other video carries on');
  await page.waitForTimeout(1500);
  assert.equal(await badge.textContent(), 'ENDED', 'it does not flip back to LIVE');
  await page.evaluate(() => { window.__old = window.__players.LIVEAAAAAAA; });
  await page.locator('.tile').nth(0).getByText('Watch the recording').click();
  await page.waitForFunction(() => window.__players.LIVEAAAAAAA && window.__players.LIVEAAAAAAA !== window.__old && window.__players.LIVEAAAAAAA.state === 1);
  assert.ok(await page.locator('.tile').nth(0).locator('.ended-note').isHidden());
  assert.equal(await page.locator('.tile').count(), 2);
  await page.context().close();


  // only live streams in the session: Pause has nothing to stop, and says so
  const only = await open('/watch.html?v=LIVEAAAAAAA&v=LIVEBBBBBBB');
  await begin(only);
  await only.waitForFunction(() => Object.values(window.__players).every((x) => x.state === 1));
  await only.click('#play');
  await only.waitForSelector('#toast:not([hidden])');
  assert.match(await only.textContent('#toast'), /Live streams keep playing/);
  p = await players(only);
  assert.ok(Object.values(p).every((x) => x.state === 1));
  assert.equal(await only.getAttribute('#play', 'aria-label'), 'Pause');
  await only.context().close();

  // a live stream that is slow to start is not sent back to its first minute
  const slow = await open(`/watch.html?v=${A}&t=10&v=LATELIVEAAA&t=0`);
  await begin(slow); // gives up waiting after 8s and starts the rest
  assert.equal((await players(slow))[A].state, 1);
  await slow.waitForFunction(() => window.__players.LATELIVEAAA.state === 1, null, { timeout: 8000 });
  await slow.waitForFunction(() => /behind real time/.test(document.querySelectorAll('.tile .drift')[1].textContent), null, { timeout: 8000 });
  p = await players(slow);
  assert.equal(p.LATELIVEAAA.seeks, 0, 'never seeked to 0:00');
  assert.ok(p.LATELIVEAAA.behind < 16.5, `at the live point (${p.LATELIVEAAA.behind.toFixed(1)}s)`);
  assert.equal(await slow.locator('.tile').nth(1).locator('.badge').textContent(), 'LIVE');
  await slow.context().close();

  // a live stream added while others are playing is not thrown back in time
  const late = await open(`/watch.html?v=${A}&t=100`);
  await begin(late);
  await late.locator('#timeline').fill('200');
  await late.locator('#timeline').dispatchEvent('change');
  await late.click('#add');
  await late.fill('#add-input', 'https://www.youtube.com/live/LIVEZZZZZZZ');
  await late.keyboard.press('Enter');
  await late.waitForFunction(() => window.__players.LIVEZZZZZZZ?.state === 1);
  await late.waitForTimeout(1200);
  p = await players(late);
  assert.equal(p.LIVEZZZZZZZ.seeks, 0);
  assert.ok(p.LIVEZZZZZZZ.behind < 16.5, `joined at live (${p.LIVEZZZZZZZ.behind.toFixed(1)}s)`);
  await late.click('#add');
  await late.fill('#add-input', `https://youtu.be/${C}?t=40`);
  await late.keyboard.press('Enter');
  await late.waitForFunction(() => window.__players.CCCCCCCCCCC?.state === 1);
  await inSync(late);
  p = await players(late);
  assert.ok(Math.abs(p[C].t - 40 - (p[A].t - 100)) < 0.4, 'a recorded video added late still joins in sync');
  await late.context().close();
});

// ---------- YouTube search (official API mocked; suggestions mocked) ----------
const KEY = 'AIzaSyTESTKEY_0123456789abcdefghijk';
const hit = (id, title, live = 'none') => ({ id: { videoId: id }, snippet: { title, channelTitle: `Channel of ${id[0]}`, liveBroadcastContent: live, thumbnails: { medium: { url: `https://i.ytimg.com/vi/${id}/mqdefault.jpg` } } } });
async function mockSearch(page, log, { fail } = {}) {
  await page.route(/suggestqueries\.google\.com/, (route) => {
    const u = new URL(route.request().url());
    const q = u.searchParams.get('q');
    route.fulfill({ contentType: 'text/javascript', body: `${u.searchParams.get('jsonp')}(${JSON.stringify([q, [[`${q} live`, 0], [`${q} today`, 0]], {}])})` });
  });
  await page.route(/googleapis\.com\/youtube\/v3\/search/, (route) => {
    const u = new URL(route.request().url());
    log.push(u.searchParams);
    if (fail) return route.fulfill({ status: 403, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ error: { message: 'quota', errors: [{ reason: fail }] } }) });
    if (u.searchParams.get('key') !== KEY) return route.fulfill({ status: 400, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ error: { message: 'API key not valid. Please pass a valid API key.', errors: [{ reason: 'badRequest' }] } }) });
    const live = u.searchParams.get('eventType') === 'live';
    const page2 = u.searchParams.get('pageToken') === 'P2';
    const items = page2 ? [hit('GGGGGGGGGGG', 'Seventh')] : live ? [hit('LIVEDDDDDDD', 'Live one', 'live')] : [hit('DDDDDDDDDDD', 'First &amp; best'), hit('EEEEEEEEEEE', 'Second'), hit('LIVEDDDDDDD', 'Live one', 'live')];
    route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ items, nextPageToken: page2 || live ? undefined : 'P2' }) });
  });
  await page.route(/googleapis\.com\/youtube\/v3\/videos/, (route) => route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ items: [{ id: 'DDDDDDDDDDD', contentDetails: { duration: 'PT1H2M3S' } }, { id: 'EEEEEEEEEEE', contentDetails: { duration: 'PT4M13S' } }] }) }));
}

await check('search: suggestions, one-time key setup, add several from one search, filters, paging', async () => {
  const page = await open('/index.html');
  const log = [];
  await mockSearch(page, log);
  await page.click('#paste');
  await page.keyboard.type('nifty');
  await page.waitForSelector('#suggest [role=option]');
  assert.deepEqual(await page.locator('#suggest [role=option]').allTextContents(), ['nifty live', 'nifty today']);
  assert.equal((await page.textContent('#add')).trim(), 'Search');
  await page.keyboard.press('ArrowDown'); // keyboard picks a suggestion
  await page.keyboard.press('Enter');
  assert.equal(await page.inputValue('#paste'), 'nifty live');
  // first search ever: explains the free key instead of failing
  assert.match(await page.textContent('#results'), /free YouTube key/);
  assert.equal(log.length, 0, 'nothing is sent without a key');
  await page.fill('#results input', 'short');
  await page.click('#results >> text=Save key');
  assert.match(await page.textContent('#results .error'), /does not look like a key/);
  await page.fill('#results input', 'AIzaSyWRONGKEY_0123456789abcdefghij');
  await page.click('#results >> text=Save key');
  await page.waitForFunction(() => /did not accept that key/.test(document.getElementById('results').textContent));
  await page.fill('#results input', KEY);
  await page.keyboard.press('Enter');
  await page.waitForSelector('#results .result');
  assert.equal(await page.locator('#results .result').count(), 3);
  assert.equal(log.at(-1).get('q'), 'nifty live');
  assert.equal(log.at(-1).get('videoEmbeddable'), 'true');
  assert.deepEqual(await page.locator('#results .result strong').allTextContents(), ['First & best', 'Second', 'Live one']);
  assert.deepEqual(await page.locator('#results .len').allTextContents(), ['1:02:03', '4:13']);
  assert.equal(await page.locator('#results .result .badge').count(), 1);
  // add two from the same search without leaving it
  await page.locator('#results .result').nth(0).click();
  await page.locator('#results .result').nth(2).click();
  assert.equal(await page.locator('#videos li').count(), 2);
  assert.equal(await page.locator('#wall .slot').count(), 2);
  assert.deepEqual(await page.locator('#results .result').evaluateAll((els) => els.map((e) => e.getAttribute('aria-pressed'))), ['true', 'false', 'true']);
  assert.match(await page.getAttribute('#go', 'href'), /v=DDDDDDDDDDD&t=0&v=LIVEDDDDDDD&t=0$/);
  await page.locator('#results .result').nth(0).click(); // click again takes it back out
  assert.equal(await page.locator('#videos li').count(), 1);
  await page.getByLabel('Remove video 1').click(); // removing from the list un-marks the result
  assert.deepEqual(await page.locator('#results .result').evaluateAll((els) => els.map((e) => e.getAttribute('aria-pressed'))), ['false', 'false', 'false']);
  // more results, then the live filter
  const before = log.length;
  await page.click('#results >> text=More results');
  await page.waitForFunction(() => document.querySelectorAll('#results .result').length === 4);
  assert.equal(log.at(-1).get('pageToken'), 'P2');
  await page.click('#results >> text=Live now');
  await page.waitForFunction(() => document.querySelectorAll('#results .result').length === 1);
  assert.equal(log.at(-1).get('eventType'), 'live');
  await page.click('#results >> text=All');
  await page.waitForFunction(() => document.querySelectorAll('#results .result').length === 3);
  assert.equal(log.length, before + 2, 'going back to "All" reuses the earlier answer and costs nothing');
  // recent searches are offered when the box is empty
  await page.fill('#paste', '');
  await page.click('#paste');
  await page.waitForSelector('#suggest [role=option]');
  assert.deepEqual(await page.locator('#suggest [role=option]').allTextContents(), ['nifty live']);
  // pasting links still works exactly as before
  await page.fill('#paste', `https://youtu.be/${A} twitch.tv/chan`);
  assert.equal((await page.textContent('#add')).trim(), 'Add');
  await page.click('#add');
  assert.equal(await page.locator('#videos li').count(), 2);
  assert.equal(await page.inputValue('#paste'), '');
  await page.context().close();

  const limited = await open('/index.html');
  await limited.addInitScript((k) => localStorage.setItem('multisync.youtubeKey', JSON.stringify(k)), KEY);
  await limited.reload();
  await mockSearch(limited, [], { fail: 'quotaExceeded' });
  await limited.fill('#paste', 'anything');
  await limited.click('#add');
  await limited.waitForFunction(() => /used up/.test(document.getElementById('paste-error').textContent));
  await limited.context().close();
});

await check('search inside the viewer: pick several results while the videos keep playing', async () => {
  const page = await open(`/watch.html?v=${A}&t=10`, { viewport: { width: 1280, height: 720 } });
  await page.evaluate((k) => localStorage.setItem('multisync.youtubeKey', JSON.stringify(k)), KEY);
  const log = [];
  await mockSearch(page, log);
  await begin(page);
  await page.click('#add');
  await page.fill('#add-input', 'market open');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#add-results .result');
  await page.locator('#add-results .result').nth(0).click();
  await page.locator('#add-results .result').nth(1).click();
  assert.equal(await page.locator('.tile').count(), 3);
  assert.ok(await page.locator('#adder').isVisible(), 'stays open for more picks');
  assert.match(page.url(), /v=DDDDDDDDDDD&t=0&v=EEEEEEEEEEE&t=0/);
  await page.waitForFunction(() => window.__players.DDDDDDDDDDD?.state === 1 && window.__players.EEEEEEEEEEE?.state === 1);
  await page.locator('#add-results .result').nth(1).click(); // un-pick removes the tile
  assert.equal(await page.locator('.tile').count(), 2);
  assert.equal((await players(page))[A].state, 1, 'the original video never stopped');
  const pop = await page.locator('#adder').boundingBox();
  assert.ok(pop.x >= 0 && pop.y >= 0 && pop.x + pop.width <= 1281, 'panel on screen');
  await page.keyboard.press('Escape');
  await page.context().close();
});

await check('watch: "save current positions" turns a manual line-up into the sync point', async () => {
  const page = await open(`/watch.html?v=${A}&t=0&v=${B}&t=0`);
  await begin(page);
  await inSync(page);
  await page.click('#more');
  await page.uncheck('#autosync');
  await page.evaluate(() => window.__players.BBBBBBBBBBB.skew(7)); // user drags video 2 ahead by hand
  await page.click('#lock');
  assert.match(page.url(), /v=BBBBBBBBBBB&t=7(\.\d)?$/);
  await page.click('#more');
  await page.check('#autosync');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1200);
  const p = await players(page);
  assert.ok(Math.abs(p[B].t - p[A].t - 7) < 0.4, 'offset kept, not undone');
  assert.equal(await page.textContent('#status'), 'In sync');
  await page.context().close();
});

await check('layout: phone, tablet, laptop, ultrawide and sideways phone, grid and focus', async () => {
  const sizes = [[1280, 720], [390, 780], [780, 360], [820, 1180], [2560, 1080], [320, 568]];
  for (const [width, height] of sizes) {
    const page = await open(`/watch.html?v=${A}&v=${B}&v=${C}`, { viewport: { width, height } });
    await begin(page);
    for (const focus of [false, true]) {
      if (focus) {
        await page.locator('.tile').nth(1).hover();
        await tool(page, 1, 'Make this video big').click();
      }
      await page.waitForTimeout(350);
      const list = await boxes(page);
      list.forEach((a, i) => {
        assert.ok(a.x >= 0 && a.x + a.w <= width + 1 && a.y >= 0, `${width}x${height} on screen ${JSON.stringify(a)}`);
        assert.ok(Math.abs(a.w / a.h - 16 / 9) < 0.04, `${width}x${height} 16:9`);
        list.slice(i + 1).forEach((b) => assert.ok(!(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h), `${width}x${height} overlap`));
      });
      if (focus) assert.ok(list[1].w > list[0].w * 1.4, `${width}x${height} focused tile is bigger`);
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${width}x${height} no sideways scroll`);
    const dock = await page.locator('#dock').boundingBox();
    assert.ok(dock.y + dock.height <= height + 1 && dock.x >= 0 && dock.x + dock.width <= width + 1, `${width}x${height} dock on screen`);
    for (const id of ['play', 'mute', 'add', 'more']) {
      const b = await page.locator(`#${id}`).boundingBox();
      assert.ok(b && b.x >= 0 && b.x + b.width <= width + 1 && b.width >= 36, `${width}x${height} #${id} reachable`);
    }
    await page.click('#more');
    const menu = await page.locator('#menu').boundingBox();
    assert.ok(menu.x >= 0 && menu.x + menu.width <= width + 1 && menu.y >= 0, `${width}x${height} menu on screen`);
    await page.screenshot({ path: `/tmp/watch-${width}x${height}.png` });
    await page.context().close();
  }
  // five videos on a phone: full-width tiles that scroll instead of thumbnails
  const phone = await open(`/watch.html?v=${A}&v=${B}&v=${C}&v=DDDDDDDDDDD&v=EEEEEEEEEEE`, { viewport: { width: 390, height: 780 } });
  await begin(phone);
  await phone.waitForTimeout(350);
  assert.ok(await phone.locator('#stage.scroll').count());
  const first = (await boxes(phone))[0];
  assert.ok(first.w > 360, `full width ${first.w}`);
  assert.ok(await phone.evaluate(() => { const s = document.getElementById('stage'); return s.scrollHeight > s.clientHeight; }), 'scrolls');
  await phone.context().close();
  // builder on a small phone
  const b = await open(`/index.html?v=${A}&t=5&v=tw:chan&v=vm:123`, { viewport: { width: 320, height: 568 }, theme: 'light' });
  assert.equal(await b.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'builder: no sideways scroll at 320px');
  const go = await b.locator('#go').boundingBox();
  assert.ok(go.y + go.height <= 568 && go.x + go.width <= 321, 'Watch button stays on screen');
  const slots = await b.locator('#wall .slot').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
  assert.ok(slots.length === 3 && slots.every((w) => w > 40), 'preview wall is drawn');
  await b.screenshot({ path: '/tmp/builder-320.png' });
  await b.context().close();
});

await check('themes: day and night both apply, follow the device, and can be forced', async () => {
  const bg = (page, sel) => page.evaluate((s) => getComputedStyle(document.querySelector(s)).backgroundColor, sel);
  const day = await open(`/watch.html?v=${A}&v=${B}`, { theme: 'light' });
  assert.equal(await day.evaluate(() => document.documentElement.dataset.theme), 'light');
  const dayDock = await bg(day, '#dock');
  await day.emulateMedia({ colorScheme: 'dark' }); // device switches to night while the page is open
  await day.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  const nightDock = await bg(day, '#dock');
  assert.notEqual(dayDock, nightDock);
  await day.click('#more');
  await day.click('#theme button[data-value=light]'); // forced day wins over the device
  assert.equal(await day.evaluate(() => document.documentElement.dataset.theme), 'light');
  await day.screenshot({ path: '/tmp/watch-day.png' });
  await day.reload();
  assert.equal(await day.evaluate(() => document.documentElement.dataset.theme), 'light');
  await day.context().close();
});

await check('controls can hide while playing and come back on movement', async () => {
  const page = await open(`/watch.html?v=${A}&v=${B}`);
  await begin(page);
  await page.locator('body').press('h');
  await page.mouse.move(600, 300);
  await page.waitForFunction(() => document.body.classList.contains('bar-hidden'), null, { timeout: 6000 });
  const tall = (await boxes(page))[0].h;
  await page.mouse.move(610, 310);
  await page.waitForFunction(() => !document.body.classList.contains('bar-hidden'));
  await page.locator('body').press(' '); // paused: must stay visible
  await page.waitForTimeout(4200);
  assert.equal(await page.evaluate(() => document.body.classList.contains('bar-hidden')), false);
  assert.ok(tall > 0);
  await page.context().close();
});

await check('clear messages when a video site is blocked', async () => {
  const page = await open(`/watch.html?v=${A}&v=tw:chan&v=vm:1`, { mock: false });
  await page.waitForFunction(() => document.querySelectorAll('.msg:not([hidden])').length === 3);
  const text = await page.locator('.msg').allTextContents();
  assert.match(text[0], /YouTube player could not be loaded/);
  assert.match(text[1], /Twitch player could not be loaded/);
  assert.match(text[2], /Vimeo player could not be loaded/);
  assert.match(await page.textContent('#gate-title'), /None of these videos/);
  await page.context().close();
});

await check('settings and recent sessions persist in the browser', async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await open(`/watch.html?v=${A}&v=${B}`, { context });
  await begin(page);
  await page.locator('#volume').fill('40');
  await page.click('#more');
  await page.uncheck('#autosync');
  await page.selectOption('#threshold', '1');
  await page.reload();
  assert.equal(await page.inputValue('#volume'), '40');
  await page.click('#more');
  assert.equal(await page.isChecked('#autosync'), false);
  assert.equal(await page.inputValue('#threshold'), '1');
  await page.click('#edit');
  await page.waitForSelector('#videos li');
  assert.equal(await page.locator('#videos li').count(), 2);
  assert.equal(await page.locator('#recent li').count(), 1);
  await context.close();
});

await browser.close();
server.close();
console.log(results.join('\n'));
if (problems.length) { console.log('\nPage errors:\n' + [...new Set(problems)].join('\n')); process.exitCode = 1; }
console.log(process.exitCode ? '\nFAILED' : '\nAll browser checks passed');
