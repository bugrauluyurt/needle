import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { gunzipSync } from "node:zlib";
import type { ServerMessage } from "@needle/shared";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { openDatabase } from "../src/db.ts";
import { DeviceHub } from "../src/devices.ts";

const ND = "http://navidrome.test";
const LB = "http://lb.test";
const MBID = "11111111-1111-4111-8111-111111111111";
const good = { "x-needle-user": "alex", "x-needle-token": "tok", "x-needle-salt": "salt" };

function fakeNavidrome() {
  vi.stubGlobal("fetch", vi.fn((input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const params = init?.body instanceof URLSearchParams ? init.body : url.searchParams;
    const authed = params.get("u") === "alex" && params.get("t") === "tok";
    if (url.origin === LB) {
      const valid = new Headers(init?.headers).get("authorization") === "Token good-token";
      return Promise.resolve(new Response(JSON.stringify(valid ? { valid: true, user_name: "alexlb" } : { valid: false }), { headers: { "content-type": "application/json" } }));
    }
    const json = (body: object) => Promise.resolve(new Response(JSON.stringify({ "subsonic-response": { status: authed ? "ok" : "failed", ...(authed ? body : { error: { code: 40, message: "Wrong username or password" } }) } }), { headers: { "content-type": "application/json" } }));
    if (url.pathname.startsWith("/rest/ping")) return json({});
    if (url.pathname.startsWith("/rest/getUser")) return json({ user: { adminRole: true } });
    if (url.pathname.startsWith("/rest/getCoverArt")) return Promise.resolve(new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg", etag: "x" } }));
    if (url.pathname.startsWith("/rest/getAlbumList2")) return json({ albumList2: { album: [{ id: "a", name: "Album" }] } });
    if (url.pathname.startsWith("/rest/getScanStatus")) return json({ scanStatus: { lastScan: "2026-09-27", count: 3 } });
    if (url.pathname.startsWith("/rest/search3")) {
      return json({ searchResult3: { album: [
        { id: "a1", name: "Night Transit", coverArt: "c1", year: 2022, genres: [{ name: "Synthwave" }], created: "2026-09-01" },
        { id: "a2", name: "Pulse Theory", coverArt: "c2", year: 2005, genre: "Synthwave", created: "2026-09-02" },
        { id: "a3", name: "Blue Minutes", year: 1998, genre: "Jazz", created: "2026-09-03" },
      ] } });
    }
    if (url.pathname.startsWith("/rest/stream")) {
      const range = (init?.headers as Headers | undefined)?.get("range");
      return Promise.resolve(new Response("abcdef".slice(range ? 2 : 0), { status: range ? 206 : 200, headers: { "content-type": "audio/flac", ...(range ? { "content-range": "bytes 2-5/6" } : {}) } }));
    }
    return Promise.resolve(new Response("?", { status: 404 }));
  }));
}

describe("server", () => {
  let app: ReturnType<typeof createApp>["app"];
  beforeEach(() => {
    fakeNavidrome();
    app = createApp(loadConfig({ navidromeUrl: ND, listenbrainzUrl: LB, dataDir: ":memory:", webDist: "/nonexistent", lidarr: null, spotify: null, soulseek: null }), openDatabase(":memory:")).app;
  });
  afterEach(() => vi.unstubAllGlobals());

  it("answers health checks without signing in", async () => {
    expect(await (await app.request("/api/health")).json()).toEqual({ ok: true, version: expect.any(String) as string });
  });

  it("turns away requests without valid Navidrome credentials", async () => {
    expect((await app.request("/api/stats")).status).toBe(401);
    expect((await app.request("/api/stats", { headers: { ...good, "x-needle-token": "nope" } })).status).toBe(401);
  });

  it("records plays and reports them in stats", async () => {
    const play = { songId: "s", title: "T", artist: "A", album: "B", duration: 100, msPlayed: 60_000, device: "Mac" };
    expect((await app.request("/api/plays", { method: "POST", headers: { ...good, "content-type": "application/json" }, body: JSON.stringify(play) })).status).toBe(204);
    const stats = (await (await app.request("/api/stats?period=all", { headers: good })).json()) as { msPlayed: number };
    expect(stats.msPlayed).toBe(60_000);
    expect((await app.request("/api/stats?period=decade", { headers: good })).status).toBe(400);
  });

  it("keeps an account photo for every device", async () => {
    const me = async () => (await (await app.request("/api/me", { headers: good })).json()) as { user: string; photo: string | null };
    expect(await me()).toEqual({ user: "alex", photo: null });
    const put = (type: string, body: Uint8Array<ArrayBuffer>) => app.request("/api/me/photo", { method: "PUT", headers: { ...good, "content-type": type }, body });
    expect((await put("image/gif", new Uint8Array([1]))).status).toBe(415);
    expect((await put("image/webp", new Uint8Array(500_000))).status).toBe(413);
    expect((await put("image/webp", new Uint8Array([1, 2, 3]))).status).toBe(204);
    expect((await me()).photo).toBe("data:image/webp;base64,AQID");
    await app.request("/api/me/photo", { method: "DELETE", headers: good });
    expect((await me()).photo).toBeNull();
  });

  it("builds browse tiles from the library in one request", async () => {
    const tiles = (await (await app.request("/api/browse", { headers: good })).json()) as { name: string; covers: { id: string }[] }[];
    expect(tiles.map((t) => t.name)).toEqual(expect.arrayContaining(["Synthwave", "2020s", "2000s", "Recently added", "Surprise me"]));
    expect(tiles.find((t) => t.name === "Synthwave")?.covers.map((c) => c.id)).toEqual(["a2", "a1"]);
    expect(tiles.some((t) => t.name === "Jazz")).toBe(false);
  });

  it("lists requests and needs slskd for songs", async () => {
    expect(await (await app.request("/api/requests", { headers: good })).json()).toEqual([]);
    expect((await app.request("/api/songs/search?q=one", { headers: good })).status).toBe(404);
  });

  it("reports what's switched on", async () => {
    expect(await (await app.request("/api/capabilities", { headers: good })).json()).toEqual({ admin: true, lidarr: false, spotify: false, spotifyConnected: false, spotifyPlayback: false, spotifyReconnect: false, spotifyEnabled: false, songs: false, publicUrl: null, listenbrainzUser: null, listenbrainzNavidrome: false });
    expect((await app.request("/api/lidarr/search?q=air", { headers: good })).status).toBe(404);
  });

  it("connects ListenBrainz with a valid token and keeps its playlists behind the connection", async () => {
    const put = (body: object) => app.request("/api/listenbrainz", { method: "PUT", headers: { ...good, "content-type": "application/json" }, body: JSON.stringify(body) });
    const notYet = await app.request("/api/listenbrainz/playlists", { headers: good });
    expect(notYet.status).toBe(409);
    expect(await notYet.json()).toEqual({ error: "Connect ListenBrainz in Settings first" });
    expect((await put({ token: "  " })).status).toBe(400);
    const bad = await put({ token: "not-a-token", password: "hunter2" });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(await bad.json())).not.toContain("hunter2");
    expect(await (await put({ token: "good-token" })).json()).toEqual({ user: "alexlb", navidrome: false });
    expect(await (await app.request("/api/capabilities", { headers: good })).json()).toMatchObject({ listenbrainzUser: "alexlb", listenbrainzNavidrome: false });
    expect((await app.request("/api/listenbrainz/playlists/not-an-mbid", { headers: good })).status).toBe(404);
    expect((await app.request(`/api/listenbrainz/playlists/${MBID}/missing`, { method: "POST", headers: good })).status).toBe(404);
    expect((await app.request("/api/listenbrainz", { method: "DELETE", headers: good })).status).toBe(200);
    expect(await (await app.request("/api/capabilities", { headers: good })).json()).toMatchObject({ listenbrainzUser: null });
  });

  it("proxies Navidrome, caching covers for a year and passing ranges through", async () => {
    const cover = await app.request("/rest/getCoverArt.view?id=al-1&u=alex&t=tok&s=salt");
    expect(cover.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    const part = await app.request("/rest/stream.view?id=1&u=alex&t=tok&s=salt", { headers: { range: "bytes=2-" } });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe("bytes 2-5/6");
    expect(await part.text()).toBe("cdef");
  });

  it("gzips JSON when the browser accepts it", async () => {
    const r = await app.request("/rest/getAlbumList2.view?u=alex&t=tok&s=salt&f=json", { headers: { "accept-encoding": "gzip, br" } });
    expect(r.headers.get("content-encoding")).toBe("gzip");
    const body = JSON.parse(gunzipSync(Buffer.from(await r.arrayBuffer())).toString()) as { "subsonic-response": { albumList2: unknown } };
    expect(body["subsonic-response"].albumList2).toBeTruthy();
  });
});

class FakeSocket extends EventEmitter {
  readonly OPEN = 1;
  readyState = 1;
  sent: ServerMessage[] = [];
  send(raw: string) {
    this.sent.push(JSON.parse(raw) as ServerMessage);
  }
  close() {
    this.readyState = 3;
    this.emit("close");
  }
  terminate() {
    this.close();
  }
  ping() {
    return undefined;
  }
  say(msg: object) {
    this.emit("message", Buffer.from(JSON.stringify(msg)));
  }
}

describe("device hub", () => {
  it("lists a user's devices and forwards commands only within that user", () => {
    const hub = new DeviceHub();
    const mac = new FakeSocket();
    const phone = new FakeSocket();
    const stranger = new FakeSocket();
    hub.attach(mac as never, "alex");
    hub.attach(phone as never, "alex");
    hub.attach(stranger as never, "guest");
    mac.say({ type: "hello", device: { id: "mac", name: "Chrome on Mac", kind: "desktop" } });
    phone.say({ type: "hello", device: { id: "phone", name: "iPhone", kind: "phone" } });
    stranger.say({ type: "hello", device: { id: "tv", name: "TV", kind: "desktop" } });

    const last = phone.sent.filter((m) => m.type === "devices").at(-1);
    expect(last?.type === "devices" && last.devices.map((d) => d.id)).toEqual(["mac", "phone"]);

    mac.say({ type: "command", to: "phone", command: { action: "pause" } });
    expect(phone.sent.at(-1)).toEqual({ type: "command", from: "mac", command: { action: "pause" } });
    mac.say({ type: "command", to: "tv", command: { action: "pause" } });
    expect(stranger.sent.some((m) => m.type === "command")).toBe(false);

    phone.close();
    const after = mac.sent.filter((m) => m.type === "devices").at(-1);
    expect(after?.type === "devices" && after.devices.map((d) => d.id)).toEqual(["mac"]);
  });

  it("replaces an older connection from the same device", () => {
    const hub = new DeviceHub();
    const first = new FakeSocket();
    const second = new FakeSocket();
    hub.attach(first as never, "alex");
    hub.attach(second as never, "alex");
    first.say({ type: "hello", device: { id: "mac", name: "Mac", kind: "desktop" } });
    second.say({ type: "hello", device: { id: "mac", name: "Mac", kind: "desktop" } });
    expect(first.readyState).toBe(3);
    expect(hub.devices("alex")).toHaveLength(1);
  });
});

describe("people and permissions", () => {
  const as = (user: string) => ({ "x-needle-user": user, "x-needle-token": "tok", "x-needle-salt": "salt" });
  const USERS = [{ username: "alex", adminRole: true }, { username: "sam", adminRole: false }];
  let app: ReturnType<typeof createApp>["app"];

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn((input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      const params = init?.body instanceof URLSearchParams ? init.body : url.searchParams;
      const me = USERS.find((u) => u.username === params.get("u"));
      const json = (body: object) => Promise.resolve(new Response(JSON.stringify({ "subsonic-response": { status: "ok", ...body } })));
      if (!url.pathname.startsWith("/rest/")) return Promise.resolve(new Response("[]"));
      if (url.pathname.startsWith("/rest/ping")) return json({});
      if (url.pathname.startsWith("/rest/getUser")) return json({ user: { adminRole: me?.adminRole ?? false } });
      return Promise.resolve(new Response("?", { status: 404 }));
    }));
    const config = loadConfig({
      navidromeUrl: ND, dataDir: ":memory:", webDist: "/nonexistent", publicUrl: "https://music.example.com",
      lidarr: { url: "http://lidarr.test", apiKey: "k", qualityProfile: null, rootFolder: null }, spotify: { clientId: "id", clientSecret: "secret" },
      soulseek: { url: "http://slskd.test", apiKey: "k", downloadsDir: "/tmp/needle-none", singlesDir: "/tmp/needle-none" },
    });
    app = createApp(config, openDatabase(":memory:")).app;
  });
  afterEach(() => vi.unstubAllGlobals());

  const caps = async (user: string) => (await (await app.request("/api/capabilities", { headers: as(user) })).json()) as { admin: boolean; lidarr: boolean; spotify: boolean };

  it("gives admins everything and other people nothing until an admin allows it", async () => {
    expect(await caps("alex")).toMatchObject({ admin: true, lidarr: true, spotify: true });
    expect(await caps("sam")).toMatchObject({ admin: false, lidarr: false, spotify: false });
    expect((await app.request("/api/lidarr/search?q=ab", { headers: as("sam") })).status).toBe(403);
    expect((await app.request("/api/spotify/token", { headers: as("sam") })).status).toBe(403);
    expect((await app.request(`/api/listenbrainz/playlists/${MBID}/missing`, { method: "POST", headers: as("sam") })).status).toBe(403);

    const put = await app.request("/api/people/sam", { method: "PUT", headers: { ...as("alex"), "content-type": "application/json" }, body: JSON.stringify({ canRequest: true, canSpotify: true }) });
    expect(await put.json()).toEqual({ user: "sam", admin: false, canRequest: true, canSpotify: true, lastSeen: expect.any(Number) as number });
    expect(await caps("sam")).toMatchObject({ lidarr: true, spotify: true });
  });

  it("keeps managing people and Lidarr's queue to admins", async () => {
    await app.request("/api/people/sam", { method: "PUT", headers: { ...as("alex"), "content-type": "application/json" }, body: JSON.stringify({ canRequest: true }) });
    expect((await app.request("/api/people", { headers: as("sam") })).status).toBe(403);
    expect((await app.request("/api/people/sam", { method: "PUT", headers: { ...as("sam"), "content-type": "application/json" }, body: "{}" })).status).toBe(403);
    expect((await app.request("/api/lidarr/downloads", { headers: as("sam") })).status).toBe(403);
    expect((await app.request("/api/requests?everyone=1", { headers: as("sam") })).status).toBe(403);
    const list = (await (await app.request("/api/people", { headers: as("alex") })).json()) as { user: string; canRequest: boolean }[];
    expect(list.map((p) => [p.user, p.canRequest])).toEqual([["alex", true], ["sam", true]]);
  });

  it("lets admins set up someone who hasn't opened Needle yet", async () => {
    const put = await app.request("/api/people/newcomer", { method: "PUT", headers: { ...as("alex"), "content-type": "application/json" }, body: JSON.stringify({ canRequest: true }) });
    expect(await put.json()).toEqual({ user: "newcomer", admin: false, canRequest: true, canSpotify: false, lastSeen: null });
    const list = (await (await app.request("/api/people", { headers: as("alex") })).json()) as { user: string; lastSeen: number | null }[];
    expect(list.map((p) => [p.user, p.lastSeen === null])).toEqual([["alex", false], ["newcomer", true]]);
  });
});
