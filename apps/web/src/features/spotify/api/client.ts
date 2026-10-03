import type { RemoteImage, Song, SpotifyToken } from "@needle/shared";
import { HOUR_MS, MINUTE_MS } from "@needle/shared";
import { create } from "zustand";
import { api } from "../../../lib/api.ts";
import { translate } from "../../../i18n/index.ts";

export const SPOTIFY_API = "https://api.spotify.com/v1";
const MAX_ITEMS = 3000;
const PAGE = 50;
const ARTIST_ALBUMS_PAGE = 10;
const SEARCH_PAGE = 10;
export const SPOTIFY_SEARCH_MAX_OFFSET = 1000;

export type SpImage = RemoteImage;
export type SpArtistRef = { id: string; name: string };
export type SpAlbumRef = {
  id: string;
  name: string;
  images: SpImage[];
  release_date?: string;
  artists?: SpArtistRef[];
  album_type?: string;
  total_tracks?: number;
  uri?: string;
};
export type SpTrack = {
  id: string;
  uri: string;
  name: string;
  duration_ms: number;
  artists: SpArtistRef[];
  album?: SpAlbumRef;
  track_number?: number;
  disc_number?: number;
  is_local?: boolean;
};
export type SpAlbum = SpAlbumRef & {
  tracks: { items: SpTrack[]; next: string | null; total: number };
  label?: string;
  copyrights?: { text: string }[];
};
export type SpArtist = {
  id: string;
  name: string;
  images: SpImage[];
  followers?: { total: number };
};
export type SpPlaylist = {
  id: string;
  name: string;
  description?: string | null;
  owner: { id: string; display_name?: string };
  images?: SpImage[] | null;
  collaborative: boolean;
  public?: boolean | null;
  snapshot_id?: string;
  items?: { total: number };
  tracks?: { total: number };
  external_urls?: { spotify?: string };
};
type Paged<T> = {
  items: T[];
  next: string | null;
  total: number;
  offset?: number;
  limit?: number;
};
export type SpPagination = {
  next: string | null;
  total: number;
  offset: number;
  limit: number;
};
export type SpPage<T> = SpPagination & { items: T[] };
export type SpotifySearchKind = "songs" | "albums" | "artists" | "playlists";
export type SpotifySearchType = "track" | "album" | "artist" | "playlist";
export type SpotifySearchData = {
  songs: Song[];
  albums: SpAlbumRef[];
  artists: SpArtist[];
  playlists: SpPlaylist[];
  pagination: Partial<Record<SpotifySearchKind, SpPagination>>;
};
type PlaylistItem = {
  added_at?: string;
  item?: SpTrack | null;
  track?: SpTrack | null;
};
type SavedTrack = { added_at: string; track: SpTrack };
type SavedAlbum = { added_at: string; album: SpAlbum };
type SearchResult = {
  tracks?: Paged<SpTrack>;
  albums?: Paged<SpAlbumRef>;
  artists?: Paged<SpArtist>;
  playlists?: Paged<SpPlaylist | null>;
};

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
  if (!force && token && token.expiresAt - 30_000 > Date.now())
    return token.accessToken;
  pending ??= api.spotifyToken().finally(() => {
    pending = null;
  });
  token = await pending;
  return token.accessToken;
}

const BLOCK_KEY = "needle.spotifyBlockedUntil";
const SHORT_WAIT_S = 5;
const QUOTA_WAIT_MS = HOUR_MS;
const DOWN_WAIT_MS = 5 * MINUTE_MS;

export const useSpotifyStatus = create<{ blocked: boolean; until: number }>(
  () => ({ blocked: false, until: 0 }),
);
let unblock: ReturnType<typeof setTimeout> | undefined;

function blockUntil(until: number) {
  clearTimeout(unblock);
  const ms = until - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return;
  useSpotifyStatus.setState({ blocked: true, until });
  unblock = setTimeout(
    () => {
      if (useSpotifyStatus.getState().until !== until) return;
      if (Date.now() < until) return blockUntil(until);
      useSpotifyStatus.setState({ blocked: false, until: 0 });
      try {
        localStorage.removeItem(BLOCK_KEY);
      } catch {
        return;
      }
    },
    Math.min(ms, 2_147_483_647),
  );
}

