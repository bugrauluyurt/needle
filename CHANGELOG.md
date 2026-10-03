# Changelog

What changed in each release. Needle uses [semantic versioning](https://semver.org):
a major version means you need to change your setup (a renamed setting, a new mount),
a minor version adds features, and a patch fixes bugs. Each change adds its entry as a
file in [`changelog.d/`](changelog.d/README.md), named for the heading that sets the next
version: breaking or removed for a major, added, changed or deprecated for a minor, fixed
or security for a patch. A bot keeps a release pull request open with them; merging it
writes the entries here and releases.

## 1.10.2 - 2026-10-03

### Fixed
- Shorten release pipelines by running browser tests once in the required pull request checks instead of repeating them after merge and during publication.

## 1.10.1 - 2026-10-03

### Fixed
- Prevent concurrent server startups from failing when SQLite removes a transient journal during permission hardening.

### Security
- Avoid excessive CPU use when library titles contain unusually long unmatched metadata delimiters.

## 1.10.0 - 2026-10-03

### Added
- Add a Turkish interface that can be selected manually in Settings and stays selected on that device.

### Changed
- Protect existing Needle data with versioned SQLite migrations, schema checks and a one-time pre-migration backup.

### Fixed
- Restore browser zoom, keyboard radio navigation and predictable focus for lyrics and mobile action sheets.

### Security
- Bind Spotify sign-ins to their browser and protect Navidrome API, media, proxy and remote-device verification with shared brute-force and concurrency limits.
- Keep credentials, downloads, queues, provider state, pending playback, cover caches and recent searches isolated between signed-in users, including late requests and Spotify devices.
- Restrict Needle database and backup files to the server account and refuse symlinked credential storage paths.
- Soulseek downloads use stable directory handles, safely finish identical retries, stay inside the configured download and singles folders, and never overwrite a different file during directory swaps.
- Update the YouTube Music bridge HTTP stack to close known resource-exhaustion and proxy-isolation vulnerabilities.

## 1.9.0 - 2026-10-03

### Added
- YouTube Music can join your own music and Spotify in Home, Search and Your library.
  Connect a separate account for each person, play songs in Needle, like songs, save
  albums and follow artists. YouTube Music playlists are read-only and can be copied
  into Navidrome using songs you already have. This integration is experimental and
  has its own on/off switch; YouTube Music audio cannot be downloaded for offline use.

### Fixed
- Music-source icons have consistent spacing beside artist names in the player.

## 1.8.4 - 2026-10-03

### Fixed
- Library filters are easier to reach, the sidebar stays aligned, and artist artwork loads at a size suited to the screen.

## 1.8.3 - 2026-10-02

### Fixed
- Mobile player links, responsive navigation, Spotify notices and locked playlist spacing now work without overlap.

## 1.8.2 - 2026-10-02

### Fixed
- Load artist pictures without fetching album catalogues, and keep Spotify visible with previously loaded content and a clear retry time while requests are paused.

## 1.8.1 - 2026-10-02

### Fixed
- Match the back and forward buttons to the glass search field and remove the extra side inset from full artist song lists.

## 1.8.0 - 2026-10-02

### Changed
- Lighten the top search field while keeping its glass blur and focus outline readable over artwork.

### Fixed
- Dismiss the mobile keyboard when submitting a search or collection filter, preserving the query and results without interrupting text composition.

## 1.7.1 - 2026-10-01

### Fixed
- Keep the Back to artist caret beside its label with a subtle entrance, give collection search placeholders room to fit on small screens, and make the top search more transparent without losing readability over bright artwork.
- Show Spotify artwork for monthly top artists alongside library artists, and keep source badges off library mix covers so their labels stay unobstructed.

## 1.7.0 - 2026-10-01

### Added
- Search every matching song and album in your library, sort by release date or plays, and load more Spotify results without changing their order. Artist pages put songs first and let you open full album and singles lists. Find music within albums, collections, and the queue, with clearer source labels, liked icons, and device controls.

### Fixed
- Keep the glass search field readable over bright artwork, reveal truncated text on hover, and smoothly dismiss the mobile player with the caret or a downward swipe. Existing typography and scroll animations stay consistent.

## 1.6.1 - 2026-09-30

### Fixed
- On tablet widths, clicking beside the queue, lyrics or now playing panel closes it every time.

## 1.6.0 - 2026-09-29

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
- Scroll past a page's title and its name and cover appear in the top bar, while the
  search field slides aside to make room.

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
