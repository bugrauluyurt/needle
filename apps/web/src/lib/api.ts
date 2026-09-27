import type { Capabilities, ImportedTrack, ImportResult, LidarrAlbum, LidarrArtist, Mix, Period, PlayReport, SpotifyPlaylist, Stats } from "@needle/shared";
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

const post = <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

export const api = {
  capabilities: () => request<Capabilities>("/capabilities"),
  reportPlay: (p: PlayReport) => post<void>("/plays", p),
  stats: (period: Period) => request<Stats>(`/stats?period=${period}`),
  mixes: () => request<Mix[]>("/mixes"),
  lidarrSearch: (q: string) => request<LidarrAlbum[]>(`/lidarr/search?q=${encodeURIComponent(q)}`),
  lidarrAlbums: (ids: string[]) => request<LidarrAlbum[]>(`/lidarr/albums?ids=${ids.map(encodeURIComponent).join(",")}`),
  lidarrGet: (foreignAlbumId: string) => post<LidarrAlbum>(`/lidarr/albums/${encodeURIComponent(foreignAlbumId)}`),
  lidarrArtists: (names: string[]) => request<LidarrArtist[]>(`/lidarr/artists?names=${names.map(encodeURIComponent).join("|")}`),
  lidarrAddArtist: (foreignArtistId: string) => post<void>(`/lidarr/artists/${encodeURIComponent(foreignArtistId)}`),
  spotifyLogin: () => request<{ url: string }>("/spotify/login"),
  spotifyDisconnect: () => request<void>("/spotify", { method: "DELETE" }),
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
