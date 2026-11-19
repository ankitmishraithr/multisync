import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTime, formatTime, parseLine, parseInput, buildQuery, parseWatch, parseToken, toToken, sourceUrl, shortName } from '../js/parse.js';

const yt = (id, start = 0) => ({ kind: 'youtube', id, start });

test('parseTime accepts every common format', () => {
  assert.equal(parseTime('90'), 90);
  assert.equal(parseTime('90s'), 90);
  assert.equal(parseTime('0'), 0);
  assert.equal(parseTime('12.5'), 12.5);
  assert.equal(parseTime('1h2m3s'), 3723);
  assert.equal(parseTime('2m'), 120);
  assert.equal(parseTime('1:02:03'), 3723);
  assert.equal(parseTime('2:03'), 123);
  assert.equal(parseTime('junk'), 0);
  assert.equal(parseTime(null), 0);
});

test('formatTime', () => {
  assert.equal(formatTime(123), '2:03');
  assert.equal(formatTime(3723), '1:02:03');
  assert.equal(formatTime(5.25, true), '0:05.3');
  assert.equal(formatTime(-4), '0:00');
});

test('YouTube link shapes', () => {
  const id = 'dQw4w9WgXcQ';
  for (const url of [
    id,
    `https://www.youtube.com/watch?v=${id}`,
    `https://m.youtube.com/watch?v=${id}&feature=share`,
    `https://youtu.be/${id}`,
    `youtu.be/${id}`,
    `https://www.youtube.com/live/${id}`,
    `https://www.youtube.com/shorts/${id}`,
    `https://www.youtube.com/embed/${id}`,
    `https://www.youtube-nocookie.com/embed/${id}`,
  ]) {
    assert.deepEqual(parseLine(url), [yt(id)], url);
  }
  assert.deepEqual(parseLine(`https://youtu.be/${id}?t=1m5s`), [yt(id, 65)]);
  assert.deepEqual(parseLine(`https://www.youtube.com/watch?v=${id}&t=42`), [yt(id, 42)]);
});

test('Twitch channels and videos', () => {
  assert.deepEqual(parseLine('https://www.twitch.tv/SomeChannel'), [{ kind: 'twitch', id: 'somechannel', start: 0 }]);
  assert.deepEqual(parseLine('twitch.tv/some_channel'), [{ kind: 'twitch', id: 'some_channel', start: 0 }]);
  assert.deepEqual(parseLine('https://www.twitch.tv/videos/123456789?t=1h2m3s'), [{ kind: 'twitchvod', id: '123456789', start: 3723 }]);
  assert.deepEqual(parseLine('https://player.twitch.tv/?channel=abc&parent=x.com'), [{ kind: 'twitch', id: 'abc', start: 0 }]);
  assert.deepEqual(parseLine('https://player.twitch.tv/?video=v987&parent=x.com'), [{ kind: 'twitchvod', id: '987', start: 0 }]);
  assert.deepEqual(parseLine('https://www.twitch.tv/directory'), []);
  assert.deepEqual(parseLine('https://www.twitch.tv/'), []);
});

test('Vimeo links, including private ones with a hash', () => {
  assert.deepEqual(parseLine('https://vimeo.com/76979871'), [{ kind: 'vimeo', id: '76979871', start: 0 }]);
  assert.deepEqual(parseLine('https://vimeo.com/channels/staffpicks/76979871'), [{ kind: 'vimeo', id: '76979871', start: 0 }]);
  assert.deepEqual(parseLine('https://vimeo.com/76979871/abcdef1234'), [{ kind: 'vimeo', id: '76979871/abcdef1234', start: 0 }]);
  assert.deepEqual(parseLine('https://player.vimeo.com/video/76979871?h=abcdef1234'), [{ kind: 'vimeo', id: '76979871/abcdef1234', start: 0 }]);
  assert.deepEqual(parseLine('https://vimeo.com/76979871#t=1m30s'), [{ kind: 'vimeo', id: '76979871', start: 90 }]);
  assert.deepEqual(parseLine('https://vimeo.com/about'), []);
});

