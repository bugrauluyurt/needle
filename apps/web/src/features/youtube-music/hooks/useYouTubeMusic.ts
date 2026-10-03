import { HOUR_MS, youtubeMusicRawId } from "@needle/shared";
import type {
  Song,
  YouTubeMusicAlbum,
  YouTubeMusicArtist,
  YouTubeMusicArtistDetail,
  YouTubeMusicPage,
  YouTubeMusicSearchKind,
} from "@needle/shared";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Query } from "@tanstack/react-query";
import { image } from "../../spotify/api/client.ts";
import { clearYouTubeMusicStatus, useYouTubeMusicStatus, ytm } from "../api/client.ts";
import { useSession } from "../../../state/session.ts";
import { toast } from "../../../state/ui.ts";
import { queryClient } from "../../../queries/client.ts";
import { useCapabilities } from "../../../queries/hooks.ts";
import { translate } from "../../../i18n/index.ts";

const LIBRARY_STALE = 6 * HOUR_MS;
const CACHE_PREFIX = "needle.ytm.";
const PERSISTED = new Set(["account", "liked", "albums", "artists", "playlists"]);
const currentUser = () => useSession.getState().credentials?.user ?? "";
let cacheGeneration = 0;

export const ytmKeys = {
  get account() {
    return ["ytm", "account", currentUser()] as const;
  },
  get liked() {
    return ["ytm", "liked", currentUser()] as const;
  },
  get albums() {
    return ["ytm", "albums", currentUser()] as const;
  },
  get artists() {
    return ["ytm", "artists", currentUser()] as const;
  },
  get playlists() {
    return ["ytm", "playlists", currentUser()] as const;
  },
  album: (id: string) => ["ytm", "album", youtubeMusicRawId(id), currentUser()] as const,
  artist: (id: string) => ["ytm", "artist", youtubeMusicRawId(id), currentUser()] as const,
  playlist: (id: string, limit = 100) => ["ytm", "playlist", youtubeMusicRawId(id), limit, currentUser()] as const,
};

queryClient.setQueryDefaults(["ytm"], {
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
    queryKey[0] !== "ytm" ||
    !PERSISTED.has(String(queryKey[1])) ||
    state.status !== "success" ||
    !currentUser() ||
    queryKey[2] !== currentUser()
  )
    return;

  try {
    localStorage.setItem(cacheKey(queryKey), JSON.stringify({ at: state.dataUpdatedAt, data: state.data }));
  } catch {
    return;
  }
});

export function clearYouTubeMusicCache() {
  cacheGeneration += 1;

  clearYouTubeMusicStatus();

  queryClient.removeQueries({ queryKey: ["ytm"] });

  try {
    for (const storageKey of Object.keys(localStorage)) {
      if (storageKey.startsWith(CACHE_PREFIX)) localStorage.removeItem(storageKey);
    }
  } catch {
    return;
  }
}

function cached<T>(queryKey: readonly unknown[], visible: boolean): { initialData?: T; initialDataUpdatedAt?: number } {
  if (!visible) return {};

  try {
    const cachedData = JSON.parse(localStorage.getItem(cacheKey(queryKey)) ?? "null") as { at: number; data: T } | null;

    return cachedData ? { initialData: cachedData.data, initialDataUpdatedAt: cachedData.at } : {};
  } catch {
    return {};
  }
}

export function useYouTubeMusicOn(): boolean {
  const capabilities = useCapabilities().data;

  return Boolean(capabilities?.youtubeMusicConnected && capabilities.youtubeMusicEnabled);
}

export function useYouTubeMusicRequestsAllowed(): boolean {
  const visible = useYouTubeMusicOn();
  const blocked = useYouTubeMusicStatus((status) => status.blocked);

  return visible && !blocked;
}

export function useYouTubeMusicAccount() {
  const visible = useYouTubeMusicOn();
  const enabled = useYouTubeMusicRequestsAllowed();
  const account = useQuery({
    queryKey: ytmKeys.account,
    queryFn: ytm.account,
    enabled,
    staleTime: LIBRARY_STALE,
    ...cached(ytmKeys.account, visible),
  });

  return { ...account, data: visible ? account.data : undefined };
}

