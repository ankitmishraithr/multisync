// End-to-end check of both pages in a real browser, using the offline YouTube stand-in.
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

const root = normalize(join(fileURLToPath(import.meta.url), '..', '..'));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.mjs': 'text/javascript' };
const server = http.createServer(async (req, res) => {
  const path = normalize(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
  try {
    const body = await readFile(join(root, path));
    res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end('not found'); }
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome' }).catch(() => chromium.launch());
const results = [];
const problems = [];

async function open(path, { mock = true, viewport = { width: 1280, height: 720 } } = {}) {
  const context = await browser.newContext({ viewport });
  await context.route(/ytimg\.com|youtube\.com/, (route) => route.abort());
  const page = await context.newPage();
  page.on('pageerror', (e) => problems.push(`${path}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/ERR_FAILED|Failed to load resource/.test(m.text()) && problems.push(`${path}: ${m.text()}`));
  if (mock) await page.addInitScript({ path: join(root, 'tests', 'mock-youtube.js') });
  await page.goto(base + path);
  return page;
}
async function check(name, fn) {
  try { await fn(); results.push(`ok   ${name}`); }
  catch (e) { results.push(`FAIL ${name}\n     ${e.message.split('\n')[0]}`); process.exitCode = 1; }
}
const players = (page) => page.evaluate(() => Object.fromEntries(Object.entries(window.__players).map(([id, p]) => [id, { t: p.getCurrentTime(), state: p.state, muted: p.muted, rate: p.rate, vol: p.volume }])));
const A = 'AAAAAAAAAAA', B = 'BBBBBBBBBBB', C = 'CCCCCCCCCCC';

await check('builder: paste links, set start, link round-trips', async () => {
  const page = await open('/index.html');
  await page.fill('#paste', `https://youtu.be/${A}?t=1m5s\nhttps://viewsync.net/watch?v=${B}&t=20s&v=${C}&t=0`);
  await page.click('#add');
  assert.equal(await page.locator('#videos li').count(), 3);
  assert.equal(await page.inputValue('#start-0'), '1:05');
  await page.fill('#start-2', '1m30s');
  await page.locator('#start-2').blur();
  const link = await page.inputValue('#link');
  assert.match(link, new RegExp(`watch\\.html\\?v=${A}&t=65&v=${B}&t=20&v=${C}&t=90$`));
  await page.fill('#paste', 'not a link');
  await page.click('#add');
  assert.match(await page.textContent('#paste-error'), /No YouTube video/);
  await page.locator('#videos li').nth(0).getByText('Remove').click();
  assert.equal(await page.locator('#videos li').count(), 2);
  await page.context().close();
});

await check('watch: one click starts everything, in sync, one audio source', async () => {
  const page = await open(`/watch.html?v=${A}&t=10&v=SLOWBBBBBBB&t=100&v=${C}&t=0`);
  await page.waitForFunction(() => !document.getElementById('start').disabled);
  assert.equal(await page.textContent('#start'), 'Start all 3 videos');
  await page.click('#start');
  await page.waitForSelector('#gate', { state: 'hidden' });
  // the slow video buffers again after release; the sync loop must pull it level by itself
  await page.waitForFunction(() => Object.values(window.__players).every((x) => x.state === 1));
  await page.waitForFunction(() => document.getElementById('status').textContent === 'In sync');
  const p = await players(page);
  const offs = [p[A].t - 10, p.SLOWBBBBBBB.t - 100, p[C].t - 0];
  assert.ok(Math.max(...offs) - Math.min(...offs) < 0.3, `spread ${offs.map((x) => x.toFixed(2))}`);
  assert.ok(Object.values(p).every((x) => x.state === 1), 'all playing');
  assert.deepEqual([p[A].muted, p.SLOWBBBBBBB.muted, p[C].muted], [false, true, true]);
  assert.equal(await page.textContent('#play'), 'Pause');
  assert.equal(await page.textContent('#total'), '8:20'); // 600 - 100

  // drift repair
  await page.evaluate(() => window.__players.CCCCCCCCCCC.__skew(3));
  await page.waitForTimeout(1500);
  let q = await players(page);
  assert.ok(Math.abs(q[C].t - (q[A].t - 10)) < 0.4, `drift left ${(q[C].t - (q[A].t - 10)).toFixed(2)}`);
  await page.waitForFunction(() => document.getElementById('status').textContent === 'In sync');

  // seek forward 10s
  const before = q[A].t;
  await page.click('#fwd');
  await page.waitForTimeout(300);
  q = await players(page);
  assert.ok(q[A].t - before > 9.5 && q[A].t - before < 11.5, `jump ${q[A].t - before}`);
  assert.ok(Math.abs(q.SLOWBBBBBBB.t - 100 - (q[A].t - 10)) < 0.3);

  // keyboard: 2 moves sound, space pauses
  await page.locator('body').press('2');
  q = await players(page);
  assert.deepEqual([q[A].muted, q.SLOWBBBBBBB.muted], [true, false]);
  await page.locator('body').press(' ');
  await page.waitForTimeout(200);
  q = await players(page);
  assert.ok(Object.values(q).every((x) => x.state === 2), 'all paused');
  assert.equal(await page.textContent('#play'), 'Play');

  // timeline scrub while paused
  await page.locator('#timeline').fill('200');
  await page.locator('#timeline').dispatchEvent('change');
  q = await players(page);
  assert.equal(Math.round(q[A].t), 210);
  assert.equal(Math.round(q[C].t), 200);
  assert.equal(await page.textContent('#now'), '3:20');

  // nudge is written to the link
  await page.locator('.tile').nth(2).hover();
  await page.locator('.tile').nth(2).getByText('+0.1s').click();
  assert.match(page.url(), /v=CCCCCCCCCCC&t=0\.1/);
  q = await players(page);
  assert.ok(Math.abs(q[C].t - 200.1) < 0.01);

  // sound mode + volume + speed
  await page.selectOption('#audio', 'all');
  await page.selectOption('#speed', '1.5');
  q = await players(page);
  assert.ok(Object.values(q).every((x) => !x.muted && x.rate === 1.5));
  assert.match(page.url(), /audio=all/);
  await page.click('#mute');
  q = await players(page);
  assert.ok(Object.values(q).every((x) => x.muted));
  await page.context().close();
});

await check('watch: a blocked video does not stop the others; live is recognised', async () => {
  const page = await open(`/watch.html?v=${A}&t=0&v=BLOCKBBBBBB&t=0&v=LIVECCCCCCC&t=0&v=${B}&t=5`);
  await page.waitForFunction(() => !document.getElementById('start').disabled);
  assert.equal(await page.textContent('#start'), 'Start all 3 videos');
  assert.match(await page.locator('.tile').nth(1).locator('.msg').textContent(), /cannot be played on other sites/);
  await page.click('#start');
  await page.waitForSelector('#gate', { state: 'hidden' });
  await page.waitForTimeout(800);
  const p = await players(page);
  assert.equal(p[A].state, 1);
  assert.equal(p.LIVECCCCCCC.state, 1);
  assert.ok(Math.abs(p[B].t - 5 - p[A].t) < 0.3);
  assert.equal(await page.locator('.tile').nth(2).locator('.badge').getAttribute('hidden'), null);
  assert.ok(await page.locator('#golive').isVisible());
  assert.equal(await page.textContent('#total'), '9:55'); // live + blocked ignored
  // live stream is never dragged around by the sync loop
  const seeksBefore = await page.evaluate(() => window.__players.LIVECCCCCCC.seeks);
  await page.waitForTimeout(1500);
  assert.equal(await page.evaluate(() => window.__players.LIVECCCCCCC.seeks), seeksBefore);
  await page.context().close();
});

await check('watch: a video that ignores the first play request still starts in sync', async () => {
  const page = await open(`/watch.html?v=${A}&t=0&v=FLAKYBBBBBB&t=50`);
  await page.waitForFunction(() => !document.getElementById('start').disabled);
  const t0 = Date.now();
  await page.click('#start');
  await page.waitForSelector('#gate', { state: 'hidden' });
  assert.ok(Date.now() - t0 < 4000, `start took ${Date.now() - t0}ms`);
  await page.waitForFunction(() => document.getElementById('status').textContent === 'In sync');
  const p = await players(page);
  assert.ok(p[A].state === 1 && p.FLAKYBBBBBB.state === 1);
  assert.ok(Math.abs(p.FLAKYBBBBBB.t - 50 - p[A].t) < 0.3);
  await page.context().close();
});

await check('watch: tiles never overlap or overflow (desktop, focus, phone)', async () => {
  for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 780 }]) {
    const page = await open(`/watch.html?v=${A}&v=${B}&v=${C}`, { viewport });
    await page.waitForFunction(() => !document.getElementById('start').disabled);
    for (const focus of [false, true]) {
      if (focus) {
        await page.evaluate(() => (document.getElementById('gate').hidden = true));
        await page.locator('.tile').nth(1).hover();
        await page.locator('.tile').nth(1).getByText('Focus').click();
      }
      await page.waitForTimeout(350);
      const boxes = await page.locator('.tile').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }));
      boxes.forEach((a, i) => {
        assert.ok(a.x >= 0 && a.x + a.w <= viewport.width + 1 && a.y >= 0, `on screen ${JSON.stringify(a)}`);
        assert.ok(Math.abs(a.w / a.h - 16 / 9) < 0.03, '16:9');
        boxes.slice(i + 1).forEach((b) => assert.ok(!(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h), 'overlap'));
      });
      if (focus) assert.ok(boxes[1].w > boxes[0].w * 1.5, 'focused tile is bigger');
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no sideways scroll');
    const bar = await page.locator('#controls').boundingBox();
    assert.ok(bar.y + bar.height <= viewport.height + 1, 'control bar on screen');
    await page.screenshot({ path: `/tmp/shot-${viewport.width}.png` });
    await page.context().close();
  }
});

