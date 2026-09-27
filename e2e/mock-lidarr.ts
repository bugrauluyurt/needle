import { createServer } from "node:http";
import type { ServerResponse } from "node:http";

const PORT = Number(process.env.MOCK_LIDARR_PORT ?? 14537);

type Album = { id?: number; title: string; foreignAlbumId: string; albumType: string; monitored: boolean; releaseDate: string; artist: { artistName: string; foreignArtistId: string }; statistics?: { trackFileCount: number; totalTrackCount: number } };

const catalog: Album[] = [
  { title: "Harbor Lights", foreignAlbumId: "mb-harbor-lights", albumType: "Album", monitored: false, releaseDate: "2024-05-01T00:00:00Z", artist: { artistName: "Neon Harbor", foreignArtistId: "mb-neon" } },
  { id: 41, title: "Coastline Tapes", foreignAlbumId: "mb-coastline", albumType: "Album", monitored: false, releaseDate: "2017-03-01T00:00:00Z", artist: { artistName: "Neon Harbor", foreignArtistId: "mb-neon" }, statistics: { trackFileCount: 0, totalTrackCount: 9 } },
];
const searches = new Map<number, number>();
let nextId = 100;

function json(res: ServerResponse, body: unknown, status = 200) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

createServer((req, res) => {
  if (req.headers["x-api-key"] !== "test-key") return json(res, { message: "Unauthorized" }, 401);
  const url = new URL(req.url ?? "/", "http://lidarr");
  const path = url.pathname;
  let raw = "";
  req.on("data", (c: Buffer) => (raw += c.toString()));
  req.on("end", () => {
    const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    if (req.method === "GET" && path === "/api/v1/search") {
      const term = (url.searchParams.get("term") ?? "").toLowerCase();
      return json(res, catalog.filter((a) => `${a.title} ${a.artist.artistName}`.toLowerCase().includes(term.split(" ")[0] ?? "")).map((album) => ({ album })));
    }
    if (req.method === "GET" && path === "/api/v1/album") {
      const ids = url.searchParams.getAll("albumIds").map(Number);
      const foreign = url.searchParams.get("foreignAlbumId");
      return json(res, catalog.filter((a) => a.id && (ids.includes(a.id) || a.foreignAlbumId === foreign)));
    }
    if (req.method === "GET" && path === "/api/v1/album/lookup") {
      const id = (url.searchParams.get("term") ?? "").replace("lidarr:", "");
      return json(res, catalog.filter((a) => a.foreignAlbumId === id));
    }
    if (req.method === "POST" && path === "/api/v1/album") {
      const a = catalog.find((x) => x.foreignAlbumId === body.foreignAlbumId);
      if (a) {
        a.id = nextId++;
        a.monitored = true;
      }
      return json(res, a ?? {});
    }
    if (req.method === "PUT" && path === "/api/v1/album/monitor") {
      for (const a of catalog) if (a.id && (body.albumIds as number[]).includes(a.id)) a.monitored = true;
      return json(res, {});
    }
    if (req.method === "POST" && path === "/api/v1/command") {
      for (const id of (body.albumIds as number[] | undefined) ?? []) searches.set(id, Date.now());
      return json(res, { id: 1 });
    }
    if (req.method === "GET" && path === "/api/v1/command") {
      return json(res, [...searches.entries()].filter(([, t]) => Date.now() - t < 4000).map(([id]) => ({ name: "AlbumSearch", status: "started", body: { albumIds: [id] } })));
    }
    if (req.method === "GET" && path === "/api/v1/queue") {
      const records = [...searches.entries()].filter(([, t]) => Date.now() - t >= 4000).map(([id, t]) => ({
        albumId: id, size: 100, sizeleft: Math.max(0, 100 - Math.round((Date.now() - t - 4000) / 100)), trackedDownloadState: "downloading",
      }));
      return json(res, { records });
    }
    if (path === "/api/v1/rootfolder") return json(res, [{ path: "/music", defaultQualityProfileId: 1, defaultMetadataProfileId: 1 }]);
    if (path === "/api/v1/qualityprofile" || path === "/api/v1/metadataprofile") return json(res, [{ id: 1, name: "Standard" }]);
    if (path === "/api/v1/artist/lookup") return json(res, [{ artistName: url.searchParams.get("term"), foreignArtistId: `mb-${url.searchParams.get("term") ?? ""}`, images: [] }]);
    if (path === "/api/v1/artist") return json(res, req.method === "GET" ? [] : { id: 1 });
    json(res, { message: "not mocked" }, 404);
  });
}).listen(PORT, "127.0.0.1", () => console.log(`mock lidarr on :${PORT}`));
