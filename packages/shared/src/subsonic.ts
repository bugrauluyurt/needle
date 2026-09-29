export type NamedRef = { id: string; name: string };

export type ReplayGain = { trackGain?: number; albumGain?: number; trackPeak?: number; albumPeak?: number };

export type Song = {
  id: string;
  parent?: string;
  title: string;
  album?: string;
  albumId?: string;
  artist?: string;
  artistId?: string;
  displayArtist?: string;
  artists?: NamedRef[];
  track?: number;
  discNumber?: number;
  year?: number;
  genre?: string;
  genres?: { name: string }[];
  coverArt?: string;
  size?: number;
  contentType?: string;
  suffix?: string;
  duration?: number;
  bitRate?: number;
  bitDepth?: number;
  samplingRate?: number;
  channelCount?: number;
  path?: string;
  created?: string;
  starred?: string;
  userRating?: number;
  playCount?: number;
  played?: string;
  replayGain?: ReplayGain;
  isrc?: string[];
  musicBrainzId?: string;
  source?: "spotify";
  uri?: string;
};

export type Album = {
  id: string;
  name: string;
  artist?: string;
  artistId?: string;
  displayArtist?: string;
  artists?: NamedRef[];
  coverArt?: string;
  songCount: number;
  duration: number;
  playCount?: number;
  played?: string;
  created?: string;
  starred?: string;
  year?: number;
  genre?: string;
  genres?: { name: string }[];
  isCompilation?: boolean;
  userRating?: number;
};

export type AlbumWithSongs = Album & { song?: Song[] };

export type Artist = {
  id: string;
  name: string;
  coverArt?: string;
  artistImageUrl?: string;
  albumCount?: number;
  starred?: string;
  userRating?: number;
};

export type ArtistWithAlbums = Artist & { album?: Album[] };

export type ArtistInfo = {
  biography?: string;
  musicBrainzId?: string;
  lastFmUrl?: string;
  smallImageUrl?: string;
  mediumImageUrl?: string;
  largeImageUrl?: string;
  similarArtist?: Artist[];
};

export type Playlist = {
  id: string;
  name: string;
  comment?: string;
  owner?: string;
  public?: boolean;
  songCount: number;
  duration: number;
  created?: string;
  changed?: string;
  coverArt?: string;
  readonly?: boolean;
};

export type PlaylistWithSongs = Playlist & { entry?: Song[] };

export type Genre = { value: string; songCount: number; albumCount: number };

export type LyricLine = { start?: number; value: string };

export type StructuredLyrics = {
  displayArtist?: string;
  displayTitle?: string;
  lang?: string;
  offset?: number;
  synced: boolean;
  line?: LyricLine[];
};

export type PlayQueue = {
  current?: string;
  position?: number;
  username?: string;
  changed?: string;
  changedBy?: string;
  entry?: Song[];
};

export type InternetRadioStation = { id: string; name: string; streamUrl: string; homePageUrl?: string };

export type SearchResult3 = { artist?: Artist[]; album?: Album[]; song?: Song[] };

export type ScanStatus = { scanning: boolean; count?: number; folderCount?: number; lastScan?: string };

export type SubsonicError = { code: number; message: string };

export type SubsonicEnvelope<T> = {
  "subsonic-response": T & {
    status: "ok" | "failed";
    version: string;
    type?: string;
    serverVersion?: string;
    openSubsonic?: boolean;
    error?: SubsonicError;
  };
};