await check('watch: clear message when YouTube is blocked or link is empty', async () => {
  let page = await open(`/watch.html?v=${A}`, { mock: false });
  await page.waitForSelector('#banner:not([hidden])');
  assert.match(await page.textContent('#banner'), /could not be loaded/);
  await page.context().close();
  page = await open('/watch.html');
  assert.match(await page.textContent('#gate'), /No videos in this link/);
  await page.context().close();
});

await check('settings and recent sessions persist in the browser', async () => {
  const context = await browser.newContext();
  await context.route(/ytimg\.com|youtube\.com/, (r) => r.abort());
  const page = await context.newPage();
  await page.addInitScript({ path: join(root, 'tests', 'mock-youtube.js') });
  await page.goto(`${base}/watch.html?v=${A}&v=${B}`);
  await page.waitForFunction(() => !document.getElementById('start').disabled);
  await page.click('#start');
  await page.waitForSelector('#gate', { state: 'hidden' });
  await page.locator('#volume').fill('40');
  await page.uncheck('#autosync');
  await page.reload();
  assert.equal(await page.inputValue('#volume'), '40');
  assert.equal(await page.isChecked('#autosync'), false);
  await page.click('#edit');
  await page.waitForSelector('#videos li');
  assert.equal(await page.locator('#videos li').count(), 2);
  assert.equal(await page.locator('#recent li').count(), 1);
  await context.close();
});

await browser.close();
server.close();
console.log(results.join('\n'));
if (problems.length) { console.log('\nPage errors:\n' + problems.join('\n')); process.exitCode = 1; }
console.log(process.exitCode ? '\nFAILED' : '\nAll browser checks passed');
