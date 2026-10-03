import { serve } from "@hono/node-server";
import type { Server } from "node:http";
import { WebSocketServer } from "ws";
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { openDatabaseWithBackup } from "./db.ts";
import { createRealtimeApp, DEVICE_MAX_PAYLOAD_BYTES } from "./realtime/devices.ts";

const config = loadConfig();
const db = await openDatabaseWithBackup(config.dataDir);
const { app, hub, verifier } = createApp(config, db);
const realtimeApp = createRealtimeApp(app, { hub, trustedProxy: config.trustedProxy, verifier });
const webSocketServer = new WebSocketServer({
  noServer: true,
  maxPayload: DEVICE_MAX_PAYLOAD_BYTES,
});

const server = serve(
  {
    fetch: realtimeApp.fetch,
    port: config.port,
    hostname: "0.0.0.0",
    websocket: { server: webSocketServer },
  },
  (info) => {
    console.log(`needle listening on :${info.port}, navidrome at ${config.navidromeUrl}`);
  },
) as Server;

const beat = setInterval(() => hub.heartbeat(), 15_000);

const stop = () => {
  clearInterval(beat);
  server.close(() => {
    db.close();
    process.exit(0);
  });
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
