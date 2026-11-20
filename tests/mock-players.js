// Offline stand-ins for the YouTube, Twitch and Vimeo player scripts, so the whole
// app can be tested without the network. The ID picks the behaviour:
//   LIVE…  live stream        BLOCK… cannot be embedded      SLOW… slow to buffer
//   FLAKY… ignores the first play request                    offline… Twitch channel that is offline
(() => {
  const S = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };
  window.__players = {};

  /** A pretend video: a clock that runs while "playing". */
  class Sim {
    constructor(id, { live = false, start = 0, length = 600, onState }) {
      Object.assign(this, { id, live, length, onState, state: S.CUED, base: live ? 3600 : start, since: null, rate: 1, muted: false, volume: 100, seeks: 0, plays: 0, created: performance.now() });
      window.__players[id] = this;
    }
    set(state) { this.state = state; this.onState(state); }
    // A live stream's newest point moves forward with the clock; playback can never pass it.
    edge() { return 3600 + (performance.now() - this.created) / 1000; }
    now() {
      const pos = this.since == null ? this.base : this.base + ((performance.now() - this.since) / 1000) * this.rate;
      return this.live ? Math.min(pos, this.edge()) : pos;
    }
    // Like real YouTube: wall-clock time of the frame on screen for live (about 15s behind at best),
    // plain position for a recording.
    reference() { return this.live ? Date.now() / 1000 - 15 - (this.edge() - this.now()) : this.now(); }
    get t() { return this.now(); }
    skew(sec) { this.base += sec; }
    play() {
      if (this.state === S.PLAYING || this.pending) return;
      this.plays++;
      if (this.id.startsWith('FLAKY') && this.plays === 1) {
        this.set(S.BUFFERING);
        setTimeout(() => this.set(S.UNSTARTED), 80);
        return;
      }
      this.pending = true;
      this.set(S.BUFFERING);
      if (this.live && this.plays === 1) this.base = this.edge(); // a fresh join starts at the live point
      setTimeout(() => { this.pending = false; this.since = performance.now(); this.set(S.PLAYING); }, this.id.startsWith('SLOW') ? 1500 : 120);
    }
    pause() {
      if (this.state !== S.PLAYING) return;
      this.base = this.now();
      this.since = null;
      this.set(S.PAUSED);
    }
    seek(t) {
      this.seeks++;
      // seeking past the end of a live stream lands a few seconds short of the newest point, as on YouTube
      this.base = this.live && t > this.edge() ? this.edge() - 4 : t;
      if (this.since != null) this.since = performance.now();
    }
    setRate(r) { this.base = this.now(); if (this.since != null) this.since = performance.now(); this.rate = r; }
    duration() { return this.live ? 3600 + (performance.now() - this.created) / 1000 : this.length; }
  }

  const paint = (host, label) => {
    const el = typeof host === 'string' ? document.getElementById(host) : host;
    const frame = document.createElement('iframe');
    frame.srcdoc = `<body style="margin:0;display:grid;place-items:center;height:100vh;background:#1c2a3a;color:#9fb4cc;font:13px sans-serif">${label}</body>`;
    el.append(frame);
    return frame;
  };

  // --- YouTube ---
  class YTPlayer {
    constructor(host, opts) {
      const id = opts.videoId;
      this.sim = new Sim(id, { live: id.startsWith('LIVE'), start: opts.playerVars.start || 0, onState: (s) => opts.events.onStateChange({ data: s }) });
      const frame = paint(host.parentNode, `YouTube ${id}`);
      host.remove();
      this.frame = frame;
      setTimeout(() => (id.startsWith('BLOCK') ? opts.events.onError({ data: 150 }) : opts.events.onReady({ target: this })), 50);
    }
    playVideo() { this.sim.play(); }
    pauseVideo() { this.sim.pause(); }
    seekTo(t) { this.sim.seek(t); }
    getCurrentTime() { return this.sim.now(); }
    getDuration() { return this.sim.duration(); }
    getMediaReferenceTime() { return this.sim.reference(); }
    getPlayerState() { return this.sim.state; }
    getVideoData() { return { video_id: this.sim.id, title: `Title ${this.sim.id}`, author: 'Channel', isLive: this.sim.live }; }
    mute() { this.sim.muted = true; }
    unMute() { this.sim.muted = false; }
    setVolume(v) { this.sim.volume = v; }
    setPlaybackRate(r) { this.sim.setRate(r); }
    destroy() { this.frame.remove(); delete window.__players[this.sim.id]; }
  }
  window.YT = { Player: YTPlayer, PlayerState: S };

  // --- Twitch ---
  class TwitchPlayer {
    constructor(host, opts) {
      window.__twitchOptions = opts;
      const id = opts.channel || opts.video;
      this.handlers = {};
      const fire = (name) => (this.handlers[name] || []).forEach((fn) => fn());
      this.sim = new Sim(id, { live: Boolean(opts.channel), onState: (s) => fire({ [S.PLAYING]: 'playing', [S.PAUSED]: 'pause', [S.ENDED]: 'ended', [S.BUFFERING]: 'play' }[s]) });
      paint(host, `Twitch ${id}`);
      setTimeout(() => { fire('ready'); if (id.startsWith('offline')) fire('offline'); }, 50);
    }
    addEventListener(name, fn) { (this.handlers[name] ||= []).push(fn); }
    play() { this.sim.play(); }
    pause() { this.sim.pause(); }
    seek(t) { this.sim.seek(t); }
    getCurrentTime() { return this.sim.now(); }
    getDuration() { return this.sim.live ? Infinity : this.sim.length; }
    setMuted(m) { this.sim.muted = m; }
    setVolume(v) { this.sim.volume = v * 100; }
  }
  Object.assign(TwitchPlayer, { READY: 'ready', PLAY: 'play', PLAYING: 'playing', PAUSE: 'pause', ENDED: 'ended', OFFLINE: 'offline', ONLINE: 'online' });
  window.Twitch = { Player: TwitchPlayer };

  // --- Vimeo: everything is a promise, position arrives through 'timeupdate' events ---
  class VimeoPlayer {
    constructor(host, opts) {
      const id = opts.url.split('vimeo.com/')[1];
      this.id = id;
      this.handlers = {};
      const fire = (name, data) => (this.handlers[name] || []).forEach((fn) => fn(data));
      this.fire = fire;
      this.sim = new Sim(`vimeo${id}`, { length: 300, onState: (s) => {
        const data = { seconds: this.sim.now(), duration: 300 };
        if (s === S.BUFFERING) fire('play', data);
        if (s === S.PLAYING) fire('playing', data);
        if (s === S.PAUSED) fire('pause', data);
      } });
      this.frame = paint(host, `Vimeo ${id}`);
      this.timer = setInterval(() => this.sim.state === S.PLAYING && fire('timeupdate', { seconds: this.sim.now(), duration: 300 }), 250);
    }
    on(name, fn) { (this.handlers[name] ||= []).push(fn); }
    ready() { return this.id.startsWith('404') ? Promise.reject(new Error('not found')) : new Promise((r) => setTimeout(r, 50)); }
    play() { this.sim.play(); return Promise.resolve(); }
    pause() { this.sim.pause(); return Promise.resolve(); }
    setCurrentTime(t) { this.sim.seek(t); setTimeout(() => this.fire('seeked', { seconds: t, duration: 300 }), 30); return Promise.resolve(t); }
    getCurrentTime() { return Promise.resolve(this.sim.now()); }
    getDuration() { return Promise.resolve(300); }
    getVideoTitle() { return Promise.resolve(`Vimeo title ${this.id}`); }
    setMuted(m) { this.sim.muted = m; return Promise.resolve(m); }
    setVolume(v) { this.sim.volume = v * 100; return Promise.resolve(v); }
    setPlaybackRate(r) { this.sim.setRate(r); return Promise.resolve(r); }
    destroy() { clearInterval(this.timer); this.frame.remove(); return Promise.resolve(); }
  }
  window.Vimeo = { Player: VimeoPlayer };
})();
