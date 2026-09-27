import { serve } from "@hono/node-server";
import type { Server } from "node:http";
import { WebSocketServer } from "ws";
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { openDatabase } from "./db.ts";
import { authFromQuery } from "./navidrome.ts";

const config = loadConfig();
const db = openDatabase(config.dataDir);
const { app, hub, navidrome } = createApp(config, db);

const server = serve({ fetch: app.fetch, port: config.port, hostname: "0.0.0.0" }, (info) => {
  console.log(`needle listening on :${info.port}, navidrome at ${config.navidromeUrl}`);
}) as Server;

const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://needle");
  const auth = url.pathname === "/api/devices" ? authFromQuery(url) : null;
  if (!auth) return socket.destroy();
  void navidrome.verify(auth).then((status) => {
    if (status !== "ok") return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => hub.attach(ws, auth.user));
  });
});

const beat = setInterval(() => hub.heartbeat(), 15_000);

const stop = () => {
  clearInterval(beat);
  wss.close();
  server.close(() => {
    db.close();
    process.exit(0);
  });
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
