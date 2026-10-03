import {
  keepPreviousData,
  queryOptions,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { Query } from "@tanstack/react-query";
import type { Song } from "@needle/shared";
import {
  albumSongs,
  image,
  isSpotify,
  nextSpotifySearchOffset,
  rawId,
  clearSpotifyClient,
  sp,
  SpotifyApiError,
  spotifySearchResults,
  uniqueSpotifyItems,
  useSpotifyStatus,
} from "../api/client.ts";
import type {
  SpAlbumRef,
  SpArtist,
  SpPage,
  SpPlaylist,
  SpotifySearchData,
  SpotifySearchKind,
  SpotifySearchType,
} from "../api/client.ts";
import { toast } from "../../../state/ui.ts";
import { queryClient } from "../../../queries/client.ts";
import { useArtists, useCapabilities } from "../../../queries/hooks.ts";
import { useSession } from "../../../state/session.ts";
import { fold, HOUR_MS, isYouTubeMusic } from "@needle/shared";
import { useYouTubeMusicArtistImage } from "../../youtube-music/hooks/useYouTubeMusic.ts";
import { translate } from "../../../i18n/index.ts";

const LIBRARY_STALE = 6 * HOUR_MS;
const CACHE_PREFIX = "needle.sp.";
const PERSISTED = new Set(["me", "playlists", "liked", "albums", "followed", "artistImage", "artistProfile"]);
const currentUser = () => useSession.getState().credentials?.user ?? "";
let cacheGeneration = 0;

type SpotifyCacheContext = { accountUser: string; generation: number };

function getSpotifyCacheContext(): SpotifyCacheContext {
  return { accountUser: currentUser(), generation: cacheGeneration };
}

function spotifyCacheContextIsCurrent(cacheContext: SpotifyCacheContext): boolean {
  return cacheContext.accountUser === currentUser() && cacheContext.generation === cacheGeneration;
}

export const spKeys = {
  get me() {
    return ["sp", "me", currentUser()] as const;
  },
  get playlists() {
    return ["sp", "playlists", currentUser()] as const;
  },
  playlist: (id: string) => ["sp", "playlist", id, currentUser()] as const,
  get liked() {
    return ["sp", "liked", currentUser()] as const;
  },
  get albums() {
    return ["sp", "albums", currentUser()] as const;
  },
  get followed() {
    return ["sp", "followed", currentUser()] as const;
  },
  artistImage: (name: string) => ["sp", "artistImage", name, currentUser()] as const,
  album: (id: string) => ["sp", "album", id, currentUser()] as const,
  artistProfile: (id: string) => ["sp", "artistProfile", id, currentUser()] as const,
  artist: (id: string) => ["sp", "artist", id, currentUser()] as const,
  artistAlbums: (id: string, category?: "album" | "single") =>
    ["sp", "artistAlbums", id, category ?? "all", currentUser()] as const,
  artistSongs: (id: string, artistName: string) => ["sp", "artistSongs", id, artistName, currentUser()] as const,
  search: (q: string) => ["sp", "search", q, currentUser()] as const,
  searchCategory: (q: string, category: SpotifySearchKind | undefined) =>
    ["sp", "search", q, category, currentUser()] as const,
};

queryClient.setQueryDefaults(["sp"], {
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  retry: false,
  staleTime: HOUR_MS,
});

const cacheKey = (queryKey: readonly unknown[]) =>
  `${CACHE_PREFIX}${useSession.getState().credentials?.user ?? ""}.${JSON.stringify(queryKey)}`;

queryClient.getQueryCache().subscribe((queryEvent) => {
  if (queryEvent.type !== "updated") return;

  const { queryKey, state } = queryEvent.query as Query;
  if (
    queryKey[0] !== "sp" ||
    !PERSISTED.has(String(queryKey[1])) ||
    state.status !== "success" ||
    !currentUser() ||
    queryKey.at(-1) !== currentUser()
  )
    return;

  try {
    localStorage.setItem(cacheKey(queryKey), JSON.stringify({ at: state.dataUpdatedAt, data: state.data }));
  } catch {
    return;
  }
});

export function clearSpotifyCache() {
  cacheGeneration += 1;

  clearSpotifyClient();
  queryClient.removeQueries({ queryKey: ["sp"] });

  try {
    for (const storageKey of Object.keys(localStorage)) {
      if (storageKey.startsWith(CACHE_PREFIX)) localStorage.removeItem(storageKey);
    }
  } catch {
    return;
  }
}

function cached<T>(key: readonly unknown[], on: boolean): { initialData?: T; initialDataUpdatedAt?: number } {
  if (!on) return {};
  try {
    const hit = JSON.parse(localStorage.getItem(cacheKey(key)) ?? "null") as {
      at: number;
      data: T;
    } | null;
    return hit ? { initialData: hit.data, initialDataUpdatedAt: hit.at } : {};
  } catch {
    return {};
  }
}

export function useSpotifyOn(): boolean {
  const caps = useCapabilities().data;
  return Boolean(caps?.spotifyConnected && caps.spotifyEnabled);
}

export function useSpotifyRequestsAllowed(): boolean {
  const on = useSpotifyOn();
  const blocked = useSpotifyStatus((s) => s.blocked);
  return on && !blocked;
}

export const useSpotifyMe = () => {
  const visible = useSpotifyOn();
  const on = useSpotifyRequestsAllowed();
  return useQuery({
    queryKey: spKeys.me,
    queryFn: sp.me,
    enabled: on,
    staleTime: LIBRARY_STALE,
    ...cached(spKeys.me, visible),
  });
};

export type SpotifyPlaylistEntry = SpPlaylist & { mine: boolean };

export function useSpotifyPlaylists() {
  const visible = useSpotifyOn();
  const on = useSpotifyRequestsAllowed();
  const me = useSpotifyMe();
  return useQuery({
    queryKey: spKeys.playlists,
    queryFn: async (): Promise<SpotifyPlaylistEntry[]> =>
      (await sp.playlists()).map((p) => ({
        ...p,
        mine: p.owner.id === me.data?.id || p.collaborative,
      })),
    enabled: on && Boolean(me.data),
    staleTime: LIBRARY_STALE,
    ...cached<SpotifyPlaylistEntry[]>(spKeys.playlists, visible),
  });
}

export const spotifyPlaylistQuery = (id: string) =>
  queryOptions({
    queryKey: spKeys.playlist(id),
    queryFn: async () => {
      const meta = await sp.playlist(id);
      const songs = await sp.playlistSongs(id).catch((e: unknown) => {
        if (e instanceof SpotifyApiError && e.status === 403) return null;
        throw e;
      });
      return { meta, songs };
    },
  });

export function useSpotifyPlaylist(id: string | undefined) {
  const on = useSpotifyRequestsAllowed();
  return useQuery({
    ...spotifyPlaylistQuery(id ?? ""),
    enabled: on && Boolean(id),
  });
}

export function useSpotifyLiked() {
  const visible = useSpotifyOn();
  const on = useSpotifyRequestsAllowed();
  return useQuery({
    queryKey: spKeys.liked,
    queryFn: sp.liked,
    enabled: on,
    staleTime: LIBRARY_STALE,
    ...cached(spKeys.liked, visible),
  });
}

export function useSpotifySaved(): Set<string> {
  const { data } = useSpotifyLiked();
  return new Set(data?.map((s) => s.id));
}

export function useSpotifyAlbums() {
  const visible = useSpotifyOn();
  const on = useSpotifyRequestsAllowed();
  return useQuery({
    queryKey: spKeys.albums,
    queryFn: sp.albums,
    enabled: on,
    staleTime: LIBRARY_STALE,
    ...cached(spKeys.albums, visible),
  });
}

export function useSpotifyFollowed() {
  const visible = useSpotifyOn();
  const on = useSpotifyRequestsAllowed();
  return useQuery({
    queryKey: spKeys.followed,
    queryFn: sp.followed,
    enabled: on,
    staleTime: LIBRARY_STALE,
    ...cached(spKeys.followed, visible),
  });
}

function notifySpotifyFailure(message: string) {
  toast(useSpotifyStatus.getState().blocked ? translate("spotify.requestPaused") : message);
}

type SpotifyFollowVariables = { artist: SpArtist; on: boolean };

export function useToggleSpotifyFollow() {
  const client = useQueryClient();
  const mutationContexts = new WeakMap<SpotifyFollowVariables, SpotifyCacheContext>();

  return useMutation({
    mutationFn: async (variables: SpotifyFollowVariables) => {
      const cacheContext = mutationContexts.get(variables);

      if (!cacheContext || !spotifyCacheContextIsCurrent(cacheContext)) throw new Error("Account changed");

      const { artist, on: isFollowing } = variables;
      const artistUris = [`spotify:artist:${artist.id}`];

      await (isFollowing ? sp.save(artistUris) : sp.unsave(artistUris));
    },
    onMutate: async (variables) => {
      const cacheContext = getSpotifyCacheContext();
      const queryKey = spKeys.followed;
      const { artist, on: isFollowing } = variables;

      mutationContexts.set(variables, cacheContext);

      await client.cancelQueries({ queryKey });

      if (!spotifyCacheContextIsCurrent(cacheContext)) throw new Error("Account changed");

      const previousFollowedArtists = client.getQueryData<SpArtist[]>(queryKey);

      if (previousFollowedArtists) {
        client.setQueryData<SpArtist[]>(
          queryKey,
          isFollowing
            ? [artist, ...previousFollowedArtists]
            : previousFollowedArtists.filter((followedArtist) => followedArtist.id !== artist.id),
        );
      }

      return { previousFollowedArtists, queryKey, ...cacheContext };
    },
    onSuccess: (_data, variables, context) => {
      mutationContexts.delete(variables);

      if (!context || !spotifyCacheContextIsCurrent(context)) return;

      const { artist, on: isFollowing } = variables;

      toast(
        translate(isFollowing ? "spotify.followed" : "spotify.followStopped", {
          name: artist.name,
        }),
      );
    },
    onError: (_error, variables, context) => {
      mutationContexts.delete(variables);

      if (!context || !spotifyCacheContextIsCurrent(context)) return;

      if (context.previousFollowedArtists) client.setQueryData(context.queryKey, context.previousFollowedArtists);

      notifySpotifyFailure(translate("spotify.updateFailed"));
    },
  });
}

export const spotifyAlbumQuery = (id: string) =>
  queryOptions({
    queryKey: spKeys.album(id),
    queryFn: async () => {
      const album = await sp.album(id);
      return { album, songs: albumSongs(album) };
    },
  });

export function useSpotifyAlbum(id: string | undefined) {
  const on = useSpotifyRequestsAllowed();
  return useQuery({
    ...spotifyAlbumQuery(id ?? ""),
    enabled: on && Boolean(id),
  });
}

export const spotifyArtistProfileQuery = (id: string) =>
  queryOptions({
    queryKey: spKeys.artistProfile(id),
    queryFn: ({ signal }) => sp.artist(id, signal),
    staleTime: LIBRARY_STALE,
  });

export function useSpotifyArtistProfile(id: string | undefined) {
  const visible = useSpotifyOn();
  const on = useSpotifyRequestsAllowed();
  return useQuery({
    ...spotifyArtistProfileQuery(id ?? ""),
    enabled: on && Boolean(id),
    ...cached<SpArtist>(spKeys.artistProfile(id ?? ""), visible),
  });
}

export const spotifyArtistQuery = (id: string) =>
  queryOptions({
    queryKey: spKeys.artist(id),
    queryFn: async ({ signal }) => {
      const [artist, albumsPage] = await Promise.all([
        queryClient.fetchQuery(spotifyArtistProfileQuery(id)),
        sp.artistAlbumsPage(id, { signal }),
      ]);

      return { artist, albums: albumsPage.items, albumsPage };
    },
  });

export async function spotifyArtistSongs(id: string, songPageLimit = 1): Promise<{ artist: SpArtist; songs: Song[] }> {
  const artist = await queryClient.fetchQuery(spotifyArtistProfileQuery(id));
  const songs: Song[] = [];
  let offset: number | undefined = 0;

  for (let pageIndex = 0; pageIndex < songPageLimit && offset !== undefined; pageIndex++) {
    const songPage = await sp.artistSongs(id, artist.name, { offset });

    songs.push(...songPage.items);
    offset = nextSpotifySearchOffset(songPage);
  }

  return { artist, songs: uniqueSpotifyItems(songs) };
}

export function useSpotifyArtist(id: string | undefined) {
  const on = useSpotifyRequestsAllowed();
  return useQuery({
    ...spotifyArtistQuery(id ?? ""),
    enabled: on && Boolean(id),
  });
}

export function useSpotifyArtistAlbums(id: string, initialPage?: SpPage<SpAlbumRef>, category?: "album" | "single") {
  const on = useSpotifyRequestsAllowed();

  return useInfiniteQuery({
    queryKey: spKeys.artistAlbums(id, category),
    queryFn: ({ pageParam, signal }) =>
      pageParam === 0 && initialPage && !category
        ? Promise.resolve(initialPage)
        : sp.artistAlbumsPage(id, {
            offset: pageParam,
            signal,
            ...(category ? { category } : {}),
          }),
    initialPageParam: 0,
    getNextPageParam: (albumPage) => (albumPage.next ? albumPage.offset + albumPage.limit : undefined),
    enabled: on && Boolean(id),
  });
}

export function useSpotifyArtistSongs(id: string, artistName: string) {
  const on = useSpotifyRequestsAllowed();

  return useInfiniteQuery({
    queryKey: spKeys.artistSongs(id, artistName),
    queryFn: ({ pageParam, signal }) => sp.artistSongs(id, artistName, { offset: pageParam, signal }),
    initialPageParam: 0,
    getNextPageParam: nextSpotifySearchOffset,
    enabled: on && Boolean(id && artistName),
  });
}

export function useSpotifySearch(q: string) {
  const on = useSpotifyRequestsAllowed();
  return useQuery({
    queryKey: spKeys.search(q),
    queryFn: async ({ signal }) => {
      return spotifySearchResults(await sp.search(q, signal));
    },
    enabled: on && q.trim().length > 0,
    placeholderData: keepPreviousData,
  });
}

const SEARCH_TYPES: Record<SpotifySearchKind, SpotifySearchType> = {
  songs: "track",
  albums: "album",
  artists: "artist",
  playlists: "playlist",
};

export function useSpotifySearchCategory(
  q: string,
  category: SpotifySearchKind | undefined,
  firstPage: SpotifySearchData | undefined,
) {
  const on = useSpotifyRequestsAllowed();

  return useInfiniteQuery({
    queryKey: spKeys.searchCategory(q, category),
    queryFn: async ({ pageParam, signal }) =>
      pageParam === 0 && firstPage
        ? firstPage
        : spotifySearchResults(
            await sp.search(q, signal, {
              offset: pageParam,
              ...(category ? { type: SEARCH_TYPES[category] } : {}),
            }),
            pageParam,
          ),
    initialPageParam: 0,
    getNextPageParam: (searchPage) => {
      const page = category ? searchPage.pagination[category] : undefined;

      return page ? nextSpotifySearchOffset(page) : undefined;
    },
    enabled: on && Boolean(q.trim() && category && firstPage),
  });
}

type SpotifySaveVariables = { song: Song; on: boolean };

export function useToggleSpotifySave() {
  const client = useQueryClient();
  const mutationContexts = new WeakMap<SpotifySaveVariables, SpotifyCacheContext>();

  return useMutation({
    mutationFn: async (variables: SpotifySaveVariables) => {
      const cacheContext = mutationContexts.get(variables);

      if (!cacheContext || !spotifyCacheContextIsCurrent(cacheContext)) throw new Error("Account changed");

      const { song, on: isSaved } = variables;

      if (!song.uri) return;

      await (isSaved ? sp.save([song.uri]) : sp.unsave([song.uri]));
    },
    onMutate: async (variables) => {
      const cacheContext = getSpotifyCacheContext();
      const queryKey = spKeys.liked;
      const { song, on: isSaved } = variables;

      mutationContexts.set(variables, cacheContext);

      await client.cancelQueries({ queryKey });

      if (!spotifyCacheContextIsCurrent(cacheContext)) throw new Error("Account changed");

      const previousLikedSongs = client.getQueryData<Song[]>(queryKey);

      if (previousLikedSongs) {
        client.setQueryData<Song[]>(
          queryKey,
          isSaved
            ? [{ ...song, starred: new Date().toISOString() }, ...previousLikedSongs]
            : previousLikedSongs.filter((likedSong) => likedSong.id !== song.id),
        );
      }

      return { previousLikedSongs, queryKey, ...cacheContext };
    },
    onError: (_error, variables, context) => {
      mutationContexts.delete(variables);

      if (!context || !spotifyCacheContextIsCurrent(context)) return;

      if (context.previousLikedSongs) client.setQueryData(context.queryKey, context.previousLikedSongs);

      notifySpotifyFailure(translate("spotify.saveFailed"));
    },
    onSettled: (_data, _error, variables) => mutationContexts.delete(variables),
  });
}

export function useSpotifyPlaylistEdits() {
  const client = useQueryClient();
  const refresh = (playlistKey: readonly unknown[], playlistsKey: readonly unknown[]) => {
    void client.invalidateQueries({ queryKey: playlistKey });
    void client.invalidateQueries({ queryKey: playlistsKey });
  };
  const fail = (cacheContext: SpotifyCacheContext) => {
    if (spotifyCacheContextIsCurrent(cacheContext)) notifySpotifyFailure(translate("spotify.updateFailed"));
  };

  return {
    add: async (playlist: { id: string; name: string }, songs: Song[]) => {
      const cacheContext = getSpotifyCacheContext();
      const playlistKey = spKeys.playlist(playlist.id);
      const playlistsKey = spKeys.playlists;
      const songUris = songs.map((song) => song.uri).filter((songUri): songUri is string => Boolean(songUri));

      if (!songUris.length) return;

      try {
        await sp.addToPlaylist(playlist.id, songUris);

        if (!spotifyCacheContextIsCurrent(cacheContext)) return;

        toast(translate("spotify.addedPlaylist", { name: playlist.name }));
        refresh(playlistKey, playlistsKey);
      } catch {
        fail(cacheContext);
      }
    },
    create: async (name: string, songs: Song[]) => {
      const cacheContext = getSpotifyCacheContext();
      const playlistsKey = spKeys.playlists;

      try {
        const createdPlaylist = await sp.createPlaylist(name);

        if (!spotifyCacheContextIsCurrent(cacheContext)) return null;

        const songUris = songs.map((song) => song.uri).filter((songUri): songUri is string => Boolean(songUri));

        if (songUris.length) await sp.addToPlaylist(createdPlaylist.id, songUris);

        if (!spotifyCacheContextIsCurrent(cacheContext)) return null;

        toast(translate("spotify.addedPlaylist", { name: createdPlaylist.name }));
        void client.invalidateQueries({ queryKey: playlistsKey });

        return createdPlaylist;
      } catch {
        fail(cacheContext);

        return null;
      }
    },
    remove: async (playlistId: string, song: Song) => {
      if (!song.uri) return;

      const cacheContext = getSpotifyCacheContext();
      const playlistKey = spKeys.playlist(playlistId);
      const playlistsKey = spKeys.playlists;

      try {
        await sp.removeFromPlaylist(playlistId, [song.uri]);

        if (!spotifyCacheContextIsCurrent(cacheContext)) return;

        toast(translate("spotify.removedPlaylist"));
        refresh(playlistKey, playlistsKey);
      } catch {
        fail(cacheContext);
      }
    },
    reorder: async (playlistId: string, fromIndex: number, toIndex: number) => {
      const cacheContext = getSpotifyCacheContext();
      const playlistKey = spKeys.playlist(playlistId);
      const previousPlaylist = client.getQueryData<{ meta: SpPlaylist; songs: Song[] | null }>(playlistKey);

      if (previousPlaylist?.songs) {
        const reorderedSongs = previousPlaylist.songs.slice();
        const [movedSong] = reorderedSongs.splice(fromIndex, 1);

        if (movedSong) reorderedSongs.splice(toIndex, 0, movedSong);

        client.setQueryData(playlistKey, { ...previousPlaylist, songs: reorderedSongs });
      }

      try {
        await sp.reorderPlaylist(playlistId, fromIndex, toIndex);
      } catch {
        if (!spotifyCacheContextIsCurrent(cacheContext)) return;

        if (previousPlaylist) client.setQueryData(playlistKey, previousPlaylist);

        fail(cacheContext);
      }
    },
  };
}

export function useArtistImage(id: string | undefined, name: string | undefined): string | undefined {
  const visible = useSpotifyOn();
  const on = useSpotifyRequestsAllowed();
  const spotify = isSpotify(id);
  const youtubeMusic = isYouTubeMusic(id);
  const youtubeMusicImage = useYouTubeMusicArtistImage(youtubeMusic ? (id ?? "") : "");
  const { data: localArtists, isPending: localPending } = useArtists();
  const local = spotify ? undefined : localArtists?.find((artist) => artist.id === id)?.coverArt;
  const { data: artist } = useSpotifyArtistProfile(spotify ? rawId(id ?? "") : undefined);
  const { data: found } = useQuery({
    queryKey: spKeys.artistImage(name ?? ""),
    queryFn: async () => {
      const hits = await sp.findArtist(name ?? "");
      return image(hits.find((a) => fold(a.name) === fold(name ?? ""))?.images, 640) ?? null;
    },
    enabled: on && !spotify && !youtubeMusic && !localPending && !local && Boolean(name),
    staleTime: Infinity,
    ...cached<string | null>(spKeys.artistImage(name ?? ""), visible),
  });
  return youtubeMusic ? youtubeMusicImage : spotify ? image(artist?.images, 640) : (local ?? found ?? undefined);
}
