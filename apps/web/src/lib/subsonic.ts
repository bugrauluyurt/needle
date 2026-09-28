import type {
  Album,
  AlbumWithSongs,
  ArtistInfo,
  ArtistWithAlbums,
  Artist,
  Genre,
  InternetRadioStation,
  Playlist,
  PlaylistWithSongs,
  PlayQueue,
  ScanStatus,
  Song,
  StructuredLyrics,
  SubsonicEnvelope,
} from "@needle/shared";
import { md5 } from "./md5.ts";
import { sizedCover } from "./spotify.ts";
import type { Credentials } from "../state/session.ts";
import { credentials, useSession } from "../state/session.ts";

export const API_VERSION = "1.16.1";

export class SubsonicError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

type Param = string | number | boolean | undefined | null | (string | number)[];
type Params = Record<string, Param>;

const clientName = () => `Needle ${useSession.getState().deviceName}`;

export function makeCredentials(user: string, password: string): Credentials {
  const salt = crypto.getRandomValues(new Uint32Array(3)).reduce((s, n) => s + n.toString(36), "");
  return { user, salt, token: md5(password + salt) };
}

function query(params: Params, creds: Credentials | null = credentials(), json = true): URLSearchParams {
  const q = new URLSearchParams({ v: API_VERSION, c: clientName() });
  if (json) q.set("f", "json");
  if (creds) {
    q.set("u", creds.user);
    q.set("t", creds.token);
    q.set("s", creds.salt);
  }
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    for (const item of Array.isArray(v) ? v : [v]) q.append(k, String(item));
  }
  return q;
}

export function subsonicUrl(method: string, params: Params = {}): string {
  return `/rest/${method}.view?${query(params, credentials(), false).toString()}`;
}

export function coverUrl(id: string | undefined, size = 300, version?: string): string | null {
  if (!id) return null;
  if (id.startsWith("https://")) return sizedCover(id, size);
  const c = credentials();
  if (!c) return null;
  return `/rest/getCoverArt.view?${new URLSearchParams({ id, size: String(size), u: c.user, t: c.token, s: c.salt, v: API_VERSION, c: "Needle", ...(version ? { changed: version } : {}) }).toString()}`;
}

export async function call<T>(method: string, params: Params = {}, creds?: Credentials, signal?: AbortSignal): Promise<T> {
  const body = query(params, creds ?? credentials());
  const res = await fetch(`/rest/${method}.view`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    signal: signal ?? null,
  });
  if (!res.ok) throw new SubsonicError(res.status, `Navidrome answered ${res.status}`);
  const json = (await res.json()) as SubsonicEnvelope<T>;
  const r = json["subsonic-response"];
  if (r.status !== "ok") {
    const err = new SubsonicError(r.error?.code ?? 0, r.error?.message ?? "Navidrome request failed");
    if (!creds && (err.code === 40 || err.code === 41 || err.code === 44)) useSession.getState().signOut();
    throw err;
  }
  return r;
}

export type AlbumListType = "newest" | "recent" | "frequent" | "random" | "starred" | "alphabeticalByName" | "alphabeticalByArtist" | "highest" | "byYear" | "byGenre";

