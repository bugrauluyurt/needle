import { createHash, randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { ImportedTrack, ImportResult, Playlist, Song, SpotifyPlaylist } from "@needle/shared";
import type { Auth, Navidrome } from "./navidrome.ts";

const AUTHORIZE = "https://accounts.spotify.com/authorize";
const TOKEN = "https://accounts.spotify.com/api/token";
const API = "https://api.spotify.com/v1";
const SCOPES = "playlist-read-private playlist-read-collaborative user-library-read";
const STATE_TTL = 10 * 60_000;
const PAGE = 500;

type Tokens = { access_token: string; refresh_token?: string; expires_in: number };
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

export function normalize(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s*[([].*?(feat|ft\.|with|remaster|version|edit|live|mono|stereo|deluxe|bonus).*?[)\]]/g, "")
    .replace(/\s+-\s+.*(remaster|version|edit|live|mono|stereo|mix).*$/, "")
    .replace(/&/g, "and")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function matchKey(title: string, artist: string): string {
  return `${normalize(artist)}|${normalize(title)}`;
}

export class Spotify {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly redirectUri: string;
  private readonly db: DatabaseSync;
  private readonly navidrome: Navidrome;

  constructor(opts: { clientId: string; clientSecret: string; publicUrl: string; db: DatabaseSync; navidrome: Navidrome }) {
    this.clientId = opts.clientId;
    this.clientSecret = opts.clientSecret;
    this.redirectUri = `${opts.publicUrl}/api/spotify/callback`;
    this.db = opts.db;
    this.navidrome = opts.navidrome;
  }

  connected(user: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM spotify_tokens WHERE user = ?").get(user));
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
      scope: SCOPES,
      state,
      code_challenge_method: "S256",
      code_challenge: b64url(createHash("sha256").update(verifier).digest()),
    });
    return `${AUTHORIZE}?${q.toString()}`;
  }

  private async token(fields: Record<string, string>): Promise<Tokens> {
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

  private save(user: string, t: Tokens, refresh: string) {
    this.db.prepare(`INSERT INTO spotify_tokens (user, access_token, refresh_token, expires_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(user) DO UPDATE SET access_token = excluded.access_token, refresh_token = excluded.refresh_token, expires_at = excluded.expires_at`)
      .run(user, t.access_token, t.refresh_token ?? refresh, Date.now() + (t.expires_in - 60) * 1000);
  }

  async complete(code: string, state: string): Promise<string> {
    const row = this.db.prepare("SELECT user, verifier, created_at FROM oauth_states WHERE state = ?").get(state) as
      { user: string; verifier: string; created_at: number } | undefined;
    this.db.prepare("DELETE FROM oauth_states WHERE state = ?").run(state);
    if (!row || row.created_at < Date.now() - STATE_TTL) throw new SpotifyError(400, "The Spotify sign-in expired; start it again");
    const t = await this.token({ grant_type: "authorization_code", code, redirect_uri: this.redirectUri, code_verifier: row.verifier });
    this.save(row.user, t, t.refresh_token ?? "");
    return row.user;
  }

  private async access(user: string): Promise<string> {
    const row = this.db.prepare("SELECT access_token, refresh_token, expires_at FROM spotify_tokens WHERE user = ?").get(user) as
      { access_token: string; refresh_token: string; expires_at: number } | undefined;
    if (!row) throw new SpotifyError(401, "Connect Spotify first");
    if (row.expires_at > Date.now()) return row.access_token;
    const t = await this.token({ grant_type: "refresh_token", refresh_token: row.refresh_token });
    this.save(user, t, row.refresh_token);
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

  async libraryIndex(auth: Auth): Promise<Map<string, string>> {
    const index = new Map<string, string>();
    for (let offset = 0; ; offset += PAGE) {
      const r = await this.navidrome.call<{ searchResult3: { song?: Song[] } }>(auth, "search3", {
        query: "", songCount: PAGE, songOffset: offset, albumCount: 0, artistCount: 0,
      });
      const songs = r.searchResult3.song ?? [];
      for (const s of songs) {
        const names = [s.artist, ...(s.artists ?? []).map((a) => a.name)].filter((n): n is string => Boolean(n));
        for (const n of names) index.set(matchKey(s.title, n), s.id);
      }
      if (songs.length < PAGE) return index;
    }
  }

  async import(auth: Auth, source: string): Promise<ImportResult> {
    const [{ name, tracks }, index] = await Promise.all([this.tracks(auth.user, source), this.libraryIndex(auth)]);
    const ids: string[] = [];
    const missing: ImportedTrack[] = [];
    for (const t of tracks) {
      const id = index.get(matchKey(t.title, t.artist));
      if (id) ids.push(id);
      else missing.push(t);
    }
    let playlistId: string | null = null;
    if (ids.length) {
      const title = `${name} (from Spotify)`;
      const { playlists } = await this.navidrome.call<{ playlists: { playlist?: Playlist[] } }>(auth, "getPlaylists");
      const existing = (playlists.playlist ?? []).find((p) => p.name === title);
      const r = await this.navidrome.call<{ playlist: Playlist }>(auth, "createPlaylist", existing
        ? { playlistId: existing.id, songId: ids }
        : { name: title, songId: ids });
      playlistId = r.playlist.id;
    }
    return { source: name, total: tracks.length, matched: ids.length, playlistId, missing };
  }
}