function useLibraryPage<T>(
  queryKey: readonly string[],
  queryFn: (limit: number) => Promise<YouTubeMusicPage<T>>,
  limit: number,
) {
  const visible = useYouTubeMusicOn();
  const enabled = useYouTubeMusicRequestsAllowed();
  const libraryKey = [...queryKey, limit];
  const library = useQuery({
    queryKey: libraryKey,
    queryFn: () => queryFn(limit),
    enabled,
    staleTime: LIBRARY_STALE,
    placeholderData: (previousPage, previousQuery) =>
      previousQuery?.queryKey[2] === currentUser() ? previousPage : undefined,
    ...cached<YouTubeMusicPage<T>>(libraryKey, visible),
  });

  return {
    ...library,
    data: visible ? library.data?.items : undefined,
    hasMore: visible && Boolean(library.data?.hasMore),
    total: visible ? library.data?.total : undefined,
  };
}

export const useYouTubeMusicLiked = (limit = 100) => useLibraryPage(ytmKeys.liked, ytm.liked, limit);
export const useYouTubeMusicAlbums = (limit = 100) => useLibraryPage(ytmKeys.albums, ytm.albums, limit);
export const useYouTubeMusicArtists = (limit = 100) => useLibraryPage(ytmKeys.artists, ytm.artists, limit);
export const useYouTubeMusicPlaylists = (limit = 100) => useLibraryPage(ytmKeys.playlists, ytm.playlists, limit);

export function useYouTubeMusicSaved(): Set<string> {
  const likedSongs = useYouTubeMusicLiked();
  const loadedLikedPages = queryClient.getQueriesData<YouTubeMusicPage<Song>>({
    queryKey: ytmKeys.liked,
  });

  return new Set(
    likedSongs.data ? loadedLikedPages.flatMap(([, page]) => page?.items.map((song) => song.id) ?? []) : [],
  );
}

export const youtubeMusicAlbumQuery = (id: string) =>
  queryOptions({ queryKey: ytmKeys.album(id), queryFn: () => ytm.album(id) });
export const youtubeMusicArtistQuery = (id: string) =>
  queryOptions({ queryKey: ytmKeys.artist(id), queryFn: () => ytm.artist(id) });
export const youtubeMusicPlaylistQuery = (id: string, limit = 100) =>
  queryOptions({
    queryKey: ytmKeys.playlist(id, limit),
    queryFn: () => ytm.playlist(id, limit),
  });

export function useYouTubeMusicAlbum(id: string) {
  const enabled = useYouTubeMusicRequestsAllowed();

  return useQuery({
    ...youtubeMusicAlbumQuery(id),
    enabled: enabled && Boolean(id),
  });
}

export function useYouTubeMusicArtist(id: string) {
  const enabled = useYouTubeMusicRequestsAllowed();

  return useQuery({
    ...youtubeMusicArtistQuery(id),
    enabled: enabled && Boolean(id),
  });
}

export function useYouTubeMusicArtistImage(id: string): string | undefined {
  const artist = useYouTubeMusicArtist(id);
  const visible = useYouTubeMusicOn();

  return visible ? image(artist.data?.artist.images, 640) : undefined;
}

export function useYouTubeMusicPlaylist(id: string, limit = 100) {
  const enabled = useYouTubeMusicRequestsAllowed();

  return useQuery({
    ...youtubeMusicPlaylistQuery(id, limit),
    enabled: enabled && Boolean(id),
    placeholderData: (previousPlaylist, previousQuery) =>
      previousQuery?.queryKey[2] === youtubeMusicRawId(id) && previousQuery.queryKey[4] === currentUser()
        ? previousPlaylist
        : undefined,
  });
}

export function useYouTubeMusicSearch(query: string, kind?: YouTubeMusicSearchKind, limit = 20) {
  const enabled = useYouTubeMusicRequestsAllowed();

  return useQuery({
    queryKey: ["ytm", "search", query, kind ?? "all", limit, currentUser()],
    queryFn: ({ signal }) => ytm.search(query, { limit, signal, ...(kind ? { kind } : {}) }),
    enabled: enabled && Boolean(query.trim()),
    placeholderData: (previousSearch, previousQuery) =>
      previousQuery?.queryKey[2] === query &&
      previousQuery.queryKey[3] === (kind ?? "all") &&
      previousQuery.queryKey[5] === currentUser()
        ? previousSearch
        : undefined,
  });
}