function block(ms: number) {
  const until = Math.max(useSpotifyStatus.getState().until, Date.now() + ms);
  try {
    localStorage.setItem(BLOCK_KEY, String(until));
  } catch {
    return blockUntil(until);
  }
  blockUntil(until);
}

try {
  blockUntil(Number(localStorage.getItem(BLOCK_KEY) ?? 0));
} catch {
  blockUntil(0);
}

async function req<T>(
  path: string,
  init: RequestInit = {},
  retry = true,
): Promise<T> {
  if (useSpotifyStatus.getState().blocked)
    throw new SpotifyApiError(429, translate("spotify.unavailableNow"));
  const url = path.startsWith("http") ? path : `${SPOTIFY_API}${path}`;
  const headers = new Headers(init.headers);
  const bearer = await spotifyToken().catch((e: unknown) => {
    block(DOWN_WAIT_MS);
    throw e;
  });
  if (useSpotifyStatus.getState().blocked)
    throw new SpotifyApiError(429, translate("spotify.paused"));
  headers.set("authorization", `Bearer ${bearer}`);
  if (init.body) headers.set("content-type", "application/json");
  const res = await fetch(url, { ...init, headers });
  if (res.status === 401 && retry) {
    await spotifyToken(true);
    return req<T>(path, init, false);
  }
  const retryAfter = res.headers.get("retry-after");
  const seconds = retryAfter?.trim() ? Number(retryAfter) : Number.NaN;
  const wait = Number.isFinite(seconds) && seconds >= 0 ? seconds : Number.NaN;
  if (res.status === 429 && retry && wait <= SHORT_WAIT_S) {
    block(wait * 1000);
    await new Promise((r) => setTimeout(r, wait * 1000));
    return req<T>(path, init, false);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    if (res.status === 429)
      block(Number.isNaN(wait) ? QUOTA_WAIT_MS : wait * 1000);
    throw new SpotifyApiError(
      res.status,
      body?.error?.message ??
        translate("error.spotifyAnswered", { status: res.status }),
    );
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

async function pages<T>(
  first: string,
  limit = MAX_ITEMS,
  unwrap: (body: unknown) => Paged<T> = (body) => body as Paged<T>,
): Promise<T[]> {
  const out: T[] = [];
  let next: string | null = first;
  while (next && out.length < limit) {
    const page: Paged<T> = unwrap(await req<unknown>(next));
    out.push(...page.items);
    next = page.next;
  }
  return out;
}

export function image(
  images: RemoteImage[] | null | undefined,
  px = 300,
): string | undefined {
  if (!images?.length) return undefined;
  const sorted = [...images].sort(
    (a, b) => (a.width ?? 640) - (b.width ?? 640),
  );
  return (
    sorted.find((i) => (i.width ?? 640) >= px) ?? sorted[sorted.length - 1]
  )?.url;
}

const ALBUM_COVER = /(\/image\/ab67616d0000)(4851|1e02|b273)/;

export function sizedCover(url: string, px: number): string {
  return url.replace(
    ALBUM_COVER,
    (_m, head: string) =>
      `${head}${px <= 64 ? "4851" : px <= 300 ? "1e02" : "b273"}`,
  );
}

export const spId = (id: string) => `sp:${id}`;
export const albumSongs = (a: SpAlbum): Song[] =>
  a.tracks.items.map((t) => toSong(t, a));
export const isSpotify = (id: string | undefined) =>
  Boolean(id?.startsWith("sp:"));
export const rawId = (id: string) => id.replace(/^sp:/, "");

export function toSong(
  t: SpTrack,
  album?: SpAlbumRef,
  extra: Partial<Song> = {},
): Song {
  const al = t.album ?? album;
  const artists = t.artists.map((a) => a.name).join(", ");
  const year = al?.release_date
    ? Number.parseInt(al.release_date, 10)
    : undefined;
  const cover = image(al?.images, 640);
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
    ...(al?.release_date ? { releaseDate: al.release_date } : {}),
    source: "spotify",
    uri: t.uri,
    ...extra,
  };
}

const playable = (t: SpTrack | null | undefined): t is SpTrack =>
  Boolean(t?.id && t.uri.startsWith("spotify:track:") && !t.is_local);

export function uniqueSpotifyItems<T extends { id: string }>(items: T[]): T[] {
  const itemIds = new Set<string>();

  return items.filter((item) => {
    if (itemIds.has(item.id)) return false;

    itemIds.add(item.id);

    return true;
  });
}

function searchPagination(page: Paged<unknown>, offset: number): SpPagination {
  return {
    next: page.next,
    total: page.total,
    offset: page.offset ?? offset,
    limit: page.limit ?? SEARCH_PAGE,
  };
}

export function nextSpotifySearchOffset(
  page: SpPagination,
): number | undefined {
  const nextOffset = page.offset + page.limit;

  return page.next &&
    nextOffset > page.offset &&
    nextOffset <= SPOTIFY_SEARCH_MAX_OFFSET
    ? nextOffset
    : undefined;
}

export function spotifySearchResults(
  searchResult: SearchResult,
  offset = 0,
): SpotifySearchData {
  return {
    songs: (searchResult.tracks?.items ?? [])
      .filter((track) => track.id)
      .map((track) => toSong(track)),
    albums: searchResult.albums?.items ?? [],
    artists: searchResult.artists?.items ?? [],
    playlists: (searchResult.playlists?.items ?? []).filter(
      (playlist): playlist is SpPlaylist => Boolean(playlist?.id),
    ),
    pagination: {
      ...(searchResult.tracks
        ? { songs: searchPagination(searchResult.tracks, offset) }
        : {}),
      ...(searchResult.albums
        ? { albums: searchPagination(searchResult.albums, offset) }
        : {}),
      ...(searchResult.artists
        ? { artists: searchPagination(searchResult.artists, offset) }
        : {}),
      ...(searchResult.playlists
        ? { playlists: searchPagination(searchResult.playlists, offset) }
        : {}),
    },
  };
}

export const sp = {
  me: () =>
    req<{
      id: string;
      display_name?: string;
      product?: string;
      images?: SpImage[];
    }>("/me"),
  playlists: () => pages<SpPlaylist>(`/me/playlists?limit=${PAGE}`),
  playlist: (id: string) => req<SpPlaylist>(`/playlists/${id}`),
  playlistSongs: async (id: string): Promise<Song[]> =>
    (await pages<PlaylistItem>(`/playlists/${id}/items?limit=${PAGE}`)).flatMap(
      (i) => {
        const t = i.item ?? i.track;
        return playable(t)
          ? [toSong(t, undefined, i.added_at ? { created: i.added_at } : {})]
          : [];
      },
    ),
  liked: async (): Promise<Song[]> =>
    (await pages<SavedTrack>(`/me/tracks?limit=${PAGE}`))
      .filter((s) => playable(s.track))
      .map((s) => toSong(s.track, undefined, { starred: s.added_at })),
  albums: async (): Promise<(SpAlbum & { added_at: string })[]> =>
    (await pages<SavedAlbum>(`/me/albums?limit=${PAGE}`)).map((s) => ({
      ...s.album,
      added_at: s.added_at,
    })),
  album: async (id: string): Promise<SpAlbum> => {
    const album = await req<SpAlbum>(`/albums/${id}`);
    const rest = album.tracks.next
      ? await pages<SpTrack>(album.tracks.next)
      : [];
    return {
      ...album,
      tracks: {
        ...album.tracks,
        items: [...album.tracks.items, ...rest],
        next: null,
      },
    };
  },
  artist: (id: string, signal?: AbortSignal) =>
    req<SpArtist>(`/artists/${id}`, signal ? { signal } : {}),
  artistAlbumsPage: async (
    id: string,
    {
      offset = 0,
      category,
      signal,
    }: {
      offset?: number;
      category?: "album" | "single";
      signal?: AbortSignal;
    } = {},
  ): Promise<SpPage<SpAlbumRef>> => {
    const albumPage = await req<Paged<SpAlbumRef>>(
      `/artists/${id}/albums?${new URLSearchParams({ include_groups: category ?? "album,single", limit: String(ARTIST_ALBUMS_PAGE), offset: String(offset) }).toString()}`,
      signal ? { signal } : {},
    );

    return {
      ...albumPage,
      offset: albumPage.offset ?? offset,
      limit: albumPage.limit ?? ARTIST_ALBUMS_PAGE,
    };
  },
  artistSongs: async (
    id: string,
    artistName: string,
    { offset = 0, signal }: { offset?: number; signal?: AbortSignal } = {},
  ): Promise<SpPage<Song>> => {
    const searchResult = await sp.search(
      `artist:"${artistName.replace(/["\\]/g, " ")}"`,
      signal,
      { type: "track", offset },
    );
    const trackPage = searchResult.tracks;

    return {
      ...(trackPage
        ? searchPagination(trackPage, offset)
        : { next: null, total: 0, offset, limit: SEARCH_PAGE }),
      items: (trackPage?.items ?? [])
        .filter(
          (track) =>
            track.id && track.artists.some((artist) => artist.id === id),
        )
        .map((track) => toSong(track)),
    };
  },
  followed: () =>
    pages<SpArtist>(
      `/me/following?type=artist&limit=${PAGE}`,
      MAX_ITEMS,
      (body) => (body as { artists: Paged<SpArtist> }).artists,
    ),
  findArtist: (name: string) =>
    req<{ artists: Paged<SpArtist> }>(
      `/search?${new URLSearchParams({ q: name, type: "artist", limit: "5" }).toString()}`,
    ).then((r) => r.artists.items),
  search: (
    q: string,
    signal?: AbortSignal,
    { type, offset = 0 }: { type?: SpotifySearchType; offset?: number } = {},
  ) =>
    req<SearchResult>(
      `/search?${new URLSearchParams({ q, type: type ?? "track,album,artist,playlist", limit: String(SEARCH_PAGE), offset: String(offset) }).toString()}`,
      signal ? { signal } : {},
    ),
  saved: (uris: string[]) =>
    req<boolean[]>(
      `/me/library/contains?${new URLSearchParams({ uris: uris.join(",") }).toString()}`,
    ),
  save: (uris: string[]) =>
    req<void>(
      `/me/library?${new URLSearchParams({ uris: uris.join(",") }).toString()}`,
      { method: "PUT" },
    ),
  unsave: (uris: string[]) =>
    req<void>(
      `/me/library?${new URLSearchParams({ uris: uris.join(",") }).toString()}`,
      { method: "DELETE" },
    ),
  createPlaylist: (name: string) =>
    req<SpPlaylist>("/me/playlists", {
      method: "POST",
      body: JSON.stringify({ name, public: false }),
    }),
  addToPlaylist: (id: string, uris: string[]) =>
    req<{ snapshot_id: string }>(`/playlists/${id}/items`, {
      method: "POST",
      body: JSON.stringify({ uris }),
    }),
  removeFromPlaylist: (id: string, uris: string[]) =>
    req<{ snapshot_id: string }>(`/playlists/${id}/items`, {
      method: "DELETE",
      body: JSON.stringify({ items: uris.map((uri) => ({ uri })) }),
    }),
  reorderPlaylist: (id: string, from: number, to: number) =>
    req<{ snapshot_id: string }>(`/playlists/${id}/items`, {
      method: "PUT",
      body: JSON.stringify({
        range_start: from,
        insert_before: to > from ? to + 1 : to,
      }),
    }),
  play: (deviceId: string, uris: string[], positionMs = 0) =>
    req<void>(`/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
      method: "PUT",
      body: JSON.stringify({ uris, position_ms: Math.round(positionMs) }),
    }),
};

export const spotifyLink = (
  kind: "album" | "artist" | "playlist" | "track",
  id: string,
) => `https://open.spotify.com/${kind}/${rawId(id)}`;
