import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { ServerResponse } from "node:http";
import { join } from "node:path";

const PORT = Number(process.env.MOCK_SOULSEEK_PORT ?? 14538);
const DOWNLOADS = process.env.SOULSEEK_DIR ?? "e2e/.soulseek";
const FILE = { filename: "Music\\Glass Harbor\\Tidal\\03 - Undertow.flac", size: 4, length: 212, extension: "flac" };
const recording = {
  id: "mb-undertow", title: "Undertow", length: 212_000, "artist-credit": [{ name: "Glass Harbor" }],
  releases: [{ title: "Tidal", date: "2023-04-01", status: "Official", "release-group": { id: "rg-tidal", "primary-type": "Album" } }],
};
let done = false;

function json(res: ServerResponse, body: unknown, status = 200) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://mock");
  const path = url.pathname;
  if (path.startsWith("/deezer/")) return json(res, { data: [] });
  if (path === "/mb/recording") return json(res, { recordings: (url.searchParams.get("query") ?? "").toLowerCase().includes("undertow") ? [recording] : [] });
  if (req.headers["x-api-key"] !== "test-slskd") return json(res, { message: "Unauthorized" }, 401);
  if (req.method === "POST" && path === "/api/v0/searches") return json(res, { id: "s1", isComplete: false });
  if (path === "/api/v0/searches/s1") return req.method === "DELETE" ? json(res, {}) : json(res, { id: "s1", isComplete: true });
  if (path === "/api/v0/searches/s1/responses") return json(res, [{ username: "peer", files: [FILE], hasFreeUploadSlot: true, uploadSpeed: 1_000_000, queueLength: 0 }]);
  if (req.method === "POST" && path === "/api/v0/transfers/downloads/peer") {
    mkdirSync(join(DOWNLOADS, "Tidal"), { recursive: true });
    writeFileSync(join(DOWNLOADS, "Tidal", "03 - Undertow.flac"), "flac");
    done = true;
    return json(res, {});
  }
  if (path === "/api/v0/transfers/downloads/peer") {
    return json(res, { username: "peer", directories: done ? [{ files: [{ id: "t1", username: "peer", filename: FILE.filename, state: "Completed, Succeeded", percentComplete: 100, size: 4 }] }] : [] });
  }
  if (req.method === "DELETE") return json(res, {});
  json(res, { message: "not found" }, 404);
}).listen(PORT, "127.0.0.1");
