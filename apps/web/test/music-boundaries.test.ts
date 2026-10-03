import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Song } from "@needle/shared";

const { idbPut, subsonicUrl } = vi.hoisted(() => ({
  idbPut: vi.fn(),
  subsonicUrl: vi.fn(() => "/subsonic/stream"),
}));

vi.mock("../src/offline/idb.ts", () => ({
  idbPut,
  idbAll: vi.fn(),
  idbDelete: vi.fn(),
  idbGet: vi.fn(),
}));

vi.mock("../src/lib/subsonic.ts", () => ({ sub: {}, subsonicUrl }));

vi.mock("../src/state/settings.ts", () => ({
  settings: () => ({ downloadQuality: "original" }),
}));

vi.mock("../src/features/spotify/api/client.ts", () => ({
  isSpotify: (id: string | undefined) => Boolean(id?.startsWith("sp:")),
  rawId: (id: string) => id.replace(/^sp:/, ""),
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  vi.stubGlobal("window", { caches: {}, isSecureContext: true, indexedDB: {} });
});

afterEach(() => vi.unstubAllGlobals());

describe("music source boundaries", () => {
  it("routes album and artist identifiers to their own provider pages", async () => {
    const { albumPath, artistPath } = await import("../src/lib/paths.ts");

    expect(albumPath("ytm:album-1")).toBe("/youtube-music/album/album-1");
    expect(artistPath("ytm:artist-1")).toBe("/youtube-music/artist/artist-1");
    expect(albumPath("sp:album-1")).toBe("/spotify/album/album-1");
    expect(artistPath("artist-1")).toBe("/artist/artist-1");
  });

  it("rejects a mixed download before storing any collection metadata", async () => {
    const { download } = await import("../src/offline/store.ts");
    const songs: Song[] = [
      { id: "local-1", title: "Local" },
      { id: "ytm:video-1", title: "Remote" },
    ];

    await expect(
      download(
        { id: "collection", kind: "playlist", name: "Queue", subtitle: "" },
        songs,
      ),
    ).rejects.toThrow("Only songs in your library can be downloaded");
    expect(idbPut).not.toHaveBeenCalled();
    expect(subsonicUrl).not.toHaveBeenCalled();
  });

  it("never looks up remote audio in the offline cache", async () => {
    const cacheOpen = vi.fn();
    vi.stubGlobal("caches", { open: cacheOpen });

    const { offlineSource, useOffline } =
      await import("../src/offline/store.ts");
    useOffline.setState({ songs: new Map([["ytm:video-1", 20]]) });

    expect(await offlineSource("ytm:video-1")).toBeNull();
    expect(cacheOpen).not.toHaveBeenCalled();
  });
});
