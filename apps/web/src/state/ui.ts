import { create } from "zustand";
import { persist } from "zustand/middleware";

export type RightPanel = "now" | "queue" | "lyrics";
export type LibraryFilter = "playlists" | "albums" | "artists" | "downloaded" | null;
export type LibraryOrigin = "all" | "server" | "spotify" | "youtubeMusic";
export type CollectionView = "compact" | "list" | "dense" | "grid";
export type SortKey = "default" | "added" | "title" | "by" | "year" | "plays";
export type CollectionState = { view?: CollectionView; sort?: SortKey; desc?: boolean };
export type Toast = { id: number; message: string; action?: { label: string; run: () => void } };

type UiState = {
  rightPanel: RightPanel | null;
  fullScreen: boolean;
  nowPlayingOpen: boolean;
  mobileView: "player" | "lyrics" | "queue";
  shortcutsOpen: boolean;
  libraryFilter: LibraryFilter;
  libraryOrigin: LibraryOrigin;
  collections: Record<string, CollectionState>;
  toasts: Toast[];
};

type Persisted = Pick<UiState, "rightPanel" | "libraryFilter" | "libraryOrigin" | "collections">;

export const useUi = create<UiState>()(
  persist(
    (): UiState => ({
      rightPanel: "now",
      fullScreen: false,
      nowPlayingOpen: false,
      mobileView: "player" as const,
      shortcutsOpen: false,
      libraryFilter: null as LibraryFilter,
      libraryOrigin: "all",
      collections: {},
      toasts: [] as Toast[],
    }),
    {
      name: "needle.ui",
      version: 2,
      partialize: (s): Persisted => ({
        rightPanel: s.rightPanel,
        libraryFilter: s.libraryFilter,
        libraryOrigin: s.libraryOrigin,
        collections: s.collections,
      }),
      migrate: (saved, version) => {
        const s = saved as Omit<Persisted, "libraryFilter"> & { libraryFilter: LibraryFilter | "spotify" };
        const spotify = version < 2 && s.libraryFilter === "spotify";
        return {
          ...s,
          libraryFilter: s.libraryFilter === "spotify" ? null : s.libraryFilter,
          libraryOrigin: spotify ? "spotify" : (s.libraryOrigin ?? "all"),
        };
      },
    },
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
