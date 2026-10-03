import { createHash, randomBytes } from "node:crypto";
import type { ImportedTrack, ImportResult, SpotifyPlaylist } from "@needle/shared";
import type { Database } from "./db/types.ts";
import type { Auth, Navidrome } from "./navidrome.ts";
import type { LibrarySearch } from "./search.ts";
import { findSong } from "./search.ts";

const AUTHORIZE = "https://accounts.spotify.com/authorize";
const TOKEN = "https://accounts.spotify.com/api/token";
const API = "https://api.spotify.com/v1";
const SCOPES = [
  "streaming",
  "user-read-email",
  "user-read-private",
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-library-read",
  "user-library-modify",
  "playlist-read-private",
  "playlist-read-collaborative",
  "playlist-modify-private",
  "playlist-modify-public",
  "user-follow-read",
  "user-follow-modify",
  "user-read-recently-played",
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

export class Spotify {
  constructor(opts: {
    clientId: string;
    clientSecret: string;
    publicUrl: string;
    db: Database;
    navidrome: Navidrome;
    library: LibrarySearch;
  }) {
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
    const row = this.db.prepare("SELECT enabled FROM spotify_tokens WHERE user = ?").get(user) as
      { enabled: number } | undefined;
    return row?.enabled !== 0;
  }

  setEnabled(user: string, on: boolean) {
    this.db.prepare("UPDATE spotify_tokens SET enabled = ? WHERE user = ?").run(on ? 1 : 0, user);
  }

  canPlay(user: string): boolean {
    return this.getScopes(user).has("streaming");
  }

  needsReconnect(user: string): boolean {
    const grantedScopes = this.getScopes(user);
    return this.connected(user) && SCOPES.some((scope) => !grantedScopes.has(scope));
  }

  async token(user: string): Promise<{ accessToken: string; expiresAt: number }> {
    if (!this.enabled(user)) throw new SpotifyError(409, "Spotify is switched off in Needle");
    const accessToken = await this.getAccessToken(user);
    const row = this.db.prepare("SELECT expires_at FROM spotify_tokens WHERE user = ?").get(user) as {
      expires_at: number;
    };
    return { accessToken, expiresAt: row.expires_at };
  }

  disconnect(user: string) {
    this.db.prepare("DELETE FROM spotify_tokens WHERE user = ?").run(user);
  }

  getAuthorization(user: string): { maxAgeSeconds: number; secure: boolean; state: string; url: string } {
    const state = Spotify.base64Url(randomBytes(18));
    const verifier = Spotify.base64Url(randomBytes(48));
    this.db.prepare("DELETE FROM oauth_states WHERE created_at < ?").run(Date.now() - STATE_TTL);
    this.db
      .prepare("INSERT INTO oauth_states (state, user, verifier, created_at) VALUES (?, ?, ?, ?)")
      .run(state, user, verifier, Date.now());
    const authorizationParameters = new URLSearchParams({
      client_id: this.clientId,
      response_type: "code",
      redirect_uri: this.redirectUri,
      scope: SCOPES.join(" "),
      state,
      code_challenge_method: "S256",
      code_challenge: Spotify.base64Url(createHash("sha256").update(verifier).digest()),
    });
    return {
      maxAgeSeconds: STATE_TTL / 1000,
      secure: new URL(this.redirectUri).protocol === "https:",
      state,
      url: `${AUTHORIZE}?${authorizationParameters.toString()}`,
    };
  }

  usesSecureCallbackCookie(): boolean {
    return new URL(this.redirectUri).protocol === "https:";
  }

  async complete(code: string, state: string): Promise<string> {
    const oauthState = this.db
      .prepare("SELECT user, verifier, created_at FROM oauth_states WHERE state = ?")
      .get(state) as { user: string; verifier: string; created_at: number } | undefined;
    this.db.prepare("DELETE FROM oauth_states WHERE state = ?").run(state);
    if (!oauthState || oauthState.created_at < Date.now() - STATE_TTL)
      throw new SpotifyError(400, "The Spotify sign-in expired; start it again");
    const tokenResponse = await this.getTokenResponse({
      grant_type: "authorization_code",
      code,
      redirect_uri: this.redirectUri,
      code_verifier: oauthState.verifier,
    });
    this.save(oauthState.user, tokenResponse, tokenResponse.refresh_token ?? "", "");
    return oauthState.user;
  }

  async playlists(user: string): Promise<SpotifyPlaylist[]> {
    const spotifyProfile = await this.getSpotifyData<{ id: string }>(user, "/me");
    const playlists = await this.getPaginatedItems<SpPlaylist>(user, "/me/playlists?limit=50");
    return playlists
      .filter((playlist) => playlist.owner.id === spotifyProfile.id || playlist.collaborative)
      .map((playlist) => ({
        id: playlist.id,
        name: playlist.name,
        trackCount: playlist.items?.total ?? playlist.tracks?.total ?? 0,
        image: playlist.images?.[0]?.url ?? null,
      }));
  }

  async import(auth: Auth, source: string): Promise<ImportResult> {
    const [{ name: playlistName, tracks }, libraryMatcher] = await Promise.all([
      this.getImportedTracks(auth.user, source),
      this.library.matcher(auth),
    ]);
    const songIds: string[] = [];
    const missingTracks: ImportedTrack[] = [];
    for (const importedTrack of tracks) {
      const matchedSong = findSong(libraryMatcher, importedTrack);
      if (matchedSong) songIds.push(matchedSong.id);
      else missingTracks.push(importedTrack);
    }
    const playlistId = songIds.length
      ? await this.navidrome.upsertPlaylist(auth, `${playlistName} (from Spotify)`, songIds)
      : null;
    return {
      source: playlistName,
      total: tracks.length,
      matched: songIds.length,
      playlistId,
      missing: missingTracks,
    };
  }

  private static base64Url(bytes: Buffer): string {
    return bytes.toString("base64url");
  }

  private getScopes(user: string): Set<string> {
    const savedToken = this.db.prepare("SELECT scope FROM spotify_tokens WHERE user = ?").get(user) as
      { scope: string } | undefined;
    return new Set(savedToken?.scope.split(" "));
  }

  private async getTokenResponse(tokenFields: Record<string, string>): Promise<Tokens> {
    const tokenResponse = await fetch(TOKEN, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64")}`,
      },
      body: new URLSearchParams(tokenFields),
      signal: AbortSignal.timeout(15_000),
    });
    if (!tokenResponse.ok) {
      throw new SpotifyError(tokenResponse.status, `Spotify refused the sign-in (${tokenResponse.status})`);
    }
    return (await tokenResponse.json()) as Tokens;
  }

  private save(user: string, tokenResponse: Tokens, refreshToken: string, scope: string) {
    this.db
      .prepare(
        `INSERT INTO spotify_tokens (user, access_token, refresh_token, expires_at, scope) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user) DO UPDATE SET access_token = excluded.access_token, refresh_token = excluded.refresh_token,
        expires_at = excluded.expires_at, scope = excluded.scope`,
      )
      .run(
        user,
        tokenResponse.access_token,
        tokenResponse.refresh_token ?? refreshToken,
        Date.now() + (tokenResponse.expires_in - 60) * 1000,
        tokenResponse.scope ?? scope,
      );
  }

  private async getAccessToken(user: string): Promise<string> {
    const savedToken = this.db
      .prepare("SELECT access_token, refresh_token, expires_at, scope FROM spotify_tokens WHERE user = ?")
      .get(user) as { access_token: string; refresh_token: string; expires_at: number; scope: string } | undefined;
    if (!savedToken) throw new SpotifyError(401, "Connect Spotify first");
    if (savedToken.expires_at > Date.now()) return savedToken.access_token;
    const tokenResponse = await this.getTokenResponse({
      grant_type: "refresh_token",
      refresh_token: savedToken.refresh_token,
    });
    this.save(user, tokenResponse, savedToken.refresh_token, savedToken.scope);
    return tokenResponse.access_token;
  }

  private async getSpotifyData<T>(user: string, pathOrUrl: string): Promise<T> {
    const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${API}${pathOrUrl}`;
    const providerResponse = await fetch(url, {
      headers: { authorization: `Bearer ${await this.getAccessToken(user)}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (providerResponse.status === 429) {
      await new Promise((resolveRetry) =>
        setTimeout(resolveRetry, Number(providerResponse.headers.get("retry-after") ?? 2) * 1000),
      );
      return this.getSpotifyData(user, pathOrUrl);
    }
    if (!providerResponse.ok)
      throw new SpotifyError(
        providerResponse.status,
        `Spotify answered ${providerResponse.status} for ${url.replace(API, "").split("?")[0]}`,
      );
    return (await providerResponse.json()) as T;
  }

  private async getPaginatedItems<T>(user: string, firstPageUrl: string): Promise<T[]> {
    const collectedItems: T[] = [];
    let nextPageUrl: string | null = firstPageUrl;
    while (nextPageUrl) {
      const page: SpPage<T> = await this.getSpotifyData<SpPage<T>>(user, nextPageUrl);
      collectedItems.push(...page.items);
      nextPageUrl = page.next;
    }
    return collectedItems;
  }

  private async getImportedTracks(user: string, source: string): Promise<{ name: string; tracks: ImportedTrack[] }> {
    const toTrack = (track: SpTrack): ImportedTrack => ({
      title: track.name,
      artist: track.artists[0]?.name ?? "",
      album: track.album.name,
    });
    if (source === "liked") {
      const items = await this.getPaginatedItems<SpItem>(user, "/me/tracks?limit=50");
      return {
        name: "Liked on Spotify",
        tracks: items
          .map((item) => item.track)
          .filter((track): track is SpTrack => Boolean(track))
          .map(toTrack),
      };
    }
    const playlist = await this.getSpotifyData<{ name: string }>(
      user,
      `/playlists/${encodeURIComponent(source)}?fields=name`,
    );
    const items = await this.getPaginatedItems<SpItem>(user, `/playlists/${encodeURIComponent(source)}/items?limit=50`);
    return {
      name: playlist.name,
      tracks: items
        .map((item) => item.item ?? item.track)
        .filter((track): track is SpTrack => Boolean(track?.name))
        .map(toTrack),
    };
  }

  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly redirectUri: string;
  private readonly db: Database;
  private readonly navidrome: Navidrome;
  private readonly library: LibrarySearch;
}