export function useYouTubeMusicLyrics(id: string | undefined) {
  const enabled = useYouTubeMusicRequestsAllowed();

  return useQuery({
    queryKey: ["ytm", "lyrics", id, currentUser()],
    queryFn: () => ytm.lyrics(id ?? ""),
    enabled: enabled && Boolean(id),
  });
}

export function useYouTubeMusicRadio(id: string | undefined) {
  const enabled = useYouTubeMusicRequestsAllowed();

  return useQuery({
    queryKey: ["ytm", "radio", id, currentUser()],
    queryFn: () => ytm.radio(id ?? ""),
    enabled: enabled && Boolean(id),
  });
}

function useLibraryMutation<T extends { id: string }>(
  queryKey: readonly string[],
  update: (item: T, on: boolean) => Promise<void>,
) {
  const client = useQueryClient();

  return useMutation({
    mutationFn: ({ item, on }: { item: T; on: boolean }) => update(item, on),
    onMutate: async ({ item, on }) => {
      const generation = cacheGeneration;
      const user = currentUser();

      await client.cancelQueries({ queryKey });

      const previousPages = client.getQueriesData<YouTubeMusicPage<T>>({
        queryKey,
      });
      const artistDetailKey = queryKey[1] === "artists" ? ytmKeys.artist(item.id) : undefined;
      const previousArtist = artistDetailKey
        ? client.getQueryData<YouTubeMusicArtistDetail>(artistDetailKey)
        : undefined;

      if (generation !== cacheGeneration || user !== currentUser())
        throw new Error(translate("youtube.connectionChanged"));

      if (artistDetailKey && previousArtist)
        client.setQueryData<YouTubeMusicArtistDetail>(artistDetailKey, {
          ...previousArtist,
          artist: { ...previousArtist.artist, subscribed: on },
        });

      client.setQueriesData<YouTubeMusicPage<T>>({ queryKey }, (page) => {
        if (!page) return page;

        const filteredItems = page.items.filter((savedItem) => savedItem.id !== item.id);
        const countChange = Number(on) - Number(filteredItems.length !== page.items.length);

        return {
          ...page,
          items: on ? [item, ...filteredItems] : filteredItems,
          total: page.total === null ? null : Math.max(0, page.total + countChange),
        };
      });

      return {
        previousPages,
        artistDetailKey,
        previousArtist,
        generation,
        user,
      };
    },
    onError: (_mutationError, _variables, context) => {
      if (!context || context.generation !== cacheGeneration || context.user !== currentUser()) return;

      for (const [previousKey, previousPage] of context?.previousPages ?? [])
        client.setQueryData(previousKey, previousPage);

      if (context.artistDetailKey && context.previousArtist)
        client.setQueryData(context.artistDetailKey, context.previousArtist);

      toast(
        useYouTubeMusicStatus.getState().blocked ? translate("youtube.requestPaused") : translate("youtube.saveFailed"),
      );
    },
  });
}

export function useToggleYouTubeMusicSave() {
  const mutation = useLibraryMutation<Song>(ytmKeys.liked, (song, on) => ytm.like(song.id, on));

  return {
    ...mutation,
    mutate: ({ song, on }: { song: Song; on: boolean }) => mutation.mutate({ item: song, on }),
  };
}

export function useToggleYouTubeMusicAlbum() {
  const mutation = useLibraryMutation<YouTubeMusicAlbum>(ytmKeys.albums, (album, on) => ytm.saveAlbum(album.id, on));

  return {
    ...mutation,
    mutate: ({ album, on }: { album: YouTubeMusicAlbum; on: boolean }) => mutation.mutate({ item: album, on }),
  };
}

export function useToggleYouTubeMusicFollow() {
  const mutation = useLibraryMutation<YouTubeMusicArtist>(ytmKeys.artists, (artist, on) => ytm.follow(artist.id, on));

  return {
    ...mutation,
    mutate: ({ artist, on }: { artist: YouTubeMusicArtist; on: boolean }) => mutation.mutate({ item: artist, on }),
  };
}
