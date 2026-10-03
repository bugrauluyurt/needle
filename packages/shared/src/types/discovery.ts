import type { Song } from "../subsonic.ts";
import type { RequestItem } from "./requests.ts";

export type DiscoveryKind = "weekly-exploration" | "weekly-jams" | "daily-jams" | "other";

export type DiscoveryPlaylist = {
  id: string;
  name: string;
  kind: DiscoveryKind;
  description: string;
  date: string;
  covers: string[];
  coverArts: string[];
  total: number;
  inLibrary: number;
};

export type DiscoveryTrack = {
  mbid: string;
  title: string;
  artist: string;
  album: string | null;
  duration: number | null;
  coverUrl: string | null;
  song: Song | null;
  request: RequestItem | null;
};

export type DiscoveryDetail = DiscoveryPlaylist & { tracks: DiscoveryTrack[] };
