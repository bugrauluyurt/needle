# Needle architecture

How the app is put together, how a request travels, where data lives, and the
flows that are easy to get wrong (Spotify's limits, fetching songs, ListenBrainz). For installing
Needle and connecting it to Navidrome, Lidarr, slskd and Spotify, see the
[README](../README.md).

## The big picture

```
 Browser (desktop or iPhone PWA)                          Needle server (Node 24 + Hono, one process)
┌───────────────────────────────────────┐   /rest/*     ┌────────────────────────────────────────────┐
│ React app (apps/web)                  │──────────────►│ proxy.ts ─────────────────────────► Navidrome (Subsonic API)
│  pages, components, layout            │   /api/*      │ app.ts routes                              │
│  player/ (audio engine, queue,        │──────────────►│  search.ts   library index, browse tiles   │──► Navidrome
│          Spotify backend)             │  /api/devices │  stats.ts    play log, listening stats     │
│  queries/ (TanStack Query)            │◄═════════════►│  devices.ts  device hub (WebSocket)        │
│  offline/ (Cache Storage + IndexedDB) │   /radio/:id  │  mixes.ts    daily mixes                   │
│  service worker (app shell, covers)   │──────────────►│  lidarr.ts   albums you don't have         │──► Lidarr
│                                       │               │  soulseek.ts single songs                  │──► slskd (Soulseek)
│  Spotify (optional, direct):          │               │  musicbrainz.ts song lookup                │──► musicbrainz.org
│   api.spotify.com, sdk.scdn.co ◄──────┼── token ──────│  spotify.ts  sign-in, tokens, switch       │──► accounts.spotify.com
└───────────────────────────────────────┘               │  requests.ts / profiles.ts                 │
                                                        │  listenbrainz.ts discovery playlists       │──► api.listenbrainz.org
                                                        │  needle.db (SQLite, node:sqlite)           │
                                                        └────────────────────────────────────────────┘
```

The browser only ever talks to the Needle server (plus Spotify when that's on).
Keys for Lidarr, slskd and Spotify's client secret stay on the server.

## Code layout

```
apps/web/src
  pages/        one file per screen (Home, Search, Album, Artist, Library, Requests, Spotify, ...)
  components/   shared UI: TrackList (virtualized), Cards, Collection (sort + view menu),
                SearchField, SearchResults (the "In your library" results Search and Your library
                share), GetCard (albums/songs you don't have), RequestState, Art (with the record
                fallback), TrackMenu (dropdown on desktop, ActionSheet on phones)
  layout/       Shell, Sidebar, TopBar, PlayerBar, RightPanel, Mobile (tab bar, mini player, player sheet)
  player/       controller.ts (queue, play/pause, scrobbling, queue sync), engine.ts (two <audio>
                elements + Web Audio for crossfade and ReplayGain), spotify.ts (Web Playback SDK)
  queries/      TanStack Query hooks: hooks.ts (Navidrome + Needle API), spotify.ts, likes.ts
  lib/          api.ts (Needle API), subsonic.ts (Navidrome API), spotify.ts (Spotify Web API),
                format, lyrics, palette, tone, songs (song sorting), photo (resize before upload)
  offline/      downloads for offline listening
  remote/       device hub client
  state/        zustand stores: session, settings, ui (persisted to localStorage)
apps/server/src
  app.ts        every route; config.ts reads the environment; db.ts creates/migrates needle.db
  people.ts     who has opened Needle and what each may do; status.ts Settings → Connections
  one file per integration: navidrome.ts (+ proxy.ts), lidarr.ts, soulseek.ts, musicbrainz.ts,
                deezer.ts, listenbrainz.ts, spotify.ts; search.ts, stats.ts, mixes.ts, requests.ts, profiles.ts, devices.ts
packages/shared types used by both sides, plus fold/matchesTerms (accent-insensitive matching)
e2e/            Playwright: test Navidrome (docker), mock Lidarr, mock slskd + MusicBrainz
```

## How a request travels

```
 /rest/getAlbum.view?u=…&t=…&s=…      ──► proxy.ts ──► Navidrome, response gzipped,
                                            covers cached "immutable" by the browser/service worker

 /api/…  headers x-needle-user/-token/-salt (the same Subsonic token the app already has)
        ──► auth middleware ──► Navidrome ping (answer cached 5 min) ──► route
                                 denied → 401 → the app signs out; Navidrome down → 503

 /api/devices   WebSocket: presence, "play here", "send my queue", remote pause/skip
 /radio/:id     internet radio streams proxied so HTTPS pages can play http:// stations
 anything else  static files from apps/web/dist (Brotli/gzip precompressed), SPA fallback
```

## Who may do what

```
 every /api request ─► isAdmin(user): Navidrome getUser → adminRole (cached 10 min)
                         └► people.seen(user, admin)   (Navidrome won't list other users,
                                                        so Needle remembers who has signed in)
 people.allowed(user, admin, "request")  admins always; others when switched on in People
 people.allowed(user, admin, "spotify")  admins unless switched off; others when switched on
```

| Needs         | Routes                                                                                                                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Request music | `GET /api/lidarr/search`, `/albums`, `/artists`, `POST /api/lidarr/albums/:id`, `/api/songs*`, `POST /api/requests/:id/retry`, `POST /api/spotify/missing`, `POST /api/listenbrainz/playlists/:mbid/missing` |
| Spotify       | `/api/spotify/*` (except the sign-in callback)                                                                                                                                                               |
| Admin         | `GET`/`DELETE /api/lidarr/downloads[/:id]`, `GET /api/status`, `GET`/`PUT /api/people[/:user]`, `GET /api/requests?everyone=1`, removing anyone's request                                                    |
| Signed in     | everything else: stats, plays, search, `/api/library/songs`, browse, mixes, photos, own requests, the rest of `/api/listenbrainz*` (each person's own connection)                                            |

`/api/capabilities` tells the app what this person may do: `admin`, `lidarr` and `songs`
(may request), and Spotify (configured and allowed, connected, allowed to play, needs
reconnecting, switched on), plus `listenbrainzUser` and `listenbrainzNavidrome`. The app hides what isn't allowed; the server refuses it
anyway (403).

## Where data lives

| Where                             | What                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `needle.db` (server, `DATA_DIR`)  | `plays` (stats, mixes), `requests` (albums and songs asked for), `profiles` (account photos), `seen` (who has opened Needle, admin or not, when), `permissions` (who may request music or use Spotify, set in Settings → People), `spotify_tokens` (+ scope, on/off switch), `oauth_states` (Spotify sign-in in progress), `listenbrainz` (each person's ListenBrainz token and user name, whether Needle linked it in Navidrome; never a password) |
| Navidrome                         | The library, users, playlists, likes, the play queue each device syncs                                                                                                                                                                                                                                                                                                                                                                              |
| Browser localStorage              | `needle.session` (Subsonic token, device name), `needle.settings`, `needle.ui` (panels, library filter, per-section sort/view), `needle.player` (queue), `needle.recentSearches`, `needle.sp.<user>.*` (Spotify library cache), `needle.spotifyBlockedUntil`                                                                                                                                                                                        |
| Browser Cache Storage + IndexedDB | Offline downloads; service-worker caches for the app shell and cover art                                                                                                                                                                                                                                                                                                                                                                            |

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

- `lib/spotify.ts` `req()`: a 429 with a short `Retry-After` (≤ 5 s) waits once;
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
`requirements.txt` pins ytmusicapi and yt-dlp. The bridge accepts fixed operations
and JSON over stdin and returns JSON over stdout; credentials never appear in
process arguments. Node validates metadata before returning shared DTOs to React.

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

## Tests

- `pnpm test`: Vitest unit tests for matching, sorting, search index, browse tiles,
  song picking, MusicBrainz ranking, requests, Spotify tokens/switch, photos,
  ListenBrainz (token, Navidrome link, playlists, matching, rate limits, caching).
- `pnpm e2e`: Playwright against a real Navidrome in Docker with a generated
  library, a mock Lidarr (`e2e/mock-lidarr.ts`) and a mock slskd + MusicBrainz +
  ListenBrainz (`e2e/mock-soulseek.ts`; the test Navidrome's `ND_LISTENBRAINZ_BASEURL`
  points there too, so linking the token in Navidrome is tested for real); Spotify is mocked in the browser (`e2e/tests/spotify-mock.ts`).
