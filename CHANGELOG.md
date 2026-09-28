# Changelog

What changed in each release. Needle uses [semantic versioning](https://semver.org):
a major version means you need to change your setup (a renamed setting, a new mount),
a minor version adds features, and a patch fixes bugs. Write new entries under
**Unreleased**; `pnpm release <version>` moves them into the release.

## Unreleased

### Added
- On phones, pages with a back button (albums, playlists, artists and more) have a header
  that turns to dark glass as you scroll and shows the page's title once it scrolls
  away.

### Changed
- Albums with no cover show a record illustration in Search's "Not in your library
  yet" and on the Requests page, like everywhere else.

### Fixed
- Downloads Lidarr couldn't import (such as "Album match is not close enough") can be
  removed from Downloading now, or replaced with **Find another copy**, which blocks
  that release and has Lidarr search for a different one.
- On phones, the Requests page's buttons no longer run off the screen when a status
  message is long.
- On phones, album and playlist pages no longer have a strip of plain background at
  the top, and every page has more room at the bottom above the mini player.
- Removing a download that Lidarr already dropped no longer shows an error.

## 1.0.0 - 2026-09-28

The first public release.

### Listening
- Albums, artists, playlists, liked songs, genres, decades, and six mixes built each
  morning from your library.
- A queue with "play next", shuffle that keeps what you queued, repeat, and similar
  songs when the queue ends.
- Crossfade, gapless playback, ReplayGain levelling, and Opus/AAC on mobile data.
- Lyrics that follow the song, internet radio, keyboard shortcuts and lock-screen
  controls.
- Your listening: hours, top artists and albums, genres and time of day.

### Library and search
- Search matches text anywhere in titles, artists and albums, with list and grid views
  and sorting.
- Your library filters by songs, albums, artists and playlists, and searches all of them.

### Fetching music (optional)
- Get album asks Lidarr; Get song fetches one song through slskd into a second
  Navidrome library.
- The Requests page follows both until they're in your library, and lists Lidarr's
  whole download queue.

### Devices and offline
- Every open Needle signed in as you is listed: pause, skip or send your queue to
  another device, or pick up where you left off.
- Download albums, playlists or liked songs to listen with no connection.
- Installs on a phone's home screen; song options open as a sheet on phones.

### Spotify (optional)
- Your Spotify library, search and playback next to your own music, with an on/off
  switch per account and back-off when Spotify rate-limits.

### Running it
- Settings → Connections checks HTTPS, Navidrome, Lidarr, slskd, the song folders and
  Spotify, and says how to fix what's wrong.
- Example Docker Compose files, a Caddyfile, and a README that covers every setting.
