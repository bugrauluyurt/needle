import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpTrack } from "../src/lib/spotify.ts";

vi.mock("../src/lib/api.ts", () => ({
  api: { spotifyToken: () => Promise.resolve({ accessToken: "test-token", expiresAt: Date.now() + 3_600_000 }) },
}));

const spotifyTrack = (trackId: string, artistId = "artist-1"): SpTrack => ({
  id: trackId,
  uri: `spotify:track:${trackId}`,
  name: `Track ${trackId}`,
  duration_ms: 180_000,
  artists: [{ id: artistId, name: "Glass Harbor" }],
  album: { id: "album-1", name: "Tidal Lines", images: [], release_date: "2024-03-15" },
});

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => undefined });
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

      return Promise.resolve(Response.json({ tracks: { items: [spotifyTrack("11")], next: null, total: 11, offset: 10, limit: 10 } }));
    });

    const { sp, spotifySearchResults } = await import("../src/lib/spotify.ts");
    const searchResults = spotifySearchResults(await sp.search("harbor", controller.signal, { type: "track", offset: 10 }), 10);

    expect(requestedUrls).toHaveLength(1);
    expect(requestedUrls[0]?.searchParams.get("type")).toBe("track");
    expect(requestedUrls[0]?.searchParams.get("limit")).toBe("10");
    expect(requestedUrls[0]?.searchParams.get("offset")).toBe("10");
    expect(searchResults.songs[0]).toMatchObject({ id: "sp:11", year: 2024, releaseDate: "2024-03-15" });
    expect(searchResults.pagination.songs).toEqual({ next: null, total: 11, offset: 10, limit: 10 });
  });

  it("appends overlapping pages in provider order and stops at Spotify's search ceiling", async () => {
    const { uniqueSpotifyItems, nextSpotifySearchOffset } = await import("../src/lib/spotify.ts");
    const firstPage = [spotifyTrack("3"), spotifyTrack("1")];
    const secondPage = [spotifyTrack("1"), spotifyTrack("2")];

    expect(uniqueSpotifyItems([...firstPage, ...secondPage]).map((track) => track.id)).toEqual(["3", "1", "2"]);
    expect(nextSpotifySearchOffset({ next: "https://api.spotify.com/v1/search?offset=10", total: 1100, offset: 0, limit: 10 })).toBe(10);
    expect(nextSpotifySearchOffset({ next: "https://api.spotify.com/v1/search?offset=1000", total: 1100, offset: 990, limit: 10 })).toBe(1000);
    expect(nextSpotifySearchOffset({ next: "https://api.spotify.com/v1/search?offset=1010", total: 1100, offset: 1000, limit: 10 })).toBeUndefined();
    expect(nextSpotifySearchOffset({ next: null, total: 10, offset: 0, limit: 10 })).toBeUndefined();
  });

  it("filters artist song results by artist id while retaining page metadata", async () => {
    const requestedUrls: URL[] = [];

    vi.stubGlobal("fetch", (input: string) => {
      requestedUrls.push(new URL(input));

      return Promise.resolve(Response.json({ tracks: { items: [spotifyTrack("1"), spotifyTrack("2", "namesake")], next: "https://api.spotify.com/v1/search?offset=10", total: 20, offset: 0, limit: 10 } }));
    });

    const { sp } = await import("../src/lib/spotify.ts");
    const artistSongs = await sp.artistSongs("artist-1", "Glass Harbor");

    expect(artistSongs.items.map((song) => song.id)).toEqual(["sp:1"]);
    expect(artistSongs).toMatchObject({ total: 20, offset: 0, limit: 10 });
    expect(requestedUrls[0]?.searchParams.get("q")).toBe('artist:"Glass Harbor"');
    expect(requestedUrls[0]?.searchParams.get("type")).toBe("track");
  });
});
