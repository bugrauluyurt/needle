import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { songKey } from "@needle/shared";
import { openDatabase } from "../src/db.ts";
import { Lidarr } from "../src/lidarr.ts";
import { Navidrome } from "../src/navidrome.ts";
import { LibrarySearch } from "../src/search.ts";
import { MusicBrainz, toCandidates } from "../src/musicbrainz.ts";
import { Deezer } from "../src/deezer.ts";
import { Requests } from "../src/requests.ts";
import { pickFiles, singlePath } from "../src/soulseek.ts";
import type { SlskdFile } from "../src/soulseek.ts";
import { Spotify } from "../src/spotify.ts";
import { findSong, matchKey, normalize } from "../src/search.ts";
import { ListenBrainz, ListenBrainzError } from "../src/listenbrainz.ts";
import { SongDownloads } from "../src/soulseek.ts";
import { loadConfig } from "../src/config.ts";
import { Slskd } from "../src/soulseek.ts";
import { Status } from "../src/status.ts";

type Route = [RegExp, (url: URL, init?: RequestInit) => unknown];

function mockFetch(routes: Route[]) {
  const calls: { url: string; method: string; headers: Headers; body?: string }[] = [];
  vi.stubGlobal("fetch", vi.fn((input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method ?? "GET";
    calls.push({ url: url.href, method, headers: new Headers(init?.headers), ...(typeof init?.body === "string" ? { body: init.body } : init?.body instanceof URLSearchParams ? { body: init.body.toString() } : {}) });
    const route = routes.find(([re]) => re.test(`${method} ${url.pathname}`));
    if (!route) return Promise.resolve(new Response("not found", { status: 404 }));
    const body = route[1](url, init);
    if (body instanceof Response) return Promise.resolve(body);
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
  }));
  return calls;
}

