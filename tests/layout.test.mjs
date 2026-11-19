import test from 'node:test';
import assert from 'node:assert/strict';
import { bestGrid, focusLayout } from '../js/layout.js';

test('single video fills the box', () => {
  const g = bestGrid(1, 1600, 900, 0);
  assert.deepEqual([g.cols, g.rows, g.tileW, g.tileH], [1, 1, 1600, 900]);
});

test('grid picks the shape that wastes least space', () => {
  assert.equal(bestGrid(2, 1600, 900).cols, 2); // wide box: side by side
  assert.equal(bestGrid(2, 600, 1000).cols, 1); // tall box (phone): stacked
  assert.equal(bestGrid(4, 1600, 900).cols, 2);
  assert.equal(bestGrid(6, 1600, 900).cols, 3);
  assert.equal(bestGrid(9, 1600, 900).cols, 3);
});

test('tiles always fit inside the box', () => {
  for (let n = 1; n <= 16; n++) {
    for (const [w, h] of [[1920, 1000], [390, 700], [1024, 600], [3000, 500]]) {
      const gap = 6;
      const g = bestGrid(n, w, h, gap);
      assert.ok(g.cols * g.rows >= n, `capacity n=${n}`);
      assert.ok(g.cols * g.tileW + (g.cols - 1) * gap <= w + 0.5, `width n=${n} ${w}x${h}`);
      assert.ok(g.rows * g.tileH + (g.rows - 1) * gap <= h + 0.5, `height n=${n} ${w}x${h}`);
      assert.ok(g.tileW > 0);
    }
  }
});

test('focus layout keeps the main tile bigger and inside the box', () => {
  for (let n = 2; n <= 8; n++) {
    for (const [w, h] of [[1920, 1000], [390, 700]]) {
      const f = focusLayout(n, w, h);
      assert.ok(f.mainW > f.smallW, `main bigger n=${n}`);
      if (f.side === 'right') assert.ok(f.mainW + f.smallW + 6 <= w + 1);
      if (f.side === 'bottom') assert.ok(f.mainH + f.smallH + 6 <= h + 1);
    }
  }
});

import { computeRects } from '../js/layout.js';

const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test('computeRects: no overlaps, everything on screen, grid and focus', () => {
  for (let n = 1; n <= 12; n++) {
    for (const [w, h] of [[1920, 1000], [390, 700], [1280, 640]]) {
      for (const focus of [null, 0, n - 1]) {
        const rects = computeRects(n, w, h, focus);
        assert.equal(rects.length, n);
        rects.forEach((r, i) => {
          assert.ok(r.w > 0 && r.h > 0, `size n=${n}`);
          assert.ok(r.x >= -1 && r.y >= -1 && r.x + r.w <= w + 1 && r.y + r.h <= h + 1, `inside n=${n} ${w}x${h} f=${focus} i=${i} ${JSON.stringify(r)}`);
          for (let j = i + 1; j < n; j++) assert.ok(!overlap(r, rects[j]), `overlap n=${n} f=${focus}`);
        });
      }
    }
  }
});

test('computeRects: three videos leave no empty quarter', () => {
  // the original site puts 3 videos in a 2x2 grid with a dead corner, left-aligned
  const r = computeRects(3, 1600, 900, null, 0);
  assert.equal(r[2].x + r[2].w / 2, 800); // third tile is centred
});

import { stackRects, shouldStack } from '../js/layout.js';

test('phones with many videos get a scrolling full-width column', () => {
  assert.equal(shouldStack(2, 390, 640), false);
  assert.equal(shouldStack(4, 390, 640), true);
  assert.equal(shouldStack(6, 390, 640), true);
  assert.equal(shouldStack(6, 1280, 640), false);
  assert.equal(shouldStack(3, 600, 1000), false); // tall tablet: three full-width tiles already fit
  const r = stackRects(4, 390);
  assert.equal(r[0].w, 390);
  assert.equal(r[1].y, r[0].h + 6);
});
