import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import type {
  ImportResult, ImportedTrack, NamedRef, RemoteImage, Song, YouTubeMusicAccount, YouTubeMusicAlbum,
  YouTubeMusicAlbumDetail, YouTubeMusicArtist, YouTubeMusicArtistDetail, YouTubeMusicLogin,
  YouTubeMusicLoginStatus, YouTubeMusicLyrics, YouTubeMusicPage, YouTubeMusicPlaylist,
  YouTubeMusicPlaylistDetail, YouTubeMusicSearch, YouTubeMusicSearchKind,
} from "@needle/shared";
import { youtubeMusicId, youtubeMusicRawId } from "@needle/shared";
import type { Auth, Navidrome } from "./navidrome.ts";
import type { LibrarySearch } from "./search.ts";
import { findSong } from "./search.ts";

const CODE_URL = "https://www.youtube.com/o/oauth2/device/code";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/youtube";
const OAUTH_AGENT = "Mozilla/5.0 Cobalt/Version";
const BRIDGE_PATH = fileURLToPath(new URL("./youtube-music.py", import.meta.url));
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const PROVIDER_ID = /^[A-Za-z0-9_-]{1,200}$/;
const SEARCH_KINDS = new Set<YouTubeMusicSearchKind>(["songs", "albums", "artists", "playlists"]);
const BRIDGE_OPERATIONS = new Set([
  "health", "resolve", "account", "liked", "albums", "artists", "playlists", "search", "album",
  "artist", "artistSongs", "artistReleases", "playlist", "lyrics", "radio", "like", "saveAlbum", "follow",
]);
const CACHE_TTL = 60_000;
const STALE_TTL = 6 * 60 * 60_000;
const COOLDOWN_MS = 15 * 60_000;
const CACHE_SIZE = 250;
const BRIDGE_MAX_BYTES = 8 * 1024 * 1024;

type ProviderObject = Record<string, unknown>;
type TokenRow = {
  access_token: string; refresh_token: string; expires_at: number; scope: string; enabled: number; reconnect: number;
};
type LoginRow = {
  device_code: string; user_code: string; verification_url: string; expires_at: number; interval: number; next_poll: number;
};
type ProviderToken = { access_token: string; refresh_token: string; expires_in: number; scope: string };
export type YouTubeMusicBridgeRequest = {
  operation: string;
  parameters?: ProviderObject;
  component?: "metadata" | "resolver";
  credentials?: { clientId: string; clientSecret: string };
  token?: { access_token: string; refresh_token: string; expires_at: number; expires_in: number; scope: string; token_type: "Bearer" };
  node?: string;
};
type Options = {
  clientId: string; clientSecret: string; python: string; db: DatabaseSync; navidrome: Navidrome; library: LibrarySearch;
  bridge?: (request: YouTubeMusicBridgeRequest) => Promise<unknown>;
};
type CachedMetadata = { data: unknown; at: number };
type ResolvedStream = { url: string; type: string; until: number };

export class YouTubeMusicError extends Error {
  readonly status: 400 | 404 | 409 | 429 | 502 | 503;
  readonly code: string;

