import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpTrack } from "../src/features/spotify/api/client.ts";

vi.mock("../src/lib/api.ts", () => ({
  api: {
    spotifyToken: () =>
      Promise.resolve({
        accessToken: "test-token",
        expiresAt: Date.now() + 3_600_000,
      }),
  },
}));

const spotifyTrack = (trackId: string, artistId = "artist-1"): SpTrack => ({
  id: trackId,
  uri: `spotify:track:${trackId}`,
  name: `Track ${trackId}`,
  duration_ms: 180_000,
  artists: [{ id: artistId, name: "Glass Harbor" }],
  album: {
    id: "album-1",
    name: "Tidal Lines",
    images: [],
    release_date: "2024-03-15",
  },
});

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => undefined,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Spotify search pagination", () => {
  it("requests one category page with cancellation and preserves release dates", async () => {
    const requestedUrls: URL[] = [];
    const controller = new AbortController();

    vi.stubGlobal("fetch", (input: string, request?: RequestInit) => {
      requestedUrls.push(new URL(input));
      expect(request?.signal).toBe(controller.signal);

      return Promise.resolve(
        Response.json({
          tracks: {
            items: [spotifyTrack("11")],
            next: null,
            total: 11,
            offset: 10,
            limit: 10,
          },
        }),
      );
    });

    const { sp, spotifySearchResults } = await import("../src/features/spotify/api/client.ts");
    const searchResults = spotifySearchResults(
      await sp.search("harbor", controller.signal, {
        type: "track",
        offset: 10,
      }),
      10,
    );

    expect(requestedUrls).toHaveLength(1);
    expect(requestedUrls[0]?.searchParams.get("type")).toBe("track");
    expect(requestedUrls[0]?.searchParams.get("limit")).toBe("10");
    expect(requestedUrls[0]?.searchParams.get("offset")).toBe("10");
    expect(searchResults.songs[0]).toMatchObject({
      id: "sp:11",
      year: 2024,
      releaseDate: "2024-03-15",
    });
    expect(searchResults.pagination.songs).toEqual({
      next: null,
      total: 11,
      offset: 10,
      limit: 10,
    });
  });

  it("appends overlapping pages in provider order and stops at Spotify's search ceiling", async () => {
    const { uniqueSpotifyItems, nextSpotifySearchOffset } = await import("../src/features/spotify/api/client.ts");
    const firstPage = [spotifyTrack("3"), spotifyTrack("1")];
    const secondPage = [spotifyTrack("1"), spotifyTrack("2")];

    expect(uniqueSpotifyItems([...firstPage, ...secondPage]).map((track) => track.id)).toEqual(["3", "1", "2"]);
    expect(
      nextSpotifySearchOffset({
        next: "https://api.spotify.com/v1/search?offset=10",
        total: 1100,
        offset: 0,
        limit: 10,
      }),
    ).toBe(10);
    expect(
      nextSpotifySearchOffset({
        next: "https://api.spotify.com/v1/search?offset=1000",
        total: 1100,
        offset: 990,
        limit: 10,
      }),
    ).toBe(1000);
    expect(
      nextSpotifySearchOffset({
        next: "https://api.spotify.com/v1/search?offset=1010",
        total: 1100,
        offset: 1000,
        limit: 10,
      }),
    ).toBeUndefined();
    expect(nextSpotifySearchOffset({ next: null, total: 10, offset: 0, limit: 10 })).toBeUndefined();
  });

  it("filters artist song results by artist id while retaining page metadata", async () => {
    const requestedUrls: URL[] = [];

    vi.stubGlobal("fetch", (input: string) => {
      requestedUrls.push(new URL(input));

      return Promise.resolve(
        Response.json({
          tracks: {
            items: [spotifyTrack("1"), spotifyTrack("2", "namesake")],
            next: "https://api.spotify.com/v1/search?offset=10",
            total: 20,
            offset: 0,
            limit: 10,
          },
        }),
      );
    });

    const { sp } = await import("../src/features/spotify/api/client.ts");
    const artistSongs = await sp.artistSongs("artist-1", "Glass Harbor");

    expect(artistSongs.items.map((song) => song.id)).toEqual(["sp:1"]);
    expect(artistSongs).toMatchObject({ total: 20, offset: 0, limit: 10 });
    expect(requestedUrls[0]?.searchParams.get("q")).toBe('artist:"Glass Harbor"');
    expect(requestedUrls[0]?.searchParams.get("type")).toBe("track");
  });
});

