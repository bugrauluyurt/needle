import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import type { Context } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Capabilities, ImportedTrack, InternetRadioStation, LidarrAlbum, LidarrSearch, Period, PlayReport, RequestItem, SongCandidate } from "@needle/shared";
import { songKey } from "@needle/shared";
import type { Config } from "./config.ts";
import { DeviceHub } from "./devices.ts";
import { Lidarr, LidarrError } from "./lidarr.ts";
import { Mixes } from "./mixes.ts";
import type { Auth } from "./navidrome.ts";
import { authFromHeaders, authFromQuery, Navidrome, SubsonicFailure } from "./navidrome.ts";
import { proxyToNavidrome } from "./proxy.ts";
import { PHOTO_MAX_BYTES, PHOTO_TYPES, Profiles } from "./profiles.ts";
import { MusicBrainz, MusicBrainzError } from "./musicbrainz.ts";
import { Deezer } from "./deezer.ts";
import { Requests, toItem } from "./requests.ts";
import { Slskd, SlskdError, SongDownloads } from "./soulseek.ts";
import { LibrarySearch } from "./search.ts";
import { Spotify, SpotifyError } from "./spotify.ts";
import { Status } from "./status.ts";
import { PlayLog } from "./stats.ts";

type Env = { Variables: { auth: Auth } };

const PERIODS = new Set<Period>(["month", "quarter", "year", "all"]);
const ADMIN_TTL = 10 * 60_000;
const MISSING_ALBUMS_LIMIT = 25;
const SONG_RESULTS = 12;
const FILE = /\/[^/]+\.[a-z0-9]+$/i;

