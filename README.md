# Gimy TV — Cloudflare

A standalone, anonymous player for [Gimy 劇迷 (gimyai.tw)](https://gimyai.tw/) designed for Samsung TV browsers. No login, SDK, external fonts, CDN scripts, API keys or cookies are required. This is an independent compatibility interface, not the official Gimy website. It follows the design of [Samsung-anime1](https://github.com/owen800q/Samsung-anime1).

## Deploy

The project is a Cloudflare Worker with static assets:

- Production branch: `main`
- Deploy command: `npx wrangler deploy`
- Build command: optional; Wrangler runs `node scripts/build.mjs`
- Worker entry: `dist/_worker.js`; static assets: `dist`
- Node.js: 20 or newer

`wrangler.jsonc` declares the Worker, its `ASSETS` binding and the `WatchHistory` SQLite Durable Object (`WATCH_HISTORY` binding, `new_sqlite_classes` migration). The generated `dist/` is committed; CI checks it matches the build. `/api/*` invokes the Worker; other paths serve static assets.

Open the Worker's `workers.dev` address on the TV. Browse by category, region, year and order, or search by title. Select a show, pick a route (線路) and an episode, then press **播放**. Arrow keys move focus; with the video focused, left/right seek ten seconds. Play/pause, fast-forward and rewind remote keys are supported.

## Samsung TV app

Besides the web page, the project ships a remote-driven Samsung TV app (Tizen 4.0+, 2018 and newer TVs), modelled on the navigation of [samsung-hongguo-drama](https://github.com/owen800q/samsung-hongguo-drama): a collapsible icon rail (影視目錄, 搜尋, 觀看歷史, 裝置同步), poster grids that load more as you scroll, a detail page with route and episode pickers, and a full-screen player with an on-screen control bar. It uses the same Worker API, so catalogue filters, search, route fallback, resume, watch history and device sync behave as on the web; history syncs between the TV app and the web page with the same private code.

The app lives in `src/tv/` (one classic script, no dependencies, Chromium 56-safe — `tests/tv.test.mjs` guards against newer syntax). The Worker serves it at `/tv/`, which is also the easiest way to try it in a desktop browser.

| Key | Browsing | Player |
|-|-|-|
| Arrows | Move focus; Left opens the sidebar | Controls hidden: Left/Right seek 10 s (presses add up), Up shows controls, Down opens episodes. Controls shown: move focus; on the progress bar Left/Right seek |
| OK | Select; on a text field, open the TV keyboard | Play/pause |
| Back | Close dialog, go back, then ask to exit | Hide controls, then leave the player |
| Play/Pause, Play, Pause, Stop | — | As labelled |
| Fast-forward / Rewind | — | Seek 30 s |
| CH ▲/▼, Next/Previous | — | Next/previous episode |
| Green / Yellow | — | Episode panel / route panel |

Episodes play automatically, resume from saved progress and continue to the next episode when one ends; a route that needs the site's parser falls through to the next route. On a desktop keyboard Esc is Back, Space is play/pause and PageUp/PageDown change episode.

### Package and install

The packaged app runs from `file://` and calls your deployed Worker, which accepts the `file://`/`null` origin of the TV app (with CORS headers) in addition to its own origin.

```sh
npm run package:tv -- --api https://gimy-tv.<account>.workers.dev --profile <certificate-profile>
# writes build/GimyTV.wgt (signed) — without --profile, an unsigned build/GimyTV-unsigned.wgt
# (the widget files are in build/widget)
GIMY_API=https://gimy-tv.<account>.workers.dev scripts/tv.sh <tv-ip> <certificate-profile>
# packages, installs and launches on a TV in Developer mode
```

Without `--api`, the TV asks for the Worker address under **裝置同步** (it can be changed there later too). Signing needs [Tizen Studio](https://developer.tizen.org/development/tizen-studio/download) with Samsung TV Extensions and a Samsung certificate profile whose distributor certificate lists the TV's DUID. To enable Developer mode, open Apps on the TV, press `1 2 3 4 5`, turn Developer mode on with this computer's IP and restart the TV. The widget metadata and the app icon are in `tizen/`.

### Updates

Installed TVs update themselves. The Worker build publishes the TV app at `/tv-app/` (`scripts/ota-update.mjs`), and the app downloads a new build in the background and uses it from the next launch. A push to `main` therefore reaches TVs without reinstalling. Updates come from the `--api` Worker, `https://tv.codeboxhk.com` by default. See [ota/README.md](ota/README.md).

Every push to `main` also publishes a GitHub release with the widget (`.github/workflows/release.yml`). Reinstall it only after changing `tizen/config.xml`, the icon or the loader. The release is signed when the repository has the certificate secrets listed in ota/README.md.

## How it works

The Worker reads gimyai.tw's public pages as text; no upstream scripts execute.

| Route | Source |
| --- | --- |
| `GET /api/catalog?type=&area=&year=&sort=&page=` | `/explore/{type}-{area}-{sort}------{page}---{year}.html` listing pages |
| `GET /api/search?q=` | `/index.php/ajax/suggest/mid/1/limit/30/wd/{q}` (JSON) |
| `GET /api/detail?id=` | `/detail/{id}.html` (metadata, routes, episodes, viewer comments) and `/static/js/playerconfig.js` |
| `GET /api/resolve?id=&sid=&nid=` | `/play/{id}-{sid}-{nid}.html` (`player_aaaa` data) |
| `GET/PUT /api/history` | Watch history Durable Object |
| `GET /api/health` | `{"authentication":"none"}` |

Gimy's search pages (`/find/…`) and any request with a `wd=` query string are behind a Cloudflare browser challenge, so search uses the path-style suggest endpoint, which is not. Titles are stored in Traditional Chinese, so search with Traditional characters (鬼滅, not 鬼灭); at least two characters are needed.

Each show offers several routes. Routes whose player flag ends in `m3u8` (or the `…zyk` resource libraries) carry a public HLS playlist; others (`qsvip`, `JD4K`, Youku, …) need the site's external parser and are not supported. The detail API marks routes `direct: true/false/null` from the player configuration and lists playable routes first. If a chosen route turns out not to have a direct playlist, the player automatically retries the same episode on the next route.

Playlists are served with `Access-Control-Allow-Origin: *` and need no cookies or referrer, so — unlike Anime1 — the browser plays the source HLS address directly and the Worker never proxies video. Samsung TVs (Tizen) and Safari play HLS natively; other browsers use the vendored [hls.js](https://github.com/video-dev/hls.js) light build (Apache-2.0, `src/vendor/`). Posters load directly from the source CDN with `no-referrer`.

Only numeric ids, plain HTTPS media URLs with public host names and `.m3u8`/`.mp4` paths, and same-site detail/play links are accepted. There is no arbitrary-URL proxy. Listing, detail and search responses are cached in memory for five minutes, play pages for two, and the player configuration for an hour. Videos remain dependent on the source routes' availability; a route that buffers or fails can be switched under the episode list.

## Watch history and device sync

Refresh and browser Back/Forward preserve filters, search, show details and the playing episode using URL hash routes. The home page has a **觀看歷史** tab; detail pages and episode buttons show saved progress. Selecting an unfinished episode restores its last position; completed episodes start again from zero. The route last used for a show is preselected.

History records (show, episode number, route, position, duration, completion and revision) persist in a SQLite-backed Durable Object per profile, keyed by the SHA-256 of a random 128-bit bearer kept in the browser. **裝置同步** shows that private code; entering it on another TV or computer switches that device to the same history. Possession of the code allows reading and updating the history, so do not publish it. Progress saves every 15 seconds and on pause, seek, end or leaving the page; local storage is only an offline outbox. Revision checks prevent an outdated write from overwriting newer progress, and the 500 most recently updated episodes are kept.

## Development

There are no npm dependencies.

```sh
npm run build   # writes dist/
npm test        # parser, Worker route and history tests with recorded fixtures
npm run dev     # local preview on http://localhost:8787 (history stays local)
npm run check:live   # optional: exercises the real site end to end
npm run package:tv   # Samsung TV widget in build/ (see above)
```

Edit `src/`, then rebuild `dist/` before committing. Tests use trimmed copies of real Gimy pages in `tests/fixtures/` and mocked upstream responses; `scripts/check-live.mjs` runs the same Worker code against the live site and fetches the resulting HLS playlist. `npx wrangler dev` runs the bundle in the Workers runtime with the Durable Object.
