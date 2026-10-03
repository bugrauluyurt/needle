import { afterEach, expect, it, vi } from "vitest";

vi.mock("../src/offline/store.ts", () => ({ loadOffline: vi.fn(), resetOfflineAccount: vi.fn() }));
vi.mock("../src/player/controller.ts", () => ({ resetPlayerAccount: vi.fn(), startPlayer: vi.fn() }));
vi.mock("../src/queries/client.ts", () => ({ queryClient: { clear: vi.fn() } }));
vi.mock("../src/queries/hooks.ts", () => ({ prefetchStart: vi.fn() }));
vi.mock("../src/features/spotify/hooks/useSpotify.ts", () => ({ clearSpotifyCache: vi.fn() }));
vi.mock("../src/features/spotify/api/client.ts", () => ({ activateSpotifyAccount: vi.fn() }));
vi.mock("../src/features/youtube-music/hooks/useYouTubeMusic.ts", () => ({ clearYouTubeMusicCache: vi.fn() }));
vi.mock("../src/features/remote/client.ts", () => ({ startRemote: vi.fn(), stopRemote: vi.fn() }));
vi.mock("../src/components/songDetailsStore.ts", () => ({ useDetails: { setState: vi.fn() } }));
vi.mock("../src/state/accountLifecycle.ts", () => ({ registerAccountResetHandler: vi.fn() }));

afterEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
});

it("removes credentialed cover requests without touching offline audio", async () => {
  const cacheEntries = new Map<string, Set<string>>([
    [
      "covers",
      new Set([
        "/rest/getCoverArt.view?id=album-1&u=Alice&t=alice-token&s=alice-salt",
        "/rest/getCoverArt.view?id=album-2&u=Alice&t=alice-token&s=alice-salt",
      ]),
    ],
    ["needle-audio:Alice", new Set(["/offline/song-1"])],
  ]);
  vi.stubGlobal("caches", {
    delete: vi.fn((cacheName: string) => Promise.resolve(cacheEntries.delete(cacheName))),
  });

  const { resetAccountRuntime } = await import("../src/app/hooks/useAppRuntime.ts");
  const coverCache = await import("../src/state/credentialedCaches.ts");
  resetAccountRuntime();
  await coverCache.credentialedCoverCacheCleared();

  expect(cacheEntries.has("covers")).toBe(false);
  expect(cacheEntries.get("needle-audio:Alice")).toEqual(new Set(["/offline/song-1"]));
  expect(JSON.stringify([...cacheEntries.values()].flatMap((cacheRequests) => [...cacheRequests]))).not.toContain(
    "alice-token",
  );
});

it("runs another deletion when a newer reset arrives during cache removal", async () => {
  const deletionResolvers: Array<() => void> = [];
  const deleteCache = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        deletionResolvers.push(() => resolve(true));
      }),
  );
  vi.stubGlobal("caches", { delete: deleteCache });

  const coverCache = await import("../src/state/credentialedCaches.ts");
  coverCache.clearCredentialedCoverCache();
  await vi.waitFor(() => expect(deleteCache).toHaveBeenCalledTimes(1));

  coverCache.clearCredentialedCoverCache();
  deletionResolvers.shift()?.();
  await vi.waitFor(() => expect(deleteCache).toHaveBeenCalledTimes(2));
  deletionResolvers.shift()?.();
  await coverCache.credentialedCoverCacheCleared();

  expect(deleteCache).toHaveBeenNthCalledWith(1, "covers");
  expect(deleteCache).toHaveBeenNthCalledWith(2, "covers");
});
