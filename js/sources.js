// One small adapter per video source, all exposing the same controls so the
// sync code never needs to know where a video comes from.
//
//   play() pause() seek(seconds) time() duration() state()
//   setMuted(bool) setVolume(0-100) setRate(number) info() liveEdge() destroy()
//
// Each source's own script is loaded only when a video of that kind is used.
import { STATE } from './sync.js';
import { shortName } from './parse.js';

const scripts = new Map();

/** Load a third-party player script once and wait until its global is usable. */
function loadScript(src, isReady) {
  if (isReady()) return Promise.resolve();
  if (!scripts.has(src)) {
    scripts.set(src, new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src;
      el.onerror = () => reject(new Error('blocked'));
      document.head.append(el);
      const began = Date.now();
      const timer = setInterval(() => {
        if (isReady()) { clearInterval(timer); resolve(); }
        else if (Date.now() - began > 15000) { clearInterval(timer); reject(new Error('timeout')); }
      }, 50);
    }));
    scripts.get(src).catch(() => scripts.delete(src)); // allow a retry later
  }
  return scripts.get(src);
}

const BLOCKED = (name) => `The ${name} player could not be loaded. Check your connection or allow it in your ad blocker, then reload.`;

class Base {
  constructor(video, mount, events) {
    this.video = video;
    this.mount = mount;
    this.events = events;
    this.current = STATE.UNSTARTED;
    this.dead = false;
    this.canRate = true;
    this.canSeekLive = false;
  }
  emit(state) {
    if (this.dead) return;
    this.current = state;
    this.events.onState(state);
  }
  fail(message) {
    if (!this.dead) this.events.onError(message);
  }
  ready() {
    if (!this.dead) this.events.onReady();
  }
  state() { return this.current; }
  info() { return { title: '', author: '', live: false }; }
  liveEdge() { return 0; }
  /** Seconds between real time and the frame on screen, or null when the player cannot tell. */
  latency() { return null; }
  /** Skip to the newest point of a live stream. */
  goLive() {}
  setRate() {}
  destroy() {
    this.dead = true;
    this.mount.replaceChildren();
  }
}

// ---------- YouTube ----------

const YT_ERRORS = {
  2: 'This video ID is not valid.',
  5: 'This video cannot be played in the browser.',
  100: 'This video was removed or is private.',
  101: 'This video cannot be played here. Either it was a live stream that has ended and left no recording, or its owner does not allow playing on other sites.',
  150: 'This video cannot be played here. Either it was a live stream that has ended and left no recording, or its owner does not allow playing on other sites.',
  153: 'YouTube refused the player. Open this page from a web server (http://…), not from a file.',
};

class YouTube extends Base {
  constructor(...args) {
    super(...args);
    this.canSeekLive = true;
    loadScript('https://www.youtube.com/iframe_api', () => Boolean(window.YT && window.YT.Player))
      .then(() => this.build())
      .catch(() => this.fail(BLOCKED('YouTube')));
  }
  build() {
    if (this.dead) return;
    const slot = document.createElement('div');
    this.mount.append(slot);
    this.p = new window.YT.Player(slot, {
      host: 'https://www.youtube-nocookie.com', // YouTube's privacy-enhanced player
      videoId: this.video.id,
      width: '100%',
      height: '100%',
      // No start time unless one was asked for: start=0 can send a live stream back to its first minute.
      playerVars: { playsinline: 1, rel: 0, origin: location.origin, ...(this.video.start > 0 ? { start: Math.floor(this.video.start) } : {}) },
      events: {
        onReady: () => this.ready(),
        onStateChange: (e) => this.emit(e.data),
        onError: (e) => this.fail(YT_ERRORS[e.data] || `YouTube reported error ${e.data}.`),
      },
    });
  }
  play() { this.p.playVideo(); }
  pause() { this.p.pauseVideo(); }
  seek(t) { this.p.seekTo(t, true); }
  time() { return this.p.getCurrentTime() || 0; }
  duration() { return this.p.getDuration() || 0; }
  state() { return this.p ? this.p.getPlayerState() : STATE.UNSTARTED; }
  setMuted(muted) { muted ? this.p.mute() : this.p.unMute(); }
  setVolume(v) { this.p.setVolume(v); }
  setRate(r) { this.p.setPlaybackRate(r); }
  liveEdge() { return this.duration(); }
  latency() {
    // For a live stream the player reports the wall-clock time of the frame on screen.
    // (For a recording the same call returns the position in seconds, a small number.)
    const ref = this.p.getMediaReferenceTime ? this.p.getMediaReferenceTime() : 0;
    return ref > 1e9 ? Date.now() / 1000 - ref : null;
  }
  goLive() {
    // getDuration() is stale on live streams (seen in real testing: seeking to it can go
    // backwards), so ask for a point far in the future and let the player clamp to live.
    this.p.seekTo(this.p.getCurrentTime() + 100000, true);
  }
  info() {
    const d = (this.p && this.p.getVideoData && this.p.getVideoData()) || {};
    return { title: d.title || '', author: d.author || '', live: Boolean(d.isLive) };
  }
  destroy() {
    try { this.p && this.p.destroy(); } catch { /* already gone */ }
    super.destroy();
  }
}

