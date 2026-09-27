import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { gunzipSync } from "node:zlib";
import type { ServerMessage } from "@needle/shared";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { openDatabase } from "../src/db.ts";
import { DeviceHub } from "../src/devices.ts";

const ND = "http://navidrome.test";
const good = { "x-needle-user": "bugra", "x-needle-token": "tok", "x-needle-salt": "salt" };

function fakeNavidrome() {
  vi.stubGlobal("fetch", vi.fn((input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const params = init?.body instanceof URLSearchParams ? init.body : url.searchParams;
    const authed = params.get("u") === "bugra" && params.get("t") === "tok";
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
    app = createApp(loadConfig({ navidromeUrl: ND, dataDir: ":memory:", webDist: "/nonexistent", lidarr: null, spotify: null }), openDatabase(":memory:")).app;
  });
  afterEach(() => vi.unstubAllGlobals());

  it("answers health checks without signing in", async () => {
    expect(await (await app.request("/api/health")).json()).toEqual({ ok: true });
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
    expect(await me()).toEqual({ user: "bugra", photo: null });
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
    expect(await (await app.request("/api/capabilities", { headers: good })).json()).toEqual({ lidarr: false, spotify: false, spotifyConnected: false, spotifyPlayback: false, spotifyReconnect: false, spotifyEnabled: false, songs: false, publicUrl: null });
    expect((await app.request("/api/lidarr/search?q=air", { headers: good })).status).toBe(404);
  });

  it("proxies Navidrome, caching covers for a year and passing ranges through", async () => {
    const cover = await app.request("/rest/getCoverArt.view?id=al-1&u=bugra&t=tok&s=salt");
    expect(cover.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    const part = await app.request("/rest/stream.view?id=1&u=bugra&t=tok&s=salt", { headers: { range: "bytes=2-" } });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe("bytes 2-5/6");
    expect(await part.text()).toBe("cdef");
  });

  it("gzips JSON when the browser accepts it", async () => {
    const r = await app.request("/rest/getAlbumList2.view?u=bugra&t=tok&s=salt&f=json", { headers: { "accept-encoding": "gzip, br" } });
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
    hub.attach(mac as never, "bugra");
    hub.attach(phone as never, "bugra");
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
    hub.attach(first as never, "bugra");
    hub.attach(second as never, "bugra");
    first.say({ type: "hello", device: { id: "mac", name: "Mac", kind: "desktop" } });
    second.say({ type: "hello", device: { id: "mac", name: "Mac", kind: "desktop" } });
    expect(first.readyState).toBe(3);
    expect(hub.devices("bugra")).toHaveLength(1);
  });
});
