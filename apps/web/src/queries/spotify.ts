import { keepPreviousData, queryOptions, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Query } from "@tanstack/react-query";
import type { Song } from "@needle/shared";
import { albumSongs, image, isSpotify, nextSpotifySearchOffset, rawId, sp, SpotifyApiError, spotifySearchResults, uniqueSpotifyItems, useSpotifyStatus } from "../lib/spotify.ts";
import type { SpAlbumRef, SpArtist, SpPage, SpPlaylist, SpotifySearchData, SpotifySearchKind, SpotifySearchType } from "../lib/spotify.ts";
import { toast } from "../state/ui.ts";
import { queryClient } from "./client.ts";
import { useArtists, useCapabilities } from "./hooks.ts";
import { useSession } from "../state/session.ts";
import { fold, HOUR_MS } from "@needle/shared";

const LIBRARY_STALE = 6 * HOUR_MS;
const CACHE_PREFIX = "needle.sp.";
const PERSISTED = new Set(["me", "playlists", "liked", "albums", "followed", "artistImage", "artistProfile"]);

export const spKeys = {
  me: ["sp", "me"] as const,
  playlists: ["sp", "playlists"] as const,
  playlist: (id: string) => ["sp", "playlist", id] as const,
  liked: ["sp", "liked"] as const,
  albums: ["sp", "albums"] as const,
  followed: ["sp", "followed"] as const,
  artistImage: (name: string) => ["sp", "artistImage", name] as const,
  album: (id: string) => ["sp", "album", id] as const,
  artistProfile: (id: string) => ["sp", "artistProfile", id] as const,
  artist: (id: string) => ["sp", "artist", id] as const,
  artistAlbums: (id: string, category?: "album" | "single") => ["sp", "artistAlbums", id, category ?? "all"] as const,
  artistSongs: (id: string, artistName: string) => ["sp", "artistSongs", id, artistName] as const,
  search: (q: string) => ["sp", "search", q] as const,
  searchCategory: (q: string, category: SpotifySearchKind | undefined) => ["sp", "search", q, category] as const,
};

queryClient.setQueryDefaults(["sp"], { refetchOnWindowFocus: false, refetchOnReconnect: false, retry: false, staleTime: HOUR_MS });

const cacheKey = (key: readonly unknown[]) => `${CACHE_PREFIX}${useSession.getState().credentials?.user ?? ""}.${JSON.stringify(key)}`;

queryClient.getQueryCache().subscribe((e) => {
  if (e.type !== "updated") return;
  const { queryKey, state } = e.query as Query;
  if (queryKey[0] !== "sp" || !PERSISTED.has(String(queryKey[1])) || state.status !== "success") return;
  try {
    localStorage.setItem(cacheKey(queryKey), JSON.stringify({ at: state.dataUpdatedAt, data: state.data }));
  } catch {
    return;
  }
});

export function clearSpotifyCache() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(CACHE_PREFIX)) localStorage.removeItem(k);
  } catch {
    return;
  }
}