// ---------- Twitch (live channel or recorded video) ----------

class Twitch extends Base {
  constructor(...args) {
    super(...args);
    this.live = this.video.kind === 'twitch';
    this.canRate = false; // Twitch's embed has no speed control
    if (!/^[a-z0-9.-]+$/i.test(location.hostname) || /^\d+(\.\d+){3}$/.test(location.hostname)) {
      // Twitch only allows embedding on a named host (localhost is fine, raw IPs are not).
      queueMicrotask(() => this.fail('Twitch only plays on a named address. Open this page as http://localhost:8080 instead of an IP address.'));
      return;
    }
    loadScript('https://player.twitch.tv/js/embed/v1.js', () => Boolean(window.Twitch && window.Twitch.Player))
      .then(() => this.build())
      .catch(() => this.fail(BLOCKED('Twitch')));
  }
  build() {
    if (this.dead) return;
    const T = window.Twitch.Player;
    const options = { width: '100%', height: '100%', parent: [location.hostname], autoplay: false, muted: true };
    if (this.live) options.channel = this.video.id;
    else options.video = this.video.id;
    this.p = new T(this.mount, options);
    this.p.addEventListener(T.READY, () => this.ready());
    this.p.addEventListener(T.PLAY, () => this.current !== STATE.PLAYING && this.emit(STATE.BUFFERING));
    this.p.addEventListener(T.PLAYING, () => this.emit(STATE.PLAYING));
    this.p.addEventListener(T.PAUSE, () => this.emit(STATE.PAUSED));
    this.p.addEventListener(T.ENDED, () => this.emit(STATE.ENDED));
    this.p.addEventListener(T.OFFLINE, () => this.fail('This channel is offline right now.'));
  }
  play() { this.p.play(); }
  pause() { this.p.pause(); }
  seek(t) { this.p.seek(t); }
  time() { return this.p.getCurrentTime() || 0; }
  duration() {
    const d = this.p.getDuration();
    return Number.isFinite(d) ? d : 0;
  }
  setMuted(muted) { this.p.setMuted(muted); }
  setVolume(v) { this.p.setVolume(v / 100); }
  info() {
    return { title: this.live ? this.video.id : `Twitch video ${this.video.id}`, author: 'Twitch', live: this.live };
  }
}

// ---------- Vimeo ----------
// Vimeo answers every question asynchronously, so position is tracked from its
// 'timeupdate' events and extended with the clock between events.

class Vimeo extends Base {
  constructor(...args) {
    super(...args);
    this.last = this.video.start || 0;
    this.lastAt = performance.now();
    this.rate = 1;
    this.length = 0;
    this.title = '';
    this.isReady = false;
    loadScript('https://player.vimeo.com/api/player.js', () => Boolean(window.Vimeo && window.Vimeo.Player))
      .then(() => this.build())
      .catch(() => this.fail(BLOCKED('Vimeo')));
  }
  mark(seconds) {
    this.last = seconds;
    this.lastAt = performance.now();
  }
  build() {
    if (this.dead) return;
    this.p = new window.Vimeo.Player(this.mount, { url: `https://vimeo.com/${this.video.id}`, autoplay: false, dnt: true, playsinline: true });
    const quiet = (promise) => promise && promise.catch && promise.catch(() => {});
    this.quiet = quiet;
    this.p.on('play', () => this.current !== STATE.PLAYING && this.emit(STATE.BUFFERING));
    this.p.on('playing', () => { this.mark(this.last); this.emit(STATE.PLAYING); });
    this.p.on('pause', () => { this.mark(this.time()); this.emit(STATE.PAUSED); });
    this.p.on('ended', () => this.emit(STATE.ENDED));
    this.p.on('bufferstart', () => { this.mark(this.time()); this.emit(STATE.BUFFERING); });
    this.p.on('bufferend', () => { this.mark(this.last); this.playingWanted && this.emit(STATE.PLAYING); });
    this.p.on('timeupdate', (d) => { this.mark(d.seconds); if (d.duration) this.length = d.duration; });
    this.p.on('seeked', (d) => this.mark(d.seconds));
    this.p.ready()
      .then(() => {
        this.isReady = true;
        quiet(this.p.getDuration().then((d) => (this.length = d || 0)));
        quiet(this.p.getVideoTitle().then((t) => (this.title = t || '')));
        if (this.last > 0) quiet(this.p.setCurrentTime(this.last));
        this.ready();
      })
      .catch(() => this.fail('This Vimeo video is private, removed, or cannot be played on other sites.'));
  }
  play() { this.playingWanted = true; this.quiet(this.p.play()); }
  pause() { this.playingWanted = false; this.quiet(this.p.pause()); }
  seek(t) { this.mark(t); this.quiet(this.p.setCurrentTime(t)); }
  time() {
    if (this.current !== STATE.PLAYING) return this.last;
    return this.last + ((performance.now() - this.lastAt) / 1000) * this.rate;
  }
  duration() { return this.length; }
  setMuted(muted) { this.quiet(this.p.setMuted(muted)); }
  setVolume(v) { this.quiet(this.p.setVolume(v / 100)); }
  setRate(r) { this.mark(this.time()); this.rate = r; this.quiet(this.p.setPlaybackRate(r)); }
  info() { return { title: this.title, author: 'Vimeo', live: false }; }
  destroy() {
    try { this.p && this.p.destroy(); } catch { /* already gone */ }
    super.destroy();
  }
}

