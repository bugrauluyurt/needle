import { useNavigate } from "react-router";
import { HOUR_MS, MINUTE_MS, musicSource } from "@needle/shared";
import { keepPreviousData, queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Query, QueryClient } from "@tanstack/react-query";
import type { Album, Artist, Period, PlaylistWithSongs, RequestItem, Song, SongCandidate } from "@needle/shared";
import { api } from "../lib/api.ts";
import type { AlbumListType } from "../lib/subsonic.ts";
import { sub } from "../lib/subsonic.ts";
import { useSession } from "../state/session.ts";
import { toast } from "../state/ui.ts";
import { keys } from "./keys.ts";
import { queryClient } from "./client.ts";

export const useAlbum = (id: string | undefined) =>
  useQuery({ queryKey: keys.album(id ?? ""), queryFn: () => sub.album(id ?? ""), enabled: navidromeId(id) });

type ListOpts = { genre?: string; fromYear?: number; toYear?: number };

export const albumListOptions = (type: AlbumListType, size = 20, opts: ListOpts = {}) =>
  queryOptions({
    queryKey: keys.albumList(type, size, JSON.stringify(opts)),
    queryFn: () => sub.albumList(type, { size, ...opts }),
    staleTime: type === "random" ? Infinity : 60_000,
  });

export const useAlbumList = (type: AlbumListType, size = 20, opts: ListOpts = {}) =>
  useQuery(albumListOptions(type, size, opts));

const browseOptions = queryOptions({ queryKey: keys.browse, queryFn: api.browse, staleTime: HOUR_MS });

export const useBrowse = () => useQuery(browseOptions);

export const useStorageEstimate = () =>
  useQuery({
    queryKey: keys.storage,
    queryFn: async () => (await navigator.storage?.estimate?.()) ?? null,
    staleTime: 60_000,
  });

export const useMe = () => useQuery({ queryKey: keys.me, queryFn: api.me, staleTime: HOUR_MS });

const ACTIVE = new Set(["searching", "downloading", "importing", "moving"]);
const REQUEST_POLL_MS = 4_000;
const WAITING_POLL_MS = 60_000;

const LIBRARY_KEYS = [
  keys.allAlbums,
  keys.artists,
  keys.librarySongs,
  ["albumList"],
  keys.browse,
  ["search"],
  ["songCandidates"],
  ["lidarrSearch"],
  keys.genres,
];
let arrived: Set<number> | null = null;

queryClient.getQueryCache().subscribe((e) => {
  if (e.type !== "updated") return;
  const query = e.query as Query<RequestItem[]>;
  if (query.queryKey[0] !== keys.requests[0]) return;
  const done = new Set(query.state.data?.filter((r) => r.state === "available").map((r) => r.id));
  const fresh = arrived !== null && [...done].some((id) => !arrived?.has(id));
  arrived = done;
  if (fresh) for (const queryKey of LIBRARY_KEYS) void queryClient.invalidateQueries({ queryKey });
});

export const useEveryonesRequests = (enabled: boolean) =>
  useQuery({
    queryKey: keys.everyonesRequests,
    queryFn: api.everyonesRequests,
    enabled,
    refetchInterval: enabled ? WAITING_POLL_MS : false,
  });

export const usePeople = (enabled: boolean) => useQuery({ queryKey: keys.people, queryFn: api.people, enabled });

const pollFor = (states: string[]) =>
  states.some((s) => ACTIVE.has(s)) ? REQUEST_POLL_MS : states.includes("wanted") ? WAITING_POLL_MS : false;

export const useRequests = () =>
  useQuery({
    queryKey: keys.requests,
    queryFn: api.requests,
    refetchInterval: (q) => pollFor(q.state.data?.map((r) => r.state) ?? []),
  });

const DOWNLOADS_IDLE_POLL_MS = 30_000;

export const useLidarrDownloads = (enabled: boolean) =>
  useQuery({
    queryKey: keys.downloads,
    queryFn: api.lidarrDownloads,
    enabled,
    refetchInterval: (q) => (q.state.data?.length ? REQUEST_POLL_MS : DOWNLOADS_IDLE_POLL_MS),
  });

export const useSongCandidates = (q: string, enabled: boolean) =>
  useQuery({
    queryKey: keys.songCandidates(q),
    queryFn: () => api.songSearch(q),
    enabled: enabled && q.trim().length > 1,
    staleTime: HOUR_MS,
  });

