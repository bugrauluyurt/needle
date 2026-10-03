import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.ts";
import {
  InMemoryNavidromeVerifier,
  NAVIDROME_VERIFICATION_ATTEMPT_LIMIT,
  type NavidromeVerificationUpstream,
} from "../src/http/navidrome-verifier.ts";
import { SPOTIFY_OAUTH_STATE_COOKIE } from "../src/routes/spotify.ts";
import { loadConfig } from "../src/config.ts";
import { openDatabase } from "../src/db.ts";
import type { Auth } from "../src/navidrome.ts";

const validAuth: Auth = { user: "alex", token: "token", salt: "salt" };
const validHeaders = {
  "x-needle-user": validAuth.user,
  "x-needle-token": validAuth.token,
  "x-needle-salt": validAuth.salt,
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("in-memory Navidrome verification", () => {
  it("limits repeated cache-miss verifications and admits the key after expiry", async () => {
    let currentTime = 1_000;
    const upstreamVerification = vi.fn<NavidromeVerificationUpstream["verify"]>(() => Promise.resolve("denied"));
    const verifier = new InMemoryNavidromeVerifier(
      { verify: upstreamVerification },
      {
        attemptLimit: 2,
        attemptWindowMs: 1_000,
        concurrentLimit: 2,
        entryLimit: 20,
        now: () => currentTime,
      },
    );

    await expect(verifier.verify(validAuth, { clientAddress: "192.0.2.10" })).resolves.toBe("denied");
    await expect(verifier.verify({ ...validAuth, token: "second" }, { clientAddress: "192.0.2.10" })).resolves.toBe(
      "denied",
    );
    await expect(verifier.verify({ ...validAuth, token: "third" }, { clientAddress: "192.0.2.10" })).resolves.toBe(
      "limited",
    );
    expect(upstreamVerification).toHaveBeenCalledTimes(2);

    currentTime += 1_001;

    await expect(verifier.verify({ ...validAuth, token: "third" }, { clientAddress: "192.0.2.10" })).resolves.toBe(
      "denied",
    );
    expect(upstreamVerification).toHaveBeenCalledTimes(3);
  });

  it("serves valid cached credentials without consuming another attempt", async () => {
    const upstreamVerification = vi.fn<NavidromeVerificationUpstream["verify"]>(() => Promise.resolve("ok"));
    const verifier = new InMemoryNavidromeVerifier(
      { verify: upstreamVerification },
      {
        attemptLimit: 1,
        attemptWindowMs: 1_000,
        concurrentLimit: 2,
        entryLimit: 20,
        now: () => 1_000,
      },
    );

    await expect(verifier.verify(validAuth, { clientAddress: "192.0.2.10" })).resolves.toBe("ok");
    await expect(verifier.verify(validAuth, { clientAddress: "192.0.2.10" })).resolves.toBe("ok");
    await expect(verifier.verify({ ...validAuth, token: "different" }, { clientAddress: "192.0.2.10" })).resolves.toBe(
      "limited",
    );
    expect(upstreamVerification).toHaveBeenCalledTimes(1);
  });

  it("caps concurrent upstream verification globally", async () => {
    let resolveFirstVerification: ((verification: "denied") => void) | undefined;
    const firstVerification = new Promise<"denied">((resolveVerification) => {
      resolveFirstVerification = resolveVerification;
    });
    const upstreamVerification = vi.fn<NavidromeVerificationUpstream["verify"]>(() => firstVerification);
    const verifier = new InMemoryNavidromeVerifier(
      { verify: upstreamVerification },
      {
        attemptLimit: 10,
        attemptWindowMs: 1_000,
        concurrentLimit: 1,
        entryLimit: 20,
        now: () => 1_000,
      },
    );

    const pendingVerification = verifier.verify(validAuth, { clientAddress: "192.0.2.10" });

    await expect(verifier.verify({ ...validAuth, user: "sam" }, { clientAddress: "192.0.2.11" })).resolves.toBe(
      "limited",
    );
    expect(upstreamVerification).toHaveBeenCalledTimes(1);

    resolveFirstVerification?.("denied");

    await expect(pendingVerification).resolves.toBe("denied");
  });

  it("keeps attempt state bounded and evicts the oldest key", async () => {
    const upstreamVerification = vi.fn<NavidromeVerificationUpstream["verify"]>(() => Promise.resolve("denied"));
    const verifier = new InMemoryNavidromeVerifier(
      { verify: upstreamVerification },
      {
        attemptLimit: 1,
        attemptWindowMs: 10_000,
        concurrentLimit: 2,
        entryLimit: 2,
        now: () => 1_000,
      },
    );

    for (const username of ["alex", "sam", "taylor"]) {
      await expect(verifier.verify({ ...validAuth, user: username }, { clientAddress: "192.0.2.10" })).resolves.toBe(
        "denied",
      );
    }

    await expect(verifier.verify(validAuth, { clientAddress: "192.0.2.10" })).resolves.toBe("denied");
    expect(upstreamVerification).toHaveBeenCalledTimes(4);
  });
});

describe("HTTP authentication limiting", () => {
  it("returns a structured 429 before another upstream verification and ignores untrusted forwarding headers", async () => {
    let upstreamVerificationCount = 0;

    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        upstreamVerificationCount += 1;

        return Promise.resolve(
          Response.json({
            "subsonic-response": {
              status: "failed",
              error: { code: 40, message: "Wrong username or password" },
            },
          }),
        );
      }),
    );

    const app = createApp(
      loadConfig({
        navidromeUrl: "http://navidrome.test",
        dataDir: ":memory:",
        webDist: "/nonexistent",
        trustedProxy: false,
      }),
      openDatabase(":memory:"),
    ).app;

    for (let attemptIndex = 0; attemptIndex < NAVIDROME_VERIFICATION_ATTEMPT_LIMIT; attemptIndex += 1) {
      const response = await app.request("/api/stats", {
        headers: {
          ...validHeaders,
          "x-needle-token": `invalid-${attemptIndex}`,
          "x-forwarded-for": `198.51.100.${attemptIndex + 1}`,
        },
      });

      expect(response.status).toBe(401);
    }

    const limitedResponse = await app.request("/api/stats", {
      headers: {
        ...validHeaders,
        "x-needle-token": "invalid-limited",
        "x-forwarded-for": "203.0.113.9",
      },
    });

    expect(limitedResponse.status).toBe(429);
    expect(await limitedResponse.json()).toEqual({
      error: "Too many sign-in attempts. Try again later.",
      code: "RATE_LIMITED",
      requestId: limitedResponse.headers.get("x-request-id"),
    });
    expect(upstreamVerificationCount).toBe(NAVIDROME_VERIFICATION_ATTEMPT_LIMIT);
  });
});

