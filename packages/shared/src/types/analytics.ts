import type { Song } from "../subsonic.ts";

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

export type RankedAlbum = {
  id: string;
  name: string;
  artist: string;
  plays: number;
  coverArt?: string;
};

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