export function useGetSong() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return (song: SongCandidate) =>
    api.getSong(song).then(
      async () => {
        await Promise.all([
          qc.refetchQueries({ queryKey: keys.requests }),
          qc.invalidateQueries({ queryKey: keys.discoveryAll }),
        ]);
        toast(`Looking for “${song.title}” on Soulseek`, { label: "Requests", run: () => void navigate("/requests") });
      },
      (e: unknown) => toast(e instanceof Error ? e.message : "Couldn’t start the download"),
    );
}

const mixesOptions = queryOptions({ queryKey: keys.mixes, queryFn: api.mixes, staleTime: HOUR_MS });
const genresOptions = queryOptions({ queryKey: keys.genres, queryFn: sub.genres, staleTime: HOUR_MS });

export function prefetchStart(qc: QueryClient) {
  for (const o of [albumListOptions("recent", 12), albumListOptions("newest", 12)]) void qc.prefetchQuery(o);
  void qc.prefetchQuery(mixesOptions);
  void qc.prefetchQuery(browseOptions);
}

export const useArtist = (id: string | undefined) =>
  useQuery({ queryKey: keys.artist(id ?? ""), queryFn: () => sub.artist(id ?? ""), enabled: navidromeId(id) });

export const useLibrarySongs = (enabled: boolean) =>
  useQuery({ queryKey: keys.librarySongs, queryFn: api.librarySongs, enabled, staleTime: 60_000 });

export const useArtists = () => useQuery({ queryKey: keys.artists, queryFn: sub.artists, staleTime: 60_000 });

const ALBUM_PAGE = 500;

async function allAlbums(): Promise<Album[]> {
  const out: Album[] = [];
  for (let offset = 0; ; offset += ALBUM_PAGE) {
    const page = await sub.albumList("newest", { size: ALBUM_PAGE, offset });
    out.push(...page);
    if (page.length < ALBUM_PAGE) return out;
  }
}

export const useAllAlbums = () => useQuery({ queryKey: keys.allAlbums, queryFn: allAlbums, staleTime: 60_000 });

export function useArtistCover(id: string | undefined): string | undefined {
  const { data } = useArtists();
  return id ? data?.find((a) => a.id === id)?.coverArt : undefined;
}

const navidromeId = (id: string | undefined) => Boolean(id) && musicSource(id) === "library";

export const useArtistInfo = (id: string | undefined) =>
  useQuery({
    queryKey: keys.artistInfo(id ?? ""),
    queryFn: () => sub.artistInfo(id ?? "", 12, true),
    enabled: navidromeId(id),
    staleTime: HOUR_MS,
  });

export const useTopSongs = (name: string | undefined) =>
  useQuery({
    queryKey: keys.topSongs(name ?? ""),
    queryFn: () => sub.topSongs(name ?? "", 10),
    enabled: Boolean(name),
    staleTime: HOUR_MS,
  });

export const usePlaylists = () => useQuery({ queryKey: keys.playlists, queryFn: sub.playlists });

export const usePlaylist = (id: string | undefined) =>
  useQuery({ queryKey: keys.playlist(id ?? ""), queryFn: () => sub.playlist(id ?? ""), enabled: navidromeId(id) });

export const useStarred = () => useQuery({ queryKey: keys.starred, queryFn: sub.starred, staleTime: 60_000 });

export const useGenres = () => useQuery(genresOptions);

export const useGenreSongs = (genre: string | undefined) =>
  useQuery({
    queryKey: keys.genreSongs(genre ?? ""),
    queryFn: () => sub.songsByGenre(genre ?? "", 500),
    enabled: Boolean(genre),
  });

const SEARCH_FRESH_MS = 5_000;

export const useSearch = (q: string) =>
  useQuery({
    queryKey: keys.search(q),
    queryFn: ({ signal }) => api.search(q, signal),
    enabled: q.trim().length > 0,
    staleTime: SEARCH_FRESH_MS,
    placeholderData: keepPreviousData,
  });

export const useMixes = () => useQuery(mixesOptions);

export const useDiscoveries = () => {
  const connected = Boolean(useCapabilities().data?.listenbrainzUser);
  return useQuery({ queryKey: keys.discoveries, queryFn: api.discoveries, enabled: connected, staleTime: HOUR_MS });
};

export const discoveryOptions = (id: string) =>
  queryOptions({ queryKey: keys.discovery(id), queryFn: () => api.discovery(id), staleTime: 60_000 });

