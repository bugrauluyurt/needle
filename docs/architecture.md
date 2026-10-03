# Needle architecture

How the app is put together, how requests travel, where data lives, and the
integration flows that are easy to get wrong. For installation and configuration,
see the [README](../README.md).

## The big picture

```
 Browser or installed PWA
   apps/web/src/app             application bootstrap and router
   apps/web/src/features        contextual routes, components, hooks and clients
   player, shared components, i18n, offline storage and state
        |
        | /rest/*, /api/*, media routes and /api/devices WebSocket
        v
 Needle server, Node 24 and Hono
   app.ts                       service construction and route registration
   routes/                      contextual HTTP routes
   http/                        authentication, authorization, validation and errors
   realtime/devices.ts          Hono WebSocket upgrade and device hub
   db/                          node:sqlite schema, migrations and startup checks
   integration clients          Navidrome, Lidarr, slskd, Spotify and discovery APIs
        |
        +--> Navidrome, Lidarr, slskd, Spotify, ListenBrainz and metadata services
        +--> uv-managed YouTube Music bridge subprocess
```

The browser only ever talks to the Needle server (plus Spotify when that's on).
Keys for Lidarr, slskd and Spotify's client secret stay on the server.

## Code layout

```
apps/web/src
  app/          application bootstrap, router and runtime hooks
  features/     contextual routes, components, hooks and clients for catalog,
                library, search, settings, Spotify, YouTube Music and remote devices
  pages/        cross-feature screens such as Home, Login, Requests and Stats
  components/   shared UI; tracks/ owns track rows, menus and track actions
  layout/       desktop and mobile application shell
  player/       queue, audio engine, controller and Spotify playback
  queries/      shared TanStack Query client, keys and common hooks
  offline/      Cache Storage and IndexedDB downloads
  state/        persisted Zustand session, settings and UI stores
  i18n/         typed English and Turkish dictionaries and language runtime
  styles/       global, layout and mobile entry points plus components/ and pages/
apps/server/src
  app.ts        constructs services and registers contextual route modules
  routes/       library, requests, people, integrations, media, system and static routes
  http/         authentication, authorization, validation, request context and errors
  realtime/     Hono WebSocket upgrade for the device hub
  db/           SQLite schema, ordered migrations, backup and startup verification
  *.ts          concrete integration clients and domain services
packages/shared/src
  types/        shared compile-time contracts
  constants/    shared literals such as authentication headers
  schemas/      runtime Zod schemas for socket messages
  utils/        shared domain utilities
bridges/youtube-music
  pyproject.toml and uv.lock
  src/          JSON stdin/stdout Python bridge
  test/         Python unit tests
e2e/            Playwright, test Navidrome and external integration mocks
```

## HTTP and realtime boundaries

- `/api/health` and the Spotify callback are public. Other HTTP `/api/*` routes
  validate the authentication headers and verify them with Navidrome.
- Contextual routes validate path parameters, query values, headers and JSON bodies
  with Zod before domain services run.
- JSON request bodies default to 64 KiB. Photos are limited to 400,000 bytes.
  Spotify missing-track imports allow 64 MiB. WebSocket frames allow 8 MiB.
- Authentication, administration, permission and integration checks are reusable
  Hono middleware.
- Every HTTP response receives `x-request-id`. Failures use
  `{ error, code, requestId, issues? }`; unexpected errors are logged with the same id.
- `/api/devices` uses Hono's WebSocket upgrade. Query credentials are validated
  before upgrading, messages use shared Zod schemas, transfers allow at most 300
  songs, and invalid messages close with code 1008.
- `/rest/*` proxies Subsonic calls. Radio and YouTube Music audio validate route,
  query and header inputs before proxying. Static files and the SPA fallback are
  registered last, so unknown `/api/*` paths remain API errors.

## Who may do what

```
 authenticated request -> isAdmin(user): Navidrome getUser -> adminRole, cached 10 min
                          -> people.seen(user, admin)
 people.allowed(user, admin, "request")       admins always; others when enabled in People
 people.allowed(user, admin, "spotify")       admins unless disabled; others when enabled
 people.allowed(user, admin, "youtubeMusic")  admins unless disabled; others when enabled
```

| Needs         | Routes                                                                                                                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Request music | `GET /api/lidarr/search`, `/albums`, `/artists`, `POST /api/lidarr/albums/:id`, `/api/songs*`, `POST /api/requests/:id/retry`, `POST /api/spotify/missing`, `POST /api/listenbrainz/playlists/:mbid/missing` |
| Spotify       | `/api/spotify/*`, except the sign-in callback                                                                                                                                                                |
| YouTube Music | `/api/youtube-music/*` and `/youtube-music/stream/:id`                                                                                                                                                       |
| Admin         | `GET`/`DELETE /api/lidarr/downloads[/:id]`, `GET /api/status`, `GET`/`PUT /api/people[/:user]`, `GET /api/requests?everyone=1`, removing anyone's request                                                    |
| Signed in     | Stats, plays, search, library, browse, mixes, photos, own requests, devices and each person's ListenBrainz connection                                                                                        |

`/api/capabilities` tells the app what this person may do: `admin`, `lidarr` and `songs`
(may request), Spotify and YouTube Music availability, connection and enabled state,
provider reconnect state, and ListenBrainz connection state. The app hides what is not
allowed; the server refuses it anyway with 403.

## Where data lives

| Where                             | What                                                                                                                                                                                 |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `needle.db`                       | Plays, requests, profiles, people, permissions, Spotify tokens and OAuth state, YouTube Music tokens and pending device logins, ListenBrainz tokens, and `needle_migrations` history |
| `needle.pre-migrations.db`        | One-time integrity-checked copy made before adopting versioned migrations for an existing populated database                                                                         |
| Navidrome                         | The library, users, playlists, likes and the play queue each device syncs                                                                                                            |
| Browser localStorage              | Session, queue, UI state, provider caches and `needle.settings`, including the manually selected language                                                                            |
| Browser Cache Storage + IndexedDB | Offline downloads and service-worker caches for the app shell and cover art                                                                                                          |

Database migrations run under `BEGIN IMMEDIATE`. Startup rejects unknown migration
history or incompatible tables, columns and indexes instead of continuing with a
partially understood database.

## Localization

English and Turkish live in typed dictionaries under `apps/web/src/i18n/locales`.
English defines the allowed keys and Turkish must satisfy the same key set. English
is the default. The app does not infer a language from the browser: the person selects
it in Settings, and Zustand persists it in `needle.settings`. Changing language updates
the React UI, document language, title, description and localized web manifest.

## Search and browse

```
 first search after a scan ──► search.ts builds an index for that user:
                                 search3 with an empty query, 500 at a time → every song, album, artist
 every search ──► all words must appear somewhere in title/artist/album (accents folded,
                  Turkish ı/İ handled); title matches rank first
 browse tiles ──► built from the same index: top genres, decades, recently added, random
 Your library ──► GET /api/library/songs: every song from the same index, newest first
                  (the Songs filter); a search uses /api/search like the Search page
 index freshness ──► getScanStatus checked at most every 10 s; rebuilt when it changes
                     or after 60 s to refresh play counts and other metadata
                     (the app keeps search results for 5 s, so a new song shows up
                      within seconds of Navidrome's scan)
```

Library search returns every ranked match from that index. Song and release lists
sort before displaying their previews, with unknown release dates last. Spotify
search and artist releases retain paging metadata and request additional pages only
when the person chooses Load more. Search query keys keep each source and category
separate; changing the query cancels outstanding requests.

## Playback

```
 playSongs() ──► queue (player/queue.ts) ──► loadCurrent()
                    │ local song: engine.ts plays /rest/stream (original or transcoded),
                    │             preloads the next one, crossfades on desktop
                    │ Spotify song: player/spotify.ts → Web Playback SDK device → Spotify API "play"
                    │ YouTube Music song: /youtube-music/stream/:id → yt-dlp → range proxy,
                    │                     engine.ts plays the same-origin audio response
                    ▼
               report all sources to /api/plays (stats);
               only local songs scrobble to Navidrome or enter its saved play queue
               (another device offers to "pick up where you left off", checked at most every 30 s)
```

## Spotify

```
 app ──► /api/spotify/token ──► server refreshes with the stored refresh token ──► short-lived token
 app ──► api.spotify.com with that token   (library, search, playlist edits, likes, follows)
 app ──► sdk.scdn.co Web Playback SDK      (Premium; desktop and Android browsers)
```

Spotify limits "development mode" apps per developer account and can lock them out
for hours (`429`, `reason: QUOTA_EXCEEDED`). So:

- `features/spotify/api/client.ts` `req()`: a 429 with a short `Retry-After` (≤ 5 s) waits once;
  anything longer (or unreadable, one hour) blocks every Spotify call until then,
  saved in `needle.spotifyBlockedUntil` so reloads don't retry.
- While blocked, `useSpotifyOn()` is false: Spotify queries are removed and every
  Spotify row, sidebar entry, search section and the player disappear.
- The Spotify library (profile, playlists, liked songs, saved albums, followed
  artists, artist photo lookups) is cached per user in localStorage for six hours.
  Spotify queries never refetch on focus and never retry.
- Settings → **Use Spotify in Needle** (`PUT /api/spotify/enabled`) switches Spotify
  off for the account: the token endpoint refuses (409), so no device can call it.

## YouTube Music

```
 Settings → device code ──► Google OAuth ──► per-user tokens in needle.db
 app ──► /api/youtube-music/* ──► permission + enabled checks
                                └─► bounded Python subprocess ──► ytmusicapi
 audio ──► /youtube-music/stream/:id ──► Navidrome token + permission + enabled
                                       └─► yt-dlp URL resolver ──► Google media CDN
                                                               └─► byte-range response
```

The optional integration uses Python in the same container as the Node server.
The uv project in `bridges/youtube-music` locks ytmusicapi and yt-dlp. Its bridge
accepts fixed operations and JSON over stdin, and returns JSON over stdout.
Credentials never appear in process arguments. Node validates metadata before
returning shared DTOs to React.

All YouTube Music entities use `ytm:` IDs. `MusicSource`, source helpers and the
existing route helpers preserve the identity through queue persistence, source
badges, likes, lyrics, radio, statistics and remote transfers. Only local songs
can enter Navidrome playlists, its saved play queue, scrobbles or offline storage.

Account access and playback are separate. ytmusicapi receives the connected
user's OAuth token for library reads and explicit likes, saves and follows.
yt-dlp resolves public audio without that token. The browser receives a stable
Needle stream URL; expiring CDN URLs stay in a bounded server cache. The proxy
accepts only Google media hosts, forwards byte ranges, aborts when the client
leaves, and does not store audio bytes.

Provider queries, library caches and notices have their own namespace. A disabled
or disconnected provider contributes no Home, Search or Library items. During
cooldowns, previously loaded metadata remains visible and new requests pause.
Resolver failures stop at the selected song to avoid repeated queue requests.

## Requests: albums and single songs

```
 Album: "Get album" ─► POST /api/lidarr/albums/:id ─► Lidarr monitors that album and searches
                        └► requests row (kind album)
        Requests page ─► GET /api/requests ─► state merged live from Lidarr's queue and commands
                      GET /api/requests?everyone=1 ─► admins: other people's requests
                      GET /api/lidarr/downloads ─► admins: "Downloading now", Lidarr's whole queue
                      DELETE /api/lidarr/downloads/:id[?find=1] ─► remove from the queue and the
                        download client, blocklist that release; find=1 also searches again
 Artist:  searching an artist's exact name also lists their studio albums
          (Lidarr's albums if it knows the artist, else MusicBrainz release groups)

 Song:  search ─► GET /api/songs/search ─► musicbrainz.ts
                    two queries (title+artist, then title only if few), official studio
                    releases, live/remix/cover versions dropped, 1 request/second, cached 1 h,
                    songs already in the library left out
        + deezer.ts: an artist's popular songs when the search is exactly their name
        "Get song" ─► POST /api/songs ─► requests row (kind song) ─► SongDownloads.run()
```

```
 SongDownloads.run()              state in the requests row
   slskd search "artist title"    searching
   pickFiles(): rank copies       (lossless > ≥320 kbps > ≥250 kbps; length within 5 s;
                                   title words in the file name; free slot, speed, queue)
   for the best 3 copies:
     slskd download, poll 3 s     downloading + progress
       queued > 3 min or > 20 min in total → give up on that copy
     done → find the file in SOULSEEK_DIR, move to
            SINGLES_DIR/<Artist>/<Artist> - <Title>.<ext>   moving
     remove it from slskd's list, ask Navidrome to scan       available
   nothing worked                                             failed (+ reason, "Try again")
 A server restart marks unfinished songs as failed so they can be retried.
```

## ListenBrainz discovery

```
 Settings ─► PUT /api/listenbrainz {token, password?}
               ├► ListenBrainz GET /1/validate-token          → ListenBrainz user name
               ├► (password given) Navidrome POST /auth/login → JWT
               │     PUT /api/listenbrainz/link {token}, header x-nd-authorization: Bearer <jwt>
               │     401 wrong password, 429 too many sign-ins, 404 ListenBrainz off in Navidrome:
               │     the token is saved anyway and the reason comes back as navidromeError
               └► listenbrainz row (token, user, linked); the password goes nowhere else
 Home ─► GET /api/listenbrainz/playlists
           createdfor (cached 1 h per user) → newest playlist of each kind, ordered
           weekly-exploration, weekly-jams, daily-jams, then the rest
           → each playlist's JSPF (cached 24 h per MBID, a 404 drops it)
           → matched to the library index: recording MBID first, then title + artist
             with remaster/live/feat. notes removed (the same matching Spotify's import uses)
 Playlist ─► GET /api/listenbrainz/playlists/:mbid   tracks + library song or request state
             POST …/missing   Get N missing: up to 50 songs through SongDownloads (ref = MBID)
             POST …/save      Navidrome playlist "<name>, <date>" of the songs you have
```

- **Navidrome sends the listens, Needle never does.** Navidrome already scrobbles every
  play of a linked user, from any client. If Needle also submitted, each play would
  count twice. Needle only reads: playlists, and the latest listens for
  Settings → Connections (ok when Navidrome sent one in the last 7 days).
- **The password is used once.** Navidrome's link endpoint only accepts its own JWT,
  which only its sign-in hands out, and Subsonic credentials can't get one. Needle never
  stores, logs or echoes it; error messages are fixed strings.
- **Rate limits:** every ListenBrainz call goes through one queue at least 1.1 s apart,
  with a `User-Agent` and `Authorization: Token`. `X-RateLimit-Remaining: 0` holds the
  queue for `X-RateLimit-Reset-In` seconds; a `429` waits that long and retries once.
  Each call times out after 15 s.
- **Downloads:** `SongDownloads` runs at most two at once; the rest wait in
  `searching`, so a 50-song "Get missing" doesn't flood slskd.

## Updates

The service worker (`vite-plugin-pwa`, prompt mode) checks for a new version when
the tab becomes visible. A new version waits until you choose **Update Needle** in
the account menu (a dot on the avatar says one is ready), so music never stops on
its own. **Refresh page** in the same menu reloads without updating.

## Offline downloads

Albums and playlists saved for offline listening live in the browser, not on the
server: audio files in Cache Storage, the list of saved songs in IndexedDB, both
private to the site's origin on that one device. A browser can't show them as a
folder. The Downloads page says so and shows each album's size and the space used
and left (`navigator.storage.estimate()`). A download that stalls for 60 s fails
that song; unfinished albums resume when the app opens, or with **Try again**.

## Tests and CI

- `pnpm format:check`: Prettier plus Ruff formatting.
- `pnpm lint`: ESLint plus Ruff linting.
- `pnpm typecheck`: every workspace package and the e2e TypeScript project.
- `pnpm test`: Vitest plus Python bridge unit tests.
- `pnpm build`: the production web build.
- `pnpm e2e`: Playwright against a real Navidrome with mocked external integrations.

CI runs the first five in `checks`, then runs the production build and full Playwright
suite in the separate required `e2e` job.
