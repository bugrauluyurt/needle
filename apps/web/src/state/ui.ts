import { create } from "zustand";
import { persist } from "zustand/middleware";

export type RightPanel = "now" | "queue" | "lyrics";
export type LibraryFilter = "playlists" | "albums" | "artists" | "downloaded" | null;
export type Toast = { id: number; message: string; action?: { label: string; run: () => void } };

type UiState = {
  rightPanel: RightPanel | null;
  fullScreen: boolean;
  nowPlayingOpen: boolean;
  mobileView: "player" | "lyrics" | "queue";
  shortcutsOpen: boolean;
  devicesOpen: boolean;
  libraryFilter: LibraryFilter;
  toasts: Toast[];
};

export const useUi = create<UiState>()(
  persist(
    (): UiState => ({
      rightPanel: "now",
      fullScreen: false,
      nowPlayingOpen: false,
      mobileView: "player" as const,
      shortcutsOpen: false,
      devicesOpen: false,
      libraryFilter: null as LibraryFilter,
      toasts: [] as Toast[],
    }),
    { name: "needle.ui", version: 1, partialize: (s) => ({ rightPanel: s.rightPanel, libraryFilter: s.libraryFilter }) },
  ),
);

let toastId = 0;

export function toast(message: string, action?: Toast["action"]) {
  const id = ++toastId;
  useUi.setState((s) => ({ toasts: [...s.toasts.slice(-2), { id, message, ...(action ? { action } : {}) }] }));
  window.setTimeout(() => useUi.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 4500);
}

export function setFullScreen(on: boolean) {
  useUi.setState({ fullScreen: on });
  if (on) void document.documentElement.requestFullscreen?.().catch(() => undefined);
  else if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
}

export function toggleRightPanel(panel: RightPanel) {
  useUi.setState((s) => ({ rightPanel: s.rightPanel === panel ? null : panel }));
}
