import { useNavigate } from "react-router";
import { HOUR_MS, MINUTE_MS, musicSource } from "@needle/shared";
import { keepPreviousData, queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Query, QueryClient } from "@tanstack/react-query";
import type { Album, Artist, Period, PlaylistWithSongs, RequestItem, Song, SongCandidate } from "@needle/shared";
import { api } from "../lib/api.ts";
import type { AlbumListType } from "../lib/subsonic.ts";
import { sub } from "../lib/subsonic.ts";
import { toast } from "../state/ui.ts";
import { useSession } from "../state/session.ts";
import { getAccountGeneration } from "../state/accountLifecycle.ts";
import { keys } from "./keys.ts";
import { queryClient } from "./client.ts";
import { translate } from "../i18n/index.ts";

export const useStorageEstimate = () =>
  useQuery({
    queryKey: keys.storage,
    queryFn: async () => (await navigator.storage?.estimate?.()) ?? null,
    staleTime: 60_000,
  });

export const useMe = () => useQuery({ queryKey: keys.me, queryFn: api.me, staleTime: HOUR_MS });

export const usePeople = (enabled: boolean) => useQuery({ queryKey: keys.people, queryFn: api.people, enabled });

export const useCapabilities = () =>
  useQuery({
    queryKey: keys.capabilities,
    queryFn: api.capabilities,
    staleTime: 5 * 60_000,
  });

export function useCanRequest(): boolean {
  const capabilities = useCapabilities().data;

  return capabilities ? capabilities.lidarr || capabilities.songs : false;
}

export function useIsAdmin(): boolean {
  const user = useSession((sessionState) => sessionState.credentials?.user ?? "");

  return (
    useQuery({
      queryKey: keys.user(user),
      queryFn: () => sub.user(user),
      enabled: Boolean(user),
      staleTime: HOUR_MS,
    }).data?.adminRole ?? false
  );
}

export const useAlbum = (id: string | undefined) =>
  useQuery({
    queryKey: keys.album(id ?? ""),
    queryFn: () => sub.album(id ?? ""),
    enabled: navidromeId(id),
  });

type ListOpts = { genre?: string; fromYear?: number; toYear?: number };

export const albumListOptions = (type: AlbumListType, size = 20, opts: ListOpts = {}) =>
  queryOptions({
    queryKey: keys.albumList(type, size, JSON.stringify(opts)),
    queryFn: () => sub.albumList(type, { size, ...opts }),
    staleTime: type === "random" ? Infinity : 60_000,
  });

export const useAlbumList = (type: AlbumListType, size = 20, opts: ListOpts = {}) =>
  useQuery(albumListOptions(type, size, opts));

const browseOptions = queryOptions({
  queryKey: keys.browse,
  queryFn: api.browse,
  staleTime: HOUR_MS,
});

export const useBrowse = () => useQuery(browseOptions);

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
        toast(translate("query.lookingSoulseek", { title: song.title }), {
          label: translate("common.requests"),
          run: () => void navigate("/requests"),
        });
      },
      (e: unknown) => toast(e instanceof Error ? e.message : translate("query.downloadFailed")),
    );
}

const mixesOptions = queryOptions({
  queryKey: keys.mixes,
  queryFn: api.mixes,
  staleTime: HOUR_MS,
});
const genresOptions = queryOptions({
  queryKey: keys.genres,
  queryFn: sub.genres,
  staleTime: HOUR_MS,
});

export function prefetchStart(qc: QueryClient) {
  for (const o of [albumListOptions("recent", 12), albumListOptions("newest", 12)]) void qc.prefetchQuery(o);
  void qc.prefetchQuery(mixesOptions);
  void qc.prefetchQuery(browseOptions);
}

export const useArtist = (id: string | undefined) =>
  useQuery({
    queryKey: keys.artist(id ?? ""),
    queryFn: () => sub.artist(id ?? ""),
    enabled: navidromeId(id),
  });

export const useLibrarySongs = (enabled: boolean) =>
  useQuery({
    queryKey: keys.librarySongs,
    queryFn: api.librarySongs,
    enabled,
    staleTime: 60_000,
  });

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

const navidromeId = (id: string | undefined) => Boolean(id) && musicSource(id) === "library";

export const useArtistInfo = (id: string | undefined) =>
  useQuery({
    queryKey: keys.artistInfo(id ?? ""),
    queryFn: () => sub.artistInfo(id ?? "", 12, true),
    enabled: navidromeId(id),
    staleTime: HOUR_MS,
  });

export const usePlaylists = () => useQuery({ queryKey: keys.playlists, queryFn: sub.playlists });

export const usePlaylist = (id: string | undefined) =>
  useQuery({
    queryKey: keys.playlist(id ?? ""),
    queryFn: () => sub.playlist(id ?? ""),
    enabled: navidromeId(id),
  });

export const useStarred = () => useQuery({ queryKey: keys.starred, queryFn: sub.starred, staleTime: 60_000 });