describe("Spotify OAuth callback binding", () => {
  it("sets a short-lived callback-only browser cookie with HTTPS protections", async () => {
    const { app } = createSpotifyApp({ publicUrl: "https://needle.example" });
    const loginResponse = await app.request("/api/spotify/login", { headers: validHeaders });
    const authorization = (await loginResponse.json()) as { url: string };
    const state = new URL(authorization.url).searchParams.get("state");
    const stateCookie = loginResponse.headers.get("set-cookie");

    expect(state).toBeTruthy();
    expect(stateCookie).toContain(`${SPOTIFY_OAUTH_STATE_COOKIE}=${state}`);
    expect(stateCookie).toContain("HttpOnly");
    expect(stateCookie).toContain("Max-Age=600");
    expect(stateCookie).toContain("Path=/api/spotify/callback");
    expect(stateCookie).toContain("SameSite=Lax");
    expect(stateCookie).toContain("Secure");
  });

  it("does not mark a local HTTP callback cookie secure", async () => {
    const { app } = createSpotifyApp({ publicUrl: "http://127.0.0.1:4535" });
    const loginResponse = await app.request("/api/spotify/login", { headers: validHeaders });
    const stateCookie = loginResponse.headers.get("set-cookie");

    expect(stateCookie).not.toContain("Secure");
  });

  it("rejects a state from another browser before exchange, then accepts the owning browser and user", async () => {
    const { app, database, getSpotifyExchangeCount } = createSpotifyApp({ publicUrl: "https://needle.example" });
    const firstLogin = await app.request("/api/spotify/login", { headers: validHeaders });
    const secondLogin = await app.request("/api/spotify/login", { headers: validHeaders });
    const firstState = getAuthorizationState(firstLogin);
    const secondState = getAuthorizationState(secondLogin);

    const mismatchedCallback = await app.request(`/api/spotify/callback?code=first&state=${firstState}`, {
      headers: { cookie: `${SPOTIFY_OAUTH_STATE_COOKIE}=${secondState}` },
    });

    expect(mismatchedCallback.headers.get("location")).toBe("/settings?spotify=error");
    expect(getSpotifyExchangeCount()).toBe(0);
    expect(mismatchedCallback.headers.get("set-cookie")).toContain(`${SPOTIFY_OAUTH_STATE_COOKIE}=;`);
    expect(mismatchedCallback.headers.get("set-cookie")).toContain("Max-Age=0");

    const validCallback = await app.request(`/api/spotify/callback?code=first&state=${firstState}`, {
      headers: { cookie: `${SPOTIFY_OAUTH_STATE_COOKIE}=${firstState}` },
    });

    expect(validCallback.headers.get("location")).toBe("/settings?spotify=connected");
    expect(validCallback.headers.get("set-cookie")).toContain(`${SPOTIFY_OAUTH_STATE_COOKIE}=;`);
    expect(getSpotifyExchangeCount()).toBe(1);
    expect(database.prepare("SELECT user FROM spotify_tokens").get()).toEqual({ user: validAuth.user });
  });

  it("clears the state cookie after missing, expired, and failed callbacks", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    const missingCallbackApp = createSpotifyApp({ publicUrl: "https://needle.example" });
    const missingCallback = await missingCallbackApp.app.request("/api/spotify/callback");

    expect(missingCallback.headers.get("location")).toBe("/settings?spotify=error");
    expect(missingCallback.headers.get("set-cookie")).toContain("Max-Age=0");

    const expiredCallbackApp = createSpotifyApp({ publicUrl: "https://needle.example" });
    const expiredLogin = await expiredCallbackApp.app.request("/api/spotify/login", { headers: validHeaders });
    const expiredState = getAuthorizationState(expiredLogin);

    vi.advanceTimersByTime(10 * 60_000 + 1);

    const expiredCallback = await expiredCallbackApp.app.request(
      `/api/spotify/callback?code=expired&state=${expiredState}`,
      { headers: { cookie: `${SPOTIFY_OAUTH_STATE_COOKIE}=${expiredState}` } },
    );

    expect(expiredCallback.headers.get("location")).toBe("/settings?spotify=error");
    expect(expiredCallback.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(expiredCallbackApp.getSpotifyExchangeCount()).toBe(0);

    const failedCallbackApp = createSpotifyApp({ publicUrl: "https://needle.example", rejectSpotifyExchange: true });
    const failedLogin = await failedCallbackApp.app.request("/api/spotify/login", { headers: validHeaders });
    const failedState = getAuthorizationState(failedLogin);
    const failedCallback = await failedCallbackApp.app.request(
      `/api/spotify/callback?code=failed&state=${failedState}`,
      { headers: { cookie: `${SPOTIFY_OAUTH_STATE_COOKIE}=${failedState}` } },
    );

    expect(failedCallback.headers.get("location")).toBe("/settings?spotify=error");
    expect(failedCallback.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(failedCallbackApp.getSpotifyExchangeCount()).toBe(1);
  });
});

function createSpotifyApp({
  publicUrl,
  rejectSpotifyExchange = false,
}: {
  publicUrl: string;
  rejectSpotifyExchange?: boolean;
}) {
  let spotifyExchangeCount = 0;

  vi.stubGlobal(
    "fetch",
    vi.fn((input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const requestUrl = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);

      if (requestUrl.origin === "https://accounts.spotify.com") {
        spotifyExchangeCount += 1;

        return Promise.resolve(
          rejectSpotifyExchange
            ? new Response("refused", { status: 400 })
            : Response.json({
                access_token: "spotify-access",
                refresh_token: "spotify-refresh",
                expires_in: 3600,
                scope: "streaming user-library-read",
              }),
        );
      }

      const requestParameters = init?.body instanceof URLSearchParams ? init.body : requestUrl.searchParams;
      const method = requestUrl.pathname.split("/").at(-1)?.replace(".view", "");

      return Promise.resolve(
        Response.json({
          "subsonic-response": {
            status: "ok",
            version: "1.16.1",
            ...(method === "getUser" ? { user: { adminRole: true } } : {}),
            ...(requestParameters.get("u") === validAuth.user ? {} : { status: "failed" }),
          },
        }),
      );
    }),
  );

  const database = openDatabase(":memory:");
  const app = createApp(
    loadConfig({
      navidromeUrl: "http://navidrome.test",
      publicUrl,
      spotify: { clientId: "client-id", clientSecret: "client-secret" },
      dataDir: ":memory:",
      webDist: "/nonexistent",
    }),
    database,
  ).app;

  return {
    app,
    database,
    getSpotifyExchangeCount: () => spotifyExchangeCount,
  };
}

function getAuthorizationState(response: Response): string {
  const stateCookie = response.headers.get("set-cookie");
  const state = stateCookie?.match(new RegExp(`${SPOTIFY_OAUTH_STATE_COOKIE}=([^;]+)`))?.[1];

  if (!state) throw new Error("Missing Spotify OAuth state cookie");

  return state;
}
