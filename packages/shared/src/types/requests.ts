import type { LidarrState } from "./integrations.ts";

export type SongCandidate = {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  duration: number | null;
  year: number | null;
  coverUrl: string | null;
};

export type SongState = "searching" | "downloading" | "moving" | "available" | "failed";

export type RequestItem = {
  id: number;
  kind: "album" | "song";
  ref: string;
  title: string;
  artist: string;
  coverUrl: string | null;
  state: LidarrState | SongState;
  progress: number | null;
  detail: string | null;
  created: number;
  user?: string;
};
