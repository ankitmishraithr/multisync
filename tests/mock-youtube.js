// A stand-in for the YouTube IFrame API so the whole page can be tested offline.
// Video IDs choose the behaviour: LIVE… = live stream, BLOCK… = embedding disabled, SLOW… = slow to buffer,
// FLAKY… = ignores the first play request.
(() => {
  const S = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };
  window.__players = {};
  class Player {
    constructor(elId, opts) {
      this.id = opts.videoId;
      this.opts = opts;
      this.live = this.id.startsWith('LIVE');
      this.state = S.CUED;
      this.base = this.live ? 3600 : opts.playerVars.start || 0;
      this.since = null;
      this.rate = 1;
      this.muted = false;
      this.volume = 100;
      this.created = performance.now();
      this.seeks = 0;
      const host = document.getElementById(elId);
      const frame = document.createElement('iframe');
      frame.id = elId;
      frame.srcdoc = `<body style="margin:0;background:#234;color:#fff;font:14px sans-serif">${this.id}</body>`;
      host.replaceWith(frame);
      window.__players[this.id] = this;
      setTimeout(() => {
        if (this.id.startsWith('BLOCK')) opts.events.onError({ data: 150 });
        else opts.events.onReady({ target: this });
      }, 50);
    }
    _set(state) { this.state = state; this.opts.events.onStateChange({ data: state }); }
    _now() { return this.since == null ? this.base : this.base + ((performance.now() - this.since) / 1000) * this.rate; }
    __skew(sec) { this.base += sec; }
    playVideo() {
      if (this.state === S.PLAYING || this.pending) return;
      this.plays = (this.plays || 0) + 1;
      if (this.id.startsWith('FLAKY') && this.plays === 1) { // real YouTube sometimes does this
        this._set(S.BUFFERING);
        setTimeout(() => this._set(S.UNSTARTED), 80);
        return;
      }
      this.pending = true;
      this._set(S.BUFFERING);
      setTimeout(() => {
        this.pending = false;
        this.since = performance.now();
        this._set(S.PLAYING);
      }, this.id.startsWith('SLOW') ? 1500 : 120);
    }
    pauseVideo() {
      if (this.state !== S.PLAYING) return;
      this.base = this._now();
      this.since = null;
      this._set(S.PAUSED);
    }
    seekTo(t) { this.seeks++; this.base = t; if (this.since != null) this.since = performance.now(); }
    getCurrentTime() { return this._now(); }
    getDuration() { return this.live ? 3600 + (performance.now() - this.created) / 1000 : 600; }
    getPlayerState() { return this.state; }
    getVideoData() { return { video_id: this.id, title: `Title ${this.id}`, author: 'Channel', isLive: this.live }; }
    mute() { this.muted = true; }
    unMute() { this.muted = false; }
    isMuted() { return this.muted; }
    setVolume(v) { this.volume = v; }
    setPlaybackRate(r) { this.base = this._now(); if (this.since != null) this.since = performance.now(); this.rate = r; }
  }
  window.YT = { Player, PlayerState: S };
})();
