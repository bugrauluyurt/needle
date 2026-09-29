# Changelog

What changed in each release. Needle uses [semantic versioning](https://semver.org):
a major version means you need to change your setup (a renamed setting, a new mount),
a minor version adds features, and a patch fixes bugs. Write new entries under
**Unreleased**, under the heading that sets the next version: Breaking or Removed
for a major, Added, Changed or Deprecated for a minor, Fixed or Security for a patch.
A bot keeps a "Release vX.Y.Z" pull request open with them; merging it releases.

## Unreleased

### Added
- Click a column title in any song table to sort by it; click again to reverse, and a
  third time to go back to the original order.
- Every sort menu sorts both ways: pick the current sort again to reverse it.
- The sidebar's Your library menu has the same Show: Both, Your music or Spotify choice
  as the Your library page, and the two stay in step. It replaces the Spotify chip.
- Songs in Your library can be sorted.
- ListenBrainz discovery: connect your ListenBrainz token in Settings and Home shows
  the playlists ListenBrainz makes for you (Weekly Exploration, Weekly Jams, Daily
  Jams). Each plays the songs you have, gets the missing ones from Soulseek with
  **Get N missing**, and saves as a Navidrome playlist. Give your Navidrome password
  once to turn on scrobbling in Navidrome; it is never stored. Set `LISTENBRAINZ_URL`
  only to use another ListenBrainz server.
- When another of your devices is playing, the player shows "Playing on" that device with
  its song, and play, pause, skip, seek and volume control it from here. Playing anything
  here takes over.
- Song lists show a Now playing button when the playing song is scrolled out of view;
  it jumps back to the song. Shift+L and clicking the song title in the player do the same.
- The play button on song rows fades in smoothly on hover.
- Search from every page: the search field sits in the middle of the top bar, and on
  phones a search button at the top right opens Search with the keyboard up.
- Scroll past a page's title and its name appears in the top bar, with a play button
  on albums, playlists, artists and anything else you can play.

### Fixed
- The song table in Your library lines up with the page edges, without extra side padding.
- Sorting in the sidebar no longer switches the Your library page to list view.
- The layout at 768–1023 pixels wide (tablets and narrow windows) works again: lists
  and sort menus show on every page, and the icon sidebar names its links in tooltips
  and keeps the library search and new playlist buttons. Below 1180 pixels the player
  bar fits, with lyrics and full screen under More and volume in a pop-up, queue and
  Now playing open as a panel over the page, and long titles shrink to fit.
- A device no longer shows a song as playing after another device takes over: starting
  playback on one device pauses the others, including Spotify playback moved elsewhere.
- The `/` shortcut opens Search with the cursor in the search field again.
- On phones, the search bar in Search and Your library keeps space above it once it
  sticks to the top of the screen.

## 1.5.0 - 2026-09-29

### Added
- Each release carries its source archive, `needle-X.Y.Z.tar.gz`, with signed build
  provenance (`.intoto.jsonl`) that `gh attestation verify` checks; the README shows how.

## 1.4.0 - 2026-09-29

### Added
- Ready-made images for x86-64 (amd64) and ARM64 on `ghcr.io/bugrauluyurt/needle`,
  tagged `X.Y.Z`, `X.Y`, `X` and `latest`, with build provenance, so you no longer
  need to build Needle yourself. The example compose file now uses
  `ghcr.io/bugrauluyurt/needle:1`; building from source still works.
- Releases are cut automatically from this changelog.

### Fixed
- Listening stats include a play recorded at the very moment you open them.

## 1.3.0 - 2026-09-28

### Added
- While Spotify is on, Your library's sort menu starts with **Show: Both / Your music /
  Spotify**, so you can see only your own library, only Spotify, or both. It applies to
  albums, artists, playlists, songs and searches.

## 1.2.1 - 2026-09-28

### Fixed
- In song tables, the playing song's bars no longer overlap its pause button after you
  click it; the button only replaces the bars on hover or keyboard focus.
- Settings → People only listed the admin: Navidrome's Subsonic API won't list other
  users, even to admins. Needle now remembers everyone who opens it, and admins (or
  arr-stack's add-viewer.py) can set up someone who hasn't opened it yet; they show as
  "Hasn't opened Needle yet".

## 1.2.0 - 2026-09-28

### Added
- Settings → People (admins): every Navidrome user, with switches for **Request music**
  and **Spotify**. People who aren't Navidrome admins can now request albums and songs
  when allowed, without getting control of Navidrome or Lidarr's queue.
- Admins see everyone's requests on the Requests page, with who asked, and can remove them.

### Changed
- Requests only appears in the menu for people who can request music, and Spotify only
  in Settings for people allowed to use it.

## 1.1.0 - 2026-09-28

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
