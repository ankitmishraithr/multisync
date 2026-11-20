import test from 'node:test';
import assert from 'node:assert/strict';
import { STATE, planCorrections, pickReference, sharedDuration, targetTime } from '../js/sync.js';

const tile = (o) => ({ usable: true, live: false, state: STATE.PLAYING, duration: 600, start: 0, time: 0, ...o });

test('targetTime never goes negative', () => {
  assert.equal(targetTime(10, 5), 15);
  assert.equal(targetTime(10, -30), 0);
});

test('in-sync tiles need no fixes', () => {
  const plan = planCorrections([tile({ start: 10, time: 110 }), tile({ start: 50, time: 150.2 })]);
  assert.equal(plan.T, 100);
  assert.deepEqual(plan.fixes, []);
});

test('a drifted tile is pulled to the reference', () => {
  const plan = planCorrections([tile({ start: 10, time: 110 }), tile({ start: 50, time: 152 })]);
  assert.equal(plan.fixes.length, 1);
  assert.equal(plan.fixes[0].index, 1);
  assert.equal(plan.fixes[0].to, 150);
  assert.equal(plan.fixes[0].drift, 2);
});

test('paused, live and broken tiles are never touched or used as reference', () => {
  const tiles = [
    tile({ usable: false, time: 999 }),
    tile({ live: true, time: 999 }),
    tile({ state: STATE.BUFFERING, time: 3 }),
    tile({ start: 0, time: 40 }),
    tile({ start: 5, time: 60, state: STATE.PAUSED }),
  ];
  assert.equal(pickReference(tiles), 3);
  assert.deepEqual(planCorrections(tiles).fixes, []);
});

test('nothing playing -> no clock', () => {
  const plan = planCorrections([tile({ state: STATE.PAUSED })]);
  assert.equal(plan.T, null);
});

test('a video that has run out is not seeked past its end', () => {
  const plan = planCorrections([tile({ time: 500 }), tile({ time: 100, duration: 120 })]);
  assert.deepEqual(plan.fixes, []);
});

test('shared timeline ends when the first recorded video ends', () => {
  const d = sharedDuration([
    tile({ start: 10, duration: 600 }),
    tile({ start: 100, duration: 400 }),
    tile({ live: true, duration: 99999 }),
    tile({ usable: false, duration: 5 }),
  ]);
  assert.equal(d, 300);
  assert.equal(sharedDuration([tile({ live: true })]), 0);
});

import { planLive } from '../js/sync.js';

test('live: level streams are left alone', () => {
  assert.deepEqual(planLive({ latency: 17.2, base: 17 }), { action: 'none', rate: 1, excess: 17.2 - 17 });
});

test('live: a short pause is recovered by playing slightly fast, then back to normal', () => {
  assert.equal(planLive({ latency: 19, base: 17 }).rate, 1.25);
  assert.equal(planLive({ latency: 21, base: 17 }).rate, 1.5);
  assert.equal(planLive({ latency: 18, base: 17, currentRate: 1.25 }).rate, 1.25, 'keeps going until nearly level');
  assert.equal(planLive({ latency: 17.3, base: 17, currentRate: 1.25 }).rate, 1);
});

test('live: far behind jumps to the live point, but not twice in a row', () => {
  assert.equal(planLive({ latency: 30, base: 17 }).action, 'jump');
  const soon = planLive({ latency: 30, base: 17, sinceJump: 3 });
  assert.deepEqual([soon.action, soon.rate], ['none', 1.5]);
});

test('live: a delay the user asked for is respected in both directions', () => {
  assert.equal(planLive({ latency: 22, base: 17, extra: 5 }).action, 'none');
  assert.equal(planLive({ latency: 22, base: 17, extra: 5 }).rate, 1);
  assert.equal(planLive({ latency: 17, base: 17, extra: 5 }).action, 'back');
  assert.equal(planLive({ latency: 30, base: 17, extra: 5 }).action, 'jump');
});
