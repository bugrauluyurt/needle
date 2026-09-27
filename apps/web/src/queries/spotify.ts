import { keepPreviousData, queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Song } from "@needle/shared";
import { albumSongs, sp, SpotifyApiError, toSong } from "../lib/spotify.ts";
import type { SpPlaylist } from "../lib/spotify.ts";
import { toast } from "../state/ui.ts";
import { useCapabilities } from "./hooks.ts";

const TEN_MIN = 10 * 60_000;

export const spKeys = {
  me: ["sp", "me"] as const,
  playlists: ["sp", "playlists"] as const,
  playlist: (id: string) => ["sp", "playlist", id] as const,
  liked: ["sp", "liked"] as const,
  albums: ["sp", "albums"] as const,
  album: (id: string) => ["sp", "album", id] as const,
  artist: (id: string) => ["sp", "artist", id] as const,
  search: (q: string) => ["sp", "search", q] as const,
};

export function useSpotifyOn(): boolean {
  return Boolean(useCapabilities().data?.spotifyConnected);
}

export const useSpotifyMe = () => {
  const on = useSpotifyOn();
  return useQuery({ queryKey: spKeys.me, queryFn: sp.me, enabled: on, staleTime: Infinity });
};

export type SpotifyPlaylistEntry = SpPlaylist & { mine: boolean };

export function useSpotifyPlaylists() {
  const on = useSpotifyOn();
  const me = useSpotifyMe();
  return useQuery({
    queryKey: spKeys.playlists,
    queryFn: async (): Promise<SpotifyPlaylistEntry[]> => (await sp.playlists()).map((p) => ({ ...p, mine: p.owner.id === me.data?.id || p.collaborative })),
    enabled: on && Boolean(me.data),
    staleTime: TEN_MIN,
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
  staleTime: 60_000,
});

export function useSpotifyPlaylist(id: string | undefined) {
  const on = useSpotifyOn();
  return useQuery({ ...spotifyPlaylistQuery(id ?? ""), enabled: on && Boolean(id) });
}

export function useSpotifyLiked() {
  const on = useSpotifyOn();
  return useQuery({ queryKey: spKeys.liked, queryFn: sp.liked, enabled: on, staleTime: TEN_MIN });
}

export function useSpotifySaved(): Set<string> {
  const { data } = useSpotifyLiked();
  return new Set(data?.map((s) => s.id));
}

export function useSpotifyAlbums() {
  const on = useSpotifyOn();
  return useQuery({ queryKey: spKeys.albums, queryFn: sp.albums, enabled: on, staleTime: TEN_MIN });
}

export const spotifyAlbumQuery = (id: string) => queryOptions({
  queryKey: spKeys.album(id),
  queryFn: async () => {
    const album = await sp.album(id);
    return { album, songs: albumSongs(album) };
  },
  staleTime: TEN_MIN,
});

export function useSpotifyAlbum(id: string | undefined) {
  const on = useSpotifyOn();
  return useQuery({ ...spotifyAlbumQuery(id ?? ""), enabled: on && Boolean(id) });
}

export const spotifyArtistQuery = (id: string) => queryOptions({
  queryKey: spKeys.artist(id),
  queryFn: async () => {
    const [artist, albums] = await Promise.all([sp.artist(id), sp.artistAlbums(id)]);
    return { artist, albums };
  },
  staleTime: TEN_MIN,
});

export function useSpotifyArtist(id: string | undefined) {
  const on = useSpotifyOn();
  return useQuery({ ...spotifyArtistQuery(id ?? ""), enabled: on && Boolean(id) });
}

export function useSpotifySearch(q: string) {
  const on = useSpotifyOn();
  return useQuery({
    queryKey: spKeys.search(q),
    queryFn: async ({ signal }) => {
      const r = await sp.search(q, signal);
      return {
        songs: (r.tracks?.items ?? []).filter((t) => t.id).map((t) => toSong(t)),
        albums: r.albums?.items ?? [],
        artists: r.artists?.items ?? [],
        playlists: (r.playlists?.items ?? []).filter((p): p is SpPlaylist => Boolean(p)),
      };
    },
    enabled: on && q.trim().length > 0,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
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
      toast("Spotify didn’t save that. Reconnect Spotify in Settings if this keeps happening.");
    },
  });
}

export function useSpotifyPlaylistEdits() {
  const qc = useQueryClient();
  const refresh = (id: string) => {
    void qc.invalidateQueries({ queryKey: spKeys.playlist(id) });
    void qc.invalidateQueries({ queryKey: spKeys.playlists });
  };
  const fail = () => toast("Spotify didn’t take that change. Reconnect Spotify in Settings if this keeps happening.");
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
