import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { openDatabase } from "../src/db.ts";
import { Navidrome } from "../src/navidrome.ts";
import { People } from "../src/people.ts";
import { LibrarySearch, matchKey } from "../src/search.ts";
import type { Matcher } from "../src/search.ts";
import { YouTubeMusic, YouTubeMusicError } from "../src/youtube-music.ts";
import type { YouTubeMusicBridgeRequest } from "../src/youtube-music.ts";

const VIDEO = "abcdefghijk";
const ARTIST = "UCexample";
const ALBUM = "MPREexample";
const SCOPE = "https://www.googleapis.com/auth/youtube";
const auth = { user: "alex", token: "token", salt: "salt" };
const headers = { "x-needle-user": auth.user, "x-needle-token": auth.token, "x-needle-salt": auth.salt };
const databases: DatabaseSync[] = [];
const rawSong = {
  videoId: VIDEO,
  title: "Night Transit",
  artists: [{ id: ARTIST, name: "Glass Harbor" }],
  album: { id: ALBUM, name: "Tidal Lines" },
  duration_seconds: 245,
  likeStatus: "LIKE",
  videoType: "MUSIC_VIDEO_TYPE_ATV",
  thumbnails: [{ url: "https://i.ytimg.com/example.jpg", width: 544, height: 544 }],
};

function database(): DatabaseSync {
  const db = openDatabase(":memory:");
  databases.push(db);

  return db;
}

function seed(db: DatabaseSync, user = auth.user, options: { enabled?: boolean; expiresAt?: number } = {}): void {
  db.prepare(
    "INSERT INTO youtube_music_tokens (user, access_token, refresh_token, expires_at, scope, enabled) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(
    user,
    `${user}-access`,
    `${user}-refresh`,
    options.expiresAt ?? Date.now() + 3600_000,
    SCOPE,
    options.enabled === false ? 0 : 1,
  );
}

function client(bridge: (request: YouTubeMusicBridgeRequest) => Promise<unknown>, db = database()): YouTubeMusic {
  const navidrome = new Navidrome("http://navidrome.test");

  return new YouTubeMusic({
    clientId: "client",
    clientSecret: "secret",
    python: "python3",
    db,
    navidrome,
    library: new LibrarySearch(navidrome),
    bridge,
  });
}

function providerFetch(handler: (url: URL, init?: RequestInit) => Response | Promise<Response>) {
  const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);

    return Promise.resolve(handler(url, init));
  });
  vi.stubGlobal("fetch", fetchMock);

  return fetchMock;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();

  for (const db of databases.splice(0)) db.close();
});

