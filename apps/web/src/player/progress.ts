import { useSyncExternalStore } from "react";

export type Progress = { position: number; duration: number; buffered: number };

let state: Progress = { position: 0, duration: 0, buffered: 0 };
const listeners = new Set<() => void>();

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

const getState = () => state;

export const progress = {
  get: getState,
  subscribe,
  set(next: Partial<Progress>) {
    const merged = { ...state, ...next };
    if (
      merged.position === state.position &&
      merged.duration === state.duration &&
      merged.buffered === state.buffered
    )
      return;
    state = merged;
    for (const l of listeners) l();
  },
};

export function useProgress<T>(select: (p: Progress) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => select(getState()),
    () => select(getState()),
  );
}
