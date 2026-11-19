# MultiSync

Watch several YouTube videos or live streams side by side, kept in sync.
A from-scratch rebuild of the idea behind [viewsync.net](https://viewsync.net/), with its problems fixed.

- No build step, no dependencies, no server code: plain HTML, CSS and JavaScript.
- No accounts, no analytics, no API key. Settings stay in your browser.
- Cost to run: zero. Any static host works (GitHub Pages, Netlify, S3 + CloudFront).

## Run it

1. Open a terminal in this folder.
2. Run `npm start` (or `python3 -m http.server 8080`).
3. Open `http://localhost:8080` in your browser.
4. Paste YouTube links, press **Add**, then **Watch in sync**.
5. Click **Start all videos** once.

Do not open `index.html` by double-clicking it. YouTube refuses to play on `file://` pages (error 153); the page tells you this if it happens.

## Use it

1. **Add videos**: one link per line. Watch, `youtu.be`, live, shorts and embed links work, as do plain video IDs and old ViewSync links.
2. **Set start times** (optional): `90`, `1:30` or `1m30s`. For a live stream the number means "seconds behind live".
3. **Fine-tune while watching**: hover a video and use **−0.1s / +0.1s** (hold Shift for 1s). The link in the address bar updates, so what you share is what you tuned.
4. **Sound**: press `1`–`9` or the **Sound** button on a video to hear that one. Switch to "All videos" to mix.
5. **Focus**: makes one video large and puts the rest in a strip. `G` returns to the grid.

Shortcuts: `Space` play/pause, `←` `→` 10s, `M` mute, `S` re-sync, `F` full screen.

## What was wrong with ViewSync, and what changed

Found by testing the live site on 19 Nov 2026.

| # | Problem on viewsync.net | Here |
|---|---|---|
| 1 | Every video is labelled "Error". The site asks the YouTube Data API for the channel name and that call fails. | Title and channel come from the player itself. No API key, nothing to break. |
| 2 | You must click every video one by one to start it. | One click starts all of them. Videos buffer muted first, then are released together. |
| 3 | A start time like `t=10` is ignored; only `t=10s` works. | `10`, `10s`, `1m30s` and `1:30` all work. |
| 4 | Sync is set once at the start. If one video buffers, it stays behind. | A loop checks every half second and pulls a drifted video back. Per-video drift is shown. |
| 5 | Offsets can only be set on the first page, by trial and error. | Nudge each video in 0.1s steps while it plays. |
| 6 | Three videos leave a dead quarter of the screen; layout is a fixed grid. | The grid picks the shape with the largest tiles and centres a short last row. Focus mode added. |
| 7 | The quality menu calls `setPlaybackQuality`, which YouTube turned into a no-op years ago. | Removed. YouTube picks quality from tile size; each player's own gear menu still works. |
| 8 | No live stream handling. | Live streams get a LIVE badge, are left out of the shared timeline, are never dragged by the sync loop, and have a **Go live** button. |
| 9 | A broken or blocked video shows YouTube's raw error. | The tile says why in plain words, links to YouTube, and the other videos carry on. |
| 10 | Pinch-zoom is disabled on phones; the page is not usable on a narrow screen. | Zoom allowed; the layout stacks on phones. |
| 11 | No keyboard shortcuts, nothing remembered. | Shortcuts; volume, auto-sync and recent sessions are remembered locally. |
| 12 | Loads a visitor counter and jQuery 1.8 (2012). | No trackers, no libraries. Uses YouTube's privacy-enhanced player (`youtube-nocookie.com`). |

## Limits you should know

- Sync accuracy is about ±0.5s by default. YouTube's player only reports its position a few times a second, so frame-exact sync is not possible from a web page.
- Two live streams of the same event usually have different delays. Use the nudge buttons to line them up by ear; the page cannot measure this for you.
- Some videos cannot be embedded anywhere (owner's choice). They show a message instead.
- Ads are YouTube's. A video showing an ad is behind until the ad ends, then gets pulled back into sync.
- YouTube only. Twitch and others are not supported.

## Tests

1. `npm test`: 21 unit tests for link parsing, layout and sync maths. Needs only Node 18+.
2. `npm run test:browser`: 7 end-to-end checks in headless Chrome against an offline stand-in for the YouTube player (`tests/mock-youtube.js`). Needs Playwright (`npm i -D playwright`).

The stand-in can be slow, blocked, live, or ignore the first play request, so start-up, drift repair, error tiles and live handling are all exercised without the network.

## Files

```
index.html        build a session (paste links, set start times)
watch.html        the synced viewer
js/parse.js       links and times      (pure, tested)
js/layout.js      tile rectangles      (pure, tested)
js/sync.js        drift maths          (pure, tested)
js/watch.js       players, controls, sync loop
js/builder.js     the build page
js/store.js       localStorage helpers
```

## Link format

`watch.html?v=ID&t=SECONDS&v=ID&t=SECONDS[&audio=all]`: the same `v`/`t` pairs ViewSync uses, so old links can be converted by swapping the domain.

MIT licence. Not affiliated with YouTube or ViewSync.