// ---------- A direct video/audio file (mp4, webm, m3u8 where the browser supports it) ----------

class FileVideo extends Base {
  constructor(...args) {
    super(...args);
    const el = document.createElement('video');
    this.el = el;
    el.controls = true;
    el.playsInline = true;
    el.preload = 'auto';
    el.muted = true;
    let announced = false;
    el.addEventListener('loadedmetadata', () => {
      if (announced) return;
      announced = true;
      if (this.video.start > 0 && Number.isFinite(el.duration)) el.currentTime = Math.min(this.video.start, el.duration);
      this.ready();
    });
    el.addEventListener('playing', () => this.emit(STATE.PLAYING));
    el.addEventListener('waiting', () => this.emit(STATE.BUFFERING));
    el.addEventListener('pause', () => !el.ended && this.emit(STATE.PAUSED));
    el.addEventListener('ended', () => this.emit(STATE.ENDED));
    el.addEventListener('error', () => {
      const hls = /\.m3u8(\?|#|$)/i.test(this.video.id);
      this.fail(hls
        ? 'This is an HLS stream (.m3u8). Chrome and Firefox cannot play those directly; Safari can.'
        : 'This file could not be loaded, or its format is not supported by your browser.');
    });
    el.src = this.video.id;
    this.mount.append(el);
  }
  play() { const p = this.el.play(); p && p.catch(() => {}); }
  pause() { this.el.pause(); }
  seek(t) { this.el.currentTime = t; }
  time() { return this.el.currentTime || 0; }
  duration() { return Number.isFinite(this.el.duration) ? this.el.duration : 0; }
  setMuted(muted) { this.el.muted = muted; }
  setVolume(v) { this.el.volume = Math.min(1, Math.max(0, v / 100)); }
  setRate(r) { this.el.playbackRate = r; }
  liveEdge() { return this.el.seekable.length ? this.el.seekable.end(this.el.seekable.length - 1) : 0; }
  goLive() { const edge = this.liveEdge(); if (edge > 0) this.el.currentTime = edge; }
  info() { return { title: shortName(this.video), author: '', live: this.el.duration === Infinity }; }
  destroy() {
    this.el.removeAttribute('src');
    this.el.load();
    super.destroy();
  }
}

const ADAPTERS = { youtube: YouTube, twitch: Twitch, twitchvod: Twitch, vimeo: Vimeo, file: FileVideo };

/** events: { onReady(), onState(code), onError(message) } */
export function createPlayer(video, mount, events) {
  const Adapter = ADAPTERS[video.kind];
  return new Adapter(video, mount, events);
}

/** Embeddable live chat for a live video, or null when the source has none. */
export function chatUrl(video, dark) {
  const host = encodeURIComponent(location.hostname);
  if (video.kind === 'youtube') return `https://www.youtube.com/live_chat?v=${video.id}&embed_domain=${host}${dark ? '&dark_theme=1' : ''}`;
  if (video.kind === 'twitch') return `https://www.twitch.tv/embed/${video.id}/chat?parent=${host}${dark ? '&darkpopout' : ''}`;
  return null;
}
