import type { RemoteImage } from "./music-source.ts";
import type { NamedRef, Song, StructuredLyrics } from "./subsonic.ts";

export type YouTubeMusicAccount = { name: string; handle: string | null; photo: string | null };

export type YouTubeMusicLogin = { userCode: string; verificationUrl: string; expiresAt: number; interval: number };

export type YouTubeMusicLoginStatus = { state: "pending" | "connected" | "expired" | "denied"; retryAfter?: number };

export type YouTubeMusicPage<T> = { items: T[]; total: number | null; hasMore: boolean; limit: number };

export type YouTubeMusicAlbum = {
  id: string;
  title: string;
  artists: NamedRef[];
  images: RemoteImage[];
  year?: number;
  playlistId?: string;
  songCount?: number;
  duration?: number;
  description?: string;
};

export type YouTubeMusicAlbumDetail = { album: YouTubeMusicAlbum; songs: Song[] };

export type YouTubeMusicArtist = {
  id: string;
  name: string;
  images: RemoteImage[];
  description?: string;
  subscribers?: string;
  subscribed?: boolean;
  subscriptionId?: string;
};

export type YouTubeMusicArtistDetail = {
  artist: YouTubeMusicArtist;
  songs: Song[];
  albums: YouTubeMusicAlbum[];
  singles: YouTubeMusicAlbum[];
  hasMoreSongs: boolean;
  hasMoreAlbums: boolean;
  hasMoreSingles: boolean;
};

export type YouTubeMusicPlaylist = {
  id: string;
  title: string;
  images: RemoteImage[];
  author?: string;
  description?: string;
  songCount?: number;
  duration?: number;
  owned?: boolean;
};

export type YouTubeMusicPlaylistDetail = { playlist: YouTubeMusicPlaylist; songs: YouTubeMusicPage<Song> };

export type YouTubeMusicSearchKind = "songs" | "albums" | "artists" | "playlists";

export type YouTubeMusicSearch = {
  songs: Song[];
  albums: YouTubeMusicAlbum[];
  artists: YouTubeMusicArtist[];
  playlists: YouTubeMusicPlaylist[];
  limit: number;
  hasMore: boolean;
};

export type YouTubeMusicLyrics = { lyrics: StructuredLyrics[]; source: string | null };