export const useDiscovery = (id: string) =>
  useQuery({
    ...discoveryOptions(id),
    refetchInterval: (q) => pollFor(q.state.data?.tracks.flatMap((t) => (t.request ? [t.request.state] : [])) ?? []),
  });

export const useStats = (period: Period) =>
  useQuery({ queryKey: keys.stats(period), queryFn: () => api.stats(period), placeholderData: keepPreviousData });

export const useLyrics = (id: string | undefined) =>
  useQuery({
    queryKey: keys.lyrics(id ?? ""),
    queryFn: () => sub.lyrics(id ?? ""),
    enabled: navidromeId(id),
    staleTime: Infinity,
  });

export const useRadios = () => useQuery({ queryKey: keys.radios, queryFn: sub.radios });

export const useCapabilities = () =>
  useQuery({ queryKey: keys.capabilities, queryFn: api.capabilities, staleTime: 5 * 60_000 });

export const useCanRequest = () => {
  const caps = useCapabilities().data;
  return caps ? caps.lidarr || caps.songs : false;
};

export const useIsAdmin = () => {
  const user = useSession((s) => s.credentials?.user ?? "");
  return (
    useQuery({ queryKey: keys.user(user), queryFn: () => sub.user(user), enabled: Boolean(user), staleTime: HOUR_MS })
      .data?.adminRole ?? false
  );
};

export const useLidarrSearch = (q: string, enabled: boolean) =>
  useQuery({
    queryKey: keys.lidarrSearch(q),
    queryFn: () => api.lidarrSearch(q),
    enabled: enabled && q.trim().length >= 2,
    staleTime: 5 * MINUTE_MS,
  });

export const useLidarrArtists = (names: string[], enabled: boolean) =>
  useQuery({
    queryKey: keys.lidarrArtists(names.join("|")),
    queryFn: () => api.lidarrArtists(names),
    enabled: enabled && names.length > 0,
    staleTime: HOUR_MS,
  });

export const useSimilarSongs = (id: string | undefined) =>
  useQuery({
    queryKey: keys.similar(id ?? ""),
    queryFn: () => sub.similarSongs(id ?? "", 20),
    enabled: navidromeId(id),
    staleTime: HOUR_MS,
  });

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
      if (!navidromeId(item.id)) throw new Error("Only items in your library can be starred in Navidrome");

      const ids =
        kind === "song" ? { id: [item.id] } : kind === "album" ? { albumId: [item.id] } : { artistId: [item.id] };
      await (on ? sub.star(ids) : sub.unstar(ids));
    },
    onMutate: async ({ kind, item, on }) => {
      await qc.cancelQueries({ queryKey: keys.starred });
      const prev = qc.getQueryData<Starred>(keys.starred);
      const field = kind === "song" ? "song" : kind === "album" ? "album" : "artist";
      const list = (prev?.[field] ?? []) as (Song | Album | Artist)[];
      const stamped = { ...item, starred: new Date().toISOString() };
      qc.setQueryData<Starred>(keys.starred, {
        ...prev,
        [field]: on ? [stamped, ...list.filter((x) => x.id !== item.id)] : list.filter((x) => x.id !== item.id),
      });
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
    mutationFn: ({ name, songIds }: { name: string; songIds?: string[] }) => {
      if (songIds?.some((songId) => !navidromeId(songId)))
        throw new Error("Only songs in your library can be added to Navidrome playlists");

      return sub.createPlaylist(name, songIds);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.playlists }),
  });
}

export function useAddToPlaylist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ playlistId, songIds }: { playlistId: string; songIds: string[] }) => {
      if (!navidromeId(playlistId) || songIds.some((songId) => !navidromeId(songId)))
        throw new Error("Only songs in your library can be added to Navidrome playlists");

      return sub.updatePlaylist(playlistId, { add: songIds });
    },
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: keys.playlist(v.playlistId) });
      void qc.invalidateQueries({ queryKey: keys.playlists });
    },
  });
}

export function useUpdatePlaylist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...changes
    }: {
      id: string;
      name?: string;
      comment?: string;
      public?: boolean;
      removeIndex?: number[];
    }) => sub.updatePlaylist(id, changes),
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
        qc.setQueryData<PlaylistWithSongs>(keys.playlist(id), {
          ...prev,
          entry: songIds.map((sid) => byId.get(sid)).filter((s): s is Song => Boolean(s)),
        });
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