export function createApp(config: Config, db: DatabaseSync) {
  const navidrome = new Navidrome(config.navidromeUrl);
  const log = new PlayLog(db);
  const mixes = new Mixes(navidrome, log);
  const library = new LibrarySearch(navidrome);
  const profiles = new Profiles(db);
  const requests = new Requests(db);
  const musicbrainz = new MusicBrainz(config.musicbrainzUrl);
  const deezer = new Deezer(config.deezerUrl);
  const slskd = config.soulseek ? new Slskd(config.soulseek.url, config.soulseek.apiKey) : null;
  const songs = config.soulseek && slskd
    ? new SongDownloads({ slskd, requests, navidrome, downloadsDir: config.soulseek.downloadsDir, singlesDir: config.soulseek.singlesDir })
    : null;
  const lidarr = config.lidarr ? new Lidarr(config.lidarr) : null;
  const status = new Status({ config, navidrome, library, lidarr, slskd, musicbrainz, deezer });
  const spotify = config.spotify && config.publicUrl
    ? new Spotify({ ...config.spotify, publicUrl: config.publicUrl, db, navidrome })
    : null;
  const hub = new DeviceHub();
  const admins = new Map<string, { admin: boolean; until: number }>();

  const isAdmin = async (auth: Auth) => {
    const hit = admins.get(auth.user);
    if (hit && hit.until > Date.now()) return hit.admin;
    const r = await navidrome.call<{ user: { adminRole?: boolean } }>(auth, "getUser", { username: auth.user });
    const admin = Boolean(r.user.adminRole);
    admins.set(auth.user, { admin, until: Date.now() + ADMIN_TTL });
    return admin;
  };

  const app = new Hono<Env>();

  app.onError((err, c) => {
    if (err instanceof SpotifyError) return c.json({ error: err.message }, err.status === 401 || err.status === 409 ? err.status : 502);
    if (err instanceof LidarrError || err instanceof SubsonicFailure || err instanceof SlskdError || err instanceof MusicBrainzError) return c.json({ error: err.message }, 502);
    console.error(err);
    return c.json({ error: "Something went wrong on the Needle server" }, 500);
  });

  app.get("/api/health", (c) => c.json({ ok: true }));

  app.get("/api/spotify/callback", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    if (!spotify || !code || !state) return c.redirect("/settings?spotify=error");
    try {
      await spotify.complete(code, state);
      return c.redirect("/settings?spotify=connected");
    } catch {
      return c.redirect("/settings?spotify=error");
    }
  });

  app.use("/api/*", async (c, next) => {
    const auth = authFromHeaders(c.req.raw.headers);
    const status = auth ? await navidrome.verify(auth) : "denied";
    if (status === "down") return c.json({ error: "Navidrome isn't responding" }, 503);
    if (!auth || status === "denied") return c.json({ error: "Sign in again" }, 401);
    c.set("auth", auth);
    await next();
  });

  const needLidarr = async (c: Context<Env>) => {
    if (!lidarr) return { error: c.json({ error: "Lidarr isn't set up on the Needle server" }, 404) };
    if (!(await isAdmin(c.get("auth")))) return { error: c.json({ error: "Only Navidrome admins can add music" }, 403) };
    return { lidarr };
  };
  const needSongs = async (c: Context<Env>) => {
    if (!songs) return { error: c.json({ error: "slskd isn't set up on the Needle server" }, 404) };
    if (!(await isAdmin(c.get("auth")))) return { error: c.json({ error: "Only Navidrome admins can add music" }, 403) };
    return { songs };
  };
  const recordAlbum = (user: string, a: LidarrAlbum) =>
    requests.add({ user, kind: "album", ref: a.foreignAlbumId, title: a.title, artist: a.artist, cover_url: a.coverUrl, state: a.state });
  const needSpotify = (c: Context<Env>) => spotify
    ? { spotify }
    : { error: c.json({ error: "Add SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET and PUBLIC_URL to the Needle server" }, 404) };

  app.get("/api/capabilities", async (c) => {
    const auth = c.get("auth");
    const caps: Capabilities = {
      lidarr: Boolean(lidarr) && (await isAdmin(auth)),
      spotify: Boolean(spotify),
      spotifyConnected: spotify?.connected(auth.user) ?? false,
      spotifyPlayback: spotify?.canPlay(auth.user) ?? false,
      spotifyReconnect: spotify?.needsReconnect(auth.user) ?? false,
      spotifyEnabled: spotify?.enabled(auth.user) ?? false,
      songs: Boolean(songs) && (await isAdmin(auth)),
      publicUrl: config.publicUrl,
    };
    return c.json(caps);
  });

  app.get("/api/status", async (c) => {
    const auth = c.get("auth");
    if (!(await isAdmin(auth))) return c.json({ error: "Only Navidrome admins can see connections" }, 403);
    return c.json({ checks: await status.checks(auth, c.req.query("fresh") === "1") });
  });

  app.post("/api/plays", async (c) => {
    const p = await c.req.json<PlayReport>();
    if (!p.songId || !p.title || typeof p.msPlayed !== "number") return c.json({ error: "Missing play fields" }, 400);
    log.record(c.get("auth").user, p);
    return c.body(null, 204);
  });

  app.get("/api/stats", (c) => {
    const period = (c.req.query("period") ?? "month") as Period;
    if (!PERIODS.has(period)) return c.json({ error: "Unknown period" }, 400);
    return c.json(log.stats(c.get("auth").user, period));
  });

  app.get("/api/search", async (c) => c.json(await library.search(c.get("auth"), c.req.query("q") ?? "")));

  app.get("/api/me", (c) => {
    const { user } = c.get("auth");
    return c.json({ user, photo: profiles.photo(user) });
  });

  app.put("/api/me/photo", async (c) => {
    const type = c.req.header("content-type") ?? "";
    const photo = new Uint8Array(await c.req.arrayBuffer());
    if (!PHOTO_TYPES.has(type)) return c.json({ error: "Use a JPEG, PNG or WebP image" }, 415);
    if (!photo.length || photo.length > PHOTO_MAX_BYTES) return c.json({ error: "That image is too large" }, 413);
    profiles.setPhoto(c.get("auth").user, photo, type);
    return c.body(null, 204);
  });

  app.delete("/api/me/photo", (c) => {
    profiles.removePhoto(c.get("auth").user);
    return c.body(null, 204);
  });

  app.get("/api/browse", async (c) => c.json(await library.browse(c.get("auth"))));

  app.get("/api/mixes", async (c) => c.json(await mixes.forUser(c.get("auth"))));

  app.get("/api/lidarr/search", async (c) => {
    const r = await needLidarr(c);
    if (r.error) return r.error;
    const q = c.req.query("q")?.trim() ?? "";
    if (q.length < 2) return c.json({ albums: [] } satisfies LidarrSearch);
    const found = await r.lidarr.search(q);
    const match = r.lidarr.pickArtist(found.artists, q);
    const discography = !match ? [] : match.id ? await r.lidarr.artistAlbums(match.id) : await musicbrainz.albumsBy(match.foreignArtistId, match.artistName).catch(() => []);
    const seen = new Set(discography.map((a) => a.foreignAlbumId));
    return c.json({
      albums: [...discography.filter((a) => a.state !== "available"), ...found.albums.filter((a) => !seen.has(a.foreignAlbumId))],
    } satisfies LidarrSearch);
  });

  app.get("/api/lidarr/albums", async (c) => {
    const r = await needLidarr(c);
    if (r.error) return r.error;
    const ids = (c.req.query("ids") ?? "").split(",").filter(Boolean).slice(0, 20);
    return c.json(await r.lidarr.albumStates(ids));
  });

  app.post("/api/lidarr/albums/:id", async (c) => {
    const r = await needLidarr(c);
    if (r.error) return r.error;
    const album = await r.lidarr.getAlbum(c.req.param("id"));
    if (album.title) recordAlbum(c.get("auth").user, album);
    return c.json(album);
  });

  app.get("/api/songs/search", async (c) => {
    const r = await needSongs(c);
    if (r.error) return r.error;
    const q = c.req.query("q")?.trim() ?? "";
    if (q.length < 2) return c.json([]);
    const [top, found, owned] = await Promise.all([deezer.topSongs(q), musicbrainz.recordings(q), library.songKeys(c.get("auth"))]);
    const seen = new Set<string>();
    return c.json([...top, ...found].filter((s) => {
      const key = songKey(s.artist, s.title);
      if (owned.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, SONG_RESULTS));
  });

  app.post("/api/songs", async (c) => {
    const r = await needSongs(c);
    if (r.error) return r.error;
    return c.json(toItem(r.songs.start(c.get("auth"), await c.req.json<SongCandidate>())));
  });

  app.get("/api/requests", async (c) => {
    const rows = requests.list(c.get("auth").user);
    const albumIds = rows.filter((r) => r.kind === "album").map((r) => r.ref);
    const live = lidarr && albumIds.length ? await lidarr.albumStates(albumIds).catch(() => []) : [];
    const byId = new Map(live.map((a) => [a.foreignAlbumId, a]));
    return c.json(rows.map((row): RequestItem => {
      const a = row.kind === "album" ? byId.get(row.ref) : undefined;
      return { ...toItem(row), ...(a ? { state: a.state, progress: a.progress, coverUrl: a.coverUrl ?? row.cover_url } : {}) };
    }));
  });

  app.post("/api/requests/:id/retry", async (c) => {
    const row = requests.get(Number(c.req.param("id")));
    if (row?.user !== c.get("auth").user) return c.json({ error: "No such request" }, 404);
    if (row.kind === "album") {
      const r = await needLidarr(c);
      if (r.error) return r.error;
      return c.json(toItem(recordAlbum(row.user, await r.lidarr.getAlbum(row.ref))));
    }
    const r = await needSongs(c);
    if (r.error) return r.error;
    return c.json(toItem(r.songs.start(c.get("auth"), { id: row.ref, title: row.title, artist: row.artist, album: null, duration: null, year: null, coverUrl: row.cover_url })));
  });

  app.delete("/api/requests/:id", (c) => {
    requests.remove(c.get("auth").user, Number(c.req.param("id")));
    return c.body(null, 204);
  });

  app.get("/api/lidarr/artists", async (c) => {
    const r = await needLidarr(c);
    if (r.error) return r.error;
    const names = (c.req.query("names") ?? "").split("|").map((n) => n.trim()).filter(Boolean).slice(0, 8);
    return c.json(await r.lidarr.lookupArtists(names));
  });

  app.get("/api/lidarr/downloads", async (c) => {
    const r = await needLidarr(c);
    if (r.error) return r.error;
    return c.json(await r.lidarr.downloads());
  });

  app.get("/api/spotify/login", (c) => {
    const r = needSpotify(c);
    return r.error ?? c.json({ url: r.spotify.authorizeUrl(c.get("auth").user) });
  });

  app.delete("/api/spotify", (c) => {
    const r = needSpotify(c);
    if (r.error) return r.error;
    r.spotify.disconnect(c.get("auth").user);
    return c.body(null, 204);
  });

  app.put("/api/spotify/enabled", async (c) => {
    const r = needSpotify(c);
    if (r.error) return r.error;
    const { on } = await c.req.json<{ on: boolean }>();
    r.spotify.setEnabled(c.get("auth").user, on);
    return c.body(null, 204);
  });

  app.get("/api/spotify/token", async (c) => {
    const r = needSpotify(c);
    return r.error ?? c.json(await r.spotify.token(c.get("auth").user));
  });

  app.get("/api/spotify/playlists", async (c) => {
    const r = needSpotify(c);
    return r.error ?? c.json(await r.spotify.playlists(c.get("auth").user));
  });

  app.post("/api/spotify/import", async (c) => {
    const r = needSpotify(c);
    if (r.error) return r.error;
    const { source } = await c.req.json<{ source: string }>();
    return c.json(await r.spotify.import(c.get("auth"), source));
  });

  app.post("/api/spotify/missing", async (c) => {
    const r = await needLidarr(c);
    if (r.error) return r.error;
    const { tracks } = await c.req.json<{ tracks: ImportedTrack[] }>();
    const groups = [...new Map(tracks.map((t) => [`${t.artist}\0${t.album}`, t])).values()];
    const albums = groups.slice(0, MISSING_ALBUMS_LIMIT);
    let requested = 0;
    for (const t of albums) {
      const [hit] = await r.lidarr.searchAlbums(`${t.artist} ${t.album}`);
      if (!hit) continue;
      recordAlbum(c.get("auth").user, await r.lidarr.getAlbum(hit.foreignAlbumId));
      requested++;
    }
    return c.json({ requested, notFound: albums.length - requested, skipped: groups.length - albums.length });
  });

  app.all("/rest/*", (c) => proxyToNavidrome(c.req.raw, config.navidromeUrl).catch(() => c.json({ error: "Navidrome isn't responding" }, 502)));

  app.get("/radio/:id", async (c) => {
    const auth = authFromQuery(new URL(c.req.url));
    if (!auth || (await navidrome.verify(auth)) !== "ok") return c.text("Sign in again", 401);
    const r = await navidrome.call<{ internetRadioStations: { internetRadioStation?: InternetRadioStation[] } }>(auth, "getInternetRadioStations");
    const station = r.internetRadioStations.internetRadioStation?.find((s) => s.id === c.req.param("id"));
    if (!station) return c.text("No such station", 404);
    const upstream = await fetch(station.streamUrl, { headers: { "icy-metadata": "0", "user-agent": "Needle" }, signal: c.req.raw.signal }).catch(() => null);
    if (!upstream?.ok || !upstream.body) return c.text("The station isn't responding", 502);
    return new Response(upstream.body, {
      headers: { "content-type": upstream.headers.get("content-type") ?? "audio/mpeg", "cache-control": "no-store" },
    });
  });

  if (existsSync(config.webDist)) {
    const index = readFileSync(join(config.webDist, "index.html"), "utf8");
    app.use("/assets/*", async (c, next) => {
      await next();
      c.header("cache-control", "public, max-age=31536000, immutable");
    });
    const files = serveStatic<Env>({ root: config.webDist, precompressed: true });
    app.use((c, next) => (FILE.test(c.req.path) && !c.req.path.endsWith("/index.html") ? files(c, next) : next()));
    app.get("*", (c) => {
      if (FILE.test(c.req.path) && !c.req.path.endsWith("/index.html")) return c.notFound();
      c.header("cache-control", "no-cache");
      return c.html(index);
    });
  }

  return { app, hub, navidrome };
}
