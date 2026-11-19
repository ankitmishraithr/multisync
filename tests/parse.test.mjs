import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTime, formatTime, parseLine, parseInput, buildQuery, parseWatch } from '../js/parse.js';

test('parseTime accepts every common format', () => {
  assert.equal(parseTime('90'), 90);
  assert.equal(parseTime('90s'), 90);
  assert.equal(parseTime('0'), 0); // the original site ignores bare numbers
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

test('parseLine handles YouTube link shapes', () => {
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
    assert.deepEqual(parseLine(url), [{ id, start: 0 }], url);
  }
  assert.deepEqual(parseLine(`https://youtu.be/${id}?t=1m5s`), [{ id, start: 65 }]);
  assert.deepEqual(parseLine(`https://www.youtube.com/watch?v=${id}&t=42`), [{ id, start: 42 }]);
});

test('parseLine rejects junk', () => {
  assert.deepEqual(parseLine('hello'), []);
  assert.deepEqual(parseLine('https://www.youtube.com/watch?v=short'), []);
  assert.deepEqual(parseLine('https://example.com/'), []);
  assert.deepEqual(parseLine(''), []);
});

test('multi-video (ViewSync style) links expand in order', () => {
  const link = 'https://viewsync.net/watch?v=aaaaaaaaaaa&t=191s&v=bbbbbbbbbbb&t=974s';
  assert.deepEqual(parseLine(link), [
    { id: 'aaaaaaaaaaa', start: 191 },
    { id: 'bbbbbbbbbbb', start: 974 },
  ]);
});

test('a bad v= does not steal the next t=', () => {
  const out = parseWatch('?v=bad&t=99&v=bbbbbbbbbbb&t=5');
  assert.deepEqual(out.videos, [{ id: 'bbbbbbbbbbb', start: 5 }]);
});

test('parseInput splits lines and spaces', () => {
  const out = parseInput('aaaaaaaaaaa\nhttps://youtu.be/bbbbbbbbbbb?t=10  ccccccccccc');
  assert.deepEqual(out.map((v) => v.id), ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc']);
  assert.equal(out[1].start, 10);
});

test('buildQuery and parseWatch round-trip', () => {
  const videos = [
    { id: 'aaaaaaaaaaa', start: 0 },
    { id: 'bbbbbbbbbbb', start: 12.34 },
  ];
  const q = buildQuery(videos, { audio: 'all' });
  assert.equal(q, 'v=aaaaaaaaaaa&t=0&v=bbbbbbbbbbb&t=12.3&audio=all');
  const back = parseWatch('?' + q);
  assert.deepEqual(back.videos, [
    { id: 'aaaaaaaaaaa', start: 0 },
    { id: 'bbbbbbbbbbb', start: 12.3 },
  ]);
  assert.equal(back.audio, 'all');
  assert.equal(parseWatch('?v=aaaaaaaaaaa').audio, 'solo');
});