export const sub = {
  ping: (creds?: Credentials) => call<{ serverVersion?: string }>("ping", {}, creds),
  user: (username: string) => call<{ user: { username: string; adminRole?: boolean } }>("getUser", { username }).then((r) => r.user),

  albumList: (type: AlbumListType, opts: { size?: number; offset?: number; genre?: string; fromYear?: number; toYear?: number } = {}) =>
    call<{ albumList2: { album?: Album[] } }>("getAlbumList2", { type, size: opts.size ?? 20, offset: opts.offset ?? 0, genre: opts.genre, fromYear: opts.fromYear, toYear: opts.toYear })
      .then((r) => r.albumList2.album ?? []),
  album: (id: string) => call<{ album: AlbumWithSongs }>("getAlbum", { id }).then((r) => r.album),
  artists: () => call<{ artists: { index?: { artist?: Artist[] }[] } }>("getArtists").then((r) => (r.artists.index ?? []).flatMap((i) => i.artist ?? [])),
  artist: (id: string) => call<{ artist: ArtistWithAlbums }>("getArtist", { id }).then((r) => r.artist),
  artistInfo: (id: string, count = 12, includeNotPresent = false) =>
    call<{ artistInfo2: ArtistInfo }>("getArtistInfo2", { id, count, includeNotPresent }).then((r) => r.artistInfo2),
  topSongs: (artist: string, count = 10) => call<{ topSongs: { song?: Song[] } }>("getTopSongs", { artist, count }).then((r) => r.topSongs.song ?? []),
  similarSongs: (id: string, count = 50) => call<{ similarSongs2: { song?: Song[] } }>("getSimilarSongs2", { id, count }).then((r) => r.similarSongs2.song ?? []),
  song: (id: string) => call<{ song: Song }>("getSong", { id }).then((r) => r.song),
  randomSongs: (size = 50, genre?: string) => call<{ randomSongs: { song?: Song[] } }>("getRandomSongs", { size, genre }).then((r) => r.randomSongs.song ?? []),
  songsByGenre: (genre: string, count = 100, offset = 0) =>
    call<{ songsByGenre: { song?: Song[] } }>("getSongsByGenre", { genre, count, offset }).then((r) => r.songsByGenre.song ?? []),
  genres: () => call<{ genres: { genre?: Genre[] } }>("getGenres").then((r) => r.genres.genre ?? []),

  playlists: () => call<{ playlists: { playlist?: Playlist[] } }>("getPlaylists").then((r) => r.playlists.playlist ?? []),
  playlist: (id: string) => call<{ playlist: PlaylistWithSongs }>("getPlaylist", { id }).then((r) => r.playlist),
  createPlaylist: (name: string, songId: string[] = []) => call<{ playlist: PlaylistWithSongs }>("createPlaylist", { name, songId }).then((r) => r.playlist),
  replacePlaylistSongs: (playlistId: string, songId: string[]) => call<{ playlist: PlaylistWithSongs }>("createPlaylist", { playlistId, songId }),
  updatePlaylist: (playlistId: string, changes: { name?: string; comment?: string; public?: boolean; add?: string[]; removeIndex?: number[] }) =>
    call("updatePlaylist", {
      playlistId, name: changes.name, comment: changes.comment, public: changes.public, songIdToAdd: changes.add, songIndexToRemove: changes.removeIndex,
    }),
  deletePlaylist: (id: string) => call("deletePlaylist", { id }),

  starred: () => call<{ starred2: { song?: Song[]; album?: Album[]; artist?: Artist[] } }>("getStarred2").then((r) => r.starred2),
  star: (ids: { id?: string[]; albumId?: string[]; artistId?: string[] }) => call("star", ids),
  unstar: (ids: { id?: string[]; albumId?: string[]; artistId?: string[] }) => call("unstar", ids),

  scrobble: (id: string, submission: boolean, time?: number) => call("scrobble", { id, submission, time }),
  playQueue: () => call<{ playQueue?: PlayQueue }>("getPlayQueue").then((r) => r.playQueue ?? null),
  savePlayQueue: (ids: string[], current?: string, position?: number) => call("savePlayQueue", { id: ids, current, position }),

  lyrics: (id: string) => call<{ lyricsList: { structuredLyrics?: StructuredLyrics[] } }>("getLyricsBySongId", { id }).then((r) => r.lyricsList.structuredLyrics ?? []),

  radios: () => call<{ internetRadioStations: { internetRadioStation?: InternetRadioStation[] } }>("getInternetRadioStations")
    .then((r) => r.internetRadioStations.internetRadioStation ?? []),
  addRadio: (name: string, streamUrl: string, homepageUrl?: string) => call("createInternetRadioStation", { name, streamUrl, homepageUrl }),
  deleteRadio: (id: string) => call("deleteInternetRadioStation", { id }),
  updateRadio: (id: string, name: string, streamUrl: string, homepageUrl?: string) => call("updateInternetRadioStation", { id, name, streamUrl, homepageUrl }),

  startScan: () => call<{ scanStatus: ScanStatus }>("startScan").then((r) => r.scanStatus),
  scanStatus: () => call<{ scanStatus: ScanStatus }>("getScanStatus").then((r) => r.scanStatus),
};
