# Needle architecture

How the app is put together, how a request travels, where data lives, and the
flows that are easy to get wrong (Spotify's limits, fetching songs). For how Needle
sits inside the home server (Navidrome, Lidarr, slskd, Tailscale), see arr-stack's
`docs/10-music.md`.

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
                SearchField, GetCard (albums/songs you don't have), RequestState, Art, TrackMenu
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

Admin-only features (Lidarr, single songs) check Navidrome's `adminRole` (cached
10 min). `/api/capabilities` tells the app what's switched on: Lidarr, songs,
Spotify (configured, connected, allowed to play, needs reconnecting, switched on).

## Where data lives

| Where | What |
|---|---|
| `needle.db` (server, `DATA_DIR`) | `plays` (stats, mixes), `requests` (albums and songs asked for), `profiles` (account photos), `spotify_tokens` (+ scope, on/off switch), `oauth_states` (Spotify sign-in in progress) |
| Navidrome | The library, users, playlists, likes, the play queue each device syncs |
| Browser localStorage | `needle.session` (Subsonic token, device name), `needle.settings`, `needle.ui` (panels, library filter, per-section sort/view), `needle.player` (queue), `needle.recentSearches`, `needle.sp.<user>.*` (Spotify library cache), `needle.spotifyBlockedUntil` |
| Browser Cache Storage + IndexedDB | Offline downloads; service-worker caches for the app shell and cover art |

## Search and browse

```
 first search after a scan ──► search.ts builds an index for that user:
                                 search3 with an empty query, 500 at a time → every song, album, artist
 every search ──► all words must appear somewhere in title/artist/album (accents folded,
                  Turkish ı/İ handled); title matches rank first
 browse tiles ──► built from the same index: top genres, decades, recently added, random
 index freshness ──► getScanStatus checked at most once a minute; rebuilt when it changes
```

## Playback

```
 playSongs() ──► queue (player/queue.ts) ──► loadCurrent()
                    │ local song: engine.ts plays /rest/stream (original or transcoded),
                    │             preloads the next one, crossfades on desktop
                    │ Spotify song: player/spotify.ts → Web Playback SDK device → Spotify API "play"
                    ▼
               scrobble to Navidrome, report to /api/plays (stats), save the play queue
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

## Requests: albums and single songs

```
 Album: "Get album" ─► POST /api/lidarr/albums/:id ─► Lidarr monitors that album and searches
                        └► requests row (kind album)
        Requests page ─► GET /api/requests ─► state merged live from Lidarr's queue and commands

 Song:  search ─► GET /api/songs/search ─► musicbrainz.ts
                    two queries (title+artist, then title only if few), official studio
                    releases, live/remix/cover versions dropped, 1 request/second, cached 1 h,
                    songs already in the library left out
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

## Updates

The service worker (`vite-plugin-pwa`, auto-update) checks for a new version when
the tab becomes visible. When the new one takes over, the app reloads, but only
once nothing is playing.

## Tests

- `pnpm test`: Vitest unit tests for matching, sorting, search index, browse tiles,
  song picking, MusicBrainz ranking, requests, Spotify tokens/switch, photos.
- `pnpm e2e`: Playwright against a real Navidrome in Docker with a generated
  library, a mock Lidarr (`e2e/mock-lidarr.ts`) and a mock slskd + MusicBrainz
  (`e2e/mock-soulseek.ts`); Spotify is mocked in the browser (`e2e/tests/spotify-mock.ts`).
