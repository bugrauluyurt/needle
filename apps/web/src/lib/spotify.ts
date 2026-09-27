import type { Song, SpotifyToken } from "@needle/shared";
import { api } from "./api.ts";

export const SPOTIFY_API = "https://api.spotify.com/v1";
const MAX_ITEMS = 3000;
const PAGE = 50;
const ARTIST_ALBUMS_PAGE = 10;

type Image = { url: string; width?: number | null; height?: number | null };
export type SpArtistRef = { id: string; name: string };
export type SpAlbumRef = { id: string; name: string; images: Image[]; release_date?: string; artists?: SpArtistRef[]; album_type?: string; total_tracks?: number; uri?: string };
export type SpTrack = { id: string; uri: string; name: string; duration_ms: number; artists: SpArtistRef[]; album?: SpAlbumRef; track_number?: number; disc_number?: number; is_local?: boolean };
export type SpAlbum = SpAlbumRef & { tracks: { items: SpTrack[]; next: string | null; total: number }; label?: string; copyrights?: { text: string }[] };
export type SpArtist = { id: string; name: string; images: Image[]; followers?: { total: number } };
export type SpPlaylist = {
  id: string;
  name: string;
  description?: string | null;
  owner: { id: string; display_name?: string };
  images?: Image[] | null;
  collaborative: boolean;
  public?: boolean | null;
  snapshot_id?: string;
  items?: { total: number };
  tracks?: { total: number };
  external_urls?: { spotify?: string };
};
type Paged<T> = { items: T[]; next: string | null; total: number };
type PlaylistItem = { added_at?: string; item?: SpTrack | null; track?: SpTrack | null };
type SavedTrack = { added_at: string; track: SpTrack };
type SavedAlbum = { added_at: string; album: SpAlbum };
type SearchResult = { tracks?: Paged<SpTrack>; albums?: Paged<SpAlbumRef>; artists?: Paged<SpArtist>; playlists?: Paged<SpPlaylist | null> };

export class SpotifyApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let token: SpotifyToken | null = null;
let pending: Promise<SpotifyToken> | null = null;

export async function spotifyToken(force = false): Promise<string> {
  if (!force && token && token.expiresAt - 30_000 > Date.now()) return token.accessToken;
  pending ??= api.spotifyToken().finally(() => {
    pending = null;
  });
  token = await pending;
  return token.accessToken;
}

