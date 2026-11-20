import test from 'node:test';
import assert from 'node:assert/strict';
import { resultsUrl, extractInitialData, mapResults, parseResultsPage } from '../js/ytscrape.js';

// The same shapes youtube.com sends (checked against the real page on 20 Nov 2026), cut down.
const video = (id, title, extra = {}) => ({ videoRenderer: { videoId: id, title: { runs: [{ text: title }] }, ownerText: { runs: [{ text: 'Some Channel' }] }, ...extra } });
const page = (contents) => `<html><script nonce="x">var ytInitialData = ${JSON.stringify({ contents: { twoColumnSearchResultsRenderer: { primaryContents: { sectionListRenderer: { contents: [{ itemSectionRenderer: { contents } }] } } } } })};</script><script>var other = {"a":1};</script></html>`;

test('resultsUrl encodes the words and adds the Live filter only when asked', () => {
  const u = new URL(resultsUrl('nifty & bank "live"', true));
  assert.equal(u.origin + u.pathname, 'https://www.youtube.com/results');
  assert.equal(u.searchParams.get('search_query'), 'nifty & bank "live"');
  assert.equal(u.searchParams.get('sp'), 'EgJAAQ==');
  assert.equal(new URL(resultsUrl('x')).searchParams.has('sp'), false);
});

test('extractInitialData copes with braces and quotes inside titles', () => {
  const html = page([video('aaaaaaaaaaa', 'Tricky } title with "quotes" and \\ slashes {')]);
  const data = extractInitialData(html);
  assert.ok(data.contents);
  assert.equal(mapResults(data)[0].title, 'Tricky } title with "quotes" and \\ slashes {');
  assert.equal(extractInitialData('<html>no data here</html>'), null);
  assert.equal(extractInitialData('var ytInitialData = {"broken": '), null);
  assert.equal(extractInitialData(null), null);
});

test('mapResults reads live, upcoming and length, and skips ads, Shorts, channels and junk', () => {
  const items = parseResultsPage(page([
    video('aaaaaaaaaaa', 'Live now', { badges: [{ metadataBadgeRenderer: { style: 'BADGE_STYLE_TYPE_LIVE_NOW' } }] }),
    video('bbbbbbbbbbb', 'A recording', { lengthText: { simpleText: '1:02:03' } }),
    video('ccccccccccc', 'Starts later', { upcomingEventData: { startTime: '1' }, thumbnailOverlays: [{ thumbnailOverlayTimeStatusRenderer: { style: 'UPCOMING' } }] }),
    { adSlotRenderer: { x: video('ddddddddddd', 'An advert') } },
    { reelShelfRenderer: { items: [video('eeeeeeeeeee', 'A Short')] } },
    { channelRenderer: { channelId: 'UCxxxx', title: { simpleText: 'A channel' } } },
    video('"><script>', 'bad id'),
    video('fffffffffff', ''),
    video('aaaaaaaaaaa', 'Live now (duplicate)'),
  ])).items;
  assert.deepEqual(items.map((i) => i.id), ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc']);
  assert.deepEqual(items.map((i) => [i.live, i.upcoming, i.duration]), [[true, false, 0], [false, false, 3723], [false, true, 0]]);
  assert.equal(items[0].channel, 'Some Channel');
  assert.equal(items[1].thumb, 'https://i.ytimg.com/vi/bbbbbbbbbbb/mqdefault.jpg');
});

test('a page that cannot be understood gives no items and says so', () => {
  const out = parseResultsPage('<html>Before you continue to YouTube</html>');
  assert.deepEqual(out, { items: [], next: '', understood: false });
  assert.equal(parseResultsPage(page([])).understood, true);
});