  constructor(status: YouTubeMusicError["status"], message: string, code = "upstream") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export class YouTubeMusic {
  constructor(options: Options) {
    this.options = options;
  }

  connected(user: string): boolean {
    return Boolean(this.tokenRow(user));
  }

  enabled(user: string): boolean {
    return this.tokenRow(user)?.enabled === 1;
  }

  needsReconnect(user: string): boolean {
    return this.tokenRow(user)?.reconnect === 1;
  }

  setEnabled(user: string, on: boolean): void {
    this.options.db.prepare("UPDATE youtube_music_tokens SET enabled = ? WHERE user = ?").run(on ? 1 : 0, user);

    if (!on) this.cancelUser(user);
  }

  disconnect(user: string): void {
    this.cancelUser(user);
    this.cancelLogin(user);
    this.options.db.prepare("DELETE FROM youtube_music_tokens WHERE user = ?").run(user);

  }

  cancelLogin(user: string): void {
    this.loginGenerations.set(user, (this.loginGenerations.get(user) ?? 0) + 1);
    this.options.db.prepare("DELETE FROM youtube_music_logins WHERE user = ?").run(user);
  }

  async login(user: string): Promise<YouTubeMusicLogin> {
    const loginInProgress = this.loginStarts.get(user);
    if (loginInProgress) return loginInProgress;

    const login = this.startLogin(user).finally(() => this.loginStarts.delete(user));
    this.loginStarts.set(user, login);

    return login;
  }

  async loginStatus(user: string): Promise<YouTubeMusicLoginStatus> {
    const loginInProgress = this.loginPolls.get(user);
    if (loginInProgress) return loginInProgress;

    const login = this.pollLogin(user).finally(() => this.loginPolls.delete(user));
    this.loginPolls.set(user, login);

    return login;
  }

  async health(component: "metadata" | "resolver"): Promise<string> {
    const diagnostic = YouTubeMusic.providerObject(await this.runBridge({ operation: "health", component }));
    if (diagnostic.available !== true || !YouTubeMusic.text(diagnostic.version)) {
      throw new YouTubeMusicError(503, `YouTube Music ${component} is unavailable`, "runtime_missing");
    }

    return YouTubeMusic.text(diagnostic.version) ?? "";
  }

  async account(user: string): Promise<YouTubeMusicAccount> {
    const account = YouTubeMusic.providerObject(await this.metadata(user, "account"));
    const name = YouTubeMusic.text(account.accountName);
    if (!name) throw new YouTubeMusicError(502, "YouTube Music returned an invalid account");

    return { name, handle: YouTubeMusic.text(account.channelHandle) ?? null, photo: YouTubeMusic.imageUrl(account.accountPhotoUrl) ?? null };
  }

  async liked(user: string, limit = 100): Promise<YouTubeMusicPage<Song>> {
    const playlist = YouTubeMusic.providerObject(await this.metadata(user, "liked", { limit: limit + 1 }));

    return YouTubeMusic.page(YouTubeMusic.songs(playlist.tracks), limit, YouTubeMusic.number(playlist.trackCount));
  }

  async albums(user: string, limit = 100): Promise<YouTubeMusicPage<YouTubeMusicAlbum>> {
    return YouTubeMusic.page(YouTubeMusic.albums(await this.metadata(user, "albums", { limit: limit + 1 })), limit);
  }

  async artists(user: string, limit = 100): Promise<YouTubeMusicPage<YouTubeMusicArtist>> {
    const artists = YouTubeMusic.list(await this.metadata(user, "artists", { limit: limit + 1 })).flatMap((rawArtist) => {
      const artist = YouTubeMusic.artist(rawArtist);

      return artist ? [{ ...artist, subscribed: true }] : [];
    });

    return YouTubeMusic.page(artists, limit);
  }

  async playlists(user: string, limit = 100): Promise<YouTubeMusicPage<YouTubeMusicPlaylist>> {
    const playlists = YouTubeMusic.list(await this.metadata(user, "playlists", { limit: limit + 1 })).flatMap((rawPlaylist) => {
      const playlist = YouTubeMusic.playlist(rawPlaylist);

      return playlist ? [playlist] : [];
    });

    return YouTubeMusic.page(playlists, limit);
  }

  async search(user: string, query: string, kind?: YouTubeMusicSearchKind, limit = 20): Promise<YouTubeMusicSearch> {
    const trimmedQuery = query.trim();
    if (trimmedQuery.length > 200 || (kind && !SEARCH_KINDS.has(kind))) throw new YouTubeMusicError(400, "Use a valid YouTube Music search");

    this.requireEnabled(user);
    if (trimmedQuery.length < 2) return { songs: [], albums: [], artists: [], playlists: [], limit, hasMore: false };

    const rawResults = YouTubeMusic.list(await this.metadata(user, "search", { query: trimmedQuery, kind, limit: limit + 1 }));
    const results: YouTubeMusicSearch = { songs: [], albums: [], artists: [], playlists: [], limit, hasMore: false };

    for (const rawResult of rawResults) {
      const providerResult = YouTubeMusic.object(rawResult);
      const resultKind = kind ?? ({ song: "songs", album: "albums", artist: "artists", playlist: "playlists" } as const)[YouTubeMusic.text(providerResult.resultType) as "song"];

      if (resultKind === "songs") {
        const song = YouTubeMusic.song(providerResult);
        if (song) results.songs.push(song);
      } else if (resultKind === "albums") {
        const album = YouTubeMusic.album(providerResult);
        if (album) results.albums.push(album);
      } else if (resultKind === "artists") {
        const artist = YouTubeMusic.artist(providerResult);
        if (artist) results.artists.push(artist);
      } else if (resultKind === "playlists") {
        const playlist = YouTubeMusic.playlist(providerResult);
        if (playlist) results.playlists.push(playlist);
      }
    }

    results.hasMore = kind ? results[kind].length > limit : rawResults.length > limit;
    results.songs = results.songs.slice(0, limit);
    results.albums = results.albums.slice(0, limit);
    results.artists = results.artists.slice(0, limit);
    results.playlists = results.playlists.slice(0, limit);

    return results;
  }

  async album(user: string, id: string): Promise<YouTubeMusicAlbumDetail> {
    const rawId = YouTubeMusic.validId(id, "album");
    const providerAlbum = YouTubeMusic.providerObject(await this.metadata(user, "album", { id: rawId }));
    const album = YouTubeMusic.album({ ...providerAlbum, browseId: rawId });
    if (!album) throw new YouTubeMusicError(502, "YouTube Music returned an invalid album");

    const songs = YouTubeMusic.songs(providerAlbum.tracks, album);

    return { album, songs };
  }

  async artist(user: string, id: string): Promise<YouTubeMusicArtistDetail> {
    const rawId = YouTubeMusic.validId(id, "artist");
    const providerArtist = YouTubeMusic.providerObject(await this.metadata(user, "artist", { id: rawId }));
    const artist = YouTubeMusic.artist({ ...providerArtist, browseId: rawId });
    if (!artist) throw new YouTubeMusicError(502, "YouTube Music returned an invalid artist");

    const songsSection = YouTubeMusic.object(providerArtist.songs);
    const albumsSection = YouTubeMusic.object(providerArtist.albums);
    const singlesSection = YouTubeMusic.object(providerArtist.singles);
    const artistRef = { id: artist.id, name: artist.name };

    return {
      artist,
      songs: YouTubeMusic.songs(songsSection.results ?? [], undefined, artistRef),
      albums: YouTubeMusic.albums(albumsSection.results ?? [], artistRef),
      singles: YouTubeMusic.albums(singlesSection.results ?? [], artistRef),
      hasMoreSongs: Boolean(YouTubeMusic.text(songsSection.browseId)),
      hasMoreAlbums: Boolean(YouTubeMusic.text(albumsSection.params)),
      hasMoreSingles: Boolean(YouTubeMusic.text(singlesSection.params)),
    };
  }

  async artistSongs(user: string, id: string, limit = 100): Promise<YouTubeMusicPage<Song>> {
    const providerPlaylist = YouTubeMusic.providerObject(await this.metadata(user, "artistSongs", { id: YouTubeMusic.validId(id, "artist"), limit: limit + 1 }));

    return YouTubeMusic.page(YouTubeMusic.songs(providerPlaylist.tracks), limit, YouTubeMusic.number(providerPlaylist.trackCount));
  }

  async artistReleases(user: string, id: string, kind: "albums" | "singles", limit = 100): Promise<YouTubeMusicPage<YouTubeMusicAlbum>> {
    if (kind !== "albums" && kind !== "singles") throw new YouTubeMusicError(400, "Choose albums or singles");

    const releases = await this.metadata(user, "artistReleases", { id: YouTubeMusic.validId(id, "artist"), kind, limit: limit + 1 });

    return YouTubeMusic.page(YouTubeMusic.albums(releases), limit);
  }

  async playlist(user: string, id: string, limit = 3000): Promise<YouTubeMusicPlaylistDetail> {
    const rawId = YouTubeMusic.validId(id);
    const providerPlaylist = YouTubeMusic.providerObject(await this.metadata(user, "playlist", { id: rawId, limit: limit + 1 }));
    const playlist = YouTubeMusic.playlist({ ...providerPlaylist, playlistId: rawId });
    if (!playlist) throw new YouTubeMusicError(502, "YouTube Music returned an invalid playlist");

    return { playlist, songs: YouTubeMusic.page(YouTubeMusic.songs(providerPlaylist.tracks), limit, playlist.songCount) };
  }

  async lyrics(user: string, id: string): Promise<YouTubeMusicLyrics> {
    const providerLyrics = YouTubeMusic.object(await this.metadata(user, "lyrics", { id: YouTubeMusic.validId(id, "song") }));
    const timed = providerLyrics.hasTimestamps === true;
    const lines = timed
      ? YouTubeMusic.list(providerLyrics.lyrics).flatMap((rawLine) => {
        const lyricLine = YouTubeMusic.object(rawLine);
        const value = YouTubeMusic.text(lyricLine.text);
        const start = YouTubeMusic.number(lyricLine.start_time);

        return value ? [{ value, ...(start !== undefined ? { start } : {}) }] : [];
      })
      : (YouTubeMusic.text(providerLyrics.lyrics) ?? "").split("\n").filter(Boolean).map((value) => ({ value }));

    return { lyrics: lines.length ? [{ synced: timed, line: lines }] : [], source: YouTubeMusic.text(providerLyrics.source) ?? null };
  }

  async radio(user: string, id: string): Promise<Song[]> {
    const providerPlaylist = YouTubeMusic.providerObject(await this.metadata(user, "radio", { id: YouTubeMusic.validId(id, "song"), limit: 50 }));

    return YouTubeMusic.songs(providerPlaylist.tracks);
  }

  async like(user: string, id: string, on: boolean): Promise<void> {
    await this.mutate(user, "like", { id: YouTubeMusic.validId(id, "song"), on });
  }

  async saveAlbum(user: string, id: string, on: boolean): Promise<void> {
    await this.mutate(user, "saveAlbum", { id: YouTubeMusic.validId(id, "album"), on });
  }

  async follow(user: string, id: string, on: boolean): Promise<void> {
    await this.mutate(user, "follow", { id: YouTubeMusic.validId(id, "artist"), on });
  }

  async import(auth: Auth, source: string): Promise<ImportResult> {
    const generation = this.userGenerations.get(auth.user) ?? 0;
    const sourcePlaylist = source === "liked" ? null : await this.playlist(auth.user, source);
    const collection = sourcePlaylist?.songs ?? await this.liked(auth.user, 3000);
    if (collection.hasMore) throw new YouTubeMusicError(409, "This playlist is too large to import. Use a playlist with at most 3000 songs.");

    const sourceName = sourcePlaylist?.playlist.title ?? "Liked on YouTube Music";
    const tracks: ImportedTrack[] = collection.items.map((song) => ({ title: song.title, artist: song.artist ?? "", album: song.album ?? "" }));
    const matcher = await this.options.library.matcher(auth);
    const songIds: string[] = [];
    const missing: ImportedTrack[] = [];

    for (const track of tracks) {
      const song = findSong(matcher, track);

      if (song) songIds.push(song.id);
      else missing.push(track);
    }

    this.requireEnabled(auth.user);
    if (generation !== (this.userGenerations.get(auth.user) ?? 0)) throw new YouTubeMusicError(409, "YouTube Music connection changed");

    const playlistId = songIds.length ? await this.options.navidrome.upsertPlaylist(auth, `${sourceName} (from YouTube Music)`, songIds) : null;

    return { source: sourceName, total: tracks.length, matched: songIds.length, playlistId, missing };
  }

  async stream(user: string, id: string, request: Request): Promise<Response> {
    this.requireEnabled(user);
    const videoId = YouTubeMusic.validId(id, "song");
    const range = request.headers.get("range");
    if (range && !/^bytes=(?:\d+-\d*|-\d+)$/.test(range)) throw new YouTubeMusicError(400, "Use a single byte range");

    const controller = new AbortController();
    const userStreams = this.streams.get(user) ?? new Set<AbortController>();
    userStreams.add(controller);
    this.streams.set(user, userStreams);

    const cleanup = () => {
      userStreams.delete(controller);
      if (!userStreams.size) this.streams.delete(user);
    };
    const signal = AbortSignal.any([controller.signal, request.signal]);
    signal.addEventListener("abort", cleanup, { once: true });

    try {
      let stream = await this.resolveStream(videoId);
      this.requireEnabled(user);
      signal.throwIfAborted();

      const headers = new Headers({ "user-agent": "Mozilla/5.0", "accept-encoding": "identity" });
      if (range) headers.set("range", range);

      let upstream = await this.fetchStream(stream.url, headers, signal);
      if (upstream.status === 403) {
        await upstream.body?.cancel();
        this.streamCache.delete(videoId);
        stream = await this.resolveStream(videoId);
        this.requireEnabled(user);
        upstream = await this.fetchStream(stream.url, headers, signal);
      }

      const upstreamType = upstream.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
      const validType = !upstreamType || upstreamType.startsWith("audio/") || upstreamType === "application/octet-stream";
      const responseHeaders = new Headers({ "content-type": stream.type, "cache-control": "private, no-store" });
      for (const header of ["content-length", "content-range", "accept-ranges"]) {
        const value = upstream.headers.get(header);
        if (value) responseHeaders.set(header, value);
      }

      if (upstream.status === 416) {
        await upstream.body?.cancel();
        responseHeaders.delete("content-length");
        cleanup();

        return new Response(null, { status: 416, headers: responseHeaders });
      }
      if (!upstream.ok || !upstream.body || !validType) {
        await upstream.body?.cancel();
        throw new YouTubeMusicError(502, "This song cannot play in Needle. Open it in YouTube Music.", "playback_unavailable");
      }

      const reader = upstream.body.getReader();
      const body = new ReadableStream<Uint8Array>({
        async pull(output) {
          try {
            const chunk = await reader.read();

            if (chunk.done) {
              cleanup();
              output.close();
            } else output.enqueue(chunk.value);
          } catch (error) {
            cleanup();
            output.error(error);
          }
        },
        async cancel() {
          controller.abort();
          cleanup();
          await reader.cancel();
        },
      });

      return new Response(body, { status: upstream.status, headers: responseHeaders });
    } catch (error) {
      if (!signal.aborted && error instanceof YouTubeMusicError && error.code === "playback_unavailable") {
        YouTubeMusic.boundedSet(this.streamFailures, videoId, { error, until: Date.now() + 60_000 });
        this.streamCache.delete(videoId);
      }

      controller.abort();
      cleanup();

      throw error instanceof YouTubeMusicError ? error : new YouTubeMusicError(502, "YouTube Music playback was interrupted", "playback_unavailable");
    }
  }

  static limit(value: string | undefined, fallback = 100, maximum = 3000): number {
    const limit = value === undefined ? fallback : Number(value);
    if (!Number.isInteger(limit) || limit < 1 || limit > maximum) throw new YouTubeMusicError(400, `Choose a limit from 1 to ${maximum}`);

    return limit;
  }

  private readonly options: Options;
  private readonly loginStarts = new Map<string, Promise<YouTubeMusicLogin>>();
  private readonly loginPolls = new Map<string, Promise<YouTubeMusicLoginStatus>>();
  private readonly loginAttempts = new Map<string, number[]>();
  private readonly loginGenerations = new Map<string, number>();
  private readonly refreshes = new Map<string, Promise<TokenRow>>();
  private readonly metadataCache = new Map<string, CachedMetadata>();
  private readonly metadataPending = new Map<string, Promise<unknown>>();
  private readonly streamCache = new Map<string, ResolvedStream>();
  private readonly streamPending = new Map<string, Promise<ResolvedStream>>();
  private readonly streamFailures = new Map<string, { error: YouTubeMusicError; until: number }>();
  private readonly streams = new Map<string, Set<AbortController>>();
  private readonly children = new Map<ChildProcessWithoutNullStreams, string | undefined>();
  private readonly userGenerations = new Map<string, number>();
  private cooldownUntil = 0;

  private tokenRow(user: string): TokenRow | undefined {
    return this.options.db.prepare("SELECT * FROM youtube_music_tokens WHERE user = ?").get(user) as TokenRow | undefined;
  }

  private requireEnabled(user: string): TokenRow {
    const token = this.tokenRow(user);
    if (!token) throw new YouTubeMusicError(409, "Connect YouTube Music in Settings first", "not_connected");
    if (!token.enabled) throw new YouTubeMusicError(409, "YouTube Music is switched off in Needle", "disabled");
    if (token.reconnect) throw new YouTubeMusicError(409, "Reconnect YouTube Music in Settings", "auth_reconnect");

    return token;
  }

  private cancelUser(user: string): void {
    this.userGenerations.set(user, (this.userGenerations.get(user) ?? 0) + 1);

    for (const [child, childUser] of this.children) {
      if (childUser === user) child.kill("SIGKILL");
    }

    for (const controller of this.streams.get(user) ?? []) controller.abort();
    this.streams.delete(user);
    this.refreshes.delete(user);

    for (const cacheKey of this.metadataCache.keys()) {
      if (cacheKey.startsWith(`${user}\0`)) this.metadataCache.delete(cacheKey);
    }

    for (const cacheKey of this.metadataPending.keys()) {
      if (cacheKey.startsWith(`${user}\0`)) this.metadataPending.delete(cacheKey);
    }
  }

  private async startLogin(user: string): Promise<YouTubeMusicLogin> {
    const attempts = (this.loginAttempts.get(user) ?? []).filter((attempt) => attempt > Date.now() - COOLDOWN_MS);
    if (attempts.length >= 10) throw new YouTubeMusicError(429, "Too many connection attempts. Try again in 15 minutes.", "login_limited");

    attempts.push(Date.now());
    this.loginAttempts.set(user, attempts);
    const generation = this.loginGenerations.get(user) ?? 0;
    const providerLogin = await this.oauth(CODE_URL, { client_id: this.options.clientId, scope: SCOPE });
    const deviceCode = YouTubeMusic.text(providerLogin.device_code);
    const userCode = YouTubeMusic.text(providerLogin.user_code);
    const verificationUrl = YouTubeMusic.text(providerLogin.verification_url ?? providerLogin.verification_uri);
    const expiresIn = YouTubeMusic.number(providerLogin.expires_in);
    const interval = Math.max(5, YouTubeMusic.number(providerLogin.interval) ?? 5);
    if (!deviceCode || !userCode || !verificationUrl || !expiresIn || !YouTubeMusic.verificationUrl(verificationUrl)) {
      throw new YouTubeMusicError(502, "Google returned an invalid connection code");
    }
    if (generation !== (this.loginGenerations.get(user) ?? 0)) throw new YouTubeMusicError(409, "The connection was cancelled");

    const expiresAt = Date.now() + expiresIn * 1000;
    this.options.db.prepare(`INSERT INTO youtube_music_logins (user, device_code, user_code, verification_url, expires_at, interval, next_poll)
      VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user) DO UPDATE SET device_code = excluded.device_code, user_code = excluded.user_code,
      verification_url = excluded.verification_url, expires_at = excluded.expires_at, interval = excluded.interval, next_poll = excluded.next_poll`)
      .run(user, deviceCode, userCode, verificationUrl, expiresAt, interval, Date.now() + interval * 1000);

    return { userCode, verificationUrl, expiresAt, interval };
  }

  private async pollLogin(user: string): Promise<YouTubeMusicLoginStatus> {
    const login = this.options.db.prepare("SELECT * FROM youtube_music_logins WHERE user = ?").get(user) as LoginRow | undefined;
    if (!login) return { state: this.connected(user) && !this.needsReconnect(user) ? "connected" : "expired" };
    if (login.expires_at <= Date.now()) {
      this.cancelLogin(user);

      return { state: "expired" };
    }
    if (login.next_poll > Date.now()) return { state: "pending", retryAfter: Math.ceil((login.next_poll - Date.now()) / 1000) };

    this.options.db.prepare("UPDATE youtube_music_logins SET next_poll = ? WHERE user = ?").run(Date.now() + login.interval * 1000, user);
    const providerToken = await this.oauth(TOKEN_URL, {
      client_id: this.options.clientId, client_secret: this.options.clientSecret,
      grant_type: "http://oauth.net/grant_type/device/1.0", code: login.device_code,
    });
    const activeLogin = this.options.db.prepare("SELECT device_code FROM youtube_music_logins WHERE user = ?").get(user) as { device_code: string } | undefined;
    if (activeLogin?.device_code !== login.device_code) return { state: "expired" };

    if (providerToken.error === "authorization_pending" || providerToken.error === "slow_down") {
      const interval = login.interval + (providerToken.error === "slow_down" ? 5 : 0);
      this.options.db.prepare("UPDATE youtube_music_logins SET interval = ?, next_poll = ? WHERE user = ?").run(interval, Date.now() + interval * 1000, user);

      return { state: "pending", retryAfter: interval };
    }
    if (providerToken.error === "access_denied" || providerToken.error === "expired_token") {
      this.cancelLogin(user);

      return { state: providerToken.error === "access_denied" ? "denied" : "expired" };
    }

    const token = YouTubeMusic.providerToken(providerToken);
    this.cancelUser(user);
    this.saveToken(user, token);
    this.cancelLogin(user);

    return { state: "connected" };
  }

  private async oauth(url: string, fields: Record<string, string>): Promise<ProviderObject> {
    try {
      const response = await fetch(url, {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": OAUTH_AGENT },
        body: new URLSearchParams(fields), signal: AbortSignal.timeout(15_000), redirect: "error",
      });
      const data = YouTubeMusic.providerObject(await response.json());
      if (response.status === 429) throw new YouTubeMusicError(429, "Google is limiting connection attempts. Try again later.", "quota");
      if (!response.ok && !data.error) throw new YouTubeMusicError(502, "Google refused the YouTube Music connection");

      return data;
    } catch (error) {
      throw error instanceof YouTubeMusicError ? error : new YouTubeMusicError(502, "Google is not responding to the YouTube Music connection");
    }
  }

  private saveToken(user: string, token: ProviderToken): void {
    this.options.db.prepare(`INSERT INTO youtube_music_tokens (user, access_token, refresh_token, expires_at, scope)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(user) DO UPDATE SET access_token = excluded.access_token, refresh_token = excluded.refresh_token,
      expires_at = excluded.expires_at, scope = excluded.scope, reconnect = 0`)
      .run(user, token.access_token, token.refresh_token, Date.now() + token.expires_in * 1000, token.scope);
  }

  private async access(user: string): Promise<TokenRow> {
    const token = this.requireEnabled(user);
    if (token.expires_at > Date.now() + 120_000) return token;

    const refreshInProgress = this.refreshes.get(user);
    if (refreshInProgress) return refreshInProgress;

    const refresh = this.refreshToken(user, token).finally(() => {
      if (this.refreshes.get(user) === refresh) this.refreshes.delete(user);
    });
    this.refreshes.set(user, refresh);

    return refresh;
  }

  private async refreshToken(user: string, token: TokenRow): Promise<TokenRow> {
    const generation = this.userGenerations.get(user) ?? 0;
    const freshToken = await this.oauth(TOKEN_URL, {
      client_id: this.options.clientId, client_secret: this.options.clientSecret, grant_type: "refresh_token", refresh_token: token.refresh_token,
    });

    if (generation !== (this.userGenerations.get(user) ?? 0)) throw new YouTubeMusicError(409, "YouTube Music connection changed");
    this.requireEnabled(user);

    if (freshToken.error === "invalid_grant" || freshToken.error === "unauthorized_client") {
      this.options.db.prepare("UPDATE youtube_music_tokens SET reconnect = 1 WHERE user = ?").run(user);
      throw new YouTubeMusicError(409, "Reconnect YouTube Music in Settings", "auth_reconnect");
    }

    this.saveToken(user, YouTubeMusic.providerToken({ ...freshToken, refresh_token: freshToken.refresh_token ?? token.refresh_token, scope: freshToken.scope ?? token.scope }));

    return this.requireEnabled(user);
  }

  private async metadata(user: string, operation: string, parameters: ProviderObject = {}, cache = true): Promise<unknown> {
    this.requireEnabled(user);
    const generation = this.userGenerations.get(user) ?? 0;
    const cacheKey = `${user}\0${operation}\0${JSON.stringify(parameters)}`;
    const cached = cache ? this.metadataCache.get(cacheKey) : undefined;
    if (cached && Date.now() - cached.at < CACHE_TTL) return cached.data;
    if (this.cooldownUntil > Date.now()) {
      if (cached && Date.now() - cached.at < STALE_TTL) return cached.data;

      throw new YouTubeMusicError(429, "YouTube Music is paused for 15 minutes after a rate limit", "quota");
    }

    const pending = cache ? this.metadataPending.get(cacheKey) : undefined;
    if (pending) return pending;

    const request: Promise<unknown> = this.fetchMetadata(user, operation, parameters).then((data) => {
      this.requireEnabled(user);
      if (generation !== (this.userGenerations.get(user) ?? 0)) throw new YouTubeMusicError(409, "YouTube Music connection changed");
      if (cache) YouTubeMusic.boundedSet(this.metadataCache, cacheKey, { data, at: Date.now() });

      return data;
    }).catch((error: unknown) => {
      this.requireEnabled(user);
      if (generation !== (this.userGenerations.get(user) ?? 0)) throw new YouTubeMusicError(409, "YouTube Music connection changed");
      if (error instanceof YouTubeMusicError && error.code === "quota") this.cooldownUntil = Date.now() + COOLDOWN_MS;
      if (error instanceof YouTubeMusicError && error.status >= 429 && cached && this.metadataCache.get(cacheKey) === cached
        && Date.now() - cached.at < STALE_TTL) return cached.data;

      throw error;
    }).finally(() => {
      if (this.metadataPending.get(cacheKey) === request) this.metadataPending.delete(cacheKey);
    });
    if (cache) this.metadataPending.set(cacheKey, request);

    return request;
  }

  private async fetchMetadata(user: string, operation: string, parameters: ProviderObject): Promise<unknown> {
    const generation = this.userGenerations.get(user) ?? 0;
    const token = await this.access(user);
    this.requireEnabled(user);
    if (generation !== (this.userGenerations.get(user) ?? 0)) throw new YouTubeMusicError(409, "YouTube Music connection changed");

    try {
      const data = await this.runBridge({
        operation, parameters,
        credentials: { clientId: this.options.clientId, clientSecret: this.options.clientSecret },
        token: { access_token: token.access_token, refresh_token: token.refresh_token, expires_at: Math.floor(token.expires_at / 1000),
          expires_in: Math.max(0, Math.floor((token.expires_at - Date.now()) / 1000)), scope: token.scope, token_type: "Bearer" },
      }, user);

      this.requireEnabled(user);
      if (generation !== (this.userGenerations.get(user) ?? 0)) throw new YouTubeMusicError(409, "YouTube Music connection changed");

      return data;
    } catch (error) {
      if (error instanceof YouTubeMusicError && error.code === "auth_reconnect" && generation === (this.userGenerations.get(user) ?? 0)) {
        this.options.db.prepare("UPDATE youtube_music_tokens SET reconnect = 1 WHERE user = ?").run(user);
      }

      throw error;
    }
  }

  private async mutate(user: string, operation: string, parameters: ProviderObject): Promise<void> {
    if (typeof parameters.on !== "boolean") throw new YouTubeMusicError(400, "Use a boolean on value");

    await this.metadata(user, operation, parameters, false);

    for (const cacheKey of this.metadataCache.keys()) {
      if (cacheKey.startsWith(`${user}\0`)) this.metadataCache.delete(cacheKey);
    }
  }

  private async resolveStream(videoId: string): Promise<ResolvedStream> {
    const cached = this.streamCache.get(videoId);
    if (cached && cached.until > Date.now()) return cached;

    const failed = this.streamFailures.get(videoId);
    if (failed && failed.until > Date.now()) throw failed.error;

    const pending = this.streamPending.get(videoId);
    if (pending) return pending;

    const resolution = this.runBridge({ operation: "resolve", parameters: { id: videoId }, node: process.execPath }).then((data) => {
      const providerStream = YouTubeMusic.providerObject(data);
      const url = YouTubeMusic.streamUrl(providerStream.url);
      const mimeTypes: Record<string, string> = { m4a: "audio/mp4", webm: "audio/webm", ogg: "audio/ogg", opus: "audio/ogg", mp3: "audio/mpeg" };
      const type = typeof providerStream.ext === "string" ? mimeTypes[providerStream.ext] : undefined;
      const codec = YouTubeMusic.text(providerStream.codec);
      if (!type || !codec || !/^(?:mp4a(?:\.\d+)*|aac|opus|vorbis|mp3|flac)$/.test(codec)) {
        throw new YouTubeMusicError(502, "YouTube Music returned an unsupported audio format");
      }

      const expiresAt = Number(new URL(url).searchParams.get("expire")) * 1000;
      const stream = { url, type,
        until: Number.isFinite(expiresAt) && expiresAt > Date.now() ? expiresAt - 5 * 60_000 : Date.now() + 60_000 };

      YouTubeMusic.boundedSet(this.streamCache, videoId, stream);
      this.streamFailures.delete(videoId);

      return stream;
    }).catch((error: unknown) => {
      const playbackError = error instanceof YouTubeMusicError && error.status === 503 ? error
        : new YouTubeMusicError(502, "This song cannot play in Needle. Open it in YouTube Music.", "playback_unavailable");
      YouTubeMusic.boundedSet(this.streamFailures, videoId, { error: playbackError, until: Date.now() + 60_000 });

      throw playbackError;
    }).finally(() => this.streamPending.delete(videoId));
    this.streamPending.set(videoId, resolution);

    return resolution;
  }

  private async fetchStream(url: string, headers: Headers, signal: AbortSignal): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);

