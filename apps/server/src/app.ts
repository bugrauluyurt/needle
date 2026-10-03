import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import type { Context } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { compress } from "hono/compress";
import type { Capabilities, DiscoveryTrack, ImportedTrack, InternetRadioStation, LidarrAlbum, LidarrSearch, Period, PlayReport, RequestItem, SongCandidate, YouTubeMusicSearchKind } from "@needle/shared";
import { songKey, trackCandidate } from "@needle/shared";
import type { Config } from "./config.ts";
import { DeviceHub } from "./devices.ts";
import { Lidarr, LidarrError } from "./lidarr.ts";
import { ListenBrainz, ListenBrainzError } from "./listenbrainz.ts";
import { Mixes } from "./mixes.ts";
import type { Auth } from "./navidrome.ts";
import { authFromHeaders, authFromQuery, Navidrome, SubsonicFailure } from "./navidrome.ts";
import { proxyToNavidrome } from "./proxy.ts";
import { PHOTO_MAX_BYTES, PHOTO_TYPES, Profiles } from "./profiles.ts";
import { MusicBrainz, MusicBrainzError } from "./musicbrainz.ts";
import { Deezer } from "./deezer.ts";
import { Requests, toItem, toItemFor } from "./requests.ts";
import { Slskd, SlskdError, SongDownloads } from "./soulseek.ts";
import { LibrarySearch } from "./search.ts";
import { Spotify, SpotifyError } from "./spotify.ts";
import { YouTubeMusic, YouTubeMusicError } from "./youtube-music.ts";
import { Status } from "./status.ts";
import { People } from "./people.ts";
import type { Permission, PersonPatch } from "./people.ts";
import { VERSION } from "./version.ts";
import { PlayLog } from "./stats.ts";

type Env = { Variables: { auth: Auth; youtubeMusic: YouTubeMusic } };

