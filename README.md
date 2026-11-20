# MultiSync

Watch several videos or live streams side by side, kept in sync.
A from-scratch rebuild of the idea behind [viewsync.net](https://viewsync.net/), with its problems fixed and more sources added.

- Sources: YouTube (videos and live), Twitch (live channels and recorded videos), Vimeo, and direct video file links (`.mp4`, `.webm`).
- Day and night themes. "Auto" follows your device.
- Every video sits in its own labelled frame, so the page's controls never cover the video. The video you are listening to is outlined in amber.
- Works from a 320px phone to an ultrawide monitor.
- No build step, no dependencies, no server code, no accounts, no analytics, no API keys.
- Cost to run: zero. Any static host works (GitHub Pages, Netlify, S3 + CloudFront).

## Run it

1. Open a terminal in this folder.
2. Run `npm start` (or `python3 -m http.server 8080`). On a Mac you can instead double-click `start.command`.
3. Open `http://localhost:8080` in your browser. Use `localhost`, not `127.0.0.1`: Twitch refuses raw IP addresses.
4. Paste links, press **Add**, then **Watch in sync**.
5. Click **Start** once.

Do not open `index.html` by double-clicking it. Video sites refuse to play on `file://` pages; the page tells you if this happens.

## Features

0. **Search YouTube from the page.** Suggestions appear as you type. Results stay open, so you can add several videos from one search, with a "Live now" filter. Needs a free key (see below).
1. **One-click start.** Every video buffers muted, then all are released together.
2. **Automatic sync.** Checked every half second; a drifted video is pulled back. Tolerance is adjustable (0.3s to 2s).
3. **Fine-tune while watching.** Shift any video in 0.1s steps (Shift-click for 1s). The link updates as you go.
4. **Save a manual line-up.** Turn auto-sync off, line videos up by hand, then choose "Save current positions as the sync point".
5. **Add and remove videos while watching.** The others keep playing.
6. **Sound.** Hear one video at a time (keys `1`–`9`), or mix all with a volume slider per video.
7. **Layouts.** Automatic grid, Focus (one big, the rest in a strip), and a scrolling column on phones with many videos.
8. **Live streams.** LIVE badge and a live chat panel for YouTube and Twitch. Each YouTube live tile shows how many seconds it is behind real time. A stream that falls behind (after a pause or a stall) is pulled back automatically: slightly fast playback for small gaps, a jump for large ones. This can be switched off under More. Pause stops only the recorded videos; live streams always keep playing. When a broadcaster ends a stream, its tile changes from LIVE to ENDED and offers to play the recording.
9. **Hide controls while playing.** They return when you move the mouse or tap.
10. **Saved sets and recent sessions**, kept only in your browser.
11. **Speed control**, full screen, and keyboard shortcuts (press `?` while watching).

## What was wrong with ViewSync, and what changed

Found by testing the live site on 19 Nov 2026.

| # | Problem on viewsync.net | Here |
|---|---|---|
| 1 | Every video is labelled "Error": its channel-name lookup fails. | Titles come from the player itself. No API key. |
| 2 | You must click every video one by one to start. | One click starts all. |
| 3 | A start time like `t=10` is ignored; only `t=10s` works. | `10`, `10s`, `1m30s` and `1:30` all work. |
| 4 | Sync is set once. A video that buffers stays behind. | Continuous correction, with per-video drift shown. |
| 5 | Offsets are set on the first page by trial and error. | Nudge while playing, or save a manual line-up. |
| 6 | Three videos leave a dead quarter of the screen. | Grid picks the largest tiles and centres a short last row. |
| 7 | No live stream handling in its code. | Live badge, Go live, chat, excluded from the shared timeline. |
| 8 | A blocked video shows a raw error. | Plain-words message, link to the original, others carry on. |
| 9 | Pinch-zoom disabled; not usable on a phone. | Fully responsive; zoom allowed. |
| 10 | No shortcuts; nothing remembered. | Shortcuts; settings, saved sets and recents remembered locally. |
| 11 | YouTube only. | YouTube, Twitch, Vimeo, direct files. |
| 12 | Loads a visitor counter and jQuery 1.8 (2012). | No trackers, no libraries. |

## YouTube search: the free key

YouTube only allows search through its official API, which needs a key tied to a Google account.

1. Open the YouTube Data API v3 page in Google Cloud: https://console.cloud.google.com/apis/library/youtube.googleapis.com
2. Create a project if asked, then press **Enable**.
3. Go to **Credentials**, press **Create credentials**, choose **API key**.
4. Paste the key into the box MultiSync shows the first time you search.

Things to know:

- It is free. The default allowance is about 100 searches a day; "More results" counts as a search. Repeating a search in the same visit costs nothing.
- The key is saved only in your browser (`localStorage`). It is never written into the code or the link you share.
- Recommended: in Google Cloud, restrict the key to "YouTube Data API v3" and to your site's address (for example `http://localhost:8080/*`).
- Suggestions while typing need no key. They come from the same public endpoint youtube.com's search box uses; it is not a documented API, so if it ever stops answering you simply get no suggestions.
- Pasting links needs no key and has no limit.

## Privacy

1. Nothing you paste leaves your browser, except to the video site that plays it.
2. YouTube plays through its privacy-enhanced player (`youtube-nocookie.com`); Vimeo is asked not to track (`dnt`).
3. Each video site's script is loaded only if you use a video from that site.
4. The build page asks YouTube or Vimeo for a video's title when you add its link. No other party is contacted.
5. What you type in the search box goes to Google (for suggestions and search), the same as typing it on youtube.com.
6. The video sites still see that you watched, as with any embedded player.

## Limits you should know

- Sync accuracy is about ±0.5s. Web players report position only a few times a second, so frame-exact sync is not possible.
- Every live stream is some seconds behind real time before it even reaches you (often 15 to 30s on YouTube, set by the broadcaster). MultiSync keeps a stream at the best delay it has shown; it cannot go below what YouTube delivers.
- Two live streams of the same event have different delays. Line them up by ear with the nudge buttons (YouTube live only; Twitch live cannot be shifted).
- Twitch has no speed control, so at speeds other than 1× a Twitch video is re-synced repeatedly.
- `.m3u8` (HLS) links play in Safari only. Chrome and Firefox cannot play them without an extra library, which this project deliberately avoids.
- A direct file link works only if the file's server allows other sites to play it.
- Some videos cannot be embedded anywhere (owner's choice). They show a message instead.
- Up to 16 videos per session. Each one costs CPU and bandwidth; older laptops struggle beyond 6 to 8.

## Tests

1. `npm test`: 36 unit tests for link parsing, layout, sync maths and search results. Needs only Node 18+.
2. `npm run test:browser`: 15 end-to-end checks in headless Chrome. Needs Playwright (`npm i -D playwright`).

The browser checks use offline stand-ins for the YouTube, Twitch and Vimeo players (`tests/mock-players.js`) plus a real audio file for the direct-file player. They cover start-up, drift repair, mixed sources, add/remove, live and chat, both themes, and six screen sizes from 320×568 to 2560×1080.

## Files

```
index.html        build a session (paste links, set start times, saved sets)
watch.html        the synced viewer
css/style.css     both themes, all screen sizes
js/parse.js       links and times                 (pure, tested)
js/layout.js      tile rectangles                 (pure, tested)
js/sync.js        drift maths                     (pure, tested)
js/sources.js     one adapter per video site
js/watch.js       tiles, controls, sync loop
js/builder.js     the build page
js/theme.js       day / night
js/icons.js       inline icons
js/ytsearch.js    YouTube search and suggestions  (pure parts tested)
js/searchbox.js   the search / paste box used on both pages
js/store.js       localStorage helpers
```

## Link format

`watch.html?v=<video>&t=<seconds>&v=<video>&t=<seconds>[&audio=all]`

| Source | `v=` value |
|---|---|
| YouTube | the 11-character ID (same as ViewSync, so old links convert by swapping the domain) |
| Twitch live | `tw:channelname` |
| Twitch video | `tv:123456789` |
| Vimeo | `vm:76979871` |
| File | `file:` followed by the URL-encoded address |

MIT licence. Not affiliated with YouTube, Twitch, Vimeo or ViewSync.
