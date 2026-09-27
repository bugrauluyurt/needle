# Needle

A music player for a Navidrome library, built for one home server
(`bugra-raspi`) and the devices on its tailnet. It runs in any browser and
installs on the iPhone as a home-screen app.

## What it does

- **Listen:** albums, artists, playlists, liked songs, genres, decades, and six mixes
  built each morning from the library. Queue with "play next", shuffle that keeps
  what you queued, repeat one or all, and similar songs when the queue ends.
- **Sound:** crossfade (desktop browsers), gapless playback, volume levelled from
  ReplayGain, and a choice of original files or Opus/AAC on mobile data.
- **Lyrics** that follow the song and seek when a line is tapped.
- **Your listening:** hours, top artists and albums, genres and time of day, for any
  period, from Needle's own play log.
- **Fetching music:** search also lists albums you don't have. **Get album** asks
  Lidarr and the card follows it through searching, downloading and importing.
  Artist pages offer similar artists you don't have.
- **Devices:** every open Needle signed in as you is listed. Pause or skip on another
  device, send your queue there, or pull its music over. A device that stopped
  somewhere else offers to pick up at the same second.
- **Offline:** download albums, playlists or liked songs to the device (needs the
  `https://` address).
- **Spotify import** (optional): playlists and liked songs become Navidrome
  playlists; what you don't own can go to Lidarr.
- Internet radio, keyboard shortcuts (`?` lists them), lock-screen controls.

## How it's built

```
apps/web       React 19 + Vite, the app itself (CSS by hand, no framework)
apps/server    Node 24 + Hono: serves the app, proxies Navidrome, and owns the
               play log (SQLite), mixes, Lidarr, Spotify and the device hub
packages/shared  types shared by both (Subsonic and Needle's own API)
e2e            Playwright tests, a generated test library and a mock Lidarr
```

The browser only talks to the Needle server. `/rest/*` is Navidrome's Subsonic API
passed through (so the app works over HTTPS with no mixed content), `/api/*` is
Needle's own API, authenticated with the same Subsonic token, and `/api/devices`
is a WebSocket for the device hub. The Lidarr API key stays on the server, and only
Navidrome admins can ask Lidarr for music.

The server runs TypeScript directly (Node's type stripping); there's no build step
for it.

## Develop

```bash
pnpm install
pnpm fixtures              # generates e2e/.library: 38 tagged songs with covers and lyrics
pnpm navidrome:test        # a throwaway Navidrome on 127.0.0.1:14533 (admin / needle-test)
NEEDLE_DATA_DIR=./data pnpm seed   # playlists, likes, radio stations, 75 days of plays
pnpm dev                   # server on :14535 (NAVIDROME_URL from .env) and Vite on :5173
```

```bash
pnpm lint && pnpm typecheck
pnpm test                  # unit tests (Vitest)
pnpm --filter @needle/web build && pnpm e2e   # end-to-end, desktop and iPhone sizes
```

`pnpm e2e` starts everything it needs: the test Navidrome, a mock Lidarr and a
Needle server on the production build.

## Run

```bash
docker build -t needle:local .
docker run -p 4535:4535 -v needle-data:/data \
  -e NAVIDROME_URL=http://navidrome:4533 needle:local
```

| Variable | |
|---|---|
| `NAVIDROME_URL` | Navidrome as the server reaches it |
| `LIDARR_URL`, `LIDARR_API_KEY` | Optional: turns on fetching music |
| `LIDARR_QUALITY_PROFILE`, `LIDARR_ROOT_FOLDER` | Optional: otherwise the root folder's defaults |
| `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` | Optional: the Spotify import |
| `PUBLIC_URL` | The `https://` address people use; needed for the Spotify sign-in |
| `DATA_DIR` | Where the play log lives (`/data` in the image) |

In the arr-stack it runs as the `needle` service on port 4535; see that repo's
`docs/03-clients.md`.
