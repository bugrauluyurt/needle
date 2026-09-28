import type { BrowseTile, Capabilities, ConnectionCheck, Song, DownloadItem, LidarrSearch, Me, RequestItem, SongCandidate, ImportedTrack, ImportResult, LidarrAlbum, LidarrArtist, Mix, Period, PlayReport, SearchResult3, SpotifyPlaylist, SpotifyToken, Stats } from "@needle/shared";
import { AUTH_HEADERS } from "@needle/shared";
import { credentials } from "../state/session.ts";

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const c = credentials();
  const headers = new Headers(init.headers);
  if (c) {
    headers.set(AUTH_HEADERS.user, c.user);
    headers.set(AUTH_HEADERS.token, c.token);
    headers.set(AUTH_HEADERS.salt, c.salt);
  }
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const res = await fetch(`/api${path}`, { ...init, headers });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(res.status, body?.error ?? `Needle server answered ${res.status}`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

const send = (method: string) => <T>(path: string, body?: unknown) => request<T>(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const post = send("POST");
const put = send("PUT");

export const api = {
  capabilities: () => request<Capabilities>("/capabilities"),
  health: () => request<{ ok: boolean; version: string }>("/health"),
  status: (fresh: boolean) => request<{ checks: ConnectionCheck[] }>(`/status${fresh ? "?fresh=1" : ""}`),
  reportPlay: (p: PlayReport) => post<void>("/plays", p),
  stats: (period: Period) => request<Stats>(`/stats?period=${period}`),
  mixes: () => request<Mix[]>("/mixes"),
  browse: () => request<BrowseTile[]>("/browse"),
  me: () => request<Me>("/me"),
  songSearch: (q: string) => request<SongCandidate[]>(`/songs/search?q=${encodeURIComponent(q)}`),
  getSong: (song: SongCandidate) => post<RequestItem>("/songs", song),
  requests: () => request<RequestItem[]>("/requests"),
  retryRequest: (id: number) => post<RequestItem>(`/requests/${id}/retry`),
  removeRequest: (id: number) => request<void>(`/requests/${id}`, { method: "DELETE" }),
  setPhoto: (photo: Blob) => request<void>("/me/photo", { method: "PUT", body: photo, headers: { "content-type": photo.type } }),
  removePhoto: () => request<void>("/me/photo", { method: "DELETE" }),
  librarySongs: () => request<Song[]>("/library/songs"),
  search: (q: string, signal?: AbortSignal) => request<SearchResult3>(`/search?q=${encodeURIComponent(q)}`, signal ? { signal } : {}),
  lidarrSearch: (q: string) => request<LidarrSearch>(`/lidarr/search?q=${encodeURIComponent(q)}`),
  lidarrAlbums: (ids: string[]) => request<LidarrAlbum[]>(`/lidarr/albums?ids=${ids.map(encodeURIComponent).join(",")}`),
  lidarrGet: (foreignAlbumId: string) => post<LidarrAlbum>(`/lidarr/albums/${encodeURIComponent(foreignAlbumId)}`),
  lidarrArtists: (names: string[]) => request<LidarrArtist[]>(`/lidarr/artists?names=${names.map(encodeURIComponent).join("|")}`),
  lidarrDownloads: () => request<DownloadItem[]>("/lidarr/downloads"),
  spotifyLogin: () => request<{ url: string }>("/spotify/login"),
  spotifyToken: () => request<SpotifyToken>("/spotify/token"),
  spotifyDisconnect: () => request<void>("/spotify", { method: "DELETE" }),
  spotifyEnabled: (on: boolean) => put<void>("/spotify/enabled", { on }),
  spotifyPlaylists: () => request<SpotifyPlaylist[]>("/spotify/playlists"),
  spotifyImport: (source: string) => post<ImportResult>("/spotify/import", { source }),
  spotifyMissing: (tracks: ImportedTrack[]) => post<{ requested: number; notFound: number; skipped: number }>("/spotify/missing", { tracks }),
};

export function devicesSocketUrl(): string | null {
  const c = credentials();
  if (!c) return null;
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/api/devices?${new URLSearchParams({ u: c.user, t: c.token, s: c.salt }).toString()}`;
}