const PERIODS = new Set<Period>(["month", "quarter", "year", "all"]);
const ADMIN_TTL = 10 * 60_000;
const MISSING_ALBUMS_LIMIT = 25;
const SONG_RESULTS = 12;
const MISSING_SONGS_LIMIT = 50;
const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_MAX = 200;
const PASSWORD_MAX = 1024;
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
  const people = new People(db);
  const listenbrainz = new ListenBrainz({ url: config.listenbrainzUrl, db, navidrome, library, requests });
  const spotify = config.spotify && config.publicUrl
    ? new Spotify({ ...config.spotify, publicUrl: config.publicUrl, db, navidrome, library })
    : null;
  const youtubeMusic = config.youtubeMusic ? new YouTubeMusic({ ...config.youtubeMusic, db, navidrome, library }) : null;
  const status = new Status({ config, navidrome, library, lidarr, slskd, musicbrainz, deezer, listenbrainz, youtubeMusic });
  const hub = new DeviceHub();
  const admins = new Map<string, { admin: boolean; until: number }>();

  const isAdmin = async (auth: Auth) => {
    const hit = admins.get(auth.user);
    if (hit && hit.until > Date.now()) return hit.admin;
    const r = await navidrome.call<{ user: { adminRole?: boolean } }>(auth, "getUser", { username: auth.user });
    const admin = Boolean(r.user.adminRole);
    admins.set(auth.user, { admin, until: Date.now() + ADMIN_TTL });
    people.seen(auth.user, admin);
    return admin;
  };

  const app = new Hono<Env>();

  app.onError((err, c) => {
    if (err instanceof YouTubeMusicError) return c.json({ error: err.message, code: err.code }, err.status);
    if (err instanceof SpotifyError) return c.json({ error: err.message }, err.status === 401 || err.status === 409 ? err.status : 502);
    if (err instanceof ListenBrainzError) return c.json({ error: err.message }, err.status);
    if (err instanceof LidarrError || err instanceof SubsonicFailure || err instanceof SlskdError || err instanceof MusicBrainzError) return c.json({ error: err.message }, 502);
    console.error(err);
    return c.json({ error: "Something went wrong on the Needle server" }, 500);
  });

  app.get("/api/health", (c) => c.json({ ok: true, version: VERSION }));

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

  const can = async (auth: Auth, what: Permission) => people.allowed(auth.user, await isAdmin(auth), what);
  const refuse = (c: Context<Env>, error: string) => c.json({ error }, 403);
  const needLidarr = async (c: Context<Env>) => {
    if (!lidarr) return { error: c.json({ error: "Lidarr isn't set up on the Needle server" }, 404) };
    if (!(await can(c.get("auth"), "request"))) return { error: refuse(c, "Ask an admin to let you request music") };
    return { lidarr };
  };
  const needLidarrAdmin = async (c: Context<Env>) => {
    if (!lidarr) return { error: c.json({ error: "Lidarr isn't set up on the Needle server" }, 404) };
    if (!(await isAdmin(c.get("auth")))) return { error: refuse(c, "Only Navidrome admins can manage Lidarr's downloads") };
    return { lidarr };
  };
  const needSongs = async (c: Context<Env>) => {
    if (!songs) return { error: c.json({ error: "slskd isn't set up on the Needle server" }, 404) };
    if (!(await can(c.get("auth"), "request"))) return { error: refuse(c, "Ask an admin to let you request music") };
    return { songs };
  };
  const recordAlbum = (user: string, a: LidarrAlbum) =>
    requests.add({ user, kind: "album", ref: a.foreignAlbumId, title: a.title, artist: a.artist, cover_url: a.coverUrl, state: a.state });
  const mbidOf = (c: Context<Env>) => {
    const mbid = c.req.param("mbid") ?? "";
    return MBID.test(mbid) ? mbid.toLowerCase() : null;
  };
  const noPlaylist = (c: Context<Env>) => c.json({ error: "No such ListenBrainz playlist" }, 404);
  const passwordOf = (body: { password?: unknown }) => (typeof body.password === "string" && body.password && body.password.length <= PASSWORD_MAX ? body.password : undefined);
  const bodyOf = (c: Context<Env>) => c.req.json<{ token?: unknown; password?: unknown }>().catch(() => ({ token: undefined, password: undefined }));
  const wanted = (t: DiscoveryTrack) => !t.song && (!t.request || t.request.state === "failed");
  const needSpotify = async (c: Context<Env>) => {
    if (!spotify) return { error: c.json({ error: "Add SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET and PUBLIC_URL to the Needle server" }, 404) };
    if (!(await can(c.get("auth"), "spotify"))) return { error: refuse(c, "Ask an admin to let you use Spotify in Needle") };
    return { spotify };
  };
  const youtubeMusicGuard = async (c: Context<Env>, next: () => Promise<void>) => {
    if (!youtubeMusic) return c.json({ error: "Add YTMUSIC_CLIENT_ID and YTMUSIC_CLIENT_SECRET to the Needle server" }, 404);
    if (!(await can(c.get("auth"), "youtubeMusic"))) return refuse(c, "Ask an admin to let you use YouTube Music in Needle");

    c.set("youtubeMusic", youtubeMusic);

    await next();
  };
  const youtubeMusicOn = async (c: Context<Env>): Promise<boolean> => {
    const body = await c.req.json<{ on?: unknown }>().catch(() => ({ on: undefined }));
    if (typeof body.on !== "boolean") throw new YouTubeMusicError(400, "Use a boolean on value");

    return body.on;
  };

  app.use("/api/youtube-music", youtubeMusicGuard);
  app.use("/api/youtube-music/*", youtubeMusicGuard);

  app.get("/api/capabilities", async (c) => {
    const auth = c.get("auth");
    const admin = await isAdmin(auth);
    const requests = people.allowed(auth.user, admin, "request");
    const sp = people.allowed(auth.user, admin, "spotify") ? spotify : null;
    const youtube = people.allowed(auth.user, admin, "youtubeMusic") ? youtubeMusic : null;
    const lb = listenbrainz.account(auth.user);
    const caps: Capabilities = {
      admin,
      lidarr: Boolean(lidarr) && requests,
      spotify: Boolean(sp),
      spotifyConnected: sp?.connected(auth.user) ?? false,
      spotifyPlayback: sp?.canPlay(auth.user) ?? false,
      spotifyReconnect: sp?.needsReconnect(auth.user) ?? false,
      spotifyEnabled: sp?.enabled(auth.user) ?? false,
      ...(config.youtubeMusic ? {
        youtubeMusic: Boolean(youtube), youtubeMusicConnected: youtube?.connected(auth.user) ?? false,
        youtubeMusicEnabled: youtube?.enabled(auth.user) ?? false, youtubeMusicReconnect: youtube?.needsReconnect(auth.user) ?? false,
      } : {}),
      songs: Boolean(songs) && requests,
      publicUrl: config.publicUrl,
      listenbrainzUser: lb?.user ?? null,
      listenbrainzNavidrome: lb?.navidrome ?? false,
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
  app.get("/api/library/songs", compress(), async (c) => c.json(await library.songs(c.get("auth"))));

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

  app.get("/api/people", async (c) => {
    const auth = c.get("auth");
    if (!(await isAdmin(auth))) return refuse(c, "Only Navidrome admins can see people");
    return c.json(people.list());
  });

  app.put("/api/people/:user", async (c) => {
    const auth = c.get("auth");
    if (!(await isAdmin(auth))) return refuse(c, "Only Navidrome admins can change people");
    const user = c.req.param("user").trim();
    if (!user) return c.json({ error: "Which user?" }, 400);
    return c.json(people.set(user, await c.req.json<PersonPatch>()));
  });

  app.get("/api/requests", async (c) => {
    const auth = c.get("auth");
    const everyone = c.req.query("everyone") === "1";
    if (everyone && !(await isAdmin(auth))) return refuse(c, "Only Navidrome admins can see everyone's requests");
    const rows = everyone ? requests.others(auth.user) : requests.list(auth.user);
    const albumIds = rows.filter((r) => r.kind === "album").map((r) => r.ref);
    const live = lidarr && albumIds.length ? await lidarr.albumStates(albumIds).catch(() => []) : [];
    const byId = new Map(live.map((a) => [a.foreignAlbumId, a]));
    return c.json(rows.map((row): RequestItem => {
      const a = row.kind === "album" ? byId.get(row.ref) : undefined;
      return { ...(everyone ? toItemFor(row) : toItem(row)), ...(a ? { state: a.state, progress: a.progress, coverUrl: a.coverUrl ?? row.cover_url } : {}) };
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

  app.delete("/api/requests/:id", async (c) => {
    const auth = c.get("auth");
    requests.remove((await isAdmin(auth)) ? null : auth.user, Number(c.req.param("id")));
    return c.body(null, 204);
  });

  app.get("/api/lidarr/artists", async (c) => {
    const r = await needLidarr(c);
    if (r.error) return r.error;
    const names = (c.req.query("names") ?? "").split("|").map((n) => n.trim()).filter(Boolean).slice(0, 8);
    return c.json(await r.lidarr.lookupArtists(names));
  });

  app.get("/api/lidarr/downloads", async (c) => {
    const r = await needLidarrAdmin(c);
    if (r.error) return r.error;
    return c.json(await r.lidarr.downloads());
  });

  app.delete("/api/lidarr/downloads/:id", async (c) => {
    const r = await needLidarrAdmin(c);
    if (r.error) return r.error;
    await r.lidarr.removeDownload(Number(c.req.param("id")), c.req.query("find") === "1");
    return c.body(null, 204);
  });

  app.put("/api/listenbrainz", async (c) => {
    const body = await bodyOf(c);
    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (!token || token.length > TOKEN_MAX) return c.json({ error: "Paste your ListenBrainz user token" }, 400);
    return c.json(await listenbrainz.connect(c.get("auth"), token, passwordOf(body)));
  });

  app.delete("/api/listenbrainz", async (c) => c.json(await listenbrainz.disconnect(c.get("auth"), passwordOf(await bodyOf(c)))));

  app.get("/api/listenbrainz/playlists", async (c) => c.json(await listenbrainz.playlists(c.get("auth"))));

  app.get("/api/listenbrainz/playlists/:mbid", async (c) => {
    const mbid = mbidOf(c);
    return mbid ? c.json(await listenbrainz.playlist(c.get("auth"), mbid)) : noPlaylist(c);
  });

  app.post("/api/listenbrainz/playlists/:mbid/missing", async (c) => {
    const r = await needSongs(c);
    if (r.error) return r.error;
    const mbid = mbidOf(c);
    if (!mbid) return noPlaylist(c);
    const auth = c.get("auth");
    const detail = await listenbrainz.playlist(auth, mbid);
    const todo = detail.tracks.filter(wanted).slice(0, MISSING_SONGS_LIMIT);
    for (const t of todo) r.songs.start(auth, trackCandidate(t));
    return c.json({ started: todo.length, skipped: detail.tracks.filter((t) => !t.song).length - todo.length });
  });

  app.post("/api/listenbrainz/playlists/:mbid/save", async (c) => {
    const mbid = mbidOf(c);
    if (!mbid) return noPlaylist(c);
    const auth = c.get("auth");
    const detail = await listenbrainz.playlist(auth, mbid);
    const ids = detail.tracks.flatMap((t) => (t.song ? [t.song.id] : []));
    if (!ids.length) return c.json({ error: "None of these songs are in your library yet" }, 409);
    const name = detail.date ? `${detail.name}, ${detail.date.slice(0, 10)}` : detail.name;
    return c.json({ playlistId: await navidrome.upsertPlaylist(auth, name, ids), matched: ids.length, total: detail.total });
  });

  app.get("/api/spotify/login", async (c) => {
    const r = await needSpotify(c);
    return r.error ?? c.json({ url: r.spotify.authorizeUrl(c.get("auth").user) });
  });

  app.post("/api/youtube-music/login", async (c) => c.json(await c.get("youtubeMusic").login(c.get("auth").user)));
  app.get("/api/youtube-music/login", async (c) => c.json(await c.get("youtubeMusic").loginStatus(c.get("auth").user)));
  app.delete("/api/youtube-music/login", (c) => {
    c.get("youtubeMusic").cancelLogin(c.get("auth").user);

    return c.body(null, 204);
  });

  app.delete("/api/youtube-music", (c) => {
    c.get("youtubeMusic").disconnect(c.get("auth").user);

    return c.body(null, 204);
  });

  app.put("/api/youtube-music/enabled", async (c) => {
    c.get("youtubeMusic").setEnabled(c.get("auth").user, await youtubeMusicOn(c));

    return c.body(null, 204);
  });

  app.get("/api/youtube-music/account", async (c) => c.json(await c.get("youtubeMusic").account(c.get("auth").user)));
  app.get("/api/youtube-music/liked", async (c) => c.json(await c.get("youtubeMusic").liked(c.get("auth").user, YouTubeMusic.limit(c.req.query("limit")))));
  app.get("/api/youtube-music/albums", async (c) => c.json(await c.get("youtubeMusic").albums(c.get("auth").user, YouTubeMusic.limit(c.req.query("limit")))));
  app.get("/api/youtube-music/artists", async (c) => c.json(await c.get("youtubeMusic").artists(c.get("auth").user, YouTubeMusic.limit(c.req.query("limit")))));
  app.get("/api/youtube-music/playlists", async (c) => c.json(await c.get("youtubeMusic").playlists(c.get("auth").user, YouTubeMusic.limit(c.req.query("limit")))));
  app.get("/api/youtube-music/search", async (c) => c.json(await c.get("youtubeMusic").search(c.get("auth").user,
    c.req.query("q") ?? "", c.req.query("kind") as YouTubeMusicSearchKind | undefined, YouTubeMusic.limit(c.req.query("limit"), 20, 100))));

  app.get("/api/youtube-music/albums/:id", async (c) => c.json(await c.get("youtubeMusic").album(c.get("auth").user, c.req.param("id"))));
  app.get("/api/youtube-music/artists/:id", async (c) => c.json(await c.get("youtubeMusic").artist(c.get("auth").user, c.req.param("id"))));
  app.get("/api/youtube-music/artists/:id/songs", async (c) => c.json(await c.get("youtubeMusic").artistSongs(c.get("auth").user,
    c.req.param("id"), YouTubeMusic.limit(c.req.query("limit")))));
  app.get("/api/youtube-music/artists/:id/releases", async (c) => c.json(await c.get("youtubeMusic").artistReleases(c.get("auth").user,
    c.req.param("id"), c.req.query("kind") as "albums" | "singles", YouTubeMusic.limit(c.req.query("limit")))));
  app.get("/api/youtube-music/playlists/:id", async (c) => c.json(await c.get("youtubeMusic").playlist(c.get("auth").user,
    c.req.param("id"), YouTubeMusic.limit(c.req.query("limit"), 3000))));
  app.get("/api/youtube-music/songs/:id/lyrics", async (c) => c.json(await c.get("youtubeMusic").lyrics(c.get("auth").user, c.req.param("id"))));
  app.get("/api/youtube-music/songs/:id/radio", async (c) => c.json(await c.get("youtubeMusic").radio(c.get("auth").user, c.req.param("id"))));

  app.put("/api/youtube-music/songs/:id/like", async (c) => {
    await c.get("youtubeMusic").like(c.get("auth").user, c.req.param("id"), await youtubeMusicOn(c));

    return c.body(null, 204);
  });

  app.put("/api/youtube-music/albums/:id/saved", async (c) => {
    await c.get("youtubeMusic").saveAlbum(c.get("auth").user, c.req.param("id"), await youtubeMusicOn(c));

    return c.body(null, 204);
  });

  app.put("/api/youtube-music/artists/:id/follow", async (c) => {
    await c.get("youtubeMusic").follow(c.get("auth").user, c.req.param("id"), await youtubeMusicOn(c));

    return c.body(null, 204);
  });

  app.post("/api/youtube-music/import", async (c) => {
    const body = await c.req.json<{ source?: unknown }>().catch(() => ({ source: undefined }));
    if (typeof body.source !== "string") throw new YouTubeMusicError(400, "Choose a YouTube Music playlist to import");

    return c.json(await c.get("youtubeMusic").import(c.get("auth"), body.source));
  });

  app.delete("/api/spotify", async (c) => {
    const r = await needSpotify(c);
    if (r.error) return r.error;
    r.spotify.disconnect(c.get("auth").user);
    return c.body(null, 204);
  });

  app.put("/api/spotify/enabled", async (c) => {
    const r = await needSpotify(c);
    if (r.error) return r.error;
    const { on } = await c.req.json<{ on: boolean }>();
    r.spotify.setEnabled(c.get("auth").user, on);
    return c.body(null, 204);
  });

  app.get("/api/spotify/token", async (c) => {
    const r = await needSpotify(c);
    return r.error ?? c.json(await r.spotify.token(c.get("auth").user));
  });

  app.get("/api/spotify/playlists", async (c) => {
    const r = await needSpotify(c);
    return r.error ?? c.json(await r.spotify.playlists(c.get("auth").user));
  });

  app.post("/api/spotify/import", async (c) => {
    const r = await needSpotify(c);
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

  app.get("/youtube-music/stream/:videoId", async (c) => {
    const auth = authFromQuery(new URL(c.req.url));
    if (!auth) return c.json({ error: "Sign in again" }, 401);

    const verification = await navidrome.verify(auth);
    if (verification === "down") return c.json({ error: "Navidrome isn't responding" }, 503);
    if (verification !== "ok") return c.json({ error: "Sign in again" }, 401);
    if (!youtubeMusic) return c.json({ error: "YouTube Music isn't set up on the Needle server" }, 404);
    if (!(await can(auth, "youtubeMusic"))) return refuse(c, "Ask an admin to let you use YouTube Music in Needle");

    return youtubeMusic.stream(auth.user, c.req.param("videoId"), c.req.raw);
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