test('direct media files', () => {
  assert.deepEqual(parseLine('https://cdn.example.com/a/My%20Clip.mp4?sig=1'), [{ kind: 'file', id: 'https://cdn.example.com/a/My%20Clip.mp4?sig=1', start: 0 }]);
  assert.deepEqual(parseLine('https://x.example/live/stream.m3u8')[0].kind, 'file');
  assert.equal(parseLine('https://x.example/clip.webm#t=12')[0].start, 12);
  assert.deepEqual(parseLine('https://example.com/page.html'), []);
  assert.deepEqual(parseLine('javascript:alert(1)//x.mp4'), []);
  assert.equal(shortName({ kind: 'file', id: 'https://cdn.example.com/a/My%20Clip.mp4?sig=1' }), 'My Clip.mp4');
});

test('junk is rejected', () => {
  assert.deepEqual(parseLine('hello'), []);
  assert.deepEqual(parseLine('https://www.youtube.com/watch?v=short'), []);
  assert.deepEqual(parseLine('https://example.com/'), []);
  assert.deepEqual(parseLine(''), []);
});

test('tokens round-trip for every source and refuse unsafe input', () => {
  for (const v of [
    { kind: 'youtube', id: 'dQw4w9WgXcQ' },
    { kind: 'twitch', id: 'some_channel' },
    { kind: 'twitchvod', id: '123456' },
    { kind: 'vimeo', id: '76979871' },
    { kind: 'vimeo', id: '76979871/abcdef12' },
    { kind: 'file', id: 'https://cdn.example.com/a/b%20c.mp4?x=1&y=2' },
  ]) {
    assert.deepEqual(parseToken(toToken(v)), v, toToken(v));
    assert.ok(sourceUrl(v).startsWith('https://'));
  }
  assert.equal(parseToken('file:' + encodeURIComponent('javascript:alert(1)')), null);
  assert.equal(parseToken('tw:bad name!'), null);
  assert.equal(parseToken('zz:1'), null);
  assert.equal(parseToken('"><script>'), null);
});

test('ViewSync links expand in order', () => {
  assert.deepEqual(parseLine('https://viewsync.net/watch?v=aaaaaaaaaaa&t=191s&v=bbbbbbbbbbb&t=974s'), [yt('aaaaaaaaaaa', 191), yt('bbbbbbbbbbb', 974)]);
});

test('a bad v= does not steal the next t=', () => {
  assert.deepEqual(parseWatch('?v=bad&t=99&v=bbbbbbbbbbb&t=5').videos, [yt('bbbbbbbbbbb', 5)]);
});

test('parseInput splits lines and spaces and mixes sources', () => {
  const out = parseInput('aaaaaaaaaaa\nhttps://youtu.be/bbbbbbbbbbb?t=10  twitch.tv/chan https://vimeo.com/123');
  assert.deepEqual(out.map((v) => v.kind), ['youtube', 'youtube', 'twitch', 'vimeo']);
  assert.equal(out[1].start, 10);
});

test('buildQuery and parseWatch round-trip a mixed session', () => {
  const videos = [
    yt('aaaaaaaaaaa'),
    { kind: 'twitch', id: 'chan', start: 0 },
    { kind: 'vimeo', id: '123', start: 12.34 },
    { kind: 'file', id: 'https://e.com/a.mp4?k=v&z=1', start: 3 },
  ];
  const q = buildQuery(videos, { audio: 'all' });
  assert.ok(q.startsWith('v=aaaaaaaaaaa&t=0&v=tw:chan&t=0&v=vm:123&t=12.3&v=file:https%3A%2F%2Fe.com'));
  const back = parseWatch('?' + q);
  assert.deepEqual(back.videos.map((v) => v.id), videos.map((v) => v.id));
  assert.equal(back.videos[2].start, 12.3);
  assert.equal(back.audio, 'all');
  assert.equal(parseWatch('?v=aaaaaaaaaaa').audio, 'solo');
});
