import { create } from "zustand";
import { persist } from "zustand/middleware";
import { defaultDeviceName, randomId } from "../lib/device.ts";

export type Credentials = { user: string; token: string; salt: string };

type SessionState = {
  credentials: Credentials | null;
  deviceId: string;
  deviceName: string;
  signIn: (c: Credentials) => void;
  signOut: () => void;
  rename: (name: string) => void;
};

export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      credentials: null,
      deviceId: randomId(),
      deviceName: defaultDeviceName(),
      signIn: (credentials) => set({ credentials }),
      signOut: () => set({ credentials: null }),
      rename: (deviceName) => set({ deviceName: deviceName.trim() || defaultDeviceName() }),
    }),
    { name: "needle.session", version: 1 },
  ),
);

export const credentials = () => useSession.getState().credentials;