describe("YouTube Music metadata", () => {
  it("normalizes catalog songs, artwork and album references without leaking unknown provider fields", async () => {
    const db = database();
    seed(db);
    const youtube = client(
      () =>
        Promise.resolve({
          tracks: [
            rawSong,
            {
              ...rawSong,
              videoId: "lmnopqrstuv",
              isAvailable: false,
              thumbnails: null,
              artists: [{ id: null, name: "Unlinked artist" }],
            },
            { ...rawSong, videoId: "video-id" },
            { ...rawSong, videoType: "MUSIC_VIDEO_TYPE_OMV" },
            { ...rawSong, videoType: "MUSIC_VIDEO_TYPE_PRIVATELY_OWNED_TRACK" },
          ],
          trackCount: 5,
        }),
      db,
    );

    const songs = await youtube.liked(auth.user);

    expect(songs.items).toHaveLength(2);
    expect(songs.items[0]).toMatchObject({
      id: `ytm:${VIDEO}`,
      source: "youtubeMusic",
      albumId: `ytm:${ALBUM}`,
      artistId: `ytm:${ARTIST}`,
      coverArt: "https://i.ytimg.com/example.jpg",
      duration: 245,
      isAvailable: true,
    });
    expect(songs.items[0]).not.toHaveProperty("starred");
    expect(songs.items[0]).not.toHaveProperty("likeStatus");
    expect(songs.items[1]).toMatchObject({ isAvailable: false, artist: "Unlinked artist", artists: [] });
    expect(songs.items[1]?.coverArt).toBeUndefined();
  });

  it("uses actual audioPlaylistId and album artwork for tracks with null album metadata", async () => {
    const db = database();
    seed(db);
    const youtube = client(
      () =>
        Promise.resolve({
          title: "Tidal Lines",
          audioPlaylistId: "OLAKexample",
          artists: [{ name: "Glass Harbor", id: ARTIST }],
          year: "2001",
          thumbnails: rawSong.thumbnails,
          tracks: [
            {
              videoId: VIDEO,
              title: "Night Transit",
              artists: null,
              album: "Tidal Lines",
              thumbnails: null,
              duration: "4:05",
            },
          ],
        }),
      db,
    );

    const detail = await youtube.album(auth.user, `ytm:${ALBUM}`);

    expect(detail.album).toMatchObject({ id: `ytm:${ALBUM}`, playlistId: "OLAKexample", year: 2001 });
    expect(detail.songs[0]).toMatchObject({
      albumId: `ytm:${ALBUM}`,
      artist: "Glass Harbor",
      artistId: `ytm:${ARTIST}`,
      duration: 245,
      coverArt: rawSong.thumbnails[0]?.url,
    });
  });

  it("preserves browse artist identity separately from its subscription channel and expands sections", async () => {
    const db = database();
    seed(db);
    const youtube = client(
      () =>
        Promise.resolve({
          name: "Glass Harbor",
          channelId: "UCsubscription",
          thumbnails: null,
          subscribed: true,
          songs: { results: [rawSong], browseId: "VLPLsongs" },
          albums: { results: [{ browseId: ALBUM, title: "Tidal Lines" }], params: "more" },
        }),
      db,
    );

    const artist = await youtube.artist(auth.user, ARTIST);

    expect(artist.artist).toMatchObject({
      id: `ytm:${ARTIST}`,
      subscriptionId: "UCsubscription",
      images: [],
      subscribed: true,
    });
    expect(artist.albums[0]?.artists).toEqual([{ id: `ytm:${ARTIST}`, name: "Glass Harbor" }]);
    expect(artist.hasMoreSongs).toBe(true);
    expect(artist.hasMoreAlbums).toBe(true);
    expect(artist.singles).toEqual([]);
  });

  it("maps each mixed search category and ignores videos, podcasts and unknown results", async () => {
    const db = database();
    seed(db);
    const youtube = client(
      () =>
        Promise.resolve([
          { ...rawSong, resultType: "song" },
          { browseId: ALBUM, title: "Tidal Lines", resultType: "album" },
          { browseId: ARTIST, artist: "Glass Harbor", resultType: "artist" },
          { playlistId: "PLexample", title: "Night music", count: "3", resultType: "playlist" },
          { ...rawSong, resultType: "video" },
          { ...rawSong, resultType: "podcast" },
        ]),
      db,
    );

    const result = await youtube.search(auth.user, "night");

    expect([result.songs.length, result.albums.length, result.artists.length, result.playlists.length]).toEqual([
      1, 1, 1, 1,
    ]);
    expect(result.playlists[0]).toMatchObject({ id: "ytm:PLexample", songCount: 3 });
    await expect(youtube.search(auth.user, "x".repeat(201))).rejects.toMatchObject({ status: 400 });
  });

  it("returns timed lyrics in the millisecond format expected by the existing player", async () => {
    const db = database();
    seed(db);
    const youtube = client(
      () =>
        Promise.resolve({
          hasTimestamps: true,
          source: "Lyrics provider",
          lyrics: [{ text: "First line", start_time: 1250, end_time: 3000, id: 1 }],
        }),
      db,
    );

    expect(await youtube.lyrics(auth.user, VIDEO)).toEqual({
      source: "Lyrics provider",
      lyrics: [{ synced: true, line: [{ value: "First line", start: 1250 }] }],
    });
  });

  it("rejects malformed provider collections and hostile ids before provider calls", async () => {
    const db = database();
    seed(db);
    const bridge = vi.fn(() => Promise.resolve({ songs: "invalid" }));
    const youtube = client(bridge, db);

    await expect(youtube.liked(auth.user)).rejects.toMatchObject({ status: 502 });
    await expect(youtube.radio(auth.user, "https://internal/secret")).rejects.toMatchObject({ status: 400 });
    await expect(youtube.album(auth.user, "../private")).rejects.toMatchObject({ status: 400 });
    expect(bridge).toHaveBeenCalledTimes(1);
  });

  it("isolates users and calls no provider while disconnected or switched off", async () => {
    const db = database();
    seed(db);
    seed(db, "sam", { enabled: false });
    const bridge = vi.fn((request: YouTubeMusicBridgeRequest) =>
      Promise.resolve({ accountName: request.token?.access_token, channelHandle: null, accountPhotoUrl: null }),
    );
    const youtube = client(bridge, db);

    expect((await youtube.account("alex")).name).toBe("alex-access");
    await expect(youtube.account("sam")).rejects.toMatchObject({ status: 409, code: "disabled" });
    await expect(youtube.account("stranger")).rejects.toMatchObject({ status: 409, code: "not_connected" });
    youtube.setEnabled("sam", true);
    expect((await youtube.account("sam")).name).toBe("sam-access");
    youtube.disconnect("alex");
    await expect(youtube.account("alex")).rejects.toMatchObject({ status: 409 });
    expect(bridge).toHaveBeenCalledTimes(2);
    expect(youtube.connected("sam")).toBe(true);
  });

  it("does not start a queued account mutation after the user switches the source off", async () => {
    const db = database();
    seed(db);
    const bridge = vi.fn(() => Promise.resolve({}));
    const youtube = client(bridge, db);

    const mutation = youtube.like(auth.user, VIDEO, true);
    youtube.setEnabled(auth.user, false);

    await expect(mutation).rejects.toMatchObject({ status: 409 });
    expect(bridge).not.toHaveBeenCalled();
  });

  it("retains cached library content during a shared cooldown and pauses new provider calls", async () => {
    vi.useFakeTimers();
    const db = database();
    seed(db);
    let limited = false;
    const bridge = vi.fn(() =>
      limited ? Promise.reject(new YouTubeMusicError(429, "Limited", "quota")) : Promise.resolve({ tracks: [rawSong] }),
    );
    const youtube = client(bridge, db);

    expect((await youtube.liked(auth.user)).items).toHaveLength(1);
    limited = true;
    await vi.advanceTimersByTimeAsync(60_001);
    expect((await youtube.liked(auth.user)).items).toHaveLength(1);
    await expect(youtube.search(auth.user, "new search")).rejects.toMatchObject({ status: 429 });
    expect((await youtube.liked(auth.user)).items).toHaveLength(1);
    expect(bridge).toHaveBeenCalledTimes(2);
  });
});

