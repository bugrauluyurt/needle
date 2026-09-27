import { keepPreviousData, queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import type { Album, Artist, Period, PlaylistWithSongs, Song } from "@needle/shared";
import { api } from "../lib/api.ts";
import type { AlbumListType } from "../lib/subsonic.ts";
import { sub } from "../lib/subsonic.ts";
import { isSpotify } from "../lib/spotify.ts";
import { useSession } from "../state/session.ts";
import { toast } from "../state/ui.ts";
import { keys } from "./keys.ts";

const HOUR = 3_600_000;

export const useAlbum = (id: string | undefined) =>
  useQuery({ queryKey: keys.album(id ?? ""), queryFn: () => sub.album(id ?? ""), enabled: Boolean(id) });

type ListOpts = { genre?: string; fromYear?: number; toYear?: number };

export const albumListOptions = (type: AlbumListType, size = 20, opts: ListOpts = {}) =>
  queryOptions({
    queryKey: keys.albumList(type, size, JSON.stringify(opts)),
    queryFn: () => sub.albumList(type, { size, ...opts }),
    staleTime: type === "random" ? Infinity : 60_000,
  });

export const useAlbumList = (type: AlbumListType, size = 20, opts: ListOpts = {}) => useQuery(albumListOptions(type, size, opts));

export const tileCoversOptions = (to: string, type: AlbumListType, opts: ListOpts = {}) =>
  queryOptions({ queryKey: ["tileCovers", to], queryFn: () => sub.albumList(type, { size: 3, ...opts }), staleTime: HOUR });

const mixesOptions = queryOptions({ queryKey: keys.mixes, queryFn: api.mixes, staleTime: HOUR });
const genresOptions = queryOptions({ queryKey: keys.genres, queryFn: sub.genres, staleTime: HOUR });

export function prefetchStart(qc: QueryClient) {
  for (const o of [albumListOptions("recent", 12), albumListOptions("newest", 12)]) void qc.prefetchQuery(o);
  void qc.prefetchQuery(mixesOptions);
  void qc.prefetchQuery(genresOptions);
}

export const useArtist = (id: string | undefined) =>
  useQuery({ queryKey: keys.artist(id ?? ""), queryFn: () => sub.artist(id ?? ""), enabled: Boolean(id) });

export const useArtists = () => useQuery({ queryKey: keys.artists, queryFn: sub.artists, staleTime: HOUR });

export function useArtistCover(id: string | undefined): string | undefined {
  const { data } = useArtists();
  return id ? data?.find((a) => a.id === id)?.coverArt : undefined;
}

const navidromeId = (id: string | undefined) => Boolean(id) && !isSpotify(id ?? "");

export const useArtistInfo = (id: string | undefined) =>
  useQuery({ queryKey: keys.artistInfo(id ?? ""), queryFn: () => sub.artistInfo(id ?? "", 12, true), enabled: navidromeId(id), staleTime: HOUR });

export const useTopSongs = (name: string | undefined) =>
  useQuery({ queryKey: keys.topSongs(name ?? ""), queryFn: () => sub.topSongs(name ?? "", 10), enabled: Boolean(name), staleTime: HOUR });

export const usePlaylists = () => useQuery({ queryKey: keys.playlists, queryFn: sub.playlists });

export const usePlaylist = (id: string | undefined) =>
  useQuery({ queryKey: keys.playlist(id ?? ""), queryFn: () => sub.playlist(id ?? ""), enabled: Boolean(id) });

export const useStarred = () => useQuery({ queryKey: keys.starred, queryFn: sub.starred, staleTime: 60_000 });

export const useGenres = () => useQuery(genresOptions);

export const useGenreSongs = (genre: string | undefined) =>
  useQuery({ queryKey: keys.genreSongs(genre ?? ""), queryFn: () => sub.songsByGenre(genre ?? "", 500), enabled: Boolean(genre) });

export const useSearch = (q: string) =>
  useQuery({
    queryKey: keys.search(q),
    queryFn: ({ signal }) => api.search(q, signal),
    enabled: q.trim().length > 0,
    placeholderData: keepPreviousData,
  });

export const useMixes = () => useQuery(mixesOptions);

export const useStats = (period: Period) => useQuery({ queryKey: keys.stats(period), queryFn: () => api.stats(period), placeholderData: keepPreviousData });

export const useLyrics = (id: string | undefined) =>
  useQuery({ queryKey: keys.lyrics(id ?? ""), queryFn: () => sub.lyrics(id ?? ""), enabled: navidromeId(id), staleTime: Infinity });

export const useRadios = () => useQuery({ queryKey: keys.radios, queryFn: sub.radios });

export const useCapabilities = () => useQuery({ queryKey: keys.capabilities, queryFn: api.capabilities, staleTime: 5 * 60_000 });

export const useIsAdmin = () => {
  const user = useSession((s) => s.credentials?.user ?? "");
  return useQuery({ queryKey: keys.user(user), queryFn: () => sub.user(user), enabled: Boolean(user), staleTime: HOUR }).data?.adminRole ?? false;
};

export const useLidarrSearch = (q: string, enabled: boolean) =>
  useQuery({
    queryKey: keys.lidarrSearch(q),
    queryFn: () => api.lidarrSearch(q),
    enabled: enabled && q.trim().length >= 2,
    staleTime: 30_000,
    refetchInterval: (query) => (query.state.data?.some((a) => a.state === "searching" || a.state === "downloading" || a.state === "importing") ? 5_000 : false),
  });

export const useLidarrArtists = (names: string[], enabled: boolean) =>
  useQuery({
    queryKey: keys.lidarrArtists(names.join("|")),
    queryFn: () => api.lidarrArtists(names),
    enabled: enabled && names.length > 0,
    staleTime: HOUR,
  });

export const useSimilarSongs = (id: string | undefined) =>
  useQuery({ queryKey: keys.similar(id ?? ""), queryFn: () => sub.similarSongs(id ?? "", 20), enabled: Boolean(id), staleTime: HOUR });

type StarKind = "song" | "album" | "artist";
type Starred = { song?: Song[]; album?: Album[]; artist?: Artist[] };

export function useStarredIds() {
  const { data } = useStarred();
  return {
    songs: new Set(data?.song?.map((s) => s.id)),
    albums: new Set(data?.album?.map((a) => a.id)),
    artists: new Set(data?.artist?.map((a) => a.id)),
  };
}

export function useToggleStar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ kind, item, on }: { kind: StarKind; item: Song | Album | Artist; on: boolean }) => {
      const ids = kind === "song" ? { id: [item.id] } : kind === "album" ? { albumId: [item.id] } : { artistId: [item.id] };
      await (on ? sub.star(ids) : sub.unstar(ids));
    },
    onMutate: async ({ kind, item, on }) => {
      await qc.cancelQueries({ queryKey: keys.starred });
      const prev = qc.getQueryData<Starred>(keys.starred);
      const field = kind === "song" ? "song" : kind === "album" ? "album" : "artist";
      const list = (prev?.[field] ?? []) as (Song | Album | Artist)[];
      const stamped = { ...item, starred: new Date().toISOString() };
      qc.setQueryData<Starred>(keys.starred, { ...prev, [field]: on ? [stamped, ...list.filter((x) => x.id !== item.id)] : list.filter((x) => x.id !== item.id) });
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(keys.starred, ctx.prev);
      toast("Couldn't update your likes. Check the connection and try again.");
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.starred }),
  });
}

