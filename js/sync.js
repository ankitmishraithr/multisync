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

// ---------- live streams ----------
// A live stream has no shared timeline. What matters is how far behind "now" it is.
// Players fall behind every time they pause or buffer and never catch up on their own,
// so the page measures the delay and pulls the stream back.
//
//   latency:  seconds between real time and the frame on screen (measured)
//   base:     the smallest latency this stream has shown — the best it can do
//   extra:    seconds the user asked this stream to stay behind (the nudge buttons)

export const LIVE = { JUMP_OVER: 6, FAST_OVER: 3, SLOW_OVER: 1.2, DONE_UNDER: 0.5, AHEAD_BY: 1.5, JUMP_COOLDOWN: 4 };

/**
 * Decide what to do with one live stream.
 * Returns { action: 'none' | 'jump' | 'back', rate, excess } — rate is the playback speed to use.
 */
export function planLive({ latency, base, extra = 0, currentRate = 1, sinceJump = Infinity }) {
  const excess = latency - (base + extra);
  if (excess > LIVE.JUMP_OVER) {
    // Far behind (a long pause or a stall): skip straight to the live point. After a long pause
    // the player's idea of "newest" is itself out of date, so one jump may land short; the short
    // cooldown lets the next check jump again (seen with real YouTube: 44s -> 29s -> 19s).
    if (sinceJump > LIVE.JUMP_COOLDOWN) return { action: 'jump', rate: 1, excess };
    return { action: 'none', rate: 1.5, excess };
  }
  if (excess < -LIVE.AHEAD_BY) return { action: 'back', rate: 1, excess }; // closer to live than the user asked
  let rate = currentRate;
  if (excess > LIVE.FAST_OVER) rate = 1.5; // a little behind: play slightly fast until level
  else if (excess > LIVE.SLOW_OVER) rate = 1.25;
  else if (excess < LIVE.DONE_UNDER) rate = 1;
  else rate = Math.min(currentRate, 1.25); // nearly level: keep going gently until it is
  return { action: 'none', rate, excess };
}
