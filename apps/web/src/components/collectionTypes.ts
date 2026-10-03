import type { ReactNode } from "react";
import type { MusicSource } from "@needle/shared";

export type CollectionItem = {
  key: string;
  to: string;
  art: (px: number) => ReactNode;
  title: string;
  subtitle: string;
  by?: string;
  added?: string;
  year?: number;
  releaseDate?: string;
  playCount?: number;
  contextId?: string;
  downloaded?: boolean;
  pinned?: boolean;
  source?: Exclude<MusicSource, "library">;
  onPlay?: () => void;
};
