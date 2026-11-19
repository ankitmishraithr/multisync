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
