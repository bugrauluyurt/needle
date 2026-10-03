import { MINUTE_MS, youtubeMusicRawId } from "@needle/shared";
import type {
  ImportResult,
  Song,
  YouTubeMusicAccount,
  YouTubeMusicAlbum,
  YouTubeMusicAlbumDetail,
  YouTubeMusicArtist,
  YouTubeMusicArtistDetail,
  YouTubeMusicLogin,
  YouTubeMusicLoginStatus,
  YouTubeMusicLyrics,
  YouTubeMusicPage,
  YouTubeMusicPlaylist,
  YouTubeMusicPlaylistDetail,
  YouTubeMusicSearch,
  YouTubeMusicSearchKind,
} from "@needle/shared";
import { create } from "zustand";
import { ApiError, request } from "./api.ts";
import { queryClient } from "../queries/client.ts";
import { keys } from "../queries/keys.ts";

export const useYouTubeMusicStatus = create<{ blocked: boolean; until: number }>(() => ({ blocked: false, until: 0 }));

let cooldownTimer: ReturnType<typeof setTimeout> | undefined;

export function clearYouTubeMusicStatus() {
  clearTimeout(cooldownTimer);

  useYouTubeMusicStatus.setState({ blocked: false, until: 0 });
}

async function metadata<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (useYouTubeMusicStatus.getState().blocked) throw new ApiError(429, "YouTube Music requests are paused");

  try {
    return await request<T>(`/youtube-music${path}`, init);
  } catch (requestError) {
    if (requestError instanceof ApiError && [401, 403, 409].includes(requestError.status))
      void queryClient.invalidateQueries({ queryKey: keys.capabilities });

    if (requestError instanceof ApiError && requestError.status === 429) {
      const until = Date.now() + 15 * MINUTE_MS;

      clearTimeout(cooldownTimer);

      useYouTubeMusicStatus.setState({ blocked: true, until });

      cooldownTimer = setTimeout(clearYouTubeMusicStatus, until - Date.now());
      cooldownTimer.unref?.();
    }

    throw requestError;
  }
}

const resourceId = (id: string) => encodeURIComponent(youtubeMusicRawId(id));
const put = (path: string, on: boolean) => metadata<void>(path, { method: "PUT", body: JSON.stringify({ on }) });
const libraryPage = <T>(kind: string, limit = 100) => metadata<YouTubeMusicPage<T>>(`/${kind}?limit=${limit}`);

export const ytm = {
  startLogin: () => request<YouTubeMusicLogin>("/youtube-music/login", { method: "POST" }),
  pollLogin: () => request<YouTubeMusicLoginStatus>("/youtube-music/login"),
  cancelLogin: () => request<void>("/youtube-music/login", { method: "DELETE" }),
  enabled: (on: boolean) => request<void>("/youtube-music/enabled", { method: "PUT", body: JSON.stringify({ on }) }),
  disconnect: () => request<void>("/youtube-music", { method: "DELETE" }),
  account: () => metadata<YouTubeMusicAccount>("/account"),
  liked: (limit = 100) => libraryPage<Song>("liked", limit),
  albums: (limit = 100) => libraryPage<YouTubeMusicAlbum>("albums", limit),
  artists: (limit = 100) => libraryPage<YouTubeMusicArtist>("artists", limit),
  playlists: (limit = 100) => libraryPage<YouTubeMusicPlaylist>("playlists", limit),
  search: (query: string, options: { kind?: YouTubeMusicSearchKind; limit?: number; signal?: AbortSignal } = {}) => {
    const searchParams = new URLSearchParams({
      q: query,
      ...(options.kind ? { kind: options.kind } : {}),
      limit: String(options.limit ?? 20),
    });

    return metadata<YouTubeMusicSearch>(`/search?${searchParams}`, options.signal ? { signal: options.signal } : {});
  },
  album: (id: string) => metadata<YouTubeMusicAlbumDetail>(`/albums/${resourceId(id)}`),
  artist: (id: string) => metadata<YouTubeMusicArtistDetail>(`/artists/${resourceId(id)}`),
  artistSongs: (id: string, limit: number) =>
    metadata<YouTubeMusicPage<Song>>(`/artists/${resourceId(id)}/songs?limit=${limit}`),
  artistReleases: (id: string, kind: "albums" | "singles", limit: number) =>
    metadata<YouTubeMusicPage<YouTubeMusicAlbum>>(`/artists/${resourceId(id)}/releases?kind=${kind}&limit=${limit}`),
  playlist: (id: string, limit = 100) =>
    metadata<YouTubeMusicPlaylistDetail>(`/playlists/${resourceId(id)}?limit=${limit}`),
  lyrics: (id: string) => metadata<YouTubeMusicLyrics>(`/songs/${resourceId(id)}/lyrics`),
  radio: (id: string) => metadata<Song[]>(`/songs/${resourceId(id)}/radio`),
  like: (id: string, on: boolean) => put(`/songs/${resourceId(id)}/like`, on),
  saveAlbum: (id: string, on: boolean) => put(`/albums/${resourceId(id)}/saved`, on),
  follow: (id: string, on: boolean) => put(`/artists/${resourceId(id)}/follow`, on),
  importPlaylist: (source: string) =>
    metadata<ImportResult>("/import", {
      method: "POST",
      body: JSON.stringify({ source: source === "liked" ? source : youtubeMusicRawId(source) }),
    }),
};
