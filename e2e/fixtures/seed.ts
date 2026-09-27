import { createHash } from "node:crypto";
import type { Playlist, Song, SubsonicEnvelope } from "@needle/shared";
import { openDatabase } from "../../apps/server/src/db.ts";

const NAVIDROME = process.env.NAVIDROME_URL ?? "http://127.0.0.1:14533";
const USER = process.env.NEEDLE_TEST_USER ?? "admin";
const PASSWORD = process.env.NEEDLE_TEST_PASSWORD ?? "needle-test";
const DATA_DIR = process.env.NEEDLE_DATA_DIR;
const salt = "seed";
const auth = { u: USER, t: createHash("md5").update(PASSWORD + salt).digest("hex"), s: salt, v: "1.16.1", c: "seed", f: "json" };

async function call<T>(method: string, params: Record<string, string | string[]> = {}): Promise<T> {
  const q = new URLSearchParams(auth);
  for (const [k, v] of Object.entries(params)) for (const x of Array.isArray(v) ? v : [v]) q.append(k, x);
  const r = (await (await fetch(`${NAVIDROME}/rest/${method}`, { method: "POST", body: q })).json()) as SubsonicEnvelope<T>;
  const body = r["subsonic-response"];
  if (body.status !== "ok") throw new Error(`${method}: ${body.error?.message ?? "failed"}`);
  return body;
}

const every = <T>(arr: T[], step: number, offset = 0) => arr.filter((_, i) => (i + offset) % step === 0);

const { searchResult3 } = await call<{ searchResult3: { song?: Song[] } }>("search3", { query: "", songCount: "500", albumCount: "0", artistCount: "0" });
const songs = searchResult3.song ?? [];
if (!songs.length) throw new Error("The test library is empty; run the fixtures and scan first");

const { starred2 } = await call<{ starred2: { song?: Song[]; album?: { id: string }[]; artist?: { id: string }[] } }>("getStarred2");
const unstar = { id: (starred2.song ?? []).map((s) => s.id), albumId: (starred2.album ?? []).map((a) => a.id), artistId: (starred2.artist ?? []).map((a) => a.id) };
if (unstar.id.length || unstar.albumId.length || unstar.artistId.length) await call("unstar", unstar);
await call("star", { id: every(songs, 3).map((s) => s.id) });
const { playlists } = await call<{ playlists: { playlist?: Playlist[] } }>("getPlaylists");
for (const p of playlists.playlist ?? []) await call("deletePlaylist", { id: p.id });
await call("createPlaylist", { name: "Late night drive", songId: every(songs, 3, 1).map((s) => s.id) });
await call("createPlaylist", { name: "Deep focus", songId: songs.filter((s) => /Ambient|Jazz/.test(s.genre ?? "")).map((s) => s.id) });
const albums = [...new Set(songs.map((s) => s.albumId).filter((a): a is string => Boolean(a)))];
await call("star", { albumId: albums.slice(0, 2) });

const { internetRadioStations } = await call<{ internetRadioStations: { internetRadioStation?: { id: string }[] } }>("getInternetRadioStations");
for (const s of internetRadioStations.internetRadioStation ?? []) await call("deleteInternetRadioStation", { id: s.id });
await call("createInternetRadioStation", { name: "Groove Salad", streamUrl: "https://ice.somafm.com/groovesalad-128-mp3", homepageUrl: "https://somafm.com/groovesalad/" });
const stream = `${NAVIDROME}/rest/stream.view?${new URLSearchParams({ ...auth, id: songs[0]?.id ?? "" }).toString()}`;
await call("createInternetRadioStation", { name: "Test Signal", streamUrl: stream, homepageUrl: "http://127.0.0.1/" });

if (DATA_DIR) {
  const db = openDatabase(DATA_DIR);
  db.exec("DELETE FROM plays WHERE device = 'seed'");
  const insert = db.prepare(`INSERT INTO plays (user, song_id, title, artist, artist_id, album, album_id, genre, cover_art, duration, ms_played, played_at, device)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'seed')`);
  const now = Date.now();
  const hourWeights = [2, 1, 1, 0, 0, 0, 1, 3, 5, 6, 6, 5, 4, 4, 6, 7, 6, 5, 6, 8, 12, 16, 18, 10];
  let n = 0;
  for (let day = 0; day < 75; day++) {
    for (let h = 0; h < 24; h++) {
      const plays = Math.round((hourWeights[h] ?? 0) * ((day * 7 + h) % 5 === 0 ? 1 : 0.35));
      for (let k = 0; k < plays; k++) {
        const s = songs[(day * 31 + h * 7 + k * 13) % Math.min(songs.length, day % 3 === 0 ? 12 : songs.length)] as Song;
        insert.run(USER, s.id, s.title, s.artist ?? "", s.artistId ?? null, s.album ?? "", s.albumId ?? null, s.genre ?? null, s.coverArt ?? null,
          s.duration ?? 0, (s.duration ?? 30) * 1000, now - day * 86_400_000 - (new Date(now).getHours() - h) * 3_600_000 - k * 60_000);
        n++;
      }
    }
  }
  db.close();
  console.log(`  + ${n} plays`);
}
console.log(`seeded ${songs.length} songs, 2 playlists, likes and radio stations`);