async function req<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const url = path.startsWith("http") ? path : `${SPOTIFY_API}${path}`;
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${await spotifyToken()}`);
  if (init.body) headers.set("content-type", "application/json");
  const res = await fetch(url, { ...init, headers });
  if (res.status === 401 && retry) {
    await spotifyToken(true);
    return req<T>(path, init, false);
  }
  if (res.status === 429 && retry) {
    await new Promise((r) => setTimeout(r, Number(res.headers.get("retry-after") ?? 2) * 1000));
    return req<T>(path, init, false);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new SpotifyApiError(res.status, body?.error?.message ?? `Spotify answered ${res.status}`);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

async function pages<T>(first: string, limit = MAX_ITEMS, unwrap: (body: unknown) => Paged<T> = (body) => body as Paged<T>): Promise<T[]> {
  const out: T[] = [];
  let next: string | null = first;
  while (next && out.length < limit) {
    const page: Paged<T> = unwrap(await req<unknown>(next));
    out.push(...page.items);
    next = page.next;
  }
  return out;
}

export function image(images: Image[] | null | undefined, px = 300): string | undefined {
  if (!images?.length) return undefined;
  const sorted = [...images].sort((a, b) => (a.width ?? 640) - (b.width ?? 640));
  return (sorted.find((i) => (i.width ?? 640) >= px) ?? sorted[sorted.length - 1])?.url;
}

export const spId = (id: string) => `sp:${id}`;
export const albumSongs = (a: SpAlbum): Song[] => a.tracks.items.map((t) => toSong(t, a));
export const isSpotify = (id: string | undefined) => Boolean(id?.startsWith("sp:"));
export const rawId = (id: string) => id.replace(/^sp:/, "");

export function toSong(t: SpTrack, album?: SpAlbumRef, extra: Partial<Song> = {}): Song {
  const al = t.album ?? album;
  const artists = t.artists.map((a) => a.name).join(", ");
  const year = al?.release_date ? Number.parseInt(al.release_date, 10) : undefined;
  const cover = image(al?.images, 300);
  return {
    id: spId(t.id),
    title: t.name,
    artist: artists,
    displayArtist: artists,
    ...(t.artists[0] ? { artistId: spId(t.artists[0].id) } : {}),
    artists: t.artists.map((a) => ({ id: spId(a.id), name: a.name })),
    ...(al ? { album: al.name, albumId: spId(al.id) } : {}),
    ...(cover ? { coverArt: cover } : {}),
    duration: Math.round(t.duration_ms / 1000),
    ...(t.track_number ? { track: t.track_number } : {}),
    ...(t.disc_number ? { discNumber: t.disc_number } : {}),
    ...(year && !Number.isNaN(year) ? { year } : {}),
    source: "spotify",
    uri: t.uri,
    ...extra,
  };
}

const playable = (t: SpTrack | null | undefined): t is SpTrack => Boolean(t?.id && t.uri.startsWith("spotify:track:") && !t.is_local);

export const sp = {
  me: () => req<{ id: string; display_name?: string; product?: string }>("/me"),
  playlists: () => pages<SpPlaylist>(`/me/playlists?limit=${PAGE}`),
  playlist: (id: string) => req<SpPlaylist>(`/playlists/${id}`),
  playlistSongs: async (id: string): Promise<Song[]> =>
    (await pages<PlaylistItem>(`/playlists/${id}/items?limit=${PAGE}`)).flatMap((i) => {
      const t = i.item ?? i.track;
      return playable(t) ? [toSong(t, undefined, i.added_at ? { created: i.added_at } : {})] : [];
    }),
  liked: async (): Promise<Song[]> =>
    (await pages<SavedTrack>(`/me/tracks?limit=${PAGE}`)).filter((s) => playable(s.track)).map((s) => toSong(s.track, undefined, { starred: s.added_at })),
  albums: async () => (await pages<SavedAlbum>(`/me/albums?limit=${PAGE}`)).map((s) => s.album),
  album: async (id: string): Promise<SpAlbum> => {
    const album = await req<SpAlbum>(`/albums/${id}`);
    const rest = album.tracks.next ? await pages<SpTrack>(album.tracks.next) : [];
    return { ...album, tracks: { ...album.tracks, items: [...album.tracks.items, ...rest], next: null } };
  },
  artist: (id: string) => req<SpArtist>(`/artists/${id}`),
  artistAlbums: (id: string) => pages<SpAlbumRef>(`/artists/${id}/albums?include_groups=album,single&limit=${ARTIST_ALBUMS_PAGE}`, 200),
  followed: () => pages<SpArtist>(`/me/following?type=artist&limit=${PAGE}`, MAX_ITEMS, (body) => (body as { artists: Paged<SpArtist> }).artists),
  search: (q: string, signal?: AbortSignal) =>
    req<SearchResult>(`/search?${new URLSearchParams({ q, type: "track,album,artist,playlist", limit: "10" }).toString()}`, signal ? { signal } : {}),
  saved: (uris: string[]) => req<boolean[]>(`/me/library/contains?${new URLSearchParams({ uris: uris.join(",") }).toString()}`),
  save: (uris: string[]) => req<void>(`/me/library?${new URLSearchParams({ uris: uris.join(",") }).toString()}`, { method: "PUT" }),
  unsave: (uris: string[]) => req<void>(`/me/library?${new URLSearchParams({ uris: uris.join(",") }).toString()}`, { method: "DELETE" }),
  createPlaylist: (name: string) => req<SpPlaylist>("/me/playlists", { method: "POST", body: JSON.stringify({ name, public: false }) }),
  addToPlaylist: (id: string, uris: string[]) => req<{ snapshot_id: string }>(`/playlists/${id}/items`, { method: "POST", body: JSON.stringify({ uris }) }),
  removeFromPlaylist: (id: string, uris: string[]) =>
    req<{ snapshot_id: string }>(`/playlists/${id}/items`, { method: "DELETE", body: JSON.stringify({ items: uris.map((uri) => ({ uri })) }) }),
  reorderPlaylist: (id: string, from: number, to: number) =>
    req<{ snapshot_id: string }>(`/playlists/${id}/items`, { method: "PUT", body: JSON.stringify({ range_start: from, insert_before: to > from ? to + 1 : to }) }),
  play: (deviceId: string, uris: string[], positionMs = 0) =>
    req<void>(`/me/player/play?device_id=${encodeURIComponent(deviceId)}`, { method: "PUT", body: JSON.stringify({ uris, position_ms: Math.round(positionMs) }) }),
};

export const spotifyLink = (kind: "album" | "artist" | "playlist" | "track", id: string) => `https://open.spotify.com/${kind}/${rawId(id)}`;
