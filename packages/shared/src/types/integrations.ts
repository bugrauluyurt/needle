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

export type LidarrSearch = { albums: LidarrAlbum[] };

export type LidarrArtist = {
  foreignArtistId: string;
  name: string;
  imageUrl: string | null;
  disambiguation: string | null;
};

export type DownloadItem = {
  id: number;
  title: string;
  artist: string;
  coverUrl: string | null;
  state: "queued" | "downloading" | "importing" | "failed";
  progress: number | null;
  detail: string | null;
};

export type Capabilities = {
  admin: boolean;
  lidarr: boolean;
  spotify: boolean;
  spotifyConnected: boolean;
  spotifyPlayback: boolean;
  spotifyReconnect: boolean;
  spotifyEnabled: boolean;
  youtubeMusic?: boolean;
  youtubeMusicConnected?: boolean;
  youtubeMusicEnabled?: boolean;
  youtubeMusicReconnect?: boolean;
  songs: boolean;
  publicUrl: string | null;
  listenbrainzUser: string | null;
  listenbrainzNavidrome: boolean;
};

export type CheckState = "ok" | "warn" | "off" | "fail";

export type ConnectionCheck = {
  id: string;
  label: string;
  state: CheckState;
  detail: string;
  fix?: string;
};

export type SpotifyToken = { accessToken: string; expiresAt: number };

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

export type ListenBrainzLink = {
  user: string;
  navidrome: boolean;
  navidromeError?: string;
};

export type ListenBrainzUnlink = {
  navidrome: boolean;
  navidromeError?: string;
};

export type Person = {
  user: string;
  admin: boolean;
  canRequest: boolean;
  canSpotify: boolean;
  canYouTubeMusic?: boolean;
  lastSeen: number | null;
};

export type Me = { user: string; photo: string | null };

export type BrowseTile = {
  name: string;
  subtitle: string;
  to: string;
  covers: { id: string; coverArt?: string }[];
};