describe("YouTube Music OAuth", () => {
  it.each([SCOPE, `openid ${SCOPE} email`])("accepts the exact YouTube scope in %s", async (grantedScopes) => {
    const db = database();
    seed(db, auth.user, { expiresAt: Date.now() - 1 });

    const youtube = client(() => Promise.resolve({ accountName: "Needle listener" }), db);
    providerFetch(() => Response.json({ access_token: "refreshed-access", expires_in: 3600, scope: grantedScopes }));

    await expect(youtube.account(auth.user)).resolves.toMatchObject({ name: "Needle listener" });
    expect(db.prepare("SELECT scope FROM youtube_music_tokens WHERE user = ?").get(auth.user)).toEqual({
      scope: grantedScopes,
    });
  });

  it.each([`${SCOPE}.readonly`, `https://evil.example/?scope=${SCOPE}`, `prefix${SCOPE}`])(
    "rejects a lookalike YouTube scope in %s",
    async (grantedScopes) => {
      const db = database();
      seed(db, auth.user, { expiresAt: Date.now() - 1 });

      const youtube = client(() => Promise.resolve({ accountName: "Needle listener" }), db);
      providerFetch(() => Response.json({ access_token: "refreshed-access", expires_in: 3600, scope: grantedScopes }));

      await expect(youtube.account(auth.user)).rejects.toMatchObject({
        status: 502,
        message: "Google refused the YouTube Music connection",
      });
      expect(db.prepare("SELECT access_token FROM youtube_music_tokens WHERE user = ?").get(auth.user)).toEqual({
        access_token: `${auth.user}-access`,
      });
    },
  );

  it("honors polling intervals, slow_down, completion and per-user tokens", async () => {
    vi.useFakeTimers();
    const db = database();
    const youtube = client(() => Promise.resolve({}), db);
    let polls = 0;
    const fetchMock = providerFetch((url) => {
      if (url.pathname.endsWith("/device/code"))
        return Response.json({
          device_code: "private-device-code",
          user_code: "ABCD-EFGH",
          verification_url: "https://www.google.com/device",
          expires_in: 900,
          interval: 5,
        });

      polls += 1;

      return polls === 1
        ? Response.json({ error: "slow_down" }, { status: 400 })
        : Response.json({ access_token: "access", refresh_token: "refresh", expires_in: 3600, scope: SCOPE });
    });

    const login = await youtube.login(auth.user);
    expect(login).toMatchObject({ userCode: "ABCD-EFGH", interval: 5 });
    expect(login).not.toHaveProperty("device_code");
    expect(await youtube.loginStatus(auth.user)).toEqual({ state: "pending", retryAfter: 5 });
    await vi.advanceTimersByTimeAsync(5000);
    expect(await youtube.loginStatus(auth.user)).toEqual({ state: "pending", retryAfter: 10 });
    await youtube.loginStatus(auth.user);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await youtube.loginStatus(auth.user)).toEqual({ state: "connected" });
    expect(youtube.connected(auth.user)).toBe(true);
    expect(youtube.connected("sam")).toBe(false);
    expect(youtube.enabled(auth.user)).toBe(true);
  });

  it("does not resurrect a cancelled login after a delayed code response", async () => {
    const db = database();
    const youtube = client(() => Promise.resolve({}), db);
    let resolveResponse: (response: Response) => void = () => undefined;
    providerFetch(
      () =>
        new Promise<Response>((resolve) => {
          resolveResponse = resolve;
        }),
    );

    const login = youtube.login(auth.user);
    youtube.cancelLogin(auth.user);
    resolveResponse(
      Response.json({
        device_code: "device",
        user_code: "code",
        verification_url: "https://www.google.com/device",
        expires_in: 900,
      }),
    );

    await expect(login).rejects.toMatchObject({ status: 409 });
    expect(db.prepare("SELECT * FROM youtube_music_logins").all()).toEqual([]);
  });

  it("limits repeated login starts and never exposes Google errors or secrets", async () => {
    const db = database();
    const youtube = client(() => Promise.resolve({}), db);
    providerFetch(() =>
      Response.json({ error: "invalid_client", error_description: "client-secret-private" }, { status: 400 }),
    );

    for (let loginAttempt = 0; loginAttempt < 10; loginAttempt += 1) {
      await expect(youtube.login(auth.user)).rejects.toMatchObject({
        status: 502,
        message: "Google returned an invalid connection code",
      });
    }

    await expect(youtube.login(auth.user)).rejects.toMatchObject({ status: 429 });
  });

  it("refreshes once for concurrent calls and requests reconnect without signing out Navidrome", async () => {
    const db = database();
    seed(db, auth.user, { expiresAt: Date.now() - 1 });
    const youtube = client(() => Promise.resolve({ tracks: [] }), db);
    const fetchMock = providerFetch(() =>
      Response.json({ error: "invalid_grant", error_description: "do not expose refresh token" }, { status: 400 }),
    );

    const results = await Promise.allSettled([youtube.liked(auth.user), youtube.liked(auth.user)]);

    expect(
      results.every(
        (result) =>
          result.status === "rejected" && result.reason instanceof YouTubeMusicError && result.reason.status === 409,
      ),
    ).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(youtube.needsReconnect(auth.user)).toBe(true);
    expect(youtube.connected(auth.user)).toBe(true);
  });

  it("retires cached and pending metadata when connecting a different Google account", async () => {
    vi.useFakeTimers();
    const db = database();
    seed(db);
    let resolveAccount: (account: unknown) => void = () => undefined;
    let accountRequests = 0;
    const bridge = vi.fn((request: YouTubeMusicBridgeRequest) => {
      accountRequests += 1;

      return accountRequests === 1
        ? new Promise<unknown>((resolve) => {
            resolveAccount = resolve;
          })
        : Promise.resolve({ accountName: request.token?.access_token });
    });
    const youtube = client(bridge, db);
    providerFetch((url) =>
      url.pathname.endsWith("/device/code")
        ? Response.json({
            device_code: "device",
            user_code: "code",
            verification_url: "https://www.google.com/device",
            expires_in: 900,
          })
        : Response.json({ access_token: "new-account", refresh_token: "new-refresh", expires_in: 3600, scope: SCOPE }),
    );

    const oldAccount = youtube.account(auth.user);
    await Promise.resolve();
    await youtube.login(auth.user);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await youtube.loginStatus(auth.user)).toEqual({ state: "connected" });
    expect((await youtube.account(auth.user)).name).toBe("new-account");
    resolveAccount({ accountName: "previous-account" });

    await expect(oldAccount).rejects.toMatchObject({ status: 409 });
    expect((await youtube.account(auth.user)).name).toBe("new-account");
    expect(bridge).toHaveBeenCalledTimes(2);
  });

  it("does not let an old token refresh overwrite a newly connected Google account", async () => {
    vi.useFakeTimers();
    const db = database();
    seed(db, auth.user, { expiresAt: Date.now() - 1 });
    const youtube = client(() => Promise.resolve({ accountName: "New account" }), db);
    let resolveRefresh: (response: Response) => void = () => undefined;
    providerFetch((url, init) => {
      if (url.pathname.endsWith("/device/code"))
        return Response.json({
          device_code: "device",
          user_code: "code",
          verification_url: "https://www.google.com/device",
          expires_in: 900,
        });
      if (init?.body instanceof URLSearchParams && init.body.get("grant_type") === "refresh_token") {
        return new Promise<Response>((resolve) => {
          resolveRefresh = resolve;
        });
      }

      return Response.json({
        access_token: "new-account",
        refresh_token: "new-refresh",
        expires_in: 3600,
        scope: SCOPE,
      });
    });

    const oldAccount = youtube.account(auth.user);
    await Promise.resolve();
    await youtube.login(auth.user);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await youtube.loginStatus(auth.user)).toEqual({ state: "connected" });
    resolveRefresh(Response.json({ access_token: "old-refreshed-access", expires_in: 3600, scope: SCOPE }));

    await expect(oldAccount).rejects.toMatchObject({ status: 409 });
    expect(
      db.prepare("SELECT access_token, refresh_token FROM youtube_music_tokens WHERE user = ?").get(auth.user),
    ).toMatchObject({ access_token: "new-account", refresh_token: "new-refresh" });
  });

  it("cannot return captured stale metadata after its account is replaced", async () => {
    vi.useFakeTimers();
    const db = database();
    seed(db);
    let rejectAccount: (error: Error) => void = () => undefined;
    let accountRequests = 0;
    const youtube = client((request) => {
      accountRequests += 1;

      return accountRequests === 2
        ? new Promise<unknown>((_resolve, reject) => {
            rejectAccount = reject;
          })
        : Promise.resolve({ accountName: request.token?.access_token });
    }, db);
    providerFetch((url) =>
      url.pathname.endsWith("/device/code")
        ? Response.json({
            device_code: "device",
            user_code: "code",
            verification_url: "https://www.google.com/device",
            expires_in: 900,
          })
        : Response.json({ access_token: "new-account", refresh_token: "new-refresh", expires_in: 3600, scope: SCOPE }),
    );

    expect((await youtube.account(auth.user)).name).toBe("alex-access");
    await vi.advanceTimersByTimeAsync(60_001);
    const staleAccount = youtube.account(auth.user);
    await Promise.resolve();
    await youtube.login(auth.user);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await youtube.loginStatus(auth.user)).toEqual({ state: "connected" });
    rejectAccount(new YouTubeMusicError(502, "The old account's bridge was terminated"));

    await expect(staleAccount).rejects.toMatchObject({ status: 409 });
    expect((await youtube.account(auth.user)).name).toBe("new-account");
  });

  it("cannot import a previous account's playlist after reconnecting while local matching is pending", async () => {
    vi.useFakeTimers();
    const db = database();
    seed(db);
    const navidrome = new Navidrome("http://navidrome.test");
    const library = new LibrarySearch(navidrome);
    const upsertPlaylist = vi.spyOn(navidrome, "upsertPlaylist").mockResolvedValue("imported-playlist");
    let resolveMatcher: (matcher: Matcher) => void = () => undefined;
    const matcher = new Promise<Matcher>((resolve) => {
      resolveMatcher = resolve;
    });
    let notifyMatcherRequested: () => void = () => undefined;
    const matcherRequested = new Promise<void>((resolve) => {
      notifyMatcherRequested = resolve;
    });
    vi.spyOn(library, "matcher").mockImplementation(() => {
      notifyMatcherRequested();

      return matcher;
    });
    const youtube = new YouTubeMusic({
      clientId: "client",
      clientSecret: "secret",
      python: "python3",
      db,
      navidrome,
      library,
      bridge: () => Promise.resolve({ tracks: [rawSong], trackCount: 1 }),
    });
    providerFetch((url) =>
      url.pathname.endsWith("/device/code")
        ? Response.json({
            device_code: "device",
            user_code: "code",
            verification_url: "https://www.google.com/device",
            expires_in: 900,
          })
        : Response.json({ access_token: "new-account", refresh_token: "new-refresh", expires_in: 3600, scope: SCOPE }),
    );

    const importPlaylist = youtube.import(auth, "liked");
    await matcherRequested;
    await youtube.login(auth.user);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await youtube.loginStatus(auth.user)).toEqual({ state: "connected" });
    resolveMatcher({
      byMbid: new Map(),
      byKey: new Map([
        [matchKey(rawSong.title, rawSong.artists[0]?.name ?? ""), { id: "local-song", title: rawSong.title }],
      ]),
    });

    await expect(importPlaylist).rejects.toMatchObject({ status: 409 });
    expect(upsertPlaylist).not.toHaveBeenCalled();
  });
});