function cached<T>(key: readonly unknown[], on: boolean): { initialData?: T; initialDataUpdatedAt?: number } {
  if (!on) return {};
  try {
    const hit = JSON.parse(localStorage.getItem(cacheKey(key)) ?? "null") as { at: number; data: T } | null;
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
  return useQuery({ queryKey: spKeys.me, queryFn: sp.me, enabled: on, staleTime: LIBRARY_STALE, ...cached(spKeys.me, visible) });
};

export type SpotifyPlaylistEntry = SpPlaylist & { mine: boolean };

export function useSpotifyPlaylists() {
  const visible = useSpotifyOn();
  const on = useSpotifyRequestsAllowed();
  const me = useSpotifyMe();
  return useQuery({
    queryKey: spKeys.playlists,
    queryFn: async (): Promise<SpotifyPlaylistEntry[]> => (await sp.playlists()).map((p) => ({ ...p, mine: p.owner.id === me.data?.id || p.collaborative })),
    enabled: on && Boolean(me.data),
    staleTime: LIBRARY_STALE,
    ...cached<SpotifyPlaylistEntry[]>(spKeys.playlists, visible),
  });
}

export const spotifyPlaylistQuery = (id: string) => queryOptions({
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
  return useQuery({ ...spotifyPlaylistQuery(id ?? ""), enabled: on && Boolean(id) });
}

export function useSpotifyLiked() {
  const visible = useSpotifyOn();
  const on = useSpotifyRequestsAllowed();
  return useQuery({ queryKey: spKeys.liked, queryFn: sp.liked, enabled: on, staleTime: LIBRARY_STALE, ...cached(spKeys.liked, visible) });
}

export function useSpotifySaved(): Set<string> {
  const { data } = useSpotifyLiked();
  return new Set(data?.map((s) => s.id));
}

export function useSpotifyAlbums() {
  const visible = useSpotifyOn();
  const on = useSpotifyRequestsAllowed();
  return useQuery({ queryKey: spKeys.albums, queryFn: sp.albums, enabled: on, staleTime: LIBRARY_STALE, ...cached(spKeys.albums, visible) });
}

export function useSpotifyFollowed() {
  const visible = useSpotifyOn();
  const on = useSpotifyRequestsAllowed();
  return useQuery({ queryKey: spKeys.followed, queryFn: sp.followed, enabled: on, staleTime: LIBRARY_STALE, ...cached(spKeys.followed, visible) });
}

function notifySpotifyFailure(message: string) {
  toast(useSpotifyStatus.getState().blocked ? "Spotify requests are paused. Try again after the cooldown." : message);
}

export function useToggleSpotifyFollow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ artist, on }: { artist: SpArtist; on: boolean }) => {
      const uri = [`spotify:artist:${artist.id}`];
      return on ? sp.save(uri) : sp.unsave(uri);
    },
    onMutate: async ({ artist, on }) => {
      await qc.cancelQueries({ queryKey: spKeys.followed });
      const prev = qc.getQueryData<SpArtist[]>(spKeys.followed);
      if (prev) qc.setQueryData<SpArtist[]>(spKeys.followed, on ? [artist, ...prev] : prev.filter((a) => a.id !== artist.id));
      return { prev };
    },
    onSuccess: (_d, { artist, on }) => toast(on ? `Following ${artist.name} on Spotify` : `Stopped following ${artist.name}`),
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(spKeys.followed, ctx.prev);
      notifySpotifyFailure("Spotify didn’t take that. Reconnect Spotify in Settings if this keeps happening.");
    },
  });
}

export const spotifyAlbumQuery = (id: string) => queryOptions({
  queryKey: spKeys.album(id),
  queryFn: async () => {
    const album = await sp.album(id);
    return { album, songs: albumSongs(album) };
  },
});

export function useSpotifyAlbum(id: string | undefined) {
  const on = useSpotifyRequestsAllowed();
  return useQuery({ ...spotifyAlbumQuery(id ?? ""), enabled: on && Boolean(id) });
}

export const spotifyArtistProfileQuery = (id: string) => queryOptions({
  queryKey: spKeys.artistProfile(id),
  queryFn: ({ signal }) => sp.artist(id, signal),
  staleTime: LIBRARY_STALE,
});

export function useSpotifyArtistProfile(id: string | undefined) {
  const visible = useSpotifyOn();
  const on = useSpotifyRequestsAllowed();
  return useQuery({ ...spotifyArtistProfileQuery(id ?? ""), enabled: on && Boolean(id), ...cached<SpArtist>(spKeys.artistProfile(id ?? ""), visible) });
}

export const spotifyArtistQuery = (id: string) => queryOptions({
  queryKey: spKeys.artist(id),
  queryFn: async ({ signal }) => {
    const [artist, albumsPage] = await Promise.all([queryClient.fetchQuery(spotifyArtistProfileQuery(id)), sp.artistAlbumsPage(id, { signal })]);

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
  return useQuery({ ...spotifyArtistQuery(id ?? ""), enabled: on && Boolean(id) });
}

export function useSpotifyArtistAlbums(id: string, initialPage?: SpPage<SpAlbumRef>, category?: "album" | "single") {
  const on = useSpotifyRequestsAllowed();

  return useInfiniteQuery({
    queryKey: spKeys.artistAlbums(id, category),
    queryFn: ({ pageParam, signal }) => pageParam === 0 && initialPage && !category ? Promise.resolve(initialPage) : sp.artistAlbumsPage(id, { offset: pageParam, signal, ...(category ? { category } : {}) }),
    initialPageParam: 0,
    getNextPageParam: (albumPage) => albumPage.next ? albumPage.offset + albumPage.limit : undefined,
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

const SEARCH_TYPES: Record<SpotifySearchKind, SpotifySearchType> = { songs: "track", albums: "album", artists: "artist", playlists: "playlist" };

export function useSpotifySearchCategory(q: string, category: SpotifySearchKind | undefined, firstPage: SpotifySearchData | undefined) {
  const on = useSpotifyRequestsAllowed();

  return useInfiniteQuery({
    queryKey: spKeys.searchCategory(q, category),
    queryFn: async ({ pageParam, signal }) => pageParam === 0 && firstPage ? firstPage : spotifySearchResults(await sp.search(q, signal, { offset: pageParam, ...(category ? { type: SEARCH_TYPES[category] } : {}) }), pageParam),
    initialPageParam: 0,
    getNextPageParam: (searchPage) => {
      const page = category ? searchPage.pagination[category] : undefined;

      return page ? nextSpotifySearchOffset(page) : undefined;
    },
    enabled: on && Boolean(q.trim() && category && firstPage),
  });
}

export function useToggleSpotifySave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ song, on }: { song: Song; on: boolean }) => {
      if (!song.uri) return;
      await (on ? sp.save([song.uri]) : sp.unsave([song.uri]));
    },
    onMutate: async ({ song, on }) => {
      await qc.cancelQueries({ queryKey: spKeys.liked });
      const prev = qc.getQueryData<Song[]>(spKeys.liked);
      if (prev) qc.setQueryData<Song[]>(spKeys.liked, on ? [{ ...song, starred: new Date().toISOString() }, ...prev] : prev.filter((s) => s.id !== song.id));
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(spKeys.liked, ctx.prev);
      notifySpotifyFailure("Spotify didn’t save that. Reconnect Spotify in Settings if this keeps happening.");
    },
  });
}

