import { once } from "node:events";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { serve } from "@hono/node-server";
import { WebSocket, WebSocketServer } from "ws";
import type { ServerMessage } from "@needle/shared";
import { createApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { openDatabase } from "../src/db.ts";
import { createRealtimeApp, DEVICE_MAX_PAYLOAD_BYTES } from "../src/realtime/devices.ts";
import { NAVIDROME_VERIFICATION_ATTEMPT_LIMIT } from "../src/http/navidrome-verifier.ts";

const openServers: Server[] = [];
const nativeFetch = globalThis.fetch;

afterEach(async () => {
  vi.unstubAllGlobals();

  await Promise.all(
    openServers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
});

describe("device realtime route", () => {
  it("rejects missing and invalid Navidrome credentials before upgrading", async () => {
    const baseUrl = await startRealtimeServer();

    await expect(getRejectedStatus(`${baseUrl}/api/devices`)).resolves.toBe(401);
    await expect(getRejectedStatus(`${baseUrl}/api/devices?u=alex&t=wrong&s=salt`)).resolves.toBe(401);
  });

  it("shares one invalid-credential budget across HTTP and WebSocket verification", async () => {
    const baseUrl = await startRealtimeServer();
    const httpBaseUrl = baseUrl.replace("ws://", "http://");
    const httpAttemptCount = NAVIDROME_VERIFICATION_ATTEMPT_LIMIT / 2;

    for (let attemptIndex = 0; attemptIndex < httpAttemptCount; attemptIndex += 1) {
      const response = await nativeFetch(`${httpBaseUrl}/api/stats`, {
        headers: {
          "x-needle-user": "alex",
          "x-needle-token": `http-wrong-${attemptIndex}`,
          "x-needle-salt": "salt",
          "x-forwarded-for": `198.51.100.${attemptIndex + 1}`,
        },
      });

      expect(response.status).toBe(401);
    }

    for (let attemptIndex = httpAttemptCount; attemptIndex < NAVIDROME_VERIFICATION_ATTEMPT_LIMIT; attemptIndex += 1) {
      await expect(getRejectedStatus(`${baseUrl}/api/devices?u=alex&t=wrong-${attemptIndex}&s=salt`)).resolves.toBe(
        401,
      );
    }

    await expect(getRejectedStatus(`${baseUrl}/api/devices?u=alex&t=limited&s=salt`)).resolves.toBe(429);
  });

  it("upgrades a valid authenticated device connection", async () => {
    const baseUrl = await startRealtimeServer();
    const socket = new WebSocket(`${baseUrl}/api/devices?u=alex&t=tok&s=salt`);

    await once(socket, "open");
    socket.close();
    await once(socket, "close");
  });

  it("closes invalid messages through the upgraded route", async () => {
    const baseUrl = await startRealtimeServer();
    const socket = new WebSocket(`${baseUrl}/api/devices?u=alex&t=tok&s=salt`);

    await once(socket, "open");
    socket.send("{");

    const [code, reason] = (await once(socket, "close")) as [number, Buffer];

    expect(code).toBe(1008);
    expect(reason.toString()).toBe("invalid message");
  });

  it("forwards a 300 song transfer within the configured payload limit", async () => {
    const baseUrl = await startRealtimeServer();
    const sender = new WebSocket(`${baseUrl}/api/devices?u=alex&t=tok&s=salt`);
    const receiver = new WebSocket(`${baseUrl}/api/devices?u=alex&t=tok&s=salt`);

    await Promise.all([once(sender, "open"), once(receiver, "open")]);

    const devicesReady = getNextMessage(
      receiver,
      (message) => message.type === "devices" && message.devices.length === 2,
    );

    sender.send(
      JSON.stringify({
        type: "hello",
        device: { id: "sender", name: "Sender", kind: "desktop" },
      }),
    );
    receiver.send(
      JSON.stringify({
        type: "hello",
        device: { id: "receiver", name: "Receiver", kind: "phone" },
      }),
    );

    await devicesReady;

    const commandMessage = getNextMessage(receiver, (message) => message.type === "command");
    const songs = Array.from({ length: 300 }, (_song, songIndex) => ({
      id: `song-${songIndex}`,
      title: `Song ${songIndex}`,
    }));

    sender.send(
      JSON.stringify({
        type: "command",
        to: "receiver",
        command: {
          action: "transfer",
          songs,
          index: 0,
          position: 0,
          playing: true,
        },
      }),
    );

    const message = await commandMessage;

    expect(message).toMatchObject({
      type: "command",
      from: "sender",
      command: { action: "transfer" },
    });
    expect(message.type === "command" && message.command.action === "transfer" && message.command.songs).toHaveLength(
      300,
    );

    const senderClosed = once(sender, "close");
    const receiverClosed = once(receiver, "close");

    sender.close();
    receiver.close();

    await Promise.all([senderClosed, receiverClosed]);
  });
});

async function startRealtimeServer() {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      const parameters = init?.body instanceof URLSearchParams ? init.body : url.searchParams;
      const isAuthenticated = parameters.get("u") === "alex" && parameters.get("t") === "tok";

      return Promise.resolve(
        Response.json({
          "subsonic-response": {
            status: isAuthenticated ? "ok" : "failed",
            version: "1.16.1",
            ...(isAuthenticated
              ? {}
              : {
                  error: { code: 40, message: "Wrong username or password" },
                }),
          },
        }),
      );
    }),
  );

  const database = openDatabase(":memory:");
  const createdApp = createApp(
    loadConfig({
      navidromeUrl: "http://navidrome.test",
      dataDir: ":memory:",
      webDist: "/nonexistent",
    }),
    database,
  );

  const realtimeApp = createRealtimeApp(createdApp.app, {
    hub: createdApp.hub,
    verifier: createdApp.verifier,
    trustedProxy: false,
  });

  const webSocketServer = new WebSocketServer({
    noServer: true,
    maxPayload: DEVICE_MAX_PAYLOAD_BYTES,
  });
  const server = serve({
    fetch: realtimeApp.fetch,
    hostname: "127.0.0.1",
    port: 0,
    websocket: { server: webSocketServer },
  }) as Server;

  openServers.push(server);
  await once(server, "listening");

  const address = server.address() as AddressInfo;

  return `ws://127.0.0.1:${address.port}`;
}

function getRejectedStatus(url: string) {
  return new Promise<number>((resolve, reject) => {
    const socket = new WebSocket(url);

    socket.once("open", () => reject(new Error("The socket unexpectedly opened")));
    socket.once("unexpected-response", (_request, response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    socket.once("error", reject);
  });
}

function getNextMessage(socket: WebSocket, accepts: (message: ServerMessage) => boolean) {
  return new Promise<ServerMessage>((resolve) => {
    const receive = (rawMessage: Buffer) => {
      const message = JSON.parse(rawMessage.toString()) as ServerMessage;

      if (!accepts(message)) return;

      socket.off("message", receive);
      resolve(message);
    };

    socket.on("message", receive);
  });
}
