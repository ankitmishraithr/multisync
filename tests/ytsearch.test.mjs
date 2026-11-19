import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeEntities, parseIsoDuration, searchUrl, videosUrl, mapSearch, mapDurations, explainError } from '../js/ytsearch.js';

test('decodeEntities turns API titles back into plain text', () => {
  assert.equal(decodeEntities('Tom &amp; Jerry &#39;live&#39; &quot;HD&quot; &lt;3'), `Tom & Jerry 'live' "HD" <3`);
  assert.equal(decodeEntities('caf&#xE9; &#128512;'), 'café 😀');
  assert.equal(decodeEntities('&unknown; &#0; plain'), '&unknown; &#0; plain');
  assert.equal(decodeEntities(null), '');
});

test('parseIsoDuration', () => {
  assert.equal(parseIsoDuration('PT1H2M3S'), 3723);
  assert.equal(parseIsoDuration('PT4M13S'), 253);
  assert.equal(parseIsoDuration('PT45S'), 45);
  assert.equal(parseIsoDuration('P1DT1H'), 90000);
  assert.equal(parseIsoDuration('P0D'), 0);
  assert.equal(parseIsoDuration('junk'), 0);
});

test('searchUrl asks only for embeddable videos and encodes the query', () => {
  const u = new URL(searchUrl({ q: 'nifty & bank live', key: 'K', live: true, pageToken: 'P2' }));
  assert.equal(u.origin + u.pathname, 'https://www.googleapis.com/youtube/v3/search');
  assert.equal(u.searchParams.get('q'), 'nifty & bank live');
  assert.equal(u.searchParams.get('type'), 'video');
  assert.equal(u.searchParams.get('videoEmbeddable'), 'true');
  assert.equal(u.searchParams.get('eventType'), 'live');
  assert.equal(u.searchParams.get('pageToken'), 'P2');
  assert.equal(new URL(searchUrl({ q: 'x', key: 'K' })).searchParams.has('eventType'), false);
  assert.equal(new URL(videosUrl(['a', 'b'], 'K')).searchParams.get('id'), 'a,b');
});

test('mapSearch keeps good items, decodes text, and drops anything malformed', () => {
  const page = mapSearch({
    nextPageToken: 'NEXT',
    items: [
      { id: { videoId: 'aaaaaaaaaaa' }, snippet: { title: 'A &amp; B', channelTitle: 'Chan &#39;1&#39;', liveBroadcastContent: 'live', thumbnails: { medium: { url: 'https://i.ytimg.com/vi/aaaaaaaaaaa/mqdefault.jpg' } } } },
      { id: { videoId: 'bbbbbbbbbbb' }, snippet: { title: 'Plain', channelTitle: 'C', liveBroadcastContent: 'none', thumbnails: { default: { url: 'javascript:alert(1)' } } } },
      { id: { channelId: 'UCxxxx' }, snippet: { title: 'a channel, not a video' } },
      { id: { videoId: '"><script>' }, snippet: {} },
      null,
    ],
  });
  assert.equal(page.next, 'NEXT');
  assert.deepEqual(page.items.map((i) => i.id), ['aaaaaaaaaaa', 'bbbbbbbbbbb']);
  assert.deepEqual([page.items[0].title, page.items[0].channel, page.items[0].live], ['A & B', "Chan '1'", true]);
  assert.equal(page.items[1].thumb, '', 'non-https thumbnail is refused');
  assert.deepEqual(mapSearch(null), { items: [], next: '' });
  assert.deepEqual(mapDurations({ items: [{ id: 'aaaaaaaaaaa', contentDetails: { duration: 'PT3M33S' } }, {}] }), { aaaaaaaaaaa: 213 });
});

test('explainError gives a plain sentence for each common failure', () => {
  const e = (reason, message = '') => explainError(403, { error: { message, errors: [{ reason }] } });
  assert.match(e('quotaExceeded').text, /used up/);
  assert.equal(e('quotaExceeded').badKey, false);
  assert.match(explainError(400, { error: { message: 'API key not valid. Please pass a valid API key.' } }).text, /did not accept that key/);
  assert.equal(explainError(400, { error: { message: 'API key not valid.' } }).badKey, true);
  assert.match(e('accessNotConfigured').text, /not switched on/);
  assert.match(e('forbidden', 'Requests from referer http://x are blocked.').text, /allowed websites/);
  assert.match(explainError(500, null).text, /error 500/);
});