export const useGenres = () => useQuery(genresOptions);

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
  return useQuery({
    queryKey: keys.discoveries,
    queryFn: api.discoveries,
    enabled: connected,
    staleTime: HOUR_MS,
  });
};

export const discoveryOptions = (id: string) =>
  queryOptions({
    queryKey: keys.discovery(id),
    queryFn: () => api.discovery(id),
    staleTime: 60_000,
  });

export const useDiscovery = (id: string) =>
  useQuery({
    ...discoveryOptions(id),
    refetchInterval: (q) => pollFor(q.state.data?.tracks.flatMap((t) => (t.request ? [t.request.state] : [])) ?? []),
  });

export const useStats = (period: Period) =>
  useQuery({
    queryKey: keys.stats(period),
    queryFn: () => api.stats(period),
    placeholderData: keepPreviousData,
  });

export const useLyrics = (id: string | undefined) =>
  useQuery({
    queryKey: keys.lyrics(id ?? ""),
    queryFn: () => sub.lyrics(id ?? ""),
    enabled: navidromeId(id),
    staleTime: Infinity,
  });

export const useRadios = () => useQuery({ queryKey: keys.radios, queryFn: sub.radios });

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
type AccountMutationContext = { accountUser: string; generation: number };
type StarMutationVariables = { kind: StarKind; item: Song | Album | Artist; on: boolean };
type CreatePlaylistVariables = { name: string; songIds?: string[] };
type AddToPlaylistVariables = { playlistId: string; songIds: string[] };
type UpdatePlaylistVariables = {
  id: string;
  name?: string;
  comment?: string;
  public?: boolean;
  removeIndex?: number[];
};
type ReorderPlaylistVariables = { id: string; songIds: string[] };
type DeletePlaylistVariables = { id: string };

function getAccountMutationContext(): AccountMutationContext {
  return {
    accountUser: useSession.getState().credentials?.user ?? "",
    generation: getAccountGeneration(),
  };
}

function accountMutationIsCurrent(accountContext: AccountMutationContext): boolean {
  return (
    accountContext.accountUser === (useSession.getState().credentials?.user ?? "") &&
    accountContext.generation === getAccountGeneration()
  );
}

async function accountMutationResult<Variables extends object, Result>(
  mutationContexts: WeakMap<Variables, AccountMutationContext>,
  variables: Variables,
  operation: () => Promise<Result>,
): Promise<Result> {
  const accountContext = mutationContexts.get(variables);

  if (!accountContext || !accountMutationIsCurrent(accountContext)) throw new Error("Account changed");

  const result = await operation();

  if (!accountMutationIsCurrent(accountContext)) throw new Error("Account changed");

  return result;
}

function accountMutationOptions<Variables extends object, Result>(
  operation: (variables: Variables) => Promise<Result>,
  onSuccess: (result: Result, variables: Variables) => void,
) {
  const mutationContexts = new WeakMap<Variables, AccountMutationContext>();

  return {
    mutationFn: (variables: Variables) =>
      accountMutationResult(mutationContexts, variables, () => operation(variables)),
    onMutate: (variables: Variables) => {
      const accountContext = getAccountMutationContext();

      mutationContexts.set(variables, accountContext);

      return accountContext;
    },
    onSuccess: (result: Result, variables: Variables, accountContext: AccountMutationContext) => {
      if (!accountMutationIsCurrent(accountContext)) return;

      onSuccess(result, variables);
    },
    onSettled: (_data: Result | undefined, _error: Error | null, variables: Variables) =>
      mutationContexts.delete(variables),
  };
}

export function useStarredIds() {
  const { data } = useStarred();
  return {
    songs: new Set(data?.song?.map((s) => s.id)),
    albums: new Set(data?.album?.map((a) => a.id)),
    artists: new Set(data?.artist?.map((a) => a.id)),
  };
}

