// Grid maths. Pure — covered by tests/layout.test.mjs
//
// A tile is a 16:9 video plus `head` pixels of label strip above it, so its
// height is width / ratio + head. Pass head = 0 for bare videos.

const RATIO = 16 / 9;

/** Pick the column count that gives the largest tiles for n videos inside width x height. */
export function bestGrid(n, width, height, gap = 6, head = 0) {
  let best = { cols: 1, rows: Math.max(1, n), tileW: 0, tileH: 0 };
  if (n < 1 || width <= 0 || height <= 0) return best;
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const maxW = (width - gap * (cols - 1)) / cols;
    const maxH = (height - gap * (rows - 1)) / rows - head;
    if (maxW <= 0 || maxH <= 0) continue;
    const tileW = Math.min(maxW, maxH * RATIO);
    if (tileW > best.tileW) best = { cols, rows, tileW };
  }
  best.tileW = Math.floor(best.tileW);
  best.tileH = Math.floor(best.tileW / RATIO + head);
  return best;
}

/** Rectangles for a plain grid placed inside a box at (ox, oy). */
function gridRects(n, width, height, gap, head, ox = 0, oy = 0) {
  const g = bestGrid(n, width, height, gap, head);
  const totalH = g.rows * g.tileH + (g.rows - 1) * gap;
  const top = (height - totalH) / 2;
  const rects = [];
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / g.cols);
    const inRow = row === g.rows - 1 ? n - row * g.cols : g.cols; // centre a short last row
    const rowW = inRow * g.tileW + (inRow - 1) * gap;
    const left = (width - rowW) / 2;
    const col = i - row * g.cols;
    rects.push({ x: Math.round(ox + left + col * (g.tileW + gap)), y: Math.round(oy + top + row * (g.tileH + gap)), w: g.tileW, h: g.tileH });
  }
  return rects;
}

/**
 * Focus layout: one big tile, the rest in a smaller grid beside it (wide boxes) or
 * below it (tall boxes). Tries several split positions and keeps the one that shows
 * the most video while the big tile stays clearly bigger. Returns null if nothing fits.
 */
function focusRects(n, width, height, focusIndex, gap, head) {
  let best = null;
  for (const side of ['right', 'bottom']) {
    for (let share = 0.5; share <= 0.85; share += 0.05) {
      const mainBox = side === 'right' ? { w: width * share - gap / 2, h: height } : { w: width, h: height * share - gap / 2 };
      const restBox = side === 'right' ? { w: width - mainBox.w - gap, h: height } : { w: width, h: height - mainBox.h - gap };
      const mainW = Math.floor(Math.min(mainBox.w, (mainBox.h - head) * RATIO));
      const small = bestGrid(n - 1, restBox.w, restBox.h, gap, head);
      if (mainW <= 0 || small.tileW <= 0 || mainW < small.tileW * 1.5) continue;
      const score = mainW * mainW + 0.6 * (n - 1) * small.tileW * small.tileW;
      if (!best || score > best.score) best = { score, side, mainBox, restBox, mainW };
    }
  }
  if (!best) return null;
  const { side, mainBox, restBox, mainW } = best;
  const mainH = Math.floor(mainW / RATIO + head);
  const main = { x: Math.round((mainBox.w - mainW) / 2), y: Math.round((mainBox.h - mainH) / 2), w: mainW, h: mainH };
  const rest = gridRects(n - 1, restBox.w, restBox.h, gap, head, side === 'right' ? mainBox.w + gap : 0, side === 'bottom' ? mainBox.h + gap : 0);
  const rects = [];
  for (let i = 0, k = 0; i < n; i++) rects.push(i === focusIndex ? main : rest[k++]);
  return rects;
}

/**
 * Final pixel rectangles for every tile: [{x, y, w, h}] in tile order.
 * Tiles are positioned absolutely so an iframe is never moved in the DOM
 * (moving an iframe reloads the video).
 */
export function computeRects(n, width, height, focusIndex = null, gap = 6, head = 0) {
  if (n < 1) return [];
  const focused = focusIndex != null && focusIndex >= 0 && focusIndex < n && n > 1;
  return (focused && focusRects(n, width, height, focusIndex, gap, head)) || gridRects(n, width, height, gap, head);
}

/** Phone layout for many videos: one full-width column that scrolls. */
export function stackRects(n, width, gap = 6, head = 0) {
  const w = Math.floor(width);
  const h = Math.floor(w / RATIO + head);
  return Array.from({ length: n }, (_, i) => ({ x: 0, y: i * (h + gap), w, h }));
}

/** Use the scrolling column when a fitted grid would make tiles too small on a narrow screen. */
export function shouldStack(n, width, height, gap = 6, head = 0) {
  if (n < 3 || width >= 640) return false;
  return bestGrid(n, width, height, gap, head).tileW < width * 0.8;
}
