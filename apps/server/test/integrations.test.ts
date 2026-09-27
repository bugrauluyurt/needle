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
import { matchKey, normalize, Spotify } from "../src/spotify.ts";

type Route = [RegExp, (url: URL, init?: RequestInit) => unknown];

function mockFetch(routes: Route[]) {
  const calls: { url: string; method: string; body?: string }[] = [];
  vi.stubGlobal("fetch", vi.fn((input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method ?? "GET";
    calls.push({ url: url.href, method, ...(typeof init?.body === "string" ? { body: init.body } : init?.body instanceof URLSearchParams ? { body: init.body.toString() } : {}) });
    const route = routes.find(([re]) => re.test(`${method} ${url.pathname}`));
    if (!route) return Promise.resolve(new Response("not found", { status: 404 }));
    const body = route[1](url, init);
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

describe("Spotify import", () => {
  it("matches tracks against the library and writes a Navidrome playlist", async () => {
    const db = openDatabase(":memory:");
    db.prepare("INSERT INTO spotify_tokens (user, access_token, refresh_token, expires_at) VALUES ('bugra', 'tok', 'ref', ?)").run(Date.now() + 3_600_000);
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
      [/POST \/rest\/search3/, () => ok({ searchResult3: { song: [
        { id: "n1", title: "Kelly Watch the Stars", artist: "Air" },
        { id: "n2", title: "Get Lucky", artist: "Daft Punk" },
      ] } })],
      [/POST \/rest\/getPlaylists/, () => ok({ playlists: { playlist: [] } })],
      [/POST \/rest\/createPlaylist/, () => ok({ playlist: { id: "pl9", name: "Road trip (from Spotify)" } })],
    ]);
    const spotify = new Spotify({ clientId: "id", clientSecret: "secret", publicUrl: "https://needle", db, navidrome: new Navidrome("http://nd") });
    const r = await spotify.import({ user: "bugra", token: "t", salt: "s" }, "p1");
    expect(r).toMatchObject({ source: "Road trip", total: 3, matched: 2, playlistId: "pl9" });
    expect(r.missing).toEqual([{ title: "Nowhere", artist: "Nobody", album: "Missing" }]);
    const create = calls.find((c) => c.url.endsWith("/rest/createPlaylist"));
    expect(new URLSearchParams(create?.body).getAll("songId")).toEqual(["n1", "n2"]);
    expect(calls.some((c) => c.url.startsWith("https://api.spotify.com/v1/playlists/p1/items"))).toBe(true);
  });

  it("builds a PKCE sign-in link and rejects unknown states", async () => {
    const db = openDatabase(":memory:");
    const spotify = new Spotify({ clientId: "id", clientSecret: "secret", publicUrl: "https://needle.example", db, navidrome: new Navidrome("http://nd") });
    const url = new URL(spotify.authorizeUrl("bugra"));
    expect(url.searchParams.get("redirect_uri")).toBe("https://needle.example/api/spotify/callback");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toContain("user-library-read");
    await expect(spotify.complete("code", "not-a-state")).rejects.toThrow(/expired/);
  });

  it("refreshes an expired token, keeps its scope, and reports whether it can play", async () => {
    const db = openDatabase(":memory:");
    db.prepare("INSERT INTO spotify_tokens (user, access_token, refresh_token, expires_at, scope) VALUES ('bugra', 'old', 'ref', ?, 'streaming user-library-read')").run(Date.now() - 1000);
    db.prepare("INSERT INTO spotify_tokens (user, access_token, refresh_token, expires_at, scope) VALUES ('guest', 'tok', 'ref', ?, 'user-library-read')").run(Date.now() + 3_600_000);
    const calls = mockFetch([[/POST \/api\/token/, () => ({ access_token: "fresh", expires_in: 3600 })]]);
    const spotify = new Spotify({ clientId: "id", clientSecret: "secret", publicUrl: "https://needle", db, navidrome: new Navidrome("http://nd") });
    const t = await spotify.token("bugra");
    expect(t.accessToken).toBe("fresh");
    expect(t.expiresAt).toBeGreaterThan(Date.now());
    expect(new URLSearchParams(calls[0]?.body).get("refresh_token")).toBe("ref");
    expect(spotify.canPlay("bugra")).toBe(true);
    expect(spotify.canPlay("guest")).toBe(false);
    expect(spotify.canPlay("nobody")).toBe(false);
    expect(spotify.needsReconnect("bugra")).toBe(true);
    expect(spotify.needsReconnect("nobody")).toBe(false);
    spotify.setEnabled("bugra", false);
    expect(spotify.enabled("bugra")).toBe(false);
    await expect(spotify.token("bugra")).rejects.toMatchObject({ status: 409 });
  });
});

describe("library search", () => {
  const auth = { user: "bugra", token: "t", salt: "s" };
  const library = (scan: string) => [
    [/POST \/rest\/getScanStatus/, () => ok({ scanStatus: { lastScan: scan, count: 3 } })],
    [/POST \/rest\/search3/, () => ok({ searchResult3: {
      song: [
        { id: "s1", title: "Bad Guy", artist: "Billie Eilish", album: "When We All Fall Asleep" },
        { id: "s2", title: "Guy Who Sings", artist: "Someone", album: "Eilish Tribute" },
        { id: "s3", title: "İstanbul'da Gece", artist: "Kasa Kaan", album: "Gece" },
      ],
      album: [{ id: "a1", name: "Happier Than Ever", artist: "Billie Eilish" }],
      artist: [{ id: "r1", name: "Billie Eilish" }, { id: "r2", name: "Kasa Kaan" }],
    } })],
  ] satisfies Route[];

  it("matches text anywhere in titles, artists and albums, ignoring accents", async () => {
    mockFetch(library("1"));
    const search = new LibrarySearch(new Navidrome("http://nd"));
    const r = await search.search(auth, "ilish");
    expect(r.song?.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(r.album?.map((a) => a.id)).toEqual(["a1"]);
    expect(r.artist?.map((a) => a.id)).toEqual(["r1"]);
    expect((await search.search(auth, "guy eilish")).song?.map((s) => s.id)).toEqual(["s2", "s1"]);
    expect((await search.search(auth, "istanbul")).song?.map((s) => s.id)).toEqual(["s3"]);
    expect((await search.search(auth, "  ")).song).toBeUndefined();
  });

  it("builds the index once and rebuilds it after a new scan", async () => {
    let calls = mockFetch(library("1"));
    const search = new LibrarySearch(new Navidrome("http://nd"));
    await search.search(auth, "bad");
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
  const want = { title: "Fade to Black", artist: "Metallica", duration: 417 };
  const peer = (username: string, files: SlskdFile[], extra = {}) => ({ username, files, hasFreeUploadSlot: true, uploadSpeed: 2_000_000, queueLength: 0, ...extra });

  it("picks the best matching copy", () => {
    const picks = pickFiles([
      peer("mp3", [{ filename: "Music\\Metallica\\Ride\\04 Fade to Black.mp3", size: 1, bitRate: 320, length: 417 }]),
      peer("flac", [{ filename: "Music\\Metallica - Ride the Lightning\\04 - Fade To Black.flac", size: 2, length: 416 }]),
      peer("live", [{ filename: "Bootlegs\\Metallica\\Fade to Black (Live).flac", size: 3, length: 417 }]),
      peer("short", [{ filename: "x\\Fade to Black.flac", size: 4, length: 200 }]),
      peer("low", [{ filename: "x\\Metallica\\Fade to Black.mp3", size: 5, bitRate: 128, length: 417 }]),
      peer("busy", [{ filename: "Metallica\\Fade to Black.flac", size: 6, length: 417 }], { hasFreeUploadSlot: false, queueLength: 50, uploadSpeed: 0 }),
    ], want);
    expect(picks.map((p) => p.username)).toEqual(["flac", "busy", "mp3"]);
  });

  it("names the file after the artist and title", () => {
    expect(singlePath("/singles", { title: "One/Two?", artist: "AC/DC" }, { filename: "x\\a.FLAC", size: 1, extension: "FLAC" })).toBe("/singles/AC_DC/AC_DC - One_Two_.flac");
  });

  it("turns MusicBrainz recordings into songs, once each", () => {
    const rec = (id: string, title: string) => ({ id, title, length: 417_000, "artist-credit": [{ name: "Metallica" }], releases: [{ title: "Ride the Lightning", date: "1984-07-27", status: "Official", "release-group": { id: "rg1", "primary-type": "Album" } }] });
    expect(toCandidates([rec("r1", "Fade to Black"), rec("r2", "Fade To Black")])).toEqual([
      { id: "r1", title: "Fade to Black", artist: "Metallica", album: "Ride the Lightning", duration: 417, year: 1984, coverUrl: "https://coverartarchive.org/release-group/rg1/front-250" },
    ]);
  });

  it("ranks the song that matches both artist and title first, and skips live versions", () => {
    const rec = (id: string, artist: string, title: string, disambiguation = "") => ({ id, title, disambiguation, "artist-credit": [{ name: artist }] });
    const songs = toCandidates([
      rec("a", "Fade to Black", "Black Box"),
      rec("b", "Metallica", "Fade to Black (Live)"),
      rec("c", "Metallica", "Fade to Black", "live, 1997"),
      rec("d", "Metallica", "Fade to Black"),
    ], "fade to black metallica");
    expect(songs.map((x) => x.id)).toEqual(["d", "a"]);
  });

  it("prefers the song whose artist and title add nothing to the search", () => {
    const rec = (id: string, artist: string, title: string) => ({ id, title, "artist-credit": [{ name: artist }] });
    const songs = toCandidates([
      rec("muppets", "Queen + The Muppets", "Bohemian Rhapsody"),
      rec("tribute", "Bohemian Rhapsody", "White Queen (As It Began)"),
      { ...rec("queen", "Queen", "Bohemian Rhapsody"), disambiguation: "2002 5.1 mix" },
    ], "bohemian rhapsody queen");
    expect(songs.map((x) => x.id)).toEqual(["queen", "muppets", "tribute"]);
  });

  it("keeps one request per item and marks interrupted songs", () => {
    const requests = new Requests(openDatabase(":memory:"));
    const first = requests.add({ user: "bugra", kind: "song", ref: "r1", title: "T", artist: "A", cover_url: null, state: "searching" });
    requests.update(first.id, { state: "failed", detail: "nope" });
    const again = requests.add({ user: "bugra", kind: "song", ref: "r1", title: "T", artist: "A", cover_url: null, state: "searching" });
    expect(again.id).toBe(first.id);
    expect(again.detail).toBeNull();
    expect(requests.list("bugra")).toHaveLength(1);
    expect(requests.active().map((r) => r.id)).toEqual([first.id]);
  });
});

describe("artist catalogues", () => {
  it("lists an artist's studio albums from MusicBrainz, newest first", async () => {
    mockFetch([[/GET \/ws\/2\/release-group/, () => ({ "release-groups": [
      { id: "rg1", title: "Kill 'Em All", "first-release-date": "1983-07-25", "primary-type": "Album" },
      { id: "rg2", title: "Master of Puppets", "first-release-date": "1986-03-03", "primary-type": "Album" },
      { id: "rg3", title: "S&M", "first-release-date": "1999-11-23", "primary-type": "Album", "secondary-types": ["Live"] },
    ] })]]);
    const albums = await new MusicBrainz("https://musicbrainz.org/ws/2").albumsBy("mbid", "Metallica");
    expect(albums.map((a) => [a.title, a.year, a.state])).toEqual([["Master of Puppets", 1986, "missing"], ["Kill 'Em All", 1983, "missing"]]);
  });

  it("gets an artist's popular songs from Deezer only for an exact name", async () => {
    const calls = mockFetch([
      [/GET \/search\/artist/, () => ({ data: [{ id: 7, name: "Metallica Tribute" }, { id: 119, name: "Metallica" }] })],
      [/GET \/artist\/119\/top/, () => ({ data: [{ id: 1, title: "Enter Sandman", duration: 331, artist: { name: "Metallica" }, album: { title: "Metallica", cover_medium: "https://c/1" } }] })],
    ]);
    const songs = await new Deezer("https://api.deezer.com").topSongs("metallica");
    expect(songs).toEqual([{ id: "deezer:1", title: "Enter Sandman", artist: "Metallica", album: "Metallica", duration: 331, year: null, coverUrl: "https://c/1" }]);
    expect(await new Deezer("https://api.deezer.com").topSongs("metallica ride")).toEqual([]);
    expect(calls.filter((c) => c.url.includes("/top"))).toHaveLength(1);
  });

  it("matches owned songs even with remaster notes in the title", () => {
    expect(songKey("Metallica", "Enter Sandman (Remastered 2021)")).toBe(songKey("metallica", "Enter Sandman"));
    expect(songKey("Queen", "Bohemian Rhapsody - Remastered 2011")).toBe(songKey("Queen", "Bohemian Rhapsody"));
  });
});
