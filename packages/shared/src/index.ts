import type { Song } from "./subsonic.ts";

export type Period = "month" | "quarter" | "year" | "all";

export type PlayReport = {
  songId: string;
  title: string;
  artist: string;
  artistId?: string;
  album: string;
  albumId?: string;
  genre?: string;
  coverArt?: string;
  duration: number;
  msPlayed: number;
  device: string;
};

export type RankedArtist = { id: string; name: string; plays: number };
export type RankedAlbum = { id: string; name: string; artist: string; plays: number; coverArt?: string };
export type GenreShare = { name: string; share: number };

export type Stats = {
  period: Period;
  from: string;
  msPlayed: number;
  prevMsPlayed: number;
  songs: number;
  artists: number;
  peakHour: number | null;
  topArtists: RankedArtist[];
  topAlbums: RankedAlbum[];
  hours: number[];
  genres: GenreShare[];
};

export type Mix = {
  id: string;
  name: string;
  description: string;
  artists: string[];
  songs: Song[];
  coverArts: string[];
  palette: [string, string, string];
};

export type LidarrState = "missing" | "wanted" | "searching" | "downloading" | "importing" | "available";

export type LidarrAlbum = {
  foreignAlbumId: string;
  title: string;
  artist: string;
  foreignArtistId: string;
  year: number | null;
  trackCount: number | null;
  coverUrl: string | null;
  state: LidarrState;
  progress: number | null;
};

export type LidarrArtist = {
  foreignArtistId: string;
  name: string;
  imageUrl: string | null;
  inLidarr: boolean;
};

export type Capabilities = {
  lidarr: boolean;
  spotify: boolean;
  spotifyConnected: boolean;
  spotifyPlayback: boolean;
  spotifyReconnect: boolean;
  publicUrl: string | null;
};

export type SpotifyToken = { accessToken: string; expiresAt: number };

export type DeviceKind = "desktop" | "phone" | "tablet";

export type RemoteState = {
  songId: string;
  title: string;
  artist: string;
  coverArt?: string;
  position: number;
  duration: number;
  playing: boolean;
  volume: number;
  updatedAt: number;
};

export type Device = {
  id: string;
  name: string;
  kind: DeviceKind;
  lastSeen: number;
  state: RemoteState | null;
};

export type RemoteCommand =
  | { action: "play" | "pause" | "next" | "previous" }
  | { action: "seek"; position: number }
  | { action: "volume"; volume: number }
  | { action: "transfer"; songs: Song[]; index: number; position: number; playing: boolean }
  | { action: "pull" };

export type ClientMessage =
  | { type: "hello"; device: { id: string; name: string; kind: DeviceKind } }
  | { type: "state"; state: RemoteState | null }
  | { type: "command"; to: string; command: RemoteCommand };

export type ServerMessage =
  | { type: "devices"; devices: Device[] }
  | { type: "command"; from: string; command: RemoteCommand };

export type SpotifyPlaylist = {
  id: string;
  name: string;
  trackCount: number;
  image: string | null;
};

export type ImportedTrack = { title: string; artist: string; album: string };

export type ImportResult = {
  source: string;
  total: number;
  matched: number;
  playlistId: string | null;
  missing: ImportedTrack[];
};

export const AUTH_HEADERS = { user: "x-needle-user", token: "x-needle-token", salt: "x-needle-salt" } as const;

export type * from "./subsonic.ts";
export * from "./search.ts";
