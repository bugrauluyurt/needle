import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import type { ServerMessage } from "@needle/shared";
import { ClientMessageSchema } from "@needle/shared/schemas/devices";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { openDatabase } from "../src/db.ts";
import { DeviceHub } from "../src/devices.ts";

const ND = "http://navidrome.test";
const LB = "http://lb.test";
const MBID = "11111111-1111-4111-8111-111111111111";
const good = {
  "x-needle-user": "alex",
  "x-needle-token": "tok",
  "x-needle-salt": "salt",
};

type ApiErrorBody = {
  error: string;
  code: string;
  requestId: string;
  issues?: { path: string; message: string }[];
};

type StreamingRequestInit = RequestInit & { duplex: "half" };

function getStreamingBodyHarness(bodyChunks: Uint8Array[]) {
  let readChunkCount = 0;
  const requestBody = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        const bodyChunk = bodyChunks[readChunkCount];

        if (!bodyChunk) {
          controller.close();

          return;
        }

        readChunkCount += 1;
        controller.enqueue(bodyChunk);
      },
    },
    { highWaterMark: 0 },
  );

  return {
    body: requestBody,
    getReadChunkCount: () => readChunkCount,
  };
}

function fakeNavidrome() {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      const params = init?.body instanceof URLSearchParams ? init.body : url.searchParams;
      const authed = params.get("u") === "alex" && params.get("t") === "tok";
      if (url.origin === LB) {
        const valid = new Headers(init?.headers).get("authorization") === "Token good-token";
        return Promise.resolve(
          new Response(JSON.stringify(valid ? { valid: true, user_name: "alexlb" } : { valid: false }), {
            headers: { "content-type": "application/json" },
          }),
        );
      }
      const json = (responseBody: object) =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              "subsonic-response": {
                status: authed ? "ok" : "failed",
                ...(authed
                  ? responseBody
                  : {
                      error: {
                        code: 40,
                        message: "Wrong username or password",
                      },
                    }),
              },
            }),
            { headers: { "content-type": "application/json" } },
          ),
        );
      if (url.pathname.startsWith("/rest/ping")) return json({});
      if (url.pathname.startsWith("/rest/getUser")) return json({ user: { adminRole: true } });
      if (url.pathname.startsWith("/rest/getCoverArt"))
        return Promise.resolve(
          new Response(new Uint8Array([1, 2, 3]), {
            headers: { "content-type": "image/jpeg", etag: "x" },
          }),
        );
      if (url.pathname.startsWith("/rest/getAlbumList2"))
        return json({ albumList2: { album: [{ id: "a", name: "Album" }] } });
      if (url.pathname.startsWith("/rest/getScanStatus"))
        return json({ scanStatus: { lastScan: "2026-09-27", count: 3 } });
      if (url.pathname.startsWith("/rest/search3")) {
        return json({
          searchResult3: {
            album: [
              {
                id: "a1",
                name: "Night Transit",
                coverArt: "c1",
                year: 2022,
                genres: [{ name: "Synthwave" }],
                created: "2026-09-01",
              },
              {
                id: "a2",
                name: "Pulse Theory",
                coverArt: "c2",
                year: 2005,
                genre: "Synthwave",
                created: "2026-09-02",
              },
              {
                id: "a3",
                name: "Blue Minutes",
                year: 1998,
                genre: "Jazz",
                created: "2026-09-03",
              },
            ],
          },
        });
      }
      if (url.pathname.startsWith("/rest/stream")) {
        const range = (init?.headers as Headers | undefined)?.get("range");
        return Promise.resolve(
          new Response("abcdef".slice(range ? 2 : 0), {
            status: range ? 206 : 200,
            headers: {
              "content-type": "audio/flac",
              ...(range ? { "content-range": "bytes 2-5/6" } : {}),
            },
          }),
        );
      }
      return Promise.resolve(new Response("?", { status: 404 }));
    }),
  );
}