describe("YouTube Music streaming", () => {
  const streamRequest = (range?: string) =>
    new Request("http://needle.test/youtube-music/stream/abcdefghijk", { headers: range ? { range } : {} });
  const resolution = () => ({
    url: `https://rr1.googlevideo.com/videoplayback?expire=${Math.floor(Date.now() / 1000) + 3600}`,
    ext: "m4a",
    codec: "mp4a.40.2",
  });

  it("proxies AAC byte ranges with private no-store and never gives the resolver account credentials", async () => {
    const db = database();
    seed(db);
    const bridge = vi.fn((_request: YouTubeMusicBridgeRequest) => Promise.resolve(resolution()));
    const youtube = client(bridge, db);
    providerFetch((_url, init) => {
      expect(new Headers(init?.headers).get("range")).toBe("bytes=2-5");
      expect(init?.redirect).toBe("error");

      return new Response("cdef", {
        status: 206,
        headers: {
          "content-type": "audio/mp4",
          "content-range": "bytes 2-5/6",
          "content-length": "4",
          "accept-ranges": "bytes",
        },
      });
    });

    const response = await youtube.stream(auth.user, VIDEO, streamRequest("bytes=2-5"));

    expect(response.status).toBe(206);
    expect(response.headers.get("content-type")).toBe("audio/mp4");
    expect(response.headers.get("content-range")).toBe("bytes 2-5/6");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.text()).toBe("cdef");
    expect(bridge.mock.calls[0]?.[0]).toEqual({
      operation: "resolve",
      parameters: { id: VIDEO },
      node: process.execPath,
    });
  });

  it("rejects unsafe CDN destinations, unsupported formats and invalid ranges before fetching", async () => {
    const db = database();
    seed(db);
    const fetchMock = providerFetch(() => new Response("must not reach"));

    for (const url of [
      "http://rr1.googlevideo.com/audio",
      "https://evilgooglevideo.com/audio",
      "https://rr1.googlevideo.com.evil.test/audio",
      "https://user:password@rr1.googlevideo.com/audio",
      "https://127.0.0.1/audio",
      "https://rr1.googlevideo.com:444/audio",
    ]) {
      const youtube = client(() => Promise.resolve({ ...resolution(), url }), db);

      await expect(youtube.stream(auth.user, VIDEO, streamRequest())).rejects.toMatchObject({ status: 502 });
    }

    const youtube = client(() => Promise.resolve({ ...resolution(), ext: "mp4", codec: "none" }), db);
    await expect(youtube.stream(auth.user, VIDEO, streamRequest())).rejects.toMatchObject({ status: 502 });
    await expect(youtube.stream(auth.user, VIDEO, streamRequest("bytes=0-2,4-6"))).rejects.toMatchObject({
      status: 400,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resolves an expired URL exactly once and caches the replacement", async () => {
    const db = database();
    seed(db);
    const bridge = vi.fn(() => Promise.resolve(resolution()));
    const youtube = client(bridge, db);
    let requests = 0;
    providerFetch(() => {
      requests += 1;

      return requests === 1
        ? new Response("Expired", { status: 403 })
        : new Response("aac", { headers: { "content-type": "audio/mp4" } });
    });

    expect(await (await youtube.stream(auth.user, VIDEO, streamRequest())).text()).toBe("aac");
    expect(await (await youtube.stream(auth.user, VIDEO, streamRequest())).text()).toBe("aac");
    expect(bridge).toHaveBeenCalledTimes(2);
  });

  it("forwards a bodyless unsatisfiable CDN range response", async () => {
    const db = database();
    seed(db);
    const youtube = client(() => Promise.resolve(resolution()), db);
    providerFetch(() => new Response(null, { status: 416, headers: { "content-range": "bytes */1234" } }));

    const response = await youtube.stream(auth.user, VIDEO, streamRequest("bytes=9999-"));

    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe("bytes */1234");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.text()).toBe("");
  });

  it("drops the Content-Length of a discarded CDN range error body", async () => {
    const db = database();
    seed(db);
    const youtube = client(() => Promise.resolve(resolution()), db);
    providerFetch(
      () => new Response("error", { status: 416, headers: { "content-range": "bytes */1234", "content-length": "5" } }),
    );

    const response = await youtube.stream(auth.user, VIDEO, streamRequest("bytes=9999-"));

    expect(response.status).toBe(416);
    expect(response.headers.get("content-length")).toBeNull();
    expect(await response.text()).toBe("");
  });

  it("caches exhausted CDN retries so an unavailable song cannot repeatedly spawn the resolver", async () => {
    const db = database();
    seed(db);
    const bridge = vi.fn(() => Promise.resolve(resolution()));
    const youtube = client(bridge, db);
    const fetchMock = providerFetch(() => new Response("Forbidden", { status: 403 }));

    await expect(youtube.stream(auth.user, VIDEO, streamRequest())).rejects.toMatchObject({
      code: "playback_unavailable",
    });
    await expect(youtube.stream(auth.user, VIDEO, streamRequest())).rejects.toMatchObject({
      code: "playback_unavailable",
    });
    expect(bridge).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("caches resolution failures so repeated player attempts cannot create a resolver storm", async () => {
    const db = database();
    seed(db);
    const bridge = vi.fn(() => Promise.reject(new YouTubeMusicError(502, "Upstream changed")));
    const youtube = client(bridge, db);

    await expect(youtube.stream(auth.user, VIDEO, streamRequest())).rejects.toMatchObject({
      code: "playback_unavailable",
    });
    await expect(youtube.stream(auth.user, VIDEO, streamRequest())).rejects.toMatchObject({
      code: "playback_unavailable",
    });
    expect(bridge).toHaveBeenCalledTimes(1);
  });

  it("rejects an HTML upstream body and suppresses repeated requests for that failed audio", async () => {
    const db = database();
    seed(db);
    const bridge = vi.fn(() => Promise.resolve(resolution()));
    const youtube = client(bridge, db);
    const fetchMock = providerFetch(
      () => new Response("<html>Provider error</html>", { headers: { "content-type": "text/html" } }),
    );

    await expect(youtube.stream(auth.user, VIDEO, streamRequest())).rejects.toMatchObject({
      code: "playback_unavailable",
    });
    await expect(youtube.stream(auth.user, VIDEO, streamRequest())).rejects.toMatchObject({
      code: "playback_unavailable",
    });
    expect(bridge).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("aborts active stream requests when switched off and rejects subsequent requests before resolution", async () => {
    const db = database();
    seed(db);
    const bridge = vi.fn(() => Promise.resolve(resolution()));
    const youtube = client(bridge, db);
    let fetchSignal: AbortSignal | null | undefined;
    providerFetch((_url, init) => {
      fetchSignal = init?.signal;

      return new Response("aac", { headers: { "content-type": "audio/mp4" } });
    });

    const response = await youtube.stream(auth.user, VIDEO, streamRequest());
    youtube.setEnabled(auth.user, false);

    expect(fetchSignal?.aborted).toBe(true);
    await response.body?.cancel();
    await expect(youtube.stream(auth.user, VIDEO, streamRequest())).rejects.toMatchObject({
      status: 409,
      code: "disabled",
    });
    expect(bridge).toHaveBeenCalledTimes(1);
  });
});

describe("YouTube Music permissions and routes", () => {
  it("migrates existing permissions without revoking admins and keeps grants independent", () => {
    const db = database();
    db.prepare("INSERT INTO permissions (user, can_request, can_spotify) VALUES ('alex', 1, 1)").run();
    const people = new People(db);

    expect(people.allowed("alex", true, "youtubeMusic")).toBe(true);
    expect(people.allowed("sam", false, "youtubeMusic")).toBe(false);
    people.set("sam", { canYouTubeMusic: true });
    expect(people.allowed("sam", false, "youtubeMusic")).toBe(true);
    expect(people.allowed("sam", false, "spotify")).toBe(false);
    expect(people.allowed("sam", false, "request")).toBe(false);
  });

  it("guards every provider route, validates mutations and preserves Navidrome sign-in for provider errors", async () => {
    const db = database();
    seed(db);
    providerFetch((url, init) => {
      const user = init?.body instanceof URLSearchParams ? init.body.get("u") : "";

      return Response.json({
        "subsonic-response": {
          status: "ok",
          user: { adminRole: user === "alex" },
          ...(url.pathname.endsWith("ping") ? {} : {}),
        },
      });
    });
    vi.spyOn(YouTubeMusic.prototype, "account").mockRejectedValue(
      new YouTubeMusicError(409, "Reconnect YouTube Music in Settings", "auth_reconnect"),
    );
    const app = createApp(
      loadConfig({
        youtubeMusic: { clientId: "client", clientSecret: "secret", python: "missing-python" },
        navidromeUrl: "http://navidrome.test",
        dataDir: ":memory:",
        webDist: "/nonexistent",
      }),
      db,
    ).app;

    expect((await app.request("/api/youtube-music/account")).status).toBe(401);
    expect(
      (await app.request("/api/youtube-music/account", { headers: { ...headers, "x-needle-user": "sam" } })).status,
    ).toBe(403);
    const response = await app.request("/api/youtube-music/account", { headers });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "auth_reconnect" });
    expect(
      (
        await app.request("/api/youtube-music/enabled", {
          method: "PUT",
          headers,
          body: JSON.stringify({ on: "false" }),
        })
      ).status,
    ).toBe(400);
    expect((await app.request("/api/youtube-music/liked?limit=90000", { headers })).status).toBe(400);
    expect((await app.request(`/youtube-music/stream/${VIDEO}?u=sam&t=token&s=salt`)).status).toBe(403);
    expect((await app.request("/api/youtube-music", { method: "DELETE", headers })).status).toBe(204);
    expect(db.prepare("SELECT * FROM youtube_music_tokens WHERE user = 'alex'").get()).toBeUndefined();
  });

  it("reports a missing Python executable as a sanitized runtime problem", async () => {
    const db = database();
    const navidrome = new Navidrome("http://navidrome.test");
    const youtube = new YouTubeMusic({
      clientId: "client",
      clientSecret: "secret",
      python: "/nonexistent/python",
      db,
      navidrome,
      library: new LibrarySearch(navidrome),
    });

    await expect(youtube.health("metadata")).rejects.toMatchObject({ status: 503, code: "runtime_missing" });
  });
});
