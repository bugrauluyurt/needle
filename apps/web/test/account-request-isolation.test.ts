import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MemoryStorage = Storage & { values: Map<string, string> };

type Deferred<Value> = {
  promise: Promise<Value>;
  resolve: (value: Value) => void;
};

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

function deferred<Value>(): Deferred<Value> {
  let resolvePromise: (value: Value) => void = () => undefined;
  const promise = new Promise<Value>((resolve) => {
    resolvePromise = resolve;
  });

  return { promise, resolve: resolvePromise };
}

function authFailureResponse(): Response {
  return new Response(
    JSON.stringify({
      "subsonic-response": {
        status: "failed",
        error: { code: 40, message: "Wrong username or password" },
      },
    }),
    { headers: { "content-type": "application/json" }, status: 200 },
  );
}

function httpAuthFailureResponse(): Response {
  return new Response(null, { status: 401 });
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Subsonic account isolation", () => {
  it("does not let a delayed auth failure sign out a newer account", async () => {
    const localStorage = memoryStorage();
    const sessionStorage = memoryStorage();
    const aliceResponse = deferred<Response>();
    vi.stubGlobal("localStorage", localStorage);
    vi.stubGlobal("sessionStorage", sessionStorage);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => aliceResponse.promise),
    );

    const { call } = await import("../src/lib/subsonic.ts");
    const { useSession } = await import("../src/state/session.ts");
    const aliceCredentials = { user: "Alice", token: "alice-token", salt: "alice-salt" };
    const bobCredentials = { user: "Bob", token: "bob-token", salt: "bob-salt" };

    useSession.getState().signIn(aliceCredentials);
    const aliceRequest = call("ping");

    useSession.getState().signIn(bobCredentials);
    aliceResponse.resolve(httpAuthFailureResponse());

    await expect(aliceRequest).rejects.toMatchObject({ code: 401 });
    expect(useSession.getState().credentials).toEqual(bobCredentials);
  });

  it("does not let an implicit request sign out refreshed credentials for the same user", async () => {
    const localStorage = memoryStorage();
    const sessionStorage = memoryStorage();
    const originalCredentialsResponse = deferred<Response>();
    vi.stubGlobal("localStorage", localStorage);
    vi.stubGlobal("sessionStorage", sessionStorage);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => originalCredentialsResponse.promise),
    );

    const { call } = await import("../src/lib/subsonic.ts");
    const { useSession } = await import("../src/state/session.ts");
    const originalCredentials = { user: "Alice", token: "original-token", salt: "original-salt" };
    const refreshedCredentials = { user: "Alice", token: "refreshed-token", salt: "refreshed-salt" };

    useSession.getState().signIn(originalCredentials);
    const originalCredentialsRequest = call("ping");

    useSession.getState().signIn(refreshedCredentials);
    originalCredentialsResponse.resolve(authFailureResponse());

    await expect(originalCredentialsRequest).rejects.toMatchObject({ code: 40 });
    expect(useSession.getState().credentials).toEqual(refreshedCredentials);
  });

  it("signs out only when implicit or explicit request credentials are still active", async () => {
    const localStorage = memoryStorage();
    const sessionStorage = memoryStorage();
    vi.stubGlobal("localStorage", localStorage);
    vi.stubGlobal("sessionStorage", sessionStorage);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(authFailureResponse())),
    );

    const { call } = await import("../src/lib/subsonic.ts");
    const { useSession } = await import("../src/state/session.ts");
    const aliceCredentials = { user: "Alice", token: "alice-token", salt: "alice-salt" };
    const refreshedAliceCredentials = { user: "Alice", token: "refreshed-token", salt: "refreshed-salt" };

    useSession.getState().signIn(aliceCredentials);
    await expect(call("ping", {}, aliceCredentials)).rejects.toMatchObject({ code: 40 });
    expect(useSession.getState().credentials).toBeNull();

    useSession.getState().signIn(aliceCredentials);
    useSession.getState().signIn(refreshedAliceCredentials);
    await expect(call("ping", {}, aliceCredentials)).rejects.toMatchObject({ code: 40 });
    expect(useSession.getState().credentials).toEqual(refreshedAliceCredentials);

    await expect(call("ping")).rejects.toMatchObject({ code: 40 });
    expect(useSession.getState().credentials).toBeNull();

    useSession.getState().signIn(refreshedAliceCredentials);
    vi.mocked(fetch).mockResolvedValueOnce(httpAuthFailureResponse());
    await expect(call("ping")).rejects.toMatchObject({ code: 401 });
    expect(useSession.getState().credentials).toBeNull();
  });
});

describe("recent search account isolation", () => {
  it("keeps exact account namespaces across stale writes and sign-out", async () => {
    const localStorage = memoryStorage({ "needle.recentSearches": JSON.stringify(["Legacy private search"]) });
    vi.stubGlobal("localStorage", localStorage);

    const { clearRecentSearches, recentSearchesForAccount, rememberRecentSearch, removeRecentSearch } =
      await import("../src/features/search/services/recentSearches.ts");

    expect(recentSearchesForAccount("Bob")).toEqual([]);
    expect(localStorage.getItem("needle.recentSearches")).toBeNull();

    rememberRecentSearch("Alice/Exact", "Alice only");
    const lateAliceWrite = () => rememberRecentSearch("Alice/Exact", "Late Alice search");

    rememberRecentSearch("Bob", "Bob only");
    lateAliceWrite();

    expect(recentSearchesForAccount("Bob")).toEqual(["Bob only"]);
    expect(recentSearchesForAccount("Alice/Exact")).toEqual(["Late Alice search", "Alice only"]);
    expect(recentSearchesForAccount(null)).toEqual([]);
    expect(localStorage.getItem("needle.recentSearches:Alice%2FExact")).toContain("Late Alice search");
    expect(localStorage.getItem("needle.recentSearches:Bob")).not.toContain("Alice");

    removeRecentSearch("Alice/Exact", "Alice only");
    clearRecentSearches("Bob");

    expect(recentSearchesForAccount("Alice/Exact")).toEqual(["Late Alice search"]);
    expect(recentSearchesForAccount("Bob")).toEqual([]);
  });
});