describe("server", () => {
  let app: ReturnType<typeof createApp>["app"];
  beforeEach(() => {
    fakeNavidrome();
    app = createApp(
      loadConfig({
        navidromeUrl: ND,
        listenbrainzUrl: LB,
        dataDir: ":memory:",
        webDist: "/nonexistent",
        lidarr: null,
        spotify: null,
        soulseek: null,
      }),
      openDatabase(":memory:"),
    ).app;
  });
  afterEach(() => vi.unstubAllGlobals());

  it("answers health checks without signing in", async () => {
    const response = await app.request("/api/health");

    expect(await response.json()).toEqual({
      ok: true,
      version: expect.any(String) as string,
    });
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("turns away requests without valid Navidrome credentials", async () => {
    const response = await app.request("/api/stats");
    const body = (await response.json()) as ApiErrorBody;

    expect(response.status).toBe(401);
    expect(body).toEqual({
      error: "Sign in again",
      code: "UNAUTHORIZED",
      requestId: response.headers.get("x-request-id"),
    });
    expect(
      (
        await app.request("/api/stats", {
          headers: { ...good, "x-needle-token": "nope" },
        })
      ).status,
    ).toBe(401);
  });

  it("returns sanitized validation errors for malformed JSON", async () => {
    const response = await app.request("/api/plays", {
      method: "POST",
      headers: { ...good, "content-type": "application/json" },
      body: '{"secret":"hunter2"',
    });
    const validationErrorBody = (await response.json()) as ApiErrorBody;

    expect(response.status).toBe(400);
    expect(validationErrorBody.code).toBe("VALIDATION_ERROR");
    expect(validationErrorBody.requestId).toBe(response.headers.get("x-request-id"));
    expect(validationErrorBody.issues).toEqual(
      expect.arrayContaining([{ path: "json", message: expect.any(String) as string }]),
    );
    expect(JSON.stringify(validationErrorBody)).not.toContain("hunter2");
  });

  it("stops reading oversized JSON bodies and returns the unified error contract", async () => {
    const textEncoder = new TextEncoder();
    const streamedJsonBody = getStreamingBodyHarness([
      textEncoder.encode(`{"songId":"${"x".repeat(65_536)}`),
      textEncoder.encode('"}'),
    ]);
    const oversizedJsonRequestInit: StreamingRequestInit = {
      method: "POST",
      headers: { ...good, "content-type": "application/json" },
      body: streamedJsonBody.body,
      duplex: "half",
    };
    const oversizedJsonResponse = await app.fetch(new Request("http://localhost/api/plays", oversizedJsonRequestInit));
    const payloadTooLargeError = (await oversizedJsonResponse.json()) as ApiErrorBody;

    expect(oversizedJsonResponse.status).toBe(413);
    expect(payloadTooLargeError).toEqual({
      error: "Request body is too large",
      code: "PAYLOAD_TOO_LARGE",
      requestId: oversizedJsonResponse.headers.get("x-request-id"),
    });
    expect(streamedJsonBody.getReadChunkCount()).toBe(1);
  });

  it("validates query and path parameters before route logic", async () => {
    const periodResponse = await app.request("/api/stats?period=decade", {
      headers: good,
    });
    const periodBody = (await periodResponse.json()) as ApiErrorBody;
    const requestResponse = await app.request("/api/requests/not-a-number/retry", { method: "POST", headers: good });
    const requestBody = (await requestResponse.json()) as ApiErrorBody;

    expect(periodResponse.status).toBe(400);
    expect(periodBody).toMatchObject({
      code: "VALIDATION_ERROR",
      issues: [{ path: "period", message: expect.any(String) as string }],
    });
    expect(requestResponse.status).toBe(400);
    expect(requestBody).toMatchObject({
      code: "VALIDATION_ERROR",
      issues: [{ path: "id", message: expect.any(String) as string }],
    });
  });

  it("serializes integration and provider errors consistently", async () => {
    const integrationResponse = await app.request("/api/songs/search?q=one", {
      headers: good,
    });
    const integrationBody = (await integrationResponse.json()) as ApiErrorBody;
    const providerResponse = await app.request("/api/listenbrainz/playlists", {
      headers: good,
    });
    const providerBody = (await providerResponse.json()) as ApiErrorBody;

    expect(integrationResponse.status).toBe(404);
    expect(integrationBody).toMatchObject({
      error: "slskd isn't set up on the Needle server",
      code: "INTEGRATION_NOT_CONFIGURED",
      requestId: integrationResponse.headers.get("x-request-id"),
    });
    expect(providerResponse.status).toBe(409);
    expect(providerBody).toMatchObject({
      error: "Connect ListenBrainz in Settings first",
      code: "CONFLICT",
      requestId: providerResponse.headers.get("x-request-id"),
    });
  });

  it("serializes unknown routes through the same error contract", async () => {
    const response = await app.request("/api/not-a-route", { headers: good });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "Not found",
      code: "NOT_FOUND",
      requestId: response.headers.get("x-request-id"),
    });
  });

  it("keeps unknown authenticated API routes out of the static app fallback", async () => {
    const webDist = await mkdtemp(join(tmpdir(), "needle-web-"));
    const database = openDatabase(":memory:");

    await writeFile(join(webDist, "index.html"), "<main>Needle app</main>");

    try {
      const productionApp = createApp(
        loadConfig({
          navidromeUrl: ND,
          listenbrainzUrl: LB,
          dataDir: ":memory:",
          webDist,
          lidarr: null,
          spotify: null,
          soulseek: null,
        }),
        database,
      ).app;
      const response = await productionApp.request("/api/not-a-route", {
        headers: good,
      });

      expect(response.status).toBe(404);
      expect(response.headers.get("content-type")).toContain("application/json");
      expect(await response.json()).toMatchObject({
        error: "Not found",
        code: "NOT_FOUND",
      });
    } finally {
      database.close();
      await rm(webDist, { recursive: true });
    }
  });

  it("records plays and reports them in stats", async () => {
    const play = {
      songId: "s",
      title: "T",
      artist: "A",
      album: "B",
      duration: 100,
      msPlayed: 60_000,
      device: "Mac",
    };
    expect(
      (
        await app.request("/api/plays", {
          method: "POST",
          headers: { ...good, "content-type": "application/json" },
          body: JSON.stringify(play),
        })
      ).status,
    ).toBe(204);
    const stats = (await (await app.request("/api/stats?period=all", { headers: good })).json()) as {
      msPlayed: number;
    };
    expect(stats.msPlayed).toBe(60_000);
    expect((await app.request("/api/stats?period=decade", { headers: good })).status).toBe(400);
  });

  it("keeps an account photo for every device", async () => {
    const me = async () =>
      (await (await app.request("/api/me", { headers: good })).json()) as {
        user: string;
        photo: string | null;
      };
    expect(await me()).toEqual({ user: "alex", photo: null });
    const putPhoto = (contentType: string, photoBytes: Uint8Array<ArrayBuffer>) =>
      app.request("/api/me/photo", {
        method: "PUT",
        headers: { ...good, "content-type": contentType },
        body: photoBytes,
      });
    const invalidPhotoTypeResponse = await putPhoto("image/gif", new Uint8Array(400_001));
    expect(invalidPhotoTypeResponse.status).toBe(415);
    expect(await invalidPhotoTypeResponse.json()).toMatchObject({
      code: "UNSUPPORTED_MEDIA_TYPE",
    });
    const streamedPhotoBody = getStreamingBodyHarness([new Uint8Array(400_001), new Uint8Array([1])]);
    const photoRequestInit: StreamingRequestInit = {
      method: "PUT",
      headers: { ...good, "content-type": "image/webp" },
      body: streamedPhotoBody.body,
      duplex: "half",
    };
    const oversizedPhotoResponse = await app.fetch(new Request("http://localhost/api/me/photo", photoRequestInit));

    expect(oversizedPhotoResponse.status).toBe(413);
    expect(await oversizedPhotoResponse.json()).toEqual({
      error: "That image is too large",
      code: "PAYLOAD_TOO_LARGE",
      requestId: oversizedPhotoResponse.headers.get("x-request-id"),
    });
    expect(streamedPhotoBody.getReadChunkCount()).toBe(1);
    expect((await putPhoto("image/webp", new Uint8Array([1, 2, 3]))).status).toBe(204);
    expect((await me()).photo).toBe("data:image/webp;base64,AQID");
    await app.request("/api/me/photo", { method: "DELETE", headers: good });
    expect((await me()).photo).toBeNull();
  });

  it("builds browse tiles from the library in one request", async () => {
    const tiles = (await (await app.request("/api/browse", { headers: good })).json()) as {
      name: string;
      covers: { id: string }[];
    }[];
    expect(tiles.map((t) => t.name)).toEqual(
      expect.arrayContaining(["Synthwave", "2020s", "2000s", "Recently added", "Surprise me"]),
    );
    expect(tiles.find((t) => t.name === "Synthwave")?.covers.map((c) => c.id)).toEqual(["a2", "a1"]);
    expect(tiles.some((t) => t.name === "Jazz")).toBe(false);
  });

  it("lists requests and needs slskd for songs", async () => {
    expect(await (await app.request("/api/requests", { headers: good })).json()).toEqual([]);
    expect((await app.request("/api/songs/search?q=one", { headers: good })).status).toBe(404);
  });

  it("reports what's switched on", async () => {
    expect(await (await app.request("/api/capabilities", { headers: good })).json()).toEqual({
      admin: true,
      lidarr: false,
      spotify: false,
      spotifyConnected: false,
      spotifyPlayback: false,
      spotifyReconnect: false,
      spotifyEnabled: false,
      songs: false,
      publicUrl: null,
      listenbrainzUser: null,
      listenbrainzNavidrome: false,
    });
    expect((await app.request("/api/lidarr/search?q=air", { headers: good })).status).toBe(404);
  });

  it("connects ListenBrainz with a valid token and keeps its playlists behind the connection", async () => {
    const put = (body: object) =>
      app.request("/api/listenbrainz", {
        method: "PUT",
        headers: { ...good, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const notYet = await app.request("/api/listenbrainz/playlists", {
      headers: good,
    });
    expect(notYet.status).toBe(409);
    expect(await notYet.json()).toMatchObject({
      error: "Connect ListenBrainz in Settings first",
      code: "CONFLICT",
    });
    expect((await put({ token: "  " })).status).toBe(400);
    const bad = await put({ token: "not-a-token", password: "hunter2" });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(await bad.json())).not.toContain("hunter2");
    expect(await (await put({ token: "good-token" })).json()).toEqual({
      user: "alexlb",
      navidrome: false,
    });
    expect(await (await app.request("/api/capabilities", { headers: good })).json()).toMatchObject({
      listenbrainzUser: "alexlb",
      listenbrainzNavidrome: false,
    });
    expect(
      (
        await app.request("/api/listenbrainz/playlists/not-an-mbid", {
          headers: good,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await app.request(`/api/listenbrainz/playlists/${MBID}/missing`, {
          method: "POST",
          headers: good,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request("/api/listenbrainz", {
          method: "DELETE",
          headers: good,
        })
      ).status,
    ).toBe(200);
    expect(await (await app.request("/api/capabilities", { headers: good })).json()).toMatchObject({
      listenbrainzUser: null,
    });
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
    const r = await app.request("/rest/getAlbumList2.view?u=alex&t=tok&s=salt&f=json", {
      headers: { "accept-encoding": "gzip, br" },
    });
    expect(r.headers.get("content-encoding")).toBe("gzip");
    const body = JSON.parse(gunzipSync(Buffer.from(await r.arrayBuffer())).toString()) as {
      "subsonic-response": { albumList2: unknown };
    };
    expect(body["subsonic-response"].albumList2).toBeTruthy();
  });
});

class FakeSocket extends EventEmitter {
  readonly OPEN = 1;
  readyState = 1;
  sent: ServerMessage[] = [];
  closeCode: number | undefined;
  closeReason: string | undefined;
  pings = 0;
  send(raw: string) {
    this.sent.push(JSON.parse(raw) as ServerMessage);
  }
  close(code?: number, reason?: string) {
    this.closeCode = code;
    this.closeReason = reason;
    this.readyState = 3;
    this.emit("close");
  }
  terminate() {
    this.close();
  }
  ping() {
    this.pings++;
  }
  say(msg: object) {
    this.emit("message", Buffer.from(JSON.stringify(msg)));
  }
  sayRaw(message: string) {
    this.emit("message", Buffer.from(message));
  }
}

describe("device hub", () => {
  it("defines the client message boundary", () => {
    expect(
      ClientMessageSchema.safeParse({
        type: "hello",
        device: { id: "phone", name: "Phone", kind: "phone" },
      }).success,
    ).toBe(true);
    expect(
      ClientMessageSchema.safeParse({
        type: "command",
        to: "phone",
        command: { action: "volume", volume: 2 },
      }).success,
    ).toBe(false);
    expect(ClientMessageSchema.safeParse({ type: "unknown" }).success).toBe(false);
  });

  it("closes invalid JSON and invalid message shapes with a policy violation", () => {
    const invalidJsonSocket = new FakeSocket();
    const nullSocket = new FakeSocket();
    const invalidShapeSocket = new FakeSocket();
    const hub = new DeviceHub();

    hub.attach(invalidJsonSocket as never, "alex");
    hub.attach(nullSocket as never, "alex");
    hub.attach(invalidShapeSocket as never, "alex");
    invalidJsonSocket.sayRaw("{");
    nullSocket.sayRaw("null");
    invalidShapeSocket.say({
      type: "command",
      to: "phone",
      command: { action: "volume", volume: 2 },
    });

    expect([invalidJsonSocket, nullSocket, invalidShapeSocket]).toEqual([
      expect.objectContaining({
        readyState: 3,
        closeCode: 1008,
        closeReason: "invalid message",
      }),
      expect.objectContaining({
        readyState: 3,
        closeCode: 1008,
        closeReason: "invalid message",
      }),
      expect.objectContaining({
        readyState: 3,
        closeCode: 1008,
        closeReason: "invalid message",
      }),
    ]);
  });

  it("pings fresh connections and terminates stale devices", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    try {
      const hub = new DeviceHub();
      const freshSocket = new FakeSocket();
      const staleSocket = new FakeSocket();

      hub.attach(freshSocket as never, "alex");
      hub.attach(staleSocket as never, "alex");
      staleSocket.say({
        type: "hello",
        device: { id: "old", name: "Old", kind: "desktop" },
      });

      hub.heartbeat();
      expect(freshSocket.pings).toBe(1);
      expect(staleSocket.pings).toBe(1);

      vi.setSystemTime(46_000);
      hub.heartbeat();
      expect(freshSocket.pings).toBe(2);
      expect(staleSocket.readyState).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("lists a user's devices and forwards commands only within that user", () => {
    const hub = new DeviceHub();
    const mac = new FakeSocket();
    const phone = new FakeSocket();
    const stranger = new FakeSocket();
    hub.attach(mac as never, "alex");
    hub.attach(phone as never, "alex");
    hub.attach(stranger as never, "guest");
    mac.say({
      type: "hello",
      device: { id: "mac", name: "Chrome on Mac", kind: "desktop" },
    });
    phone.say({
      type: "hello",
      device: { id: "phone", name: "iPhone", kind: "phone" },
    });
    stranger.say({
      type: "hello",
      device: { id: "tv", name: "TV", kind: "desktop" },
    });

    const last = phone.sent.filter((m) => m.type === "devices").at(-1);
    expect(last?.type === "devices" && last.devices.map((d) => d.id)).toEqual(["mac", "phone"]);

    mac.say({ type: "command", to: "phone", command: { action: "pause" } });
    expect(phone.sent.at(-1)).toEqual({
      type: "command",
      from: "mac",
      command: { action: "pause" },
    });
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
    first.say({
      type: "hello",
      device: { id: "mac", name: "Mac", kind: "desktop" },
    });
    second.say({
      type: "hello",
      device: { id: "mac", name: "Mac", kind: "desktop" },
    });
    expect(first.readyState).toBe(3);
    expect(hub.devices("alex")).toHaveLength(1);
  });

  const playing = (songId: string, on = true) => ({
    type: "state",
    state: {
      songId,
      title: songId,
      artist: "A",
      position: 0,
      duration: 100,
      playing: on,
      volume: 1,
      updatedAt: 0,
    },
  });
  const lastDevices = (socket: FakeSocket) => socket.sent.filter((m) => m.type === "devices").at(-1);
  const pauses = (socket: FakeSocket) =>
    socket.sent.filter((m) => m.type === "command" && m.command.action === "pause");

  function household() {
    const hub = new DeviceHub();
    const mac = new FakeSocket();
    const phone = new FakeSocket();
    const guest = new FakeSocket();
    hub.attach(mac as never, "alex");
    hub.attach(phone as never, "alex");
    hub.attach(guest as never, "guest");
    mac.say({
      type: "hello",
      device: { id: "mac", name: "Mac", kind: "desktop" },
    });
    phone.say({
      type: "hello",
      device: { id: "phone", name: "iPhone", kind: "phone" },
    });
    guest.say({
      type: "hello",
      device: { id: "tv", name: "TV", kind: "desktop" },
    });
    return { hub, mac, phone, guest };
  }

  it("pauses the other playing device when one starts playing", () => {
    const { mac, phone, guest } = household();
    mac.say(playing("s1"));
    guest.say(playing("s9"));
    expect(pauses(mac)).toHaveLength(0);

    phone.say(playing("s2"));
    expect(pauses(mac)).toEqual([{ type: "command", from: "phone", command: { action: "pause" } }]);
    expect(pauses(phone)).toHaveLength(0);
    expect(pauses(guest)).toHaveLength(0);

    phone.say(playing("s3"));
    expect(pauses(mac)).toHaveLength(1);
  });

  it("leaves paused devices alone", () => {
    const { mac, phone } = household();
    mac.say(playing("s1", false));
    phone.say(playing("s2"));
    expect(pauses(mac)).toHaveLength(0);
  });

  it("tells every device which one is active", () => {
    const { mac, phone, guest } = household();
    expect(lastDevices(mac)).toMatchObject({ activeId: null });
    mac.say(playing("s1"));
    expect(lastDevices(phone)).toMatchObject({ activeId: "mac" });
    mac.say(playing("s1", false));
    expect(lastDevices(phone)).toMatchObject({ activeId: "mac" });
    phone.say(playing("s2"));
    expect(lastDevices(mac)).toMatchObject({ activeId: "phone" });
    expect(lastDevices(guest)).toMatchObject({ activeId: null });
  });

  it("forgets the active device when it disconnects", () => {
    const { mac, phone } = household();
    mac.say(playing("s1"));
    mac.close();
    expect(lastDevices(phone)).toMatchObject({ activeId: null });
  });

  it("keeps the active device when it reconnects under the same id", () => {
    const { hub, mac, phone } = household();
    mac.say(playing("s1"));
    const again = new FakeSocket();
    hub.attach(again as never, "alex");
    again.say({
      type: "hello",
      device: { id: "mac", name: "Mac", kind: "desktop" },
    });
    expect(mac.readyState).toBe(3);
    expect(lastDevices(phone)).toMatchObject({ activeId: "mac" });
  });
});

describe("people and permissions", () => {
  const as = (user: string) => ({
    "x-needle-user": user,
    "x-needle-token": "tok",
    "x-needle-salt": "salt",
  });
  const USERS = [
    { username: "alex", adminRole: true },
    { username: "sam", adminRole: false },
  ];
  let app: ReturnType<typeof createApp>["app"];

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
        const params = init?.body instanceof URLSearchParams ? init.body : url.searchParams;
        const me = USERS.find((u) => u.username === params.get("u"));
        const json = (body: object) =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                "subsonic-response": { status: "ok", ...body },
              }),
            ),
          );
        if (!url.pathname.startsWith("/rest/")) return Promise.resolve(new Response("[]"));
        if (url.pathname.startsWith("/rest/ping")) return json({});
        if (url.pathname.startsWith("/rest/getUser")) return json({ user: { adminRole: me?.adminRole ?? false } });
        return Promise.resolve(new Response("?", { status: 404 }));
      }),
    );
    const config = loadConfig({
      navidromeUrl: ND,
      dataDir: ":memory:",
      webDist: "/nonexistent",
      publicUrl: "https://music.example.com",
      lidarr: {
        url: "http://lidarr.test",
        apiKey: "k",
        qualityProfile: null,
        rootFolder: null,
      },
      spotify: { clientId: "id", clientSecret: "secret" },
      soulseek: {
        url: "http://slskd.test",
        apiKey: "k",
        downloadsDir: "/tmp/needle-none",
        singlesDir: "/tmp/needle-none",
      },
    });
    app = createApp(config, openDatabase(":memory:")).app;
  });
  afterEach(() => vi.unstubAllGlobals());

  const caps = async (user: string) =>
    (await (await app.request("/api/capabilities", { headers: as(user) })).json()) as {
      admin: boolean;
      lidarr: boolean;
      spotify: boolean;
    };

  it("gives admins everything and other people nothing until an admin allows it", async () => {
    expect(await caps("alex")).toMatchObject({
      admin: true,
      lidarr: true,
      spotify: true,
    });
    expect(await caps("sam")).toMatchObject({
      admin: false,
      lidarr: false,
      spotify: false,
    });
    expect((await app.request("/api/lidarr/search?q=ab", { headers: as("sam") })).status).toBe(403);
    expect((await app.request("/api/spotify/token", { headers: as("sam") })).status).toBe(403);
    expect(
      (
        await app.request(`/api/listenbrainz/playlists/${MBID}/missing`, {
          method: "POST",
          headers: as("sam"),
        })
      ).status,
    ).toBe(403);

    const put = await app.request("/api/people/sam", {
      method: "PUT",
      headers: { ...as("alex"), "content-type": "application/json" },
      body: JSON.stringify({ canRequest: true, canSpotify: true }),
    });
    expect(await put.json()).toEqual({
      user: "sam",
      admin: false,
      canRequest: true,
      canSpotify: true,
      canYouTubeMusic: false,
      lastSeen: expect.any(Number) as number,
    });
    expect(await caps("sam")).toMatchObject({ lidarr: true, spotify: true });
  });

  it("keeps managing people and Lidarr's queue to admins", async () => {
    await app.request("/api/people/sam", {
      method: "PUT",
      headers: { ...as("alex"), "content-type": "application/json" },
      body: JSON.stringify({ canRequest: true }),
    });
    expect((await app.request("/api/people", { headers: as("sam") })).status).toBe(403);
    expect(
      (
        await app.request("/api/people/sam", {
          method: "PUT",
          headers: { ...as("sam"), "content-type": "application/json" },
          body: "{}",
        })
      ).status,
    ).toBe(403);
    expect((await app.request("/api/lidarr/downloads", { headers: as("sam") })).status).toBe(403);
    expect((await app.request("/api/requests?everyone=1", { headers: as("sam") })).status).toBe(403);
    const list = (await (await app.request("/api/people", { headers: as("alex") })).json()) as {
      user: string;
      canRequest: boolean;
    }[];
    expect(list.map((p) => [p.user, p.canRequest])).toEqual([
      ["alex", true],
      ["sam", true],
    ]);
  });

  it("lets admins set up someone who hasn't opened Needle yet", async () => {
    const put = await app.request("/api/people/newcomer", {
      method: "PUT",
      headers: { ...as("alex"), "content-type": "application/json" },
      body: JSON.stringify({ canRequest: true }),
    });
    expect(await put.json()).toEqual({
      user: "newcomer",
      admin: false,
      canRequest: true,
      canSpotify: false,
      canYouTubeMusic: false,
      lastSeen: null,
    });
    const list = (await (await app.request("/api/people", { headers: as("alex") })).json()) as {
      user: string;
      lastSeen: number | null;
    }[];
    expect(list.map((p) => [p.user, p.lastSeen === null])).toEqual([
      ["alex", false],
      ["newcomer", true],
    ]);
  });

  it("validates each protected route boundary after authorization", async () => {
    const invalidPerson = await app.request("/api/people/sam", {
      method: "PUT",
      headers: { ...as("alex"), "content-type": "application/json" },
      body: JSON.stringify({ canRequest: "yes" }),
    });
    const invalidStatus = await app.request("/api/status?fresh=true", {
      headers: as("alex"),
    });
    const invalidSong = await app.request("/api/songs", {
      method: "POST",
      headers: { ...as("alex"), "content-type": "application/json" },
      body: JSON.stringify({ id: 1 }),
    });
    const invalidSpotify = await app.request("/api/spotify/enabled", {
      method: "PUT",
      headers: { ...as("alex"), "content-type": "application/json" },
      body: JSON.stringify({ on: "yes" }),
    });

    for (const response of [invalidPerson, invalidStatus, invalidSong, invalidSpotify]) {
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        code: "VALIDATION_ERROR",
        requestId: expect.any(String) as string,
      });
    }
  });
});
