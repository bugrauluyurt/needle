import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OfflineCollection } from "../src/offline/store.ts";

type MemoryStorage = Storage & { values: Map<string, string> };

const offlineMocks = vi.hoisted(() => ({
  idbAll: vi.fn(),
  idbDelete: vi.fn(),
  idbGet: vi.fn(),
  idbPut: vi.fn(),
  removeLegacyOfflineDatabase: vi.fn(() => Promise.resolve()),
  album: vi.fn(),
  playlist: vi.fn(),
  starred: vi.fn(),
}));

vi.mock("../src/offline/idb.ts", () => offlineMocks);

vi.mock("../src/lib/subsonic.ts", () => ({
  sub: {
    album: offlineMocks.album,
    playlist: offlineMocks.playlist,
    starred: offlineMocks.starred,
  },
  subsonicUrl: vi.fn(() => "/subsonic/stream"),
}));

function memoryStorage(entries: Record<string, string> = {}): MemoryStorage {
  const values = new Map(Object.entries(entries));

  return {
    values,
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (storageKey) => values.get(storageKey) ?? null,
    key: (storageIndex) => [...values.keys()][storageIndex] ?? null,
    removeItem: (storageKey) => values.delete(storageKey),
    setItem: (storageKey, storageValue) => values.set(storageKey, storageValue),
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("browser session isolation", () => {
  it("purges legacy local credentials while preserving device identity", async () => {
    const legacySession = JSON.stringify({
      state: {
        credentials: { user: "alice", token: "alice-token", salt: "alice-salt" },
        deviceId: "living-room-device",
        deviceName: "Living room",
      },
      version: 1,
    });
    const localStorage = memoryStorage({ "needle.session": legacySession });
    const sessionStorage = memoryStorage();
    vi.stubGlobal("localStorage", localStorage);
    vi.stubGlobal("sessionStorage", sessionStorage);

    const { useSession } = await import("../src/state/session.ts");

    expect(useSession.getState()).toMatchObject({
      credentials: null,
      deviceId: "living-room-device",
      deviceName: "Living room",
    });
    expect(localStorage.getItem("needle.session")).toBeNull();
    expect(localStorage.getItem("needle.device")).toContain("living-room-device");
    expect(JSON.stringify([...localStorage.values])).not.toContain("alice-token");
  });

  it("keeps credentials through a same-tab reload using session storage only", async () => {
    const localStorage = memoryStorage();
    const sessionStorage = memoryStorage();
    vi.stubGlobal("localStorage", localStorage);
    vi.stubGlobal("sessionStorage", sessionStorage);

    const firstSessionModule = await import("../src/state/session.ts");
    firstSessionModule.useSession.getState().signIn({ user: "alice", token: "alice-token", salt: "alice-salt" });

    vi.resetModules();
    const reloadedSessionModule = await import("../src/state/session.ts");

    expect(reloadedSessionModule.useSession.getState().credentials).toEqual({
      user: "alice",
      token: "alice-token",
      salt: "alice-salt",
    });
    expect(sessionStorage.getItem("needle.session")).toContain("alice-token");
    expect(JSON.stringify([...localStorage.values])).not.toContain("alice-token");
  });

  it("resets account state before sign-out or another user becomes active", async () => {
    const localStorage = memoryStorage();
    const sessionStorage = memoryStorage();
    vi.stubGlobal("localStorage", localStorage);
    vi.stubGlobal("sessionStorage", sessionStorage);

    const { useSession } = await import("../src/state/session.ts");
    const { registerAccountResetHandler } = await import("../src/state/accountLifecycle.ts");
    const usersSeenDuringReset: Array<string | null> = [];
    registerAccountResetHandler(() => usersSeenDuringReset.push(useSession.getState().credentials?.user ?? null));

    useSession.getState().signIn({ user: "Alice", token: "alice-token", salt: "alice-salt" });
    useSession.getState().signIn({ user: "Bob", token: "bob-token", salt: "bob-salt" });
    useSession.getState().signOut();

    expect(usersSeenDuringReset).toEqual([null, "Alice", "Bob"]);
    expect(useSession.getState().credentials).toBeNull();
  });
});

describe("offline account isolation", () => {
  function installBrowserStorage() {
    const localStorage = memoryStorage();
    const sessionStorage = memoryStorage();
    const cacheMatch = vi.fn();
    const cacheDelete = vi.fn(() => Promise.resolve(true));
    const cacheOpen = vi.fn(() => Promise.resolve({ match: cacheMatch, delete: cacheDelete }));
    const deleteCache = vi.fn(() => Promise.resolve(true));
    const caches = { open: cacheOpen, delete: deleteCache };

    vi.stubGlobal("localStorage", localStorage);
    vi.stubGlobal("sessionStorage", sessionStorage);
    vi.stubGlobal("caches", caches);
    vi.stubGlobal("navigator", { storage: { persist: vi.fn(() => Promise.resolve(true)) } });
    vi.stubGlobal("window", {
      caches,
      indexedDB: {},
      isSecureContext: true,
      matchMedia: () => ({ matches: false }),
    });

    return { cacheMatch, cacheOpen, deleteCache };
  }

  it("loads and removes downloads only inside the exact signed-in user namespace", async () => {
    installBrowserStorage();
    offlineMocks.idbAll.mockImplementation((accountUser: string, storeName: string) => {
      if (storeName === "songs") {
        return Promise.resolve([
          {
            id: `${accountUser}-song`,
            song: { id: `${accountUser}-song`, title: `${accountUser} song` },
            bytes: 10,
            savedAt: 1,
          },
        ]);
      }

      return Promise.resolve([
        {
          id: `${accountUser}-collection`,
          kind: "album",
          name: `${accountUser} collection`,
          subtitle: "",
          songIds: [`${accountUser}-song`],
          savedAt: 1,
        },
      ]);
    });

    const { useSession } = await import("../src/state/session.ts");
    const offline = await import("../src/offline/store.ts");

    useSession.getState().signIn({ user: "Alice", token: "alice-token", salt: "alice-salt" });
    await offline.loadOffline();
    expect([...offline.useOffline.getState().songs.keys()]).toEqual(["Alice-song"]);

    offline.resetOfflineAccount();
    useSession.getState().signIn({ user: "Bob", token: "bob-token", salt: "bob-salt" });
    await offline.loadOffline();
    expect([...offline.useOffline.getState().songs.keys()]).toEqual(["Bob-song"]);

    await offline.removeDownload("Bob-collection");
    expect(offlineMocks.idbDelete).toHaveBeenCalledWith("Bob", "songs", "Bob-song");
    expect(offlineMocks.idbDelete).toHaveBeenCalledWith("Bob", "collections", "Bob-collection");
    expect(offlineMocks.idbDelete).not.toHaveBeenCalledWith("Alice", expect.anything(), expect.anything());
  });

  it("ignores an Alice load that finishes after switching to Bob", async () => {
    installBrowserStorage();
    let resolveAliceSongs: (songs: unknown[]) => void = () => undefined;
    let resolveAliceCollections: (collections: unknown[]) => void = () => undefined;
    const aliceSongs = new Promise<unknown[]>((resolve) => {
      resolveAliceSongs = resolve;
    });
    const aliceCollections = new Promise<unknown[]>((resolve) => {
      resolveAliceCollections = resolve;
    });

    offlineMocks.idbAll.mockImplementation((accountUser: string, storeName: string) => {
      if (accountUser === "Alice") return storeName === "songs" ? aliceSongs : aliceCollections;

      return Promise.resolve(
        storeName === "songs"
          ? [{ id: "bob-song", song: { id: "bob-song", title: "Bob song" }, bytes: 20, savedAt: 2 }]
          : [],
      );
    });

    const { useSession } = await import("../src/state/session.ts");
    const offline = await import("../src/offline/store.ts");

    useSession.getState().signIn({ user: "Alice", token: "alice-token", salt: "alice-salt" });
    const aliceLoad = offline.loadOffline();

    offline.resetOfflineAccount();
    useSession.getState().signIn({ user: "Bob", token: "bob-token", salt: "bob-salt" });
    await offline.loadOffline();

    resolveAliceSongs([{ id: "alice-song", song: { id: "alice-song", title: "Alice song" }, bytes: 10, savedAt: 1 }]);
    resolveAliceCollections([]);
    await aliceLoad;

    expect([...offline.useOffline.getState().songs.keys()]).toEqual(["bob-song"]);
  });

  it("opens an account-specific cache and never the legacy global cache", async () => {
    const { cacheMatch, cacheOpen, deleteCache } = installBrowserStorage();
    cacheMatch.mockResolvedValue(new Response(new Blob(["audio"])));
    offlineMocks.idbAll.mockResolvedValue([]);

    const { useSession } = await import("../src/state/session.ts");
    const offline = await import("../src/offline/store.ts");

    useSession.getState().signIn({ user: "Alice/Exact", token: "alice-token", salt: "alice-salt" });
    await offline.loadOffline();
    offline.useOffline.setState({ songs: new Map([["song-1", 5]]) });
    await offline.offlineSource("song-1");

    expect(cacheOpen).toHaveBeenCalledWith("needle-audio:Alice%2FExact");
    expect(cacheOpen).not.toHaveBeenCalledWith("needle-audio");
    expect(deleteCache).toHaveBeenCalledWith("needle-audio");
  });

  it("does not resume an Alice collection after switching to Bob", async () => {
    installBrowserStorage();
    offlineMocks.idbAll.mockResolvedValue([]);
    let resolveAliceAlbum: (album: { song: [] }) => void = () => undefined;
    offlineMocks.album.mockImplementation(
      () =>
        new Promise<{ song: [] }>((resolve) => {
          resolveAliceAlbum = resolve;
        }),
    );

    const { useSession } = await import("../src/state/session.ts");
    const offline = await import("../src/offline/store.ts");
    const aliceCollection: OfflineCollection = {
      id: "shared-collection",
      kind: "album",
      name: "Alice collection",
      subtitle: "",
      songIds: ["alice-song"],
      savedAt: 1,
    };

    useSession.getState().signIn({ user: "Alice", token: "alice-token", salt: "alice-salt" });
    await offline.loadOffline();
    const aliceResume = offline.resumeDownload(aliceCollection);
    await vi.waitFor(() => expect(offlineMocks.album).toHaveBeenCalledWith("shared-collection"));

    offline.resetOfflineAccount();
    useSession.getState().signIn({ user: "Bob", token: "bob-token", salt: "bob-salt" });
    await offline.loadOffline();
    resolveAliceAlbum({ song: [] });
    await aliceResume;

    expect(offlineMocks.idbPut).not.toHaveBeenCalledWith(
      "Bob",
      "collections",
      expect.objectContaining({ id: "shared-collection" }),
    );
  });

  it("resumes a collection when the same account remains active", async () => {
    installBrowserStorage();
    offlineMocks.idbAll.mockResolvedValue([]);
    offlineMocks.album.mockResolvedValue({ song: [] });

    const { useSession } = await import("../src/state/session.ts");
    const offline = await import("../src/offline/store.ts");
    const aliceCollection: OfflineCollection = {
      id: "alice-collection",
      kind: "album",
      name: "Alice collection",
      subtitle: "",
      songIds: ["alice-song"],
      savedAt: 1,
    };

    useSession.getState().signIn({ user: "Alice", token: "alice-token", salt: "alice-salt" });
    await offline.loadOffline();
    await offline.resumeDownload(aliceCollection);

    expect(offlineMocks.idbPut).toHaveBeenCalledWith(
      "Alice",
      "collections",
      expect.objectContaining({ id: "alice-collection" }),
    );
  });

  it("does not continue Alice removal against Bob's same collection id", async () => {
    const { cacheOpen } = installBrowserStorage();
    const aliceCacheMatch = vi.fn();
    const deleteCachedSong = vi.fn(() => Promise.resolve(true));
    type TestCache = { match: typeof aliceCacheMatch; delete: typeof deleteCachedSong };
    let resolveAliceCache: (cache: TestCache) => void = () => undefined;
    const aliceCache = new Promise<TestCache>((resolve) => {
      resolveAliceCache = resolve;
    });
    cacheOpen.mockImplementationOnce(() => aliceCache).mockResolvedValue({ match: vi.fn(), delete: deleteCachedSong });
    offlineMocks.idbAll.mockImplementation((accountUser: string, storeName: string) => {
      if (accountUser === "Alice") {
        return Promise.resolve(
          storeName === "songs"
            ? [
                { id: "alice-first-song", song: { id: "alice-first-song", title: "First" }, bytes: 10, savedAt: 1 },
                { id: "alice-shared-song", song: { id: "alice-shared-song", title: "Shared" }, bytes: 10, savedAt: 1 },
              ]
            : [
                {
                  id: "alice-first",
                  kind: "album",
                  name: "Alice first",
                  subtitle: "",
                  songIds: ["alice-first-song"],
                  savedAt: 2,
                },
                {
                  id: "shared-collection",
                  kind: "album",
                  name: "Alice shared",
                  subtitle: "",
                  songIds: ["alice-shared-song"],
                  savedAt: 1,
                },
              ],
        );
      }

      return Promise.resolve(
        storeName === "songs"
          ? [{ id: "bob-song", song: { id: "bob-song", title: "Bob" }, bytes: 20, savedAt: 3 }]
          : [
              {
                id: "shared-collection",
                kind: "album",
                name: "Bob shared",
                subtitle: "",
                songIds: ["bob-song"],
                savedAt: 3,
              },
            ],
      );
    });

    const { useSession } = await import("../src/state/session.ts");
    const offline = await import("../src/offline/store.ts");

    useSession.getState().signIn({ user: "Alice", token: "alice-token", salt: "alice-salt" });
    await offline.loadOffline();
    const aliceRemoval = offline.removeAllDownloads();
    await vi.waitFor(() => expect(cacheOpen).toHaveBeenCalledWith("needle-audio:Alice"));

    offline.resetOfflineAccount();
    useSession.getState().signIn({ user: "Bob", token: "bob-token", salt: "bob-salt" });
    await offline.loadOffline();
    resolveAliceCache({ match: aliceCacheMatch, delete: deleteCachedSong });
    await aliceRemoval;

    expect(offlineMocks.idbDelete).not.toHaveBeenCalledWith("Bob", "songs", "bob-song");
    expect(offlineMocks.idbDelete).not.toHaveBeenCalledWith("Bob", "collections", "shared-collection");
    expect(deleteCachedSong).not.toHaveBeenCalledWith("/offline/bob-song");
  });

  it("removes every collection when the same account remains active", async () => {
    installBrowserStorage();
    offlineMocks.idbAll.mockImplementation((_accountUser: string, storeName: string) =>
      Promise.resolve(
        storeName === "songs"
          ? [
              { id: "song-1", song: { id: "song-1", title: "One" }, bytes: 10, savedAt: 1 },
              { id: "song-2", song: { id: "song-2", title: "Two" }, bytes: 20, savedAt: 1 },
            ]
          : [
              {
                id: "collection-1",
                kind: "album",
                name: "One",
                subtitle: "",
                songIds: ["song-1"],
                savedAt: 2,
              },
              {
                id: "collection-2",
                kind: "album",
                name: "Two",
                subtitle: "",
                songIds: ["song-2"],
                savedAt: 1,
              },
            ],
      ),
    );

    const { useSession } = await import("../src/state/session.ts");
    const offline = await import("../src/offline/store.ts");

    useSession.getState().signIn({ user: "Alice", token: "alice-token", salt: "alice-salt" });
    await offline.loadOffline();
    await offline.removeAllDownloads();

    expect(offlineMocks.idbDelete).toHaveBeenCalledWith("Alice", "collections", "collection-1");
    expect(offlineMocks.idbDelete).toHaveBeenCalledWith("Alice", "collections", "collection-2");
    expect(offline.useOffline.getState().collections).toEqual([]);
    expect(offline.useOffline.getState().songs.size).toBe(0);
  });
});
