import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { InternetRadioStation, Song } from "@needle/shared";
import type { QueueItem, QueueState, Repeat } from "./queue.ts";

export type ContextKind =
  | "album"
  | "playlist"
  | "artist"
  | "liked"
  | "mix"
  | "genre"
  | "search"
  | "radio"
  | "queue"
  | "downloads";
export type PlayContext = {
  kind: ContextKind;
  id?: string;
  name: string;
  ordered?: boolean;
};

export type ResumeOffer = {
  songs: Song[];
  index: number;
  position: number;
  changedBy: string;
  changed: string;
};

export type PlayerState = QueueState & {
  context: PlayContext | null;
  shuffle: boolean;
  repeat: Repeat;
  playing: boolean;
  buffering: boolean;
  volume: number;
  muted: boolean;
  station: InternetRadioStation | null;
  lastPosition: number;
  resume: ResumeOffer | null;
  error: string | null;
};

const PERSIST_LIMIT = 500;

export function useContextPlaying(id: string | undefined) {
  const current = usePlayer((s) => Boolean(id) && s.context?.id === id);
  const playing = usePlayer((s) => s.playing);
  return { current, playing: current && playing };
}

export const usePlayer = create<PlayerState>()(
  persist(
    (): PlayerState => ({
      items: [] as QueueItem[],
      index: -1,
      original: null,
      context: null,
      shuffle: false,
      repeat: "off",
      playing: false,
      buffering: false,
      volume: 0.8,
      muted: false,
      station: null,
      lastPosition: 0,
      resume: null,
      error: null,
    }),
    {
      name: "needle.player",
      version: 1,
      partialize: (s) => {
        const start = Math.max(0, s.index - 50);
        const items = s.items.slice(start, start + PERSIST_LIMIT);
        return {
          items,
          index: s.index - start,
          original: null,
          context: s.context,
          shuffle: s.shuffle,
          repeat: s.repeat,
          volume: s.volume,
          muted: s.muted,
          lastPosition: s.lastPosition,
        };
      },
    },
  ),
);

export const current = (s: PlayerState = usePlayer.getState()): Song | null =>
  s.items[s.index]?.song ?? null;

export function useCurrentSong(): Song | null {
  return usePlayer((s) => s.items[s.index]?.song ?? null);
}

export const useLocate = create<{ lists: number; request: number }>(() => ({
  lists: 0,
  request: 0,
}));

export const locatePlaying = () =>
  useLocate.setState((s) => ({ request: s.request + 1 }));
