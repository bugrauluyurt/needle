import { createHash, randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { ImportedTrack, ImportResult, SpotifyPlaylist } from "@needle/shared";
import type { Auth, Navidrome } from "./navidrome.ts";
import type { LibrarySearch } from "./search.ts";
import { findSong } from "./search.ts";

const AUTHORIZE = "https://accounts.spotify.com/authorize";
const TOKEN = "https://accounts.spotify.com/api/token";
const API = "https://api.spotify.com/v1";
const SCOPES = [
  "streaming", "user-read-email", "user-read-private", "user-read-playback-state", "user-modify-playback-state",
  "user-library-read", "user-library-modify", "playlist-read-private", "playlist-read-collaborative",
  "playlist-modify-private", "playlist-modify-public", "user-follow-read", "user-follow-modify", "user-read-recently-played",
];
const STATE_TTL = 10 * 60_000;

type Tokens = { access_token: string; refresh_token?: string; expires_in: number; scope?: string };
type SpTrack = { name: string; artists: { name: string }[]; album: { name: string } };
type SpItem = { track?: SpTrack | null; item?: SpTrack | null };
type SpPage<T> = { items: T[]; next: string | null };
type SpPlaylist = {
  id: string;
  name: string;
  collaborative: boolean;
  owner: { id: string };
  images?: { url: string }[] | null;
  items?: { total: number };
  tracks?: { total: number };
};

export class SpotifyError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const b64url = (buf: Buffer) => buf.toString("base64url");

export class Spotify {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly redirectUri: string;
  private readonly db: DatabaseSync;
  private readonly navidrome: Navidrome;
  private readonly library: LibrarySearch;

  constructor(opts: { clientId: string; clientSecret: string; publicUrl: string; db: DatabaseSync; navidrome: Navidrome; library: LibrarySearch }) {
    this.clientId = opts.clientId;
    this.clientSecret = opts.clientSecret;
    this.redirectUri = `${opts.publicUrl}/api/spotify/callback`;
    this.db = opts.db;
    this.navidrome = opts.navidrome;
    this.library = opts.library;
  }

  connected(user: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM spotify_tokens WHERE user = ?").get(user));
  }

  enabled(user: string): boolean {
    const row = this.db.prepare("SELECT enabled FROM spotify_tokens WHERE user = ?").get(user) as { enabled: number } | undefined;
    return row?.enabled !== 0;
  }

  setEnabled(user: string, on: boolean) {
    this.db.prepare("UPDATE spotify_tokens SET enabled = ? WHERE user = ?").run(on ? 1 : 0, user);
  }

  private scopes(user: string): Set<string> {
    const row = this.db.prepare("SELECT scope FROM spotify_tokens WHERE user = ?").get(user) as { scope: string } | undefined;
    return new Set(row?.scope.split(" "));
  }

  canPlay(user: string): boolean {
    return this.scopes(user).has("streaming");
  }

  needsReconnect(user: string): boolean {
    const granted = this.scopes(user);
    return this.connected(user) && SCOPES.some((s) => !granted.has(s));
  }

  async token(user: string): Promise<{ accessToken: string; expiresAt: number }> {
    if (!this.enabled(user)) throw new SpotifyError(409, "Spotify is switched off in Needle");
    const accessToken = await this.access(user);
    const row = this.db.prepare("SELECT expires_at FROM spotify_tokens WHERE user = ?").get(user) as { expires_at: number };
    return { accessToken, expiresAt: row.expires_at };
  }

  disconnect(user: string) {
    this.db.prepare("DELETE FROM spotify_tokens WHERE user = ?").run(user);
  }

  authorizeUrl(user: string): string {
    const state = b64url(randomBytes(18));
    const verifier = b64url(randomBytes(48));
    this.db.prepare("DELETE FROM oauth_states WHERE created_at < ?").run(Date.now() - STATE_TTL);
    this.db.prepare("INSERT INTO oauth_states (state, user, verifier, created_at) VALUES (?, ?, ?, ?)").run(state, user, verifier, Date.now());
    const q = new URLSearchParams({
      client_id: this.clientId,
      response_type: "code",
      redirect_uri: this.redirectUri,
      scope: SCOPES.join(" "),
      state,
      code_challenge_method: "S256",
      code_challenge: b64url(createHash("sha256").update(verifier).digest()),
    });
    return `${AUTHORIZE}?${q.toString()}`;
  }

  private async exchange(fields: Record<string, string>): Promise<Tokens> {
    const res = await fetch(TOKEN, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64")}`,
      },
      body: new URLSearchParams(fields),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new SpotifyError(res.status, `Spotify refused the sign-in (${res.status})`);
    return (await res.json()) as Tokens;
  }

  private save(user: string, t: Tokens, refresh: string, scope: string) {
    this.db.prepare(`INSERT INTO spotify_tokens (user, access_token, refresh_token, expires_at, scope) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user) DO UPDATE SET access_token = excluded.access_token, refresh_token = excluded.refresh_token,
        expires_at = excluded.expires_at, scope = excluded.scope`)
      .run(user, t.access_token, t.refresh_token ?? refresh, Date.now() + (t.expires_in - 60) * 1000, t.scope ?? scope);
  }

  async complete(code: string, state: string): Promise<string> {
    const row = this.db.prepare("SELECT user, verifier, created_at FROM oauth_states WHERE state = ?").get(state) as
      { user: string; verifier: string; created_at: number } | undefined;
    this.db.prepare("DELETE FROM oauth_states WHERE state = ?").run(state);
    if (!row || row.created_at < Date.now() - STATE_TTL) throw new SpotifyError(400, "The Spotify sign-in expired; start it again");
    const t = await this.exchange({ grant_type: "authorization_code", code, redirect_uri: this.redirectUri, code_verifier: row.verifier });
    this.save(row.user, t, t.refresh_token ?? "", "");
    return row.user;
  }

  private async access(user: string): Promise<string> {
    const row = this.db.prepare("SELECT access_token, refresh_token, expires_at, scope FROM spotify_tokens WHERE user = ?").get(user) as
      { access_token: string; refresh_token: string; expires_at: number; scope: string } | undefined;
    if (!row) throw new SpotifyError(401, "Connect Spotify first");
    if (row.expires_at > Date.now()) return row.access_token;
    const t = await this.exchange({ grant_type: "refresh_token", refresh_token: row.refresh_token });
    this.save(user, t, row.refresh_token, row.scope);
    return t.access_token;
  }

  private async get<T>(user: string, pathOrUrl: string): Promise<T> {
    const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${API}${pathOrUrl}`;
    const res = await fetch(url, { headers: { authorization: `Bearer ${await this.access(user)}` }, signal: AbortSignal.timeout(20_000) });
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, Number(res.headers.get("retry-after") ?? 2) * 1000));
      return this.get(user, pathOrUrl);
    }
    if (!res.ok) throw new SpotifyError(res.status, `Spotify answered ${res.status} for ${url.replace(API, "").split("?")[0]}`);
    return (await res.json()) as T;
  }

  private async pages<T>(user: string, first: string): Promise<T[]> {
    const out: T[] = [];
    let next: string | null = first;
    while (next) {
      const page: SpPage<T> = await this.get<SpPage<T>>(user, next);
      out.push(...page.items);
      next = page.next;
    }
    return out;
  }

  async playlists(user: string): Promise<SpotifyPlaylist[]> {
    const me = await this.get<{ id: string }>(user, "/me");
    const all = await this.pages<SpPlaylist>(user, "/me/playlists?limit=50");
    return all
      .filter((p) => p.owner.id === me.id || p.collaborative)
      .map((p) => ({ id: p.id, name: p.name, trackCount: p.items?.total ?? p.tracks?.total ?? 0, image: p.images?.[0]?.url ?? null }));
  }

  private async tracks(user: string, source: string): Promise<{ name: string; tracks: ImportedTrack[] }> {
    const toTrack = (t: SpTrack): ImportedTrack => ({ title: t.name, artist: t.artists[0]?.name ?? "", album: t.album.name });
    if (source === "liked") {
      const items = await this.pages<SpItem>(user, "/me/tracks?limit=50");
      return { name: "Liked on Spotify", tracks: items.map((i) => i.track).filter((t): t is SpTrack => Boolean(t)).map(toTrack) };
    }
    const meta = await this.get<{ name: string }>(user, `/playlists/${encodeURIComponent(source)}?fields=name`);
    const items = await this.pages<SpItem>(user, `/playlists/${encodeURIComponent(source)}/items?limit=50`);
    return { name: meta.name, tracks: items.map((i) => i.item ?? i.track).filter((t): t is SpTrack => Boolean(t?.name)).map(toTrack) };
  }

  async import(auth: Auth, source: string): Promise<ImportResult> {
    const [{ name, tracks }, matcher] = await Promise.all([this.tracks(auth.user, source), this.library.matcher(auth)]);
    const ids: string[] = [];
    const missing: ImportedTrack[] = [];
    for (const t of tracks) {
      const song = findSong(matcher, t);
      if (song) ids.push(song.id);
      else missing.push(t);
    }
    const playlistId = ids.length ? await this.navidrome.upsertPlaylist(auth, `${name} (from Spotify)`, ids) : null;
    return { source: name, total: tracks.length, matched: ids.length, playlistId, missing };
  }
}