const ok = <T extends object>(body: T) => ({ "subsonic-response": { status: "ok", version: "1.16.1", ...body } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("matching", () => {
  it("ignores case, accents, featured artists and remaster notes", () => {
    expect(normalize("Boğaz Rüzgârı")).toBe("bogaz ruzgarı".normalize("NFKD").replace(/[̀-ͯ]/g, ""));
    expect(normalize("Get Lucky (feat. Pharrell Williams)")).toBe("get lucky");
    expect(normalize("Teardrop - 2019 Remaster")).toBe("teardrop");
    expect(normalize("Rock & Roll")).toBe("rock and roll");
    expect(matchKey("Kelly, Watch the Stars!", "Air")).toBe(matchKey("kelly watch the stars", "AIR"));
  });
});

describe("Lidarr", () => {
  const lidarr = new Lidarr({ url: "http://lidarr", apiKey: "k", qualityProfile: null, rootFolder: null });

  it("lists albums you don't have with their download state", async () => {
    mockFetch([
      [/GET \/api\/v1\/search/, () => [
        { album: { id: 1, title: "Moon Safari", foreignAlbumId: "f1", albumType: "Album", monitored: true, releaseDate: "1998-01-16T00:00:00Z", artist: { artistName: "Air", foreignArtistId: "a1" }, images: [{ coverType: "cover", remoteUrl: "https://img/1" }] } },
        { album: { id: 2, title: "Talkie Walkie", foreignAlbumId: "f2", albumType: "Album", artist: { artistName: "Air", foreignArtistId: "a1" } } },
        { album: { id: 3, title: "Pocket Symphony", foreignAlbumId: "f3", albumType: "Album", artist: { artistName: "Air", foreignArtistId: "a1" } } },
        { album: { title: "Love 2", foreignAlbumId: "f4", albumType: "Album", artist: { artistName: "Air", foreignArtistId: "a1" }, releases: [{ trackCount: 12, monitored: true }], images: [{ coverType: "cover", url: "https://img/4" }, { coverType: "disc", url: "/MediaCover/4/disc.jpg" }] } },
        { album: { title: "Remix Single", foreignAlbumId: "f5", albumType: "Single", artist: { artistName: "Air", foreignArtistId: "a1" } } },
        { artist: { artistName: "Air", foreignArtistId: "a1" } },
      ]],
      [/GET \/api\/v1\/album$/, () => [
        { id: 1, monitored: true, statistics: { trackFileCount: 0, totalTrackCount: 10 } },
        { id: 2, monitored: false, statistics: { trackFileCount: 11 } },
        { id: 3, monitored: true, statistics: { trackFileCount: 0 } },
      ]],
      [/GET \/api\/v1\/queue/, () => ({ records: [{ albumId: 3, size: 100, sizeleft: 36, trackedDownloadState: "downloading" }] })],
      [/GET \/api\/v1\/command/, () => [{ name: "AlbumSearch", status: "started", body: { albumIds: [1] } }]],
    ]);
    const albums = await lidarr.searchAlbums("air");
    expect(albums.map((a) => [a.title, a.state])).toEqual([["Moon Safari", "searching"], ["Pocket Symphony", "downloading"], ["Love 2", "missing"]]);
    expect(albums.map((a) => a.coverUrl)).toEqual(["https://img/1", null, "https://img/4"]);
    expect(albums[0]).toMatchObject({ year: 1998, trackCount: 10, coverUrl: "https://img/1", artist: "Air" });
    expect(albums[1]?.progress).toBeCloseTo(0.64);
    expect(albums[2]?.trackCount).toBe(12);
  });

  it("monitors a known album and searches for it without touching the artist", async () => {
    const calls = mockFetch([
      [/GET \/api\/v1\/album$/, () => [{ id: 7, title: "X", foreignAlbumId: "f7", monitored: false, artist: { artistName: "A", foreignArtistId: "a" } }]],
      [/PUT \/api\/v1\/album\/monitor/, () => ({})],
      [/POST \/api\/v1\/command/, () => ({})],
      [/GET \/api\/v1\/queue/, () => ({ records: [] })],
      [/GET \/api\/v1\/command/, () => [{ name: "AlbumSearch", status: "queued", body: { albumIds: [7] } }]],
    ]);
    const r = await lidarr.getAlbum("f7");
    expect(r.state).toBe("searching");
    expect(calls.find((c) => c.method === "PUT")?.body).toBe(JSON.stringify({ albumIds: [7], monitored: true }));
    expect(calls.find((c) => c.method === "POST")?.body).toBe(JSON.stringify({ name: "AlbumSearch", albumIds: [7] }));
    expect(calls.some((c) => c.url.includes("/artist"))).toBe(false);
  });

  it("adds an unknown album with an unmonitored artist", async () => {
    const calls = mockFetch([
      [/GET \/api\/v1\/album$/, (u) => (u.searchParams.get("foreignAlbumId") && calls.filter((c) => c.method === "POST").length ? [{ id: 9, foreignAlbumId: "f9", monitored: true }] : [])],
      [/GET \/api\/v1\/album\/lookup/, () => [{ title: "New", foreignAlbumId: "f9", artist: { artistName: "B", foreignArtistId: "b" } }]],
      [/GET \/api\/v1\/rootfolder/, () => [{ path: "/music", defaultQualityProfileId: 2, defaultMetadataProfileId: 1 }]],
      [/GET \/api\/v1\/qualityprofile/, () => [{ id: 2, name: "Lossless" }]],
      [/GET \/api\/v1\/metadataprofile/, () => [{ id: 1, name: "Standard" }]],
      [/POST \/api\/v1\/album$/, () => ({ id: 9 })],
      [/POST \/api\/v1\/command/, () => ({})],
      [/GET \/api\/v1\/queue/, () => ({ records: [] })],
      [/GET \/api\/v1\/command/, () => []],
    ]);
    await lidarr.getAlbum("f9");
    const added = JSON.parse(calls.find((c) => c.method === "POST" && c.url.endsWith("/album"))?.body ?? "{}") as { monitored: boolean; artist: { monitored: boolean; monitorNewItems: string; rootFolderPath: string; qualityProfileId: number } };
    expect(added.monitored).toBe(true);
    expect(added.artist).toMatchObject({ monitored: false, monitorNewItems: "none", rootFolderPath: "/music", qualityProfileId: 2 });
  });
});

describe("Lidarr downloads", () => {
  it("removes a download and blocks that release, optionally searching for another", async () => {
    const calls = mockFetch([[/DELETE \/api\/v1\/queue\/7/, () => ({})]]);
    const lidarr = new Lidarr({ url: "http://lidarr", apiKey: "k", qualityProfile: null, rootFolder: null });
    await lidarr.removeDownload(7, true);
    await lidarr.removeDownload(7, false);
    expect(calls.map((c) => new URL(c.url).search)).toEqual([
      "?removeFromClient=true&blocklist=true&skipRedownload=false",
      "?removeFromClient=true&blocklist=true&skipRedownload=true",
    ]);
  });

  it("treats a download that's already gone as removed", async () => {
    mockFetch([]);
    const lidarr = new Lidarr({ url: "http://lidarr", apiKey: "k", qualityProfile: null, rootFolder: null });
    await expect(lidarr.removeDownload(9, false)).resolves.toBeUndefined();
  });

  it("lists everything in Lidarr's queue with progress and failures", async () => {
    mockFetch([[/GET \/api\/v1\/queue/, () => ({ records: [
      { id: 1, size: 100, sizeleft: 25, status: "downloading", trackedDownloadState: "downloading", album: { title: "Tidal Lines", foreignAlbumId: "f", images: [{ coverType: "cover", remoteUrl: "https://c/1" }] }, artist: { artistName: "Glass Harbor", foreignArtistId: "a" } },
      { id: 2, size: 100, sizeleft: 0, status: "completed", trackedDownloadState: "importPending", album: { title: "Night Signals", foreignAlbumId: "g" }, artist: { artistName: "Glass Harbor", foreignArtistId: "a" } },
      { id: 3, status: "completed", trackedDownloadState: "importFailed", trackedDownloadStatus: "warning", statusMessages: [{ messages: ["No files found"] }], title: "Some.Release" },
    ] })]]);
    const lidarr = new Lidarr({ url: "http://lidarr", apiKey: "k", qualityProfile: null, rootFolder: null });
    expect(await lidarr.downloads()).toEqual([
      { id: 1, title: "Tidal Lines", artist: "Glass Harbor", coverUrl: "https://c/1", state: "downloading", progress: 0.75, detail: null },
      { id: 2, title: "Night Signals", artist: "Glass Harbor", coverUrl: null, state: "importing", progress: 1, detail: null },
      { id: 3, title: "Some.Release", artist: "", coverUrl: null, state: "failed", progress: null, detail: "No files found" },
    ]);
  });
});

describe("Spotify import", () => {
  it("matches tracks against the library and writes a Navidrome playlist", async () => {
    const db = openDatabase(":memory:");
    db.prepare("INSERT INTO spotify_tokens (user, access_token, refresh_token, expires_at) VALUES ('alex', 'tok', 'ref', ?)").run(Date.now() + 3_600_000);
    const calls = mockFetch([
      [/GET \/v1\/playlists\/p1$/, () => ({ name: "Road trip" })],
      [/GET \/v1\/playlists\/p1\/items/, () => ({
        items: [
          { item: { name: "Kelly, Watch the Stars!", artists: [{ name: "Air" }], album: { name: "Moon Safari" } } },
          { track: { name: "Get Lucky (feat. Pharrell Williams)", artists: [{ name: "Daft Punk" }], album: { name: "RAM" } } },
          { item: { name: "Nowhere", artists: [{ name: "Nobody" }], album: { name: "Missing" } } },
          { item: null },
        ],
        next: null,
      })],
      [/POST \/rest\/getScanStatus/, () => ok({ scanStatus: { lastScan: "1", count: 2 } })],
      [/POST \/rest\/search3/, () => ok({ searchResult3: { song: [
        { id: "n1", title: "Kelly Watch the Stars", artist: "Air" },
        { id: "n2", title: "Get Lucky", artist: "Daft Punk" },
      ] } })],
      [/POST \/rest\/getPlaylists/, () => ok({ playlists: { playlist: [] } })],
      [/POST \/rest\/createPlaylist/, () => ok({ playlist: { id: "pl9", name: "Road trip (from Spotify)" } })],
    ]);
    const spotify = new Spotify({ clientId: "id", clientSecret: "secret", publicUrl: "https://needle", db, navidrome: new Navidrome("http://nd"), library: new LibrarySearch(new Navidrome("http://nd")) });
    const r = await spotify.import({ user: "alex", token: "t", salt: "s" }, "p1");
    expect(r).toMatchObject({ source: "Road trip", total: 3, matched: 2, playlistId: "pl9" });
    expect(r.missing).toEqual([{ title: "Nowhere", artist: "Nobody", album: "Missing" }]);
    const create = calls.find((c) => c.url.endsWith("/rest/createPlaylist"));
    expect(new URLSearchParams(create?.body).getAll("songId")).toEqual(["n1", "n2"]);
    expect(calls.some((c) => c.url.startsWith("https://api.spotify.com/v1/playlists/p1/items"))).toBe(true);
  });

  it("builds a PKCE sign-in link and rejects unknown states", async () => {
    const db = openDatabase(":memory:");
    const spotify = new Spotify({ clientId: "id", clientSecret: "secret", publicUrl: "https://needle.example", db, navidrome: new Navidrome("http://nd"), library: new LibrarySearch(new Navidrome("http://nd")) });
    const url = new URL(spotify.authorizeUrl("alex"));
    expect(url.searchParams.get("redirect_uri")).toBe("https://needle.example/api/spotify/callback");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toContain("user-library-read");
    await expect(spotify.complete("code", "not-a-state")).rejects.toThrow(/expired/);
  });

  it("refreshes an expired token, keeps its scope, and reports whether it can play", async () => {
    const db = openDatabase(":memory:");
    db.prepare("INSERT INTO spotify_tokens (user, access_token, refresh_token, expires_at, scope) VALUES ('alex', 'old', 'ref', ?, 'streaming user-library-read')").run(Date.now() - 1000);
    db.prepare("INSERT INTO spotify_tokens (user, access_token, refresh_token, expires_at, scope) VALUES ('guest', 'tok', 'ref', ?, 'user-library-read')").run(Date.now() + 3_600_000);
    const calls = mockFetch([[/POST \/api\/token/, () => ({ access_token: "fresh", expires_in: 3600 })]]);
    const spotify = new Spotify({ clientId: "id", clientSecret: "secret", publicUrl: "https://needle", db, navidrome: new Navidrome("http://nd"), library: new LibrarySearch(new Navidrome("http://nd")) });
    const t = await spotify.token("alex");
    expect(t.accessToken).toBe("fresh");
    expect(t.expiresAt).toBeGreaterThan(Date.now());
    expect(new URLSearchParams(calls[0]?.body).get("refresh_token")).toBe("ref");
    expect(spotify.canPlay("alex")).toBe(true);
    expect(spotify.canPlay("guest")).toBe(false);
    expect(spotify.canPlay("nobody")).toBe(false);
    expect(spotify.needsReconnect("alex")).toBe(true);
    expect(spotify.needsReconnect("nobody")).toBe(false);
    spotify.setEnabled("alex", false);
    expect(spotify.enabled("alex")).toBe(false);
    await expect(spotify.token("alex")).rejects.toMatchObject({ status: 409 });
  });
});

describe("library search", () => {
  const auth = { user: "alex", token: "t", salt: "s" };
  const library = (scan: string) => [
    [/POST \/rest\/getScanStatus/, () => ok({ scanStatus: { lastScan: scan, count: 3 } })],
    [/POST \/rest\/search3/, () => ok({ searchResult3: {
      song: [
        { id: "s1", title: "Paper Kite", artist: "Mara Veil", album: "Quiet Rooms" },
        { id: "s2", title: "Kite Who Sings", artist: "Someone", album: "Veil Tribute" },
        { id: "s3", title: "İstanbul'da Gece", artist: "Kasa Kaan", album: "Gece" },
      ],
      album: [{ id: "a1", name: "Harbor Lights", artist: "Mara Veil" }],
      artist: [{ id: "r1", name: "Mara Veil" }, { id: "r2", name: "Kasa Kaan" }],
    } })],
  ] satisfies Route[];

  it("matches text anywhere in titles, artists and albums, ignoring accents", async () => {
    mockFetch(library("1"));
    const search = new LibrarySearch(new Navidrome("http://nd"));
    const r = await search.search(auth, "eil");
    expect(r.song?.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(r.album?.map((a) => a.id)).toEqual(["a1"]);
    expect(r.artist?.map((a) => a.id)).toEqual(["r1"]);
    expect((await search.search(auth, "kite veil")).song?.map((s) => s.id)).toEqual(["s2", "s1"]);
    expect((await search.search(auth, "istanbul")).song?.map((s) => s.id)).toEqual(["s3"]);
    expect((await search.search(auth, "  ")).song).toBeUndefined();
  });

  it("lists every song, newest first", async () => {
    mockFetch([
      [/POST \/rest\/getScanStatus/, () => ok({ scanStatus: { lastScan: "1", count: 2 } })],
      [/POST \/rest\/search3/, () => ok({ searchResult3: { song: [{ id: "old", title: "A", created: "2024-01-01" }, { id: "new", title: "B", created: "2025-06-01" }] } })],
    ]);
    const songs = await new LibrarySearch(new Navidrome("http://nd")).songs(auth);
    expect(songs.map((s) => s.id)).toEqual(["new", "old"]);
  });

  it("builds the index once and rebuilds it after a new scan", async () => {
    let calls = mockFetch(library("1"));
    const search = new LibrarySearch(new Navidrome("http://nd"));
    await search.search(auth, "paper");
    await search.search(auth, "guy");
    expect(calls.filter((c) => c.url.endsWith("/search3"))).toHaveLength(1);
    vi.setSystemTime(Date.now() + 120_000);
    calls = mockFetch(library("2"));
    await search.search(auth, "guy");
    expect(calls.filter((c) => c.url.endsWith("/search3"))).toHaveLength(1);
    vi.useRealTimers();
  });
});

describe("single songs", () => {
  const want = { title: "Undertow", artist: "Glass Harbor", duration: 417 };
  const peer = (username: string, files: SlskdFile[], extra = {}) => ({ username, files, hasFreeUploadSlot: true, uploadSpeed: 2_000_000, queueLength: 0, ...extra });

  it("picks the best matching copy", () => {
    const picks = pickFiles([
      peer("mp3", [{ filename: "Music\\Glass Harbor\\Tidal\\04 Undertow.mp3", size: 1, bitRate: 320, length: 417 }]),
      peer("flac", [{ filename: "Music\\Glass Harbor - Tidal Lines\\04 - UnderTow.flac", size: 2, length: 416 }]),
      peer("live", [{ filename: "Concerts\\Glass Harbor\\Undertow (Live).flac", size: 3, length: 417 }]),
      peer("short", [{ filename: "x\\Undertow.flac", size: 4, length: 200 }]),
      peer("low", [{ filename: "x\\Glass Harbor\\Undertow.mp3", size: 5, bitRate: 128, length: 417 }]),
      peer("busy", [{ filename: "Glass Harbor\\Undertow.flac", size: 6, length: 417 }], { hasFreeUploadSlot: false, queueLength: 50, uploadSpeed: 0 }),
    ], want);
    expect(picks.map((p) => p.username)).toEqual(["flac", "busy", "mp3"]);
  });

  it("names the file after the artist and title", () => {
    expect(singlePath("/singles", { title: "One/Two?", artist: "Stop/Go" }, { filename: "x\\a.FLAC", size: 1, extension: "FLAC" })).toBe("/singles/Stop_Go/Stop_Go - One_Two_.flac");
  });

  it("turns MusicBrainz recordings into songs, once each", () => {
    const rec = (id: string, title: string) => ({ id, title, length: 417_000, "artist-credit": [{ name: "Glass Harbor" }], releases: [{ title: "Tidal Lines", date: "1984-07-27", status: "Official", "release-group": { id: "rg1", "primary-type": "Album" } }] });
    expect(toCandidates([rec("r1", "Undertow"), rec("r2", "UnderTow")])).toEqual([
      { id: "r1", title: "Undertow", artist: "Glass Harbor", album: "Tidal Lines", duration: 417, year: 1984, coverUrl: "https://coverartarchive.org/release-group/rg1/front-250" },
    ]);
  });

  it("ranks the song that matches both artist and title first, and skips live versions", () => {
    const rec = (id: string, artist: string, title: string, disambiguation = "") => ({ id, title, disambiguation, "artist-credit": [{ name: artist }] });
    const songs = toCandidates([
      rec("a", "Undertow", "Glass Box"),
      rec("b", "Glass Harbor", "Undertow (Live)"),
      rec("c", "Glass Harbor", "Undertow", "live, 1997"),
      rec("d", "Glass Harbor", "Undertow"),
    ], "undertow glass harbor");
    expect(songs.map((x) => x.id)).toEqual(["d", "a"]);
  });

  it("prefers the song whose artist and title add nothing to the search", () => {
    const rec = (id: string, artist: string, title: string) => ({ id, title, "artist-credit": [{ name: artist }] });
    const songs = toCandidates([
      rec("guests", "Northern Choir + The Puppets", "Silver Line"),
      rec("tribute", "Silver Line", "White Northern Choir (As It Began)"),
      { ...rec("choir", "Northern Choir", "Silver Line"), disambiguation: "2002 5.1 mix" },
    ], "silver line northern choir");
    expect(songs.map((x) => x.id)).toEqual(["choir", "guests", "tribute"]);
  });

  it("keeps one request per item and marks interrupted songs", () => {
    const requests = new Requests(openDatabase(":memory:"));
    const first = requests.add({ user: "alex", kind: "song", ref: "r1", title: "T", artist: "A", cover_url: null, state: "searching" });
    requests.update(first.id, { state: "failed", detail: "nope" });
    const again = requests.add({ user: "alex", kind: "song", ref: "r1", title: "T", artist: "A", cover_url: null, state: "searching" });
    expect(again.id).toBe(first.id);
    expect(again.detail).toBeNull();
    expect(requests.list("alex")).toHaveLength(1);
    expect(requests.active().map((r) => r.id)).toEqual([first.id]);
  });
});

describe("artist catalogues", () => {
  it("lists an artist's studio albums from MusicBrainz, newest first", async () => {
    mockFetch([[/GET \/ws\/2\/release-group/, () => ({ "release-groups": [
      { id: "rg1", title: "First Tide", "first-release-date": "1983-07-25", "primary-type": "Album" },
      { id: "rg2", title: "Deep Water", "first-release-date": "1986-03-03", "primary-type": "Album" },
      { id: "rg3", title: "Live at the Pier", "first-release-date": "1999-11-23", "primary-type": "Album", "secondary-types": ["Live"] },
    ] })]]);
    const albums = await new MusicBrainz("https://musicbrainz.org/ws/2").albumsBy("mbid", "Glass Harbor");
    expect(albums.map((a) => [a.title, a.year, a.state])).toEqual([["Deep Water", 1986, "missing"], ["First Tide", 1983, "missing"]]);
  });

  it("gets an artist's popular songs from Deezer only for an exact name", async () => {
    const calls = mockFetch([
      [/GET \/search\/artist/, () => ({ data: [{ id: 7, name: "Glass Harbor Tribute" }, { id: 119, name: "Glass Harbor" }] })],
      [/GET \/artist\/119\/top/, () => ({ data: [{ id: 1, title: "Undertow", duration: 331, artist: { name: "Glass Harbor" }, album: { title: "Tidal Lines", cover_medium: "https://c/1" } }] })],
    ]);
    const songs = await new Deezer("https://api.deezer.com").topSongs("glass harbor");
    expect(songs).toEqual([{ id: "deezer:1", title: "Undertow", artist: "Glass Harbor", album: "Tidal Lines", duration: 331, year: null, coverUrl: "https://c/1" }]);
    expect(await new Deezer("https://api.deezer.com").topSongs("glass harbor tidal")).toEqual([]);
    expect(calls.filter((c) => c.url.includes("/top"))).toHaveLength(1);
  });

  it("matches owned songs even with remaster notes in the title", () => {
    expect(songKey("Glass Harbor", "Undertow (Remastered 2021)")).toBe(songKey("glass harbor", "Undertow"));
    expect(songKey("Northern Choir", "Silver Line - Remastered 2011")).toBe(songKey("Northern Choir", "Silver Line"));
  });
});

describe("connections check", () => {
  const auth = { user: "alex", token: "t", salt: "s" };

  async function setup(songSize: number) {
    const root = await mkdtemp(join(tmpdir(), "needle-status-"));
    const [downloads, singles] = [join(root, "downloads"), join(root, "singles")];
    await mkdir(join(singles, "Artist"), { recursive: true });
    await mkdir(downloads);
    await writeFile(join(singles, "Artist", "Artist - Song.flac"), "12345");
    mockFetch([
      [/POST \/rest\/ping/, () => ok({ serverVersion: "0.64.2" })],
      [/POST \/rest\/getMusicFolders/, () => ok({ musicFolders: { musicFolder: [{ id: 1, name: "Music" }, { id: 2, name: "Singles" }] } })],
      [/POST \/rest\/getScanStatus/, () => ok({ scanStatus: { lastScan: "1", count: 1 } })],
      [/POST \/rest\/search3/, () => ok({ searchResult3: { song: [{ id: "s1", title: "Song", artist: "Artist", size: songSize, suffix: "flac" }] } })],
      [/GET \/api\/v1\/system\/status/, () => ({ version: "3.1.2" })],
      [/GET \/api\/v1\/rootfolder/, () => [{ path: "/music" }]],
      [/GET \/api\/v1\/qualityprofile/, () => [{ id: 1, name: "Lossless" }]],
      [/GET \/api\/v0\/application/, () => ({ version: { current: "0.26.0" }, server: { state: "Connected, LoggedIn", isLoggedIn: true } })],
      [/GET \/ws\/2\/recording/, () => ({ recordings: [] })],
      [/GET \/search\/artist/, () => ({ data: [] })],
    ]);
    const config = loadConfig({
      navidromeUrl: "http://nd", publicUrl: null, spotify: { clientId: "id", clientSecret: "secret" },
      lidarr: { url: "http://lidarr", apiKey: "k", qualityProfile: "Missing", rootFolder: null },
      soulseek: { url: "http://slskd", apiKey: "k", downloadsDir: downloads, singlesDir: singles },
      musicbrainzUrl: "http://mb/ws/2", deezerUrl: "http://deezer",
    });
    const navidrome = new Navidrome(config.navidromeUrl);
    const db = openDatabase(":memory:");
    const status = new Status({
      config, navidrome, library: new LibrarySearch(navidrome), lidarr: new Lidarr(config.lidarr ?? { url: "", apiKey: "", qualityProfile: null, rootFolder: null }),
      slskd: new Slskd("http://slskd", "k"), musicbrainz: new MusicBrainz(config.musicbrainzUrl), deezer: new Deezer(config.deezerUrl),
      listenbrainz: new ListenBrainz({ url: "http://lb", db, navidrome, library: new LibrarySearch(navidrome), requests: new Requests(db) }),
    });
    return Object.fromEntries((await status.checks(auth)).map((c) => [c.id, c]));
  }

  it("reports each connection with a fix when something is off", async () => {
    const checks = await setup(5);
    expect(checks.navidrome).toMatchObject({ state: "ok", detail: "Version 0.64.2. Libraries: Music, Singles" });
    expect(checks.lidarr).toMatchObject({ state: "warn", fix: "LIDARR_QUALITY_PROFILE Missing isn't one of Lidarr's quality profiles" });
    expect(checks.slskd?.state).toBe("ok");
    expect(checks.folders?.state).toBe("ok");
    expect(checks["singles-library"]?.state).toBe("ok");
    expect(checks.lookups?.state).toBe("ok");
    expect(checks.spotify).toMatchObject({ state: "warn" });
  });

  it("fails the singles check when Navidrome doesn't list the fetched files", async () => {
    const checks = await setup(999);
    expect(checks["singles-library"]).toMatchObject({ state: "fail", detail: "Navidrome doesn't list the songs in SINGLES_DIR" });
    expect(checks["singles-library"]?.fix).toContain("add a library");
  });
});

describe("ListenBrainz", () => {
  const auth = { user: "alex", token: "t", salt: "s" };
  const LB = "http://lb";
  const MBIDS = {
    exploration: "11111111-1111-4111-8111-111111111111",
    jams: "22222222-2222-4222-8222-222222222222",
    oldDaily: "33333333-3333-4333-8333-333333333333",
    daily: "44444444-4444-4444-8444-444444444444",
    other: "55555555-5555-4555-8555-555555555555",
  };
  const REC = {
    lucky: "aaaaaaaa-0000-4000-8000-000000000001",
    teardrop: "aaaaaaaa-0000-4000-8000-000000000002",
    byId: "aaaaaaaa-0000-4000-8000-000000000003",
    undertow: "aaaaaaaa-0000-4000-8000-000000000004",
  };
  const playlistMeta = (mbid: string, patch: string, date: string, title = patch) => ({
    title, identifier: `https://listenbrainz.org/playlist/${mbid}`, date, annotation: "<p>Songs for <b>you</b></p>", track: [],
    extension: { "https://musicbrainz.org/doc/jspf#playlist": { additional_metadata: { algorithm_metadata: { source_patch: patch } } } },
  });
  const track = (mbid: string, title: string, creator: string, identifier: string | string[] = `https://musicbrainz.org/recording/${mbid}`) => ({
    identifier, title, creator, album: "Some Album", duration: 212_000,
    extension: { "https://musicbrainz.org/doc/jspf#track": { additional_metadata: { caa_release_mbid: `rel-${title.length}`, caa_id: 42 } } },
  });
  const TRACKS = [
    track(REC.byId, "Differently Spelled", "Whoever"),
    track(REC.lucky, "Get Lucky (feat. Pharrell Williams)", "Daft Punk feat. Pharrell Williams", [`https://musicbrainz.org/recording/${REC.lucky}`]),
    track(REC.teardrop, "Teardrop - 2019 Remaster", "Massive Attack"),
    track(REC.undertow, "Undertow", "Glass Harbor"),
  ];
  const LIBRARY = [
    { id: "s-id", title: "Kelly Watch the Stars", artist: "Air", musicBrainzId: REC.byId },
    { id: "s-lucky", title: "Get Lucky", artist: "Daft Punk", musicBrainzId: "" },
    { id: "s-tear", title: "Teardrop", artist: "Massive Attack" },
  ];
  const libraryRoutes: Route[] = [
    [/POST \/rest\/getScanStatus/, () => ok({ scanStatus: { lastScan: "1", count: 3 } })],
    [/POST \/rest\/search3/, () => ok({ searchResult3: { song: LIBRARY } })],
  ];
  const connected = (db: ReturnType<typeof openDatabase>, linked = 1) =>
    db.prepare("INSERT INTO listenbrainz (user, token, lb_user, navidrome_linked, connected_at) VALUES ('alex', 'lb-token', 'alexlb', ?, 0)").run(linked);

  function setup() {
    const db = openDatabase(":memory:");
    const navidrome = new Navidrome("http://nd");
    const requests = new Requests(db);
    const lb = new ListenBrainz({ url: LB, db, navidrome, library: new LibrarySearch(navidrome), requests });
    return { db, navidrome, requests, lb };
  }

  async function settle<T>(p: Promise<T>): Promise<T> {
    const caught = p.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(60_000);
    await caught;
    return p;
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it("validates the token, links it in Navidrome with the password once, and never stores the password", async () => {
    const { db, lb } = setup();
    const calls = mockFetch([
      [/GET \/1\/validate-token/, () => ({ code: 200, valid: true, user_name: "alexlb" })],
      [/POST \/auth\/login/, () => ({ token: "nd-jwt", name: "Alex" })],
      [/PUT \/api\/listenbrainz\/link/, () => ({ status: true, user: "alexlb" })],
    ]);
    expect(await lb.connect(auth, "lb-token", "secret-pass")).toEqual({ user: "alexlb", navidrome: true });
    expect(calls[0]?.headers.get("authorization")).toBe("Token lb-token");
    expect(calls[0]?.headers.get("user-agent")).toMatch(/^Needle\//);
    expect(JSON.parse(calls[1]?.body ?? "{}")).toEqual({ username: "alex", password: "secret-pass" });
    const link = calls.find((c) => c.method === "PUT");
    expect(link?.headers.get("x-nd-authorization")).toBe("Bearer nd-jwt");
    expect(JSON.parse(link?.body ?? "{}")).toEqual({ token: "lb-token" });
    const rows = db.prepare("SELECT * FROM listenbrainz").all();
    expect(rows).toEqual([expect.objectContaining({ user: "alex", token: "lb-token", lb_user: "alexlb", navidrome_linked: 1 })]);
    expect(JSON.stringify(rows)).not.toContain("secret-pass");
    expect(lb.account("alex")).toEqual({ user: "alexlb", navidrome: true });
  });

  it("keeps the token when Navidrome refuses the password, without echoing it", async () => {
    const { lb } = setup();
    mockFetch([
      [/GET \/1\/validate-token/, () => ({ valid: true, user_name: "alexlb" })],
      [/POST \/auth\/login/, () => new Response(JSON.stringify({ error: "Invalid username or password" }), { status: 401 })],
    ]);
    const r = await lb.connect(auth, "lb-token", "wrong-pass");
    expect(r).toEqual({ user: "alexlb", navidrome: false, navidromeError: "Navidrome didn't accept that password" });
    expect(JSON.stringify(r)).not.toContain("wrong-pass");
    expect(lb.account("alex")).toEqual({ user: "alexlb", navidrome: false });
  });

  it("explains why Navidrome couldn't link ListenBrainz", async () => {
    const navidrome = new Navidrome("http://nd");
    mockFetch([[/POST \/auth\/login/, () => new Response("{}", { status: 429 })]]);
    await expect(navidrome.linkListenBrainz("alex", "p", "t")).rejects.toThrow("Navidrome is limiting sign-ins. Try again in a minute.");
    mockFetch([[/POST \/auth\/login/, () => ({ token: "jwt" })]]);
    await expect(navidrome.linkListenBrainz("alex", "p", "t")).rejects.toThrow(/ListenBrainz is switched off in Navidrome/);
    const calls = mockFetch([[/POST \/auth\/login/, () => ({ token: "jwt" })], [/DELETE \/api\/listenbrainz\/link/, () => ({})]]);
    await navidrome.linkListenBrainz("alex", "p", null);
    expect(calls.at(-1)?.method).toBe("DELETE");
  });

  it("rejects a token ListenBrainz doesn't know", async () => {
    const { db, lb } = setup();
    mockFetch([[/GET \/1\/validate-token/, () => ({ code: 200, valid: false, message: "Token invalid." })]]);
    const err = await lb.connect(auth, "bad").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ListenBrainzError);
    expect(err).toMatchObject({ status: 400 });
    expect(db.prepare("SELECT * FROM listenbrainz").all()).toEqual([]);
  });

  it("refuses playlists until connected", async () => {
    const { lb } = setup();
    await expect(lb.playlists(auth)).rejects.toMatchObject({ status: 409, message: "Connect ListenBrainz in Settings first" });
  });

  it("lists the newest playlist of each kind, exploration first, with what's in the library", async () => {
    vi.useFakeTimers();
    const { db, lb } = setup();
    connected(db);
    const metas = [
      playlistMeta(MBIDS.daily, "daily-jams", "2026-09-28T06:00:00Z", "Daily Jams, Mon"),
      playlistMeta(MBIDS.other, "top-discoveries-for-year", "2026-01-01T00:00:00Z", "Top Discoveries of 2025"),
      playlistMeta(MBIDS.oldDaily, "daily-jams", "2026-09-27T06:00:00Z", "Daily Jams, Sun"),
      playlistMeta(MBIDS.jams, "weekly-jams", "2026-09-28T00:00:00Z", "Weekly Jams"),
      playlistMeta(MBIDS.exploration, "weekly-exploration", "2026-09-28T00:00:00Z", "Weekly Exploration"),
    ];
    const calls = mockFetch([
      ...libraryRoutes,
      [/GET \/1\/user\/alexlb\/playlists\/createdfor/, () => ({ playlists: metas.map((playlist) => ({ playlist })) })],
      [/GET \/1\/playlist\//, (u) => ({ playlist: { ...metas.find((m) => m.identifier.endsWith(u.pathname.split("/").at(-1) ?? "")), track: TRACKS } })],
    ]);
    const lists = await settle(lb.playlists(auth));
    expect(lists.map((p) => [p.name, p.kind])).toEqual([
      ["Weekly Exploration", "weekly-exploration"], ["Weekly Jams", "weekly-jams"], ["Daily Jams, Mon", "daily-jams"], ["Top Discoveries of 2025", "other"],
    ]);
    expect(lists[0]).toMatchObject({ id: MBIDS.exploration, total: 4, inLibrary: 3, description: "<p>Songs for <b>you</b></p>", date: "2026-09-28T00:00:00Z" });
    expect(lists[0]?.covers[0]).toBe("https://coverartarchive.org/release/rel-19/42-250.jpg");
    expect(calls.some((c) => c.url.includes(MBIDS.oldDaily))).toBe(false);
    expect(calls.find((c) => c.url.includes("/1/playlist/"))?.headers.get("authorization")).toBe("Token lb-token");
  });

  it("matches tracks by recording MBID first, then by title and artist, and shows requests for the rest", async () => {
    vi.useFakeTimers();
    const { db, lb, requests } = setup();
    connected(db);
    const failed = requests.add({ user: "alex", kind: "song", ref: REC.undertow, title: "Undertow", artist: "Glass Harbor", cover_url: null, state: "searching" });
    requests.update(failed.id, { state: "failed", detail: "No good copy" });
    mockFetch([...libraryRoutes, [/GET \/1\/playlist\//, () => ({ playlist: { ...playlistMeta(MBIDS.exploration, "weekly-exploration", "2026-09-28T00:00:00Z", "Weekly Exploration"), track: TRACKS } })]]);
    const detail = await settle(lb.playlist(auth, MBIDS.exploration));
    expect(detail.tracks.map((t) => [t.mbid, t.song?.id ?? null])).toEqual([[REC.byId, "s-id"], [REC.lucky, "s-lucky"], [REC.teardrop, "s-tear"], [REC.undertow, null]]);
    expect(detail.tracks[3]).toMatchObject({ title: "Undertow", artist: "Glass Harbor", album: "Some Album", duration: 212, request: { state: "failed", detail: "No good copy" } });
    expect(detail.tracks[0]?.request).toBeNull();
  });

  it("finds songs whose titles carry remaster or featuring notes", () => {
    const song = { id: "x", title: "Get Lucky", artist: "Daft Punk" };
    const m = { byMbid: new Map<string, typeof song>(), byKey: new Map([[matchKey("Get Lucky", "Daft Punk"), song]]) };
    expect(findSong(m, { title: "Get Lucky - Radio Edit", artist: "Daft Punk & Pharrell Williams" })).toBe(song);
    expect(findSong(m, { title: "Get Lucky", artist: "Nobody" })).toBeUndefined();
  });

  it("waits out a rate limit, spaces requests and caches playlists", async () => {
    vi.useFakeTimers();
    const { db, lb } = setup();
    connected(db);
    const at: number[] = [];
    let limited = true;
    mockFetch([...libraryRoutes, [/GET \/1\/playlist\//, () => {
      at.push(Date.now());
      if (limited) {
        limited = false;
        return new Response("{}", { status: 429, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset-in": "3" } });
      }
      return { playlist: { ...playlistMeta(MBIDS.exploration, "weekly-exploration", "2026-09-28T00:00:00Z"), track: TRACKS } };
    }]]);
    await settle(lb.playlist(auth, MBIDS.exploration));
    expect(at).toHaveLength(2);
    expect((at[1] ?? 0) - (at[0] ?? 0)).toBeGreaterThanOrEqual(3000);
    await settle(lb.playlist(auth, MBIDS.exploration));
    expect(at).toHaveLength(2);
    const before = Date.now();
    await settle(lb.playlist(auth, MBIDS.jams));
    expect(at).toHaveLength(3);
    expect((at[2] ?? 0) - (at[1] ?? 0)).toBeGreaterThanOrEqual(1100);
    expect(at[2]).toBe(before);
  });

  it("spaces back-to-back requests at least 1.1 s apart", async () => {
    vi.useFakeTimers();
    const { db, lb } = setup();
    connected(db);
    const at: number[] = [];
    mockFetch([...libraryRoutes, [/GET \/1\/playlist\//, () => {
      at.push(Date.now());
      return { playlist: { ...playlistMeta(MBIDS.exploration, "weekly-exploration", "2026-09-28T00:00:00Z"), track: [] } };
    }]]);
    await settle(Promise.all([lb.playlist(auth, MBIDS.exploration), lb.playlist(auth, MBIDS.jams), lb.playlist(auth, MBIDS.daily)]));
    expect(at).toHaveLength(3);
    expect((at[1] ?? 0) - (at[0] ?? 0)).toBeGreaterThanOrEqual(1100);
    expect((at[2] ?? 0) - (at[1] ?? 0)).toBeGreaterThanOrEqual(1100);
  });

  it("forgets a playlist ListenBrainz no longer has", async () => {
    vi.useFakeTimers();
    const { db, lb } = setup();
    connected(db);
    let gone = true;
    const calls = mockFetch([...libraryRoutes, [/GET \/1\/playlist\//, () => (gone ? new Response("{}", { status: 404 }) : { playlist: { ...playlistMeta(MBIDS.jams, "weekly-jams", "2026-09-28T00:00:00Z"), track: [] } })]]);
    await expect(settle(lb.playlist(auth, MBIDS.jams))).rejects.toMatchObject({ status: 404 });
    gone = false;
    await settle(lb.playlist(auth, MBIDS.jams));
    expect(calls.filter((c) => c.url.includes("/1/playlist/"))).toHaveLength(2);
  });

  it("reports whether Navidrome sends listens in Connections", async () => {
    vi.useFakeTimers();
    const { db, lb, navidrome } = setup();
    const status = new Status({
      config: loadConfig({ navidromeUrl: "http://nd", lidarr: null, soulseek: null, spotify: null }), navidrome, library: new LibrarySearch(navidrome),
      lidarr: null, slskd: null, musicbrainz: new MusicBrainz("http://mb"), deezer: new Deezer("http://dz"), listenbrainz: lb,
    });
    const check = () => settle(status.checks(auth, true)).then((all) => all.find((c) => c.id === "listenbrainz"));
    mockFetch([]);
    expect(await check()).toMatchObject({ state: "off", label: "ListenBrainz (discovery)" });
    connected(db);
    const listen = (client: string, daysAgo: number) => ({ payload: { listens: [{ listened_at: Math.floor(Date.now() / 1000) - daysAgo * 86_400, track_metadata: { additional_info: { submission_client: client } } }] } });
    mockFetch([[/GET \/1\/user\/alexlb\/listens/, () => listen("Navidrome", 1)]]);
    expect(await check()).toMatchObject({ state: "ok" });
    mockFetch([[/GET \/1\/user\/alexlb\/listens/, () => listen("Navidrome", 9)]]);
    expect(await check()).toMatchObject({ state: "warn", fix: expect.stringContaining("Settings → Personal → ListenBrainz") as string });
  });
});

describe("song downloads", () => {
  it("runs at most two downloads at once and starts the next when one ends", async () => {
    const db = openDatabase(":memory:");
    const requests = new Requests(db);
    const pending: ((r: Response) => void)[] = [];
    vi.stubGlobal("fetch", vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (init?.method === "POST" && url.endsWith("/searches")) return new Promise<Response>((resolve) => pending.push(resolve));
      return Promise.resolve(new Response("{}"));
    }));
    const songs = new SongDownloads({ slskd: new Slskd("http://slskd", "k"), requests, navidrome: new Navidrome("http://nd"), downloadsDir: "/tmp/none", singlesDir: "/tmp/none" });
    const auth = { user: "alex", token: "t", salt: "s" };
    const rows = ["a", "b", "c"].map((id) => songs.start(auth, { id, title: id, artist: "A", album: null, duration: null, year: null, coverUrl: null }));
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    expect(rows.map((r) => requests.get(r.id)?.state)).toEqual(["searching", "searching", "searching"]);
    pending[0]?.(new Response("{}", { status: 500 }));
    await vi.waitFor(() => expect(pending).toHaveLength(3));
    expect(requests.get(rows[0]?.id ?? 0)?.state).toBe("failed");
    expect(requests.byRefs("alex", "song", ["b", "c", "zzz"]).map((r) => r.ref).sort()).toEqual(["b", "c"]);
  });
});