export function useSpotifyPlaylistEdits() {
  const qc = useQueryClient();
  const refresh = (id: string) => {
    void qc.invalidateQueries({ queryKey: spKeys.playlist(id) });
    void qc.invalidateQueries({ queryKey: spKeys.playlists });
  };
  const fail = () => notifySpotifyFailure("Spotify didn’t take that change. Reconnect Spotify in Settings if this keeps happening.");
  return {
    add: async (playlist: { id: string; name: string }, songs: Song[]) => {
      const uris = songs.map((s) => s.uri).filter((u): u is string => Boolean(u));
      if (!uris.length) return;
      try {
        await sp.addToPlaylist(playlist.id, uris);
        toast(`Added to ${playlist.name}`);
        refresh(playlist.id);
      } catch {
        fail();
      }
    },
    create: async (name: string, songs: Song[]) => {
      try {
        const p = await sp.createPlaylist(name);
        const uris = songs.map((s) => s.uri).filter((u): u is string => Boolean(u));
        if (uris.length) await sp.addToPlaylist(p.id, uris);
        toast(`Added to ${p.name}`);
        void qc.invalidateQueries({ queryKey: spKeys.playlists });
        return p;
      } catch {
        fail();
        return null;
      }
    },
    remove: async (playlistId: string, song: Song) => {
      if (!song.uri) return;
      try {
        await sp.removeFromPlaylist(playlistId, [song.uri]);
        toast("Removed from playlist");
        refresh(playlistId);
      } catch {
        fail();
      }
    },
    reorder: async (playlistId: string, from: number, to: number) => {
      const key = spKeys.playlist(playlistId);
      const prev = qc.getQueryData<{ meta: SpPlaylist; songs: Song[] | null }>(key);
      if (prev?.songs) {
        const next = prev.songs.slice();
        const [moved] = next.splice(from, 1);
        if (moved) next.splice(to, 0, moved);
        qc.setQueryData(key, { ...prev, songs: next });
      }
      try {
        await sp.reorderPlaylist(playlistId, from, to);
      } catch {
        if (prev) qc.setQueryData(key, prev);
        fail();
      }
    },
  };
}

export function useArtistImage(id: string | undefined, name: string | undefined): string | undefined {
  const visible = useSpotifyOn();
  const on = useSpotifyRequestsAllowed();
  const spotify = isSpotify(id);
  const { data: localArtists, isPending: localPending } = useArtists();
  const local = spotify ? undefined : localArtists?.find((artist) => artist.id === id)?.coverArt;
  const { data: artist } = useSpotifyArtistProfile(spotify ? rawId(id ?? "") : undefined);
  const { data: found } = useQuery({
    queryKey: spKeys.artistImage(name ?? ""),
    queryFn: async () => {
      const hits = await sp.findArtist(name ?? "");
      return image(hits.find((a) => fold(a.name) === fold(name ?? ""))?.images, 640) ?? null;
    },
    enabled: on && !spotify && !localPending && !local && Boolean(name),
    staleTime: Infinity,
    ...cached<string | null>(spKeys.artistImage(name ?? ""), visible),
  });
  return spotify ? image(artist?.images, 640) : (local ?? found ?? undefined);
}
