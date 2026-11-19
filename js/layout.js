// Grid maths. Pure — covered by tests/layout.test.mjs

/**
 * Pick the column count that gives the largest 16:9 tiles for n videos
 * inside a width x height box. Returns tile size and the used grid.
 */
export function bestGrid(n, width, height, gap = 6, ratio = 16 / 9) {
  let best = { cols: 1, rows: Math.max(1, n), tileW: 0, tileH: 0 };
  if (n < 1 || width <= 0 || height <= 0) return best;
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const maxW = (width - gap * (cols - 1)) / cols;
    const maxH = (height - gap * (rows - 1)) / rows;
    if (maxW <= 0 || maxH <= 0) continue;
    const tileW = Math.min(maxW, maxH * ratio);
    if (tileW > best.tileW) best = { cols, rows, tileW, tileH: tileW / ratio };
  }
  best.tileW = Math.floor(best.tileW);
  best.tileH = Math.floor(best.tileH);
  return best;
}

/**
 * Focus layout: one big tile plus a strip of small ones.
 * Strip goes on the side for wide boxes and below for tall ones.
 */
export function focusLayout(n, width, height, gap = 6, ratio = 16 / 9) {
  const others = n - 1;
  if (others < 1) {
    const g = bestGrid(1, width, height, gap, ratio);
    return { side: 'none', mainW: g.tileW, mainH: g.tileH, smallW: 0, smallH: 0 };
  }
  const candidates = [];
  // strip on the right: small tiles stacked vertically
  {
    const smallH = Math.min((height - gap * (others - 1)) / others, height / 3);
    const smallW = smallH * ratio;
    const mainW = Math.min(width - smallW - gap, height * ratio);
    if (mainW > 0) candidates.push({ side: 'right', mainW, mainH: mainW / ratio, smallW, smallH });
  }
  // strip below: small tiles in a row
  {
    const smallW = Math.min((width - gap * (others - 1)) / others, width / 3);
    const smallH = smallW / ratio;
    const mainH = Math.min(height - smallH - gap, width / ratio);
    if (mainH > 0) candidates.push({ side: 'bottom', mainW: mainH * ratio, mainH, smallW, smallH });
  }
  candidates.sort((a, b) => b.mainW - a.mainW);
  const pick = candidates[0] || { side: 'bottom', mainW: 0, mainH: 0, smallW: 0, smallH: 0 };
  for (const k of ['mainW', 'mainH', 'smallW', 'smallH']) pick[k] = Math.floor(pick[k]);
  return pick;
}

/**
 * Final pixel rectangles for every tile: [{x, y, w, h}] in tile order.
 * Tiles are positioned absolutely so an iframe is never moved in the DOM
 * (moving an iframe reloads the video).
 */
export function computeRects(n, width, height, focusIndex = null, gap = 6) {
  const rects = [];
  if (n < 1) return rects;
  const focused = focusIndex != null && focusIndex >= 0 && focusIndex < n && n > 1;

  if (!focused) {
    const g = bestGrid(n, width, height, gap);
    const totalH = g.rows * g.tileH + (g.rows - 1) * gap;
    const top = (height - totalH) / 2;
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / g.cols);
      const inRow = row === g.rows - 1 ? n - row * g.cols : g.cols; // centre a short last row
      const rowW = inRow * g.tileW + (inRow - 1) * gap;
      const left = (width - rowW) / 2;
      const col = i - row * g.cols;
      rects.push({ x: Math.round(left + col * (g.tileW + gap)), y: Math.round(top + row * (g.tileH + gap)), w: g.tileW, h: g.tileH });
    }
    return rects;
  }

  const f = focusLayout(n, width, height, gap);
  const others = n - 1;
  let k = 0;
  if (f.side === 'right') {
    const left = (width - (f.mainW + gap + f.smallW)) / 2;
    const stripH = others * f.smallH + (others - 1) * gap;
    for (let i = 0; i < n; i++) {
      if (i === focusIndex) rects.push({ x: Math.round(left), y: Math.round((height - f.mainH) / 2), w: f.mainW, h: f.mainH });
      else rects.push({ x: Math.round(left + f.mainW + gap), y: Math.round((height - stripH) / 2 + k++ * (f.smallH + gap)), w: f.smallW, h: f.smallH });
    }
  } else {
    const top = (height - (f.mainH + gap + f.smallH)) / 2;
    const stripW = others * f.smallW + (others - 1) * gap;
    for (let i = 0; i < n; i++) {
      if (i === focusIndex) rects.push({ x: Math.round((width - f.mainW) / 2), y: Math.round(top), w: f.mainW, h: f.mainH });
      else rects.push({ x: Math.round((width - stripW) / 2 + k++ * (f.smallW + gap)), y: Math.round(top + f.mainH + gap), w: f.smallW, h: f.smallH });
    }
  }
  return rects;
}
