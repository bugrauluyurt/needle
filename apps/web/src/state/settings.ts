import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Quality = "original" | "320" | "192";
export type Normalize = "off" | "track" | "album";
export type Theme = "dark" | "light" | "system";
export type Language = "en" | "tr";

export type Settings = {
  crossfade: number;
  gapless: boolean;
  normalize: Normalize;
  wifiQuality: Quality;
  cellularQuality: Quality;
  downloadQuality: Quality;
  downloadOnCellular: boolean;
  artColor: boolean;
  theme: Theme;
  language: Language;
  autoplay: boolean;
};

type SettingsStore = Settings & {
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
};

export const useSettings = create<SettingsStore>()(
  persist(
    (set) => ({
      crossfade: 6,
      gapless: true,
      normalize: "album",
      wifiQuality: "original",
      cellularQuality: "192",
      downloadQuality: "320",
      downloadOnCellular: false,
      artColor: true,
      theme: "dark",
      language: "en",
      autoplay: true,
      set: (key, value) => set({ [key]: value } as Partial<SettingsStore>),
    }),
    { name: "needle.settings", version: 1 },
  ),
);

export const settings = () => useSettings.getState();
