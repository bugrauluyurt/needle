import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { LB_PLAYLISTS, LB_TOKEN, LB_USER, UNDERTOW_MBID } from "./fixtures/listenbrainz.ts";

const PORT = Number(process.env.MOCK_SOULSEEK_PORT ?? 14538);
const DOWNLOADS = process.env.SOULSEEK_DIR ?? "e2e/.soulseek";
const FILE = { filename: "Music\\Glass Harbor\\Tidal\\03 - Undertow.flac", size: 4, length: 212, extension: "flac" };
const recording = {
  id: UNDERTOW_MBID,
  title: "Undertow",
  length: 212_000,
  "artist-credit": [{ name: "Glass Harbor" }],
  releases: [
    {
      title: "Tidal",
      date: "2023-04-01",
      status: "Official",
      "release-group": { id: "rg-tidal", "primary-type": "Album" },
    },
  ],
};
let done = false;
type Listen = { listened_at: number; track_metadata: { additional_info?: { submission_client?: string } } };
const listens: Listen[] = [];

function json(res: ServerResponse, body: unknown, status = 200) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function bodyOf(req: IncomingMessage): Promise<string> {
  let body = "";
  for await (const chunk of req) body += String(chunk);
  return body;
}

async function listenbrainz(req: IncomingMessage, res: ServerResponse, path: string) {
  const authed = req.headers.authorization === `Token ${LB_TOKEN}`;
  if (path === "/lb/1/validate-token")
    return json(
      res,
      authed
        ? { code: 200, message: "Token valid.", valid: true, user_name: LB_USER }
        : { code: 200, message: "Token invalid.", valid: false },
    );
  if (path === "/lb/1/submit-listens") {
    const sent = JSON.parse(await bodyOf(req)) as { listen_type: string; payload: Listen[] };
    if (sent.listen_type !== "playing_now") listens.unshift(...sent.payload);
    return json(res, { status: "ok" });
  }
  if (path === `/lb/1/user/${LB_USER}/listens`)
    return json(res, { payload: { count: listens.length, listens: listens.slice(0, 25) } });
  if (path === `/lb/1/user/${LB_USER}/playlists/createdfor`)
    return json(res, {
      count: LB_PLAYLISTS.length,
      playlists: LB_PLAYLISTS.map((p) => ({ playlist: { ...p, track: [] } })),
    });
  const found = LB_PLAYLISTS.find((p) => p.identifier.endsWith(path.split("/").at(-1) ?? "?"));
  if (path.startsWith("/lb/1/playlist/") && found)
    return authed ? json(res, { playlist: found }) : json(res, { code: 401, error: "Invalid token" }, 401);
  json(res, { code: 404, error: "Not found" }, 404);
}

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://mock");
  const path = url.pathname;
  if (path.startsWith("/lb/")) return void listenbrainz(req, res, path);
  if (path.startsWith("/deezer/")) return json(res, { data: [] });
  if (path === "/mb/recording")
    return json(res, {
      recordings: (url.searchParams.get("query") ?? "").toLowerCase().includes("undertow") ? [recording] : [],
    });
  if (req.headers["x-api-key"] !== "test-slskd") return json(res, { message: "Unauthorized" }, 401);
  if (path === "/api/v0/application")
    return json(res, {
      version: { current: "0.0.0-mock" },
      server: { state: "Connected, LoggedIn", isLoggedIn: true },
    });
  if (req.method === "POST" && path === "/api/v0/searches") return json(res, { id: "s1", isComplete: false });
  if (path === "/api/v0/searches/s1")
    return req.method === "DELETE" ? json(res, {}) : json(res, { id: "s1", isComplete: true });
  if (path === "/api/v0/searches/s1/responses")
    return json(res, [
      { username: "peer", files: [FILE], hasFreeUploadSlot: true, uploadSpeed: 1_000_000, queueLength: 0 },
    ]);
  if (req.method === "POST" && path === "/api/v0/transfers/downloads/peer") {
    mkdirSync(join(DOWNLOADS, "Tidal"), { recursive: true });
    writeFileSync(join(DOWNLOADS, "Tidal", "03 - Undertow.flac"), "flac");
    done = true;
    return json(res, {});
  }
  if (path === "/api/v0/transfers/downloads/peer") {
    return json(res, {
      username: "peer",
      directories: done
        ? [
            {
              files: [
                {
                  id: "t1",
                  username: "peer",
                  filename: FILE.filename,
                  state: "Completed, Succeeded",
                  percentComplete: 100,
                  size: 4,
                },
              ],
            },
          ]
        : [],
    });
  }
  if (req.method === "DELETE") return json(res, {});
  json(res, { message: "not found" }, 404);
}).listen(PORT, "127.0.0.1");