    try {
      return await fetch(YouTubeMusic.streamUrl(url), { headers, signal: AbortSignal.any([signal, controller.signal]), redirect: "error" });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async runBridge(request: YouTubeMusicBridgeRequest, user?: string): Promise<unknown> {
    if (!BRIDGE_OPERATIONS.has(request.operation)) throw new YouTubeMusicError(400, "Unknown YouTube Music operation");
    if (this.options.bridge) return this.options.bridge(request);
    if (this.children.size >= 8) throw new YouTubeMusicError(503, "YouTube Music is busy. Try again shortly.", "busy");

    return new Promise<unknown>((resolve, reject) => {
      const child = spawn(this.options.python, ["-I", BRIDGE_PATH], { stdio: ["pipe", "pipe", "pipe"], env: YouTubeMusic.bridgeEnvironment() });
      this.children.set(child, user);
      const output: Buffer[] = [];
      let bytes = 0;
      let finished = false;
      const complete = (error?: YouTubeMusicError, data?: unknown) => {
        if (finished) return;

        finished = true;
        clearTimeout(timeout);
        this.children.delete(child);
        if (error) reject(error);
        else resolve(data);
      };
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        complete(new YouTubeMusicError(502, "YouTube Music took too long to respond", "timeout"));
      }, 30_000);

      child.stderr.resume();
      child.stdin.on("error", () => complete(new YouTubeMusicError(502, "YouTube Music bridge stopped responding")));
      child.stdout.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > BRIDGE_MAX_BYTES) {
          child.kill("SIGKILL");
          complete(new YouTubeMusicError(502, "YouTube Music returned too much data"));
        } else output.push(chunk);
      });
      child.once("error", () => complete(new YouTubeMusicError(503, "YouTube Music's Python runtime is unavailable", "runtime_missing")));
      child.once("close", (code) => {
        if (finished) return;
        if (code !== 0) return complete(new YouTubeMusicError(502, "YouTube Music bridge stopped responding"));

        try {
          const response = YouTubeMusic.providerObject(JSON.parse(Buffer.concat(output).toString("utf8")) as unknown);
          if (response.error) return complete(YouTubeMusic.bridgeError(response.error));
          if (!("data" in response)) return complete(new YouTubeMusicError(502, "YouTube Music returned an invalid response"));

          complete(undefined, response.data);
        } catch {
          complete(new YouTubeMusicError(502, "YouTube Music returned an invalid response"));
        }
      });

      child.stdin.end(JSON.stringify(request));
    });
  }

  private static bridgeError(code: unknown): YouTubeMusicError {
    if (code === "quota") return new YouTubeMusicError(429, "YouTube Music is limiting requests", code);
    if (code === "auth_reconnect") return new YouTubeMusicError(409, "Reconnect YouTube Music in Settings", code);
    if (code === "runtime_missing") return new YouTubeMusicError(503, "Install the YouTube Music Python dependencies on the Needle server", code);

    return new YouTubeMusicError(502, "YouTube Music is not responding");
  }

  private static bridgeEnvironment(): NodeJS.ProcessEnv {
    const environment: NodeJS.ProcessEnv = {};

    for (const name of ["PATH", "LANG", "LC_ALL", "TZ", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY",
      "http_proxy", "https_proxy", "all_proxy", "no_proxy", "SSL_CERT_FILE", "SSL_CERT_DIR", "REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE"]) {
      const value = process.env[name];
      if (value !== undefined) environment[name] = value;
    }

    return environment;
  }

  private static object(value: unknown): ProviderObject {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value as ProviderObject : {};
  }

  private static providerObject(value: unknown): ProviderObject {
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new YouTubeMusicError(502, "YouTube Music returned an invalid response");

    return value as ProviderObject;
  }

  private static text(value: unknown): string | undefined {
    return typeof value === "string" && value.length > 0 && value.length <= 100_000 ? value : undefined;
  }

  private static number(value: unknown): number | undefined {
    const parsed = typeof value === "number" ? value : typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : NaN;

    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  }

  private static list(value: unknown): unknown[] {
    if (!Array.isArray(value)) throw new YouTubeMusicError(502, "YouTube Music returned an invalid list");

    return value as unknown[];
  }

  private static validId(id: string, kind?: "song" | "album" | "artist"): string {
    const rawId = youtubeMusicRawId(id);
    if (!PROVIDER_ID.test(rawId) || (kind === "song" && !VIDEO_ID.test(rawId)) || (kind === "album" && !rawId.startsWith("MPRE"))
      || (kind === "artist" && !/^(?:MPLA)?UC/.test(rawId))) throw new YouTubeMusicError(400, "Use a valid YouTube Music ID");

    return rawId;
  }

  private static verificationUrl(value: string): boolean {
    try {
      const url = new URL(value);

      return url.protocol === "https:" && !url.username && !url.password && !url.port
        && ["www.youtube.com", "youtube.com", "accounts.google.com", "www.google.com", "google.com"].includes(url.hostname);
    } catch {
      return false;
    }
  }

  private static imageUrl(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;

    try {
      const url = new URL(value);

      return url.protocol === "https:" && !url.username && !url.password ? url.href : undefined;
    } catch {
      return undefined;
    }
  }

  private static streamUrl(value: unknown): string {
    try {
      const url = new URL(typeof value === "string" ? value : "");
      if (url.protocol === "https:" && url.hostname.endsWith(".googlevideo.com") && !url.username && !url.password && !url.port) return url.href;
    } catch {
      throw new YouTubeMusicError(502, "YouTube Music returned an unsafe audio address");
    }

    throw new YouTubeMusicError(502, "YouTube Music returned an unsafe audio address");
  }

  private static images(value: unknown): RemoteImage[] {
    if (!Array.isArray(value)) return [];

    return (value as unknown[]).flatMap((rawImage) => {
      const image = YouTubeMusic.object(rawImage);
      const url = YouTubeMusic.imageUrl(image.url);

      return url ? [{ url, width: YouTubeMusic.number(image.width), height: YouTubeMusic.number(image.height) }] : [];
    });
  }

  private static references(value: unknown): NamedRef[] {
    if (!Array.isArray(value)) return [];

    return (value as unknown[]).flatMap((rawArtist) => {
      const artist = YouTubeMusic.object(rawArtist);
      const name = YouTubeMusic.text(artist.name);
      const id = YouTubeMusic.text(artist.id);

      return name && id && PROVIDER_ID.test(id) ? [{ id: youtubeMusicId(id), name }] : [];
    });
  }

  private static song(value: unknown, album?: YouTubeMusicAlbum, artist?: NamedRef): Song | null {
    const providerSong = YouTubeMusic.object(value);
    const rawId = YouTubeMusic.text(providerSong.videoId);
    const title = YouTubeMusic.text(providerSong.title);
    const videoType = YouTubeMusic.text(providerSong.videoType) ?? YouTubeMusic.text(providerSong.musicVideoType);
    if (!rawId || !VIDEO_ID.test(rawId) || !title || (videoType && videoType !== "MUSIC_VIDEO_TYPE_ATV")) return null;

    const songAlbum = YouTubeMusic.object(providerSong.album);
    const artistRefs = YouTubeMusic.references(providerSong.artists);
    const artists = artistRefs.length ? artistRefs : album?.artists.length ? album.artists : artist ? [artist] : [];
    const artistNames = Array.isArray(providerSong.artists)
      ? (providerSong.artists as unknown[]).flatMap((artist) => YouTubeMusic.text(YouTubeMusic.object(artist).name) ?? []) : [];
    const images = YouTubeMusic.images(providerSong.thumbnails);
    const coverArt = images.at(-1)?.url ?? album?.images.at(-1)?.url;
    const durationParts = (YouTubeMusic.text(providerSong.duration) ?? "").split(":");
    const duration = YouTubeMusic.number(providerSong.duration_seconds)
      ?? (durationParts.length >= 2 && durationParts.every((part) => /^\d+$/.test(part)) ? durationParts.reduce((seconds, part) => seconds * 60 + Number(part), 0) : undefined);
    const albumId = YouTubeMusic.text(songAlbum.id);

    const artistNamesText = artistNames.join(", ");
    const artistsText = artists.map((artist) => artist.name).join(", ");

    return {
      id: youtubeMusicId(rawId), title, source: "youtubeMusic", uri: `https://music.youtube.com/watch?v=${rawId}`,
      artist: artistNamesText ? artistNamesText : YouTubeMusic.text(providerSong.artist) ?? (artistsText ? artistsText : undefined),
      artistId: artists[0]?.id, artists,
      album: YouTubeMusic.text(songAlbum.name) ?? YouTubeMusic.text(providerSong.album) ?? album?.title,
      albumId: albumId && PROVIDER_ID.test(albumId) ? youtubeMusicId(albumId) : album?.id,
      coverArt, duration, track: YouTubeMusic.number(providerSong.trackNumber), year: album?.year,
      isAvailable: providerSong.isAvailable !== false,
    };
  }

  private static songs(value: unknown, album?: YouTubeMusicAlbum, artist?: NamedRef): Song[] {
    return YouTubeMusic.list(value).flatMap((providerSong) => {
      const song = YouTubeMusic.song(providerSong, album, artist);

      return song ? [song] : [];
    });
  }

  private static album(value: unknown, artist?: NamedRef): YouTubeMusicAlbum | null {
    const providerAlbum = YouTubeMusic.object(value);
    const rawId = YouTubeMusic.text(providerAlbum.browseId);
    const title = YouTubeMusic.text(providerAlbum.title);
    if (!rawId || !PROVIDER_ID.test(rawId) || !rawId.startsWith("MPRE") || !title) return null;

    const artists = YouTubeMusic.references(providerAlbum.artists);

    return {
      id: youtubeMusicId(rawId), title, artists: artists.length ? artists : artist ? [artist] : [],
      images: YouTubeMusic.images(providerAlbum.thumbnails), year: YouTubeMusic.number(providerAlbum.year),
      playlistId: YouTubeMusic.text(providerAlbum.audioPlaylistId) ?? YouTubeMusic.text(providerAlbum.playlistId),
      songCount: YouTubeMusic.number(providerAlbum.trackCount), duration: YouTubeMusic.number(providerAlbum.duration_seconds),
      description: YouTubeMusic.text(providerAlbum.description),
    };
  }

  private static albums(value: unknown, artist?: NamedRef): YouTubeMusicAlbum[] {
    return YouTubeMusic.list(value).flatMap((rawAlbum) => {
      const album = YouTubeMusic.album(rawAlbum, artist);

      return album ? [album] : [];
    });
  }

  private static artist(value: unknown): YouTubeMusicArtist | null {
    const providerArtist = YouTubeMusic.object(value);
    const rawId = YouTubeMusic.text(providerArtist.browseId);
    const name = YouTubeMusic.text(providerArtist.name) ?? YouTubeMusic.text(providerArtist.artist) ?? YouTubeMusic.text(providerArtist.title);
    if (!rawId || !PROVIDER_ID.test(rawId) || !name) return null;

    return {
      id: youtubeMusicId(rawId), name, images: YouTubeMusic.images(providerArtist.thumbnails),
      description: YouTubeMusic.text(providerArtist.description), subscribers: YouTubeMusic.text(providerArtist.subscribers),
      subscribed: typeof providerArtist.subscribed === "boolean" ? providerArtist.subscribed : undefined,
      subscriptionId: YouTubeMusic.text(providerArtist.channelId),
    };
  }

  private static playlist(value: unknown): YouTubeMusicPlaylist | null {
    const providerPlaylist = YouTubeMusic.object(value);
    const rawId = YouTubeMusic.text(providerPlaylist.playlistId) ?? YouTubeMusic.text(providerPlaylist.browseId);
    const title = YouTubeMusic.text(providerPlaylist.title);
    if (!rawId || !PROVIDER_ID.test(rawId) || !title) return null;

    const author = YouTubeMusic.object(providerPlaylist.author);

    return {
      id: youtubeMusicId(rawId), title, images: YouTubeMusic.images(providerPlaylist.thumbnails),
      author: YouTubeMusic.text(author.name) ?? YouTubeMusic.text(providerPlaylist.author),
      description: YouTubeMusic.text(providerPlaylist.description),
      songCount: YouTubeMusic.number(providerPlaylist.trackCount) ?? YouTubeMusic.number(providerPlaylist.count),
      duration: YouTubeMusic.number(providerPlaylist.duration_seconds),
      owned: typeof providerPlaylist.owned === "boolean" ? providerPlaylist.owned : undefined,
    };
  }

  private static page<T>(items: T[], limit: number, total?: number): YouTubeMusicPage<T> {
    return { items: items.slice(0, limit), total: total ?? (items.length <= limit ? items.length : null), hasMore: (total ?? items.length) > limit, limit };
  }

  private static providerToken(value: ProviderObject): ProviderToken {
    const accessToken = YouTubeMusic.text(value.access_token);
    const refreshToken = YouTubeMusic.text(value.refresh_token);
    const expiresIn = YouTubeMusic.number(value.expires_in);
    const scope = YouTubeMusic.text(value.scope) ?? SCOPE;
    if (!accessToken || !refreshToken || !expiresIn || !scope.split(" ").includes(SCOPE)) throw new YouTubeMusicError(502, "Google refused the YouTube Music connection");

    return { access_token: accessToken, refresh_token: refreshToken, expires_in: expiresIn, scope };
  }

  private static boundedSet<T>(cache: Map<string, T>, key: string, value: T): void {
    cache.delete(key);
    cache.set(key, value);

    while (cache.size > CACHE_SIZE) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey !== undefined) cache.delete(oldestKey);
    }
  }
}