export function useToggleStar() {
  const client = useQueryClient();
  const mutationContexts = new WeakMap<StarMutationVariables, AccountMutationContext>();

  return useMutation({
    mutationFn: async (variables: StarMutationVariables) => {
      const accountContext = mutationContexts.get(variables);

      if (!accountContext || !accountMutationIsCurrent(accountContext)) throw new Error("Account changed");

      const { kind, item, on: isStarred } = variables;

      if (!navidromeId(item.id)) throw new Error(translate("query.localStarOnly"));

      const starIds =
        kind === "song" ? { id: [item.id] } : kind === "album" ? { albumId: [item.id] } : { artistId: [item.id] };
      await (isStarred ? sub.star(starIds) : sub.unstar(starIds));
    },
    onMutate: async (variables) => {
      const accountContext = getAccountMutationContext();
      const { kind, item, on: isStarred } = variables;

      mutationContexts.set(variables, accountContext);

      await client.cancelQueries({ queryKey: keys.starred });

      if (!accountMutationIsCurrent(accountContext)) throw new Error("Account changed");

      const previousStarred = client.getQueryData<Starred>(keys.starred);
      const starredField = kind === "song" ? "song" : kind === "album" ? "album" : "artist";
      const starredItems = (previousStarred?.[starredField] ?? []) as (Song | Album | Artist)[];
      const starredItemWithTimestamp = { ...item, starred: new Date().toISOString() };

      client.setQueryData<Starred>(keys.starred, {
        ...previousStarred,
        [starredField]: isStarred
          ? [starredItemWithTimestamp, ...starredItems.filter((starredItem) => starredItem.id !== item.id)]
          : starredItems.filter((starredItem) => starredItem.id !== item.id),
      });

      return { previousStarred, ...accountContext };
    },
    onError: (_error, variables, context) => {
      if (!context || !accountMutationIsCurrent(context)) return;

      if (context.previousStarred) client.setQueryData(keys.starred, context.previousStarred);
      toast(translate("query.likesFailed"));

      mutationContexts.delete(variables);
    },
    onSettled: (_data, _error, variables, context) => {
      mutationContexts.delete(variables);

      if (!context || !accountMutationIsCurrent(context)) return;

      void client.invalidateQueries({ queryKey: keys.starred });
    },
  });
}

export function useCreatePlaylist() {
  const client = useQueryClient();

  return useMutation(
    accountMutationOptions(
      (variables: CreatePlaylistVariables) => {
        const { name, songIds } = variables;

        if (songIds?.some((songId) => !navidromeId(songId))) throw new Error(translate("query.localPlaylistOnly"));

        return sub.createPlaylist(name, songIds);
      },
      () => void client.invalidateQueries({ queryKey: keys.playlists }),
    ),
  );
}

export function useAddToPlaylist() {
  const client = useQueryClient();

  return useMutation(
    accountMutationOptions(
      (variables: AddToPlaylistVariables) => {
        const { playlistId, songIds } = variables;

        if (!navidromeId(playlistId) || songIds.some((songId) => !navidromeId(songId)))
          throw new Error(translate("query.localPlaylistOnly"));

        return sub.updatePlaylist(playlistId, { add: songIds });
      },
      (_data, variables) => {
        void client.invalidateQueries({ queryKey: keys.playlist(variables.playlistId) });
        void client.invalidateQueries({ queryKey: keys.playlists });
      },
    ),
  );
}

export function useUpdatePlaylist() {
  const client = useQueryClient();

  return useMutation(
    accountMutationOptions(
      (variables: UpdatePlaylistVariables) => {
        const { id, ...changes } = variables;

        return sub.updatePlaylist(id, changes);
      },
      (_data, variables) => {
        void client.invalidateQueries({ queryKey: keys.playlist(variables.id) });
        void client.invalidateQueries({ queryKey: keys.playlists });
      },
    ),
  );
}

export function useReorderPlaylist() {
  const client = useQueryClient();
  const mutationContexts = new WeakMap<ReorderPlaylistVariables, AccountMutationContext>();

  return useMutation({
    mutationFn: async (variables: ReorderPlaylistVariables) => {
      const accountContext = mutationContexts.get(variables);

      if (!accountContext || !accountMutationIsCurrent(accountContext)) throw new Error("Account changed");

      await sub.replacePlaylistSongs(variables.id, variables.songIds);
    },
    onMutate: (variables) => {
      const accountContext = getAccountMutationContext();
      const { id, songIds } = variables;

      mutationContexts.set(variables, accountContext);

      const previousPlaylist = client.getQueryData<PlaylistWithSongs>(keys.playlist(id));

      if (previousPlaylist?.entry) {
        const songsById = new Map(previousPlaylist.entry.map((song) => [song.id, song]));

        client.setQueryData<PlaylistWithSongs>(keys.playlist(id), {
          ...previousPlaylist,
          entry: songIds
            .map((songId) => songsById.get(songId))
            .filter((playlistSong): playlistSong is Song => Boolean(playlistSong)),
        });
      }

      return { previousPlaylist, ...accountContext };
    },
    onError: (_error, variables, context) => {
      if (!context || !accountMutationIsCurrent(context)) return;

      if (context.previousPlaylist) client.setQueryData(keys.playlist(variables.id), context.previousPlaylist);
      toast(translate("query.orderFailed"));
    },
    onSettled: (_data, _error, variables, context) => {
      mutationContexts.delete(variables);

      if (!context || !accountMutationIsCurrent(context)) return;

      void client.invalidateQueries({ queryKey: keys.playlist(variables.id) });
    },
  });
}

export function useDeletePlaylist() {
  const client = useQueryClient();

  return useMutation(
    accountMutationOptions(
      (variables: DeletePlaylistVariables) => sub.deletePlaylist(variables.id),
      () => void client.invalidateQueries({ queryKey: keys.playlists }),
    ),
  );
}
