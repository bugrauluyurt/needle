import type { Song } from "@needle/shared";
import type { SongSort } from "../../lib/songs.ts";
import type { IconName } from "../Icon.tsx";

export type TrackColumn = {
  label: string;
  value: (song: Song, index: number) => string;
  width?: string;
  sort?: SongSort;
};

export type TrackMenuExtra = { label: string; icon: IconName; run: () => void };

export type TrackMenuAction = {
  id: string;
  icon: IconName;
  label: string;
  run: () => void;
  quick?: string;
  on?: boolean;
  playlists?: boolean;
  go?: boolean;
};