describe("Spotify account isolation", () => {
  it("rejects a token request that finishes after an account reset", async () => {
    const { api } = await import("../src/lib/api.ts");
    let resolveAliceToken: (token: { accessToken: string; expiresAt: number }) => void = () => undefined;
    const aliceToken = new Promise<{ accessToken: string; expiresAt: number }>((resolve) => {
      resolveAliceToken = resolve;
    });
    vi.spyOn(api, "spotifyToken")
      .mockImplementationOnce(() => aliceToken)
      .mockResolvedValueOnce({ accessToken: "bob-token", expiresAt: Date.now() + 3_600_000 });

    const spotify = await import("../src/features/spotify/api/client.ts");
    const pendingAliceToken = spotify.spotifyToken();
    spotify.clearSpotifyClient();
    resolveAliceToken({ accessToken: "alice-token", expiresAt: Date.now() + 3_600_000 });

    await expect(pendingAliceToken).rejects.toMatchObject({ status: 401 });
    await expect(spotify.spotifyToken()).resolves.toBe("bob-token");
  });
});

describe("Spotify cooldown", () => {
  const start = new Date("2026-10-02T10:00:00Z").getTime();
  let storage: Map<string, string>;
  const limited = (retryAfter?: string) =>
    Response.json(
      { error: { message: "Too many requests" } },
      {
        status: 429,
        headers: retryAfter === undefined ? {} : { "retry-after": retryAfter },
      },
    );

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(start);
    storage = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("honors a long Retry-After and resumes only when it expires", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(limited("58577"))
      .mockResolvedValue(Response.json({ id: "me" }));
    vi.stubGlobal("fetch", fetch);
    const { activateSpotifyAccount, sp, useSpotifyStatus } = await import("../src/features/spotify/api/client.ts");
    activateSpotifyAccount("Alice");
    await expect(sp.me()).rejects.toMatchObject({ status: 429 });
    expect(useSpotifyStatus.getState()).toEqual({
      blocked: true,
      until: start + 58_577_000,
    });
    await expect(sp.artist("artist")).rejects.toMatchObject({ status: 429 });
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(58_576_999);
    expect(useSpotifyStatus.getState().blocked).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(useSpotifyStatus.getState().blocked).toBe(false);
    expect(storage.has("needle.spotifyBlockedUntil.Alice")).toBe(false);
    await expect(sp.me()).resolves.toEqual({ id: "me" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([undefined, "", "invalid", "-1"])("uses the fallback for unreadable Retry-After %s", async (header) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(limited(header)));
    const { activateSpotifyAccount, sp, useSpotifyStatus } = await import("../src/features/spotify/api/client.ts");
    activateSpotifyAccount("Alice");
    await expect(sp.me()).rejects.toMatchObject({ status: 429 });
    expect(useSpotifyStatus.getState().until).toBe(start + 3_600_000);
  });

  it("loads the active account cooldown while removing the unowned legacy key", async () => {
    storage.set("needle.spotifyBlockedUntil", String(start + 120_000));
    storage.set("needle.spotifyBlockedUntil.Alice", String(start + 60_000));
    const fetch = vi.fn().mockResolvedValue(Response.json({ id: "me" }));
    vi.stubGlobal("fetch", fetch);
    const { activateSpotifyAccount, sp, useSpotifyStatus } = await import("../src/features/spotify/api/client.ts");
    activateSpotifyAccount("Alice");
    await expect(sp.me()).rejects.toMatchObject({ status: 429 });
    expect(fetch).not.toHaveBeenCalled();
    expect(storage.has("needle.spotifyBlockedUntil")).toBe(false);
    expect(storage.get("needle.spotifyBlockedUntil.Alice")).toBe(String(start + 60_000));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(useSpotifyStatus.getState().blocked).toBe(false);
    await sp.me();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("loads only the selected account cooldown", async () => {
    storage.set("needle.spotifyBlockedUntil.Alice", String(start + 60_000));
    storage.set("needle.spotifyBlockedUntil.Bob", String(start + 90_000));
    const { activateSpotifyAccount, useSpotifyStatus } = await import("../src/features/spotify/api/client.ts");

    activateSpotifyAccount("Alice");
    expect(useSpotifyStatus.getState()).toEqual({ blocked: true, until: start + 60_000 });

    activateSpotifyAccount("Bob");
    expect(useSpotifyStatus.getState()).toEqual({ blocked: true, until: start + 90_000 });
    expect(storage.get("needle.spotifyBlockedUntil.Alice")).toBe(String(start + 60_000));
  });

  it("pauses after a token request failure without calling Spotify", async () => {
    const { api } = await import("../src/lib/api.ts");
    vi.spyOn(api, "spotifyToken").mockRejectedValueOnce(new Error("Needle unavailable"));
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { activateSpotifyAccount, sp, useSpotifyStatus } = await import("../src/features/spotify/api/client.ts");
    activateSpotifyAccount("Alice");
    await expect(sp.me()).rejects.toThrow("Needle unavailable");
    expect(fetch).not.toHaveBeenCalled();
    expect(useSpotifyStatus.getState().until).toBe(start + 300_000);
  });

  it("does not shorten a cooldown when another in-flight request fails", async () => {
    const responses: ((response: Response) => void)[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((resolve) => responses.push(resolve))),
    );
    const { activateSpotifyAccount, sp, useSpotifyStatus } = await import("../src/features/spotify/api/client.ts");
    activateSpotifyAccount("Alice");
    const pending = Promise.allSettled([sp.me(), sp.artist("artist")]);
    await vi.advanceTimersByTimeAsync(0);
    expect(responses).toHaveLength(2);
    responses[0]?.(limited("58577"));
    await vi.advanceTimersByTimeAsync(0);
    responses[1]?.(limited("300"));
    await pending;
    expect(useSpotifyStatus.getState().until).toBe(start + 58_577_000);
    expect(storage.get("needle.spotifyBlockedUntil.Alice")).toBe(String(start + 58_577_000));
  });

  it("does not persist a late cooldown response after switching accounts", async () => {
    let resolveAliceResponse: (response: Response) => void = () => undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveAliceResponse = resolve;
          }),
      ),
    );
    const { activateSpotifyAccount, clearSpotifyClient, sp, useSpotifyStatus } =
      await import("../src/features/spotify/api/client.ts");
    activateSpotifyAccount("Alice");
    const aliceRequest = sp.me();
    await vi.advanceTimersByTimeAsync(0);

    clearSpotifyClient();
    activateSpotifyAccount("Bob");
    resolveAliceResponse(limited("300"));

    await expect(aliceRequest).rejects.toMatchObject({ status: 401 });
    expect(useSpotifyStatus.getState()).toEqual({ blocked: false, until: 0 });
    expect(storage.has("needle.spotifyBlockedUntil.Alice")).toBe(false);
    expect(storage.has("needle.spotifyBlockedUntil.Bob")).toBe(false);
  });

  it("retries a short limit once without issuing requests during the wait", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(limited("2"))
      .mockResolvedValue(Response.json({ id: "me" }));
    vi.stubGlobal("fetch", fetch);
    const { activateSpotifyAccount, sp, useSpotifyStatus } = await import("../src/features/spotify/api/client.ts");
    activateSpotifyAccount("Alice");
    const result = sp.me();
    await vi.advanceTimersByTimeAsync(0);
    expect(useSpotifyStatus.getState().blocked).toBe(true);
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toEqual({ id: "me" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not overflow the browser timer for waits longer than 24 days", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(limited("3000000")));
    const { activateSpotifyAccount, sp, useSpotifyStatus } = await import("../src/features/spotify/api/client.ts");
    activateSpotifyAccount("Alice");
    await expect(sp.me()).rejects.toMatchObject({ status: 429 });
    await vi.advanceTimersByTimeAsync(2_147_483_647);
    expect(useSpotifyStatus.getState().blocked).toBe(true);
    await vi.advanceTimersByTimeAsync(3_000_000_000 - 2_147_483_647);
    expect(useSpotifyStatus.getState().blocked).toBe(false);
  });
});
