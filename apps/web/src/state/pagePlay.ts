import { useEffect, useRef } from "react";
import { create } from "zustand";

export type PagePlay = { contextId: string; onPlay: () => void; label: string };

export const usePagePlay = create<{ entry: PagePlay | null }>(() => ({ entry: null }));

export function showPagePlay(entry: PagePlay): () => void {
  usePagePlay.setState({ entry });
  return () => {
    if (usePagePlay.getState().entry === entry) usePagePlay.setState({ entry: null });
  };
}

export function useShowPagePlay({ contextId, onPlay, label }: PagePlay) {
  const latest = useRef(onPlay);
  useEffect(() => {
    latest.current = onPlay;
  });
  useEffect(() => showPagePlay({ contextId, label, onPlay: () => latest.current() }), [contextId, label]);
}