export function useCreatePlaylist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, songIds }: { name: string; songIds?: string[] }) => sub.createPlaylist(name, songIds),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.playlists }),
  });
}

export function useAddToPlaylist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ playlistId, songIds }: { playlistId: string; songIds: string[] }) => sub.updatePlaylist(playlistId, { add: songIds }),
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: keys.playlist(v.playlistId) });
      void qc.invalidateQueries({ queryKey: keys.playlists });
    },
  });
}

export function useUpdatePlaylist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...changes }: { id: string; name?: string; comment?: string; public?: boolean; removeIndex?: number[] }) => sub.updatePlaylist(id, changes),
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: keys.playlist(v.id) });
      void qc.invalidateQueries({ queryKey: keys.playlists });
    },
  });
}

export function useReorderPlaylist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, songIds }: { id: string; songIds: string[] }) => sub.replacePlaylistSongs(id, songIds),
    onMutate: ({ id, songIds }) => {
      const prev = qc.getQueryData<PlaylistWithSongs>(keys.playlist(id));
      if (prev?.entry) {
        const byId = new Map(prev.entry.map((s) => [s.id, s]));
        qc.setQueryData<PlaylistWithSongs>(keys.playlist(id), { ...prev, entry: songIds.map((sid) => byId.get(sid)).filter((s): s is Song => Boolean(s)) });
      }
      return { prev };
    },
    onError: (_e, v, ctx) => {
      if (ctx?.prev) qc.setQueryData(keys.playlist(v.id), ctx.prev);
      toast("Couldn't save the new order.");
    },
    onSettled: (_d, _e, v) => void qc.invalidateQueries({ queryKey: keys.playlist(v.id) }),
  });
}

export function useDeletePlaylist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => sub.deletePlaylist(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.playlists }),
  });
}
