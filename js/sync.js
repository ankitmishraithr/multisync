// Sync maths. Pure — covered by tests/sync.test.mjs
//
// Every video i has a start offset s_i (seconds into that video where the
// shared moment happens). The session has one shared clock T (seconds since
// the shared moment). Video i should be showing s_i + T.

export const STATE = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };

/** Where video should be for shared time T. */
export function targetTime(start, T) {
  return Math.max(0, start + T);
}

/**
 * The reference is the first tile that is actually playing a recorded video.
 * Live and broken tiles never lead. Returns index or -1.
 */
export function pickReference(tiles) {
  return tiles.findIndex((t) => t.usable && !t.live && t.state === STATE.PLAYING);
}

/**
 * Decide which tiles need a corrective seek.
 * tiles: [{start, time, state, usable, live}]
 * Returns { T, fixes: [{index, to, drift}] } — T is null if nothing is playing.
 */
export function planCorrections(tiles, threshold = 0.5) {
  const ref = pickReference(tiles);
  if (ref < 0) return { T: null, ref, fixes: [] };
  const T = tiles[ref].time - tiles[ref].start;
  const fixes = [];
  tiles.forEach((t, index) => {
    if (index === ref || !t.usable || t.live || t.state !== STATE.PLAYING) return;
    const to = targetTime(t.start, T);
    if (t.duration > 0 && to >= t.duration) return; // this video is already over
    const drift = t.time - to;
    if (Math.abs(drift) > threshold) fixes.push({ index, to, drift });
  });
  return { T, ref, fixes };
}

/** Length of the shared timeline: until the first recorded video runs out. */
export function sharedDuration(tiles) {
  const lens = tiles
    .filter((t) => t.usable && !t.live && t.duration > 0)
    .map((t) => t.duration - t.start);
  return lens.length ? Math.max(0, Math.min(...lens)) : 0;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
