import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { PersistStorage, StorageValue } from "zustand/middleware";
import { defaultDeviceName, randomId } from "../lib/device.ts";
import { resetAccountState } from "./accountLifecycle.ts";

export type Credentials = { user: string; token: string; salt: string };

type SessionState = {
  credentials: Credentials | null;
  deviceId: string;
  deviceName: string;
  signIn: (c: Credentials) => void;
  signOut: () => void;
  rename: (name: string) => void;
};

type StoredDeviceIdentity = Pick<SessionState, "deviceId" | "deviceName">;
type StoredSession = Pick<SessionState, "credentials">;

const DEVICE_STORAGE_KEY = "needle.device";
const SESSION_STORAGE_KEY = "needle.session";

function parsedRecord(storageValue: string | null): Record<string, unknown> | null {
  if (!storageValue) return null;

  try {
    const parsedValue: unknown = JSON.parse(storageValue);

    return typeof parsedValue === "object" && parsedValue !== null ? (parsedValue as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function storedState(storageValue: string | null): Record<string, unknown> | null {
  const storedRecord = parsedRecord(storageValue);
  const state = storedRecord?.state;

  return typeof state === "object" && state !== null ? (state as Record<string, unknown>) : storedRecord;
}

function deviceIdentity(storageValue: string | null): StoredDeviceIdentity | null {
  const state = storedState(storageValue);
  const deviceId = state?.deviceId;
  const deviceName = state?.deviceName;

  return typeof deviceId === "string" && typeof deviceName === "string" ? { deviceId, deviceName } : null;
}

function sessionCredentials(storageValue: string | null): Credentials | null {
  const storedCredentials = storedState(storageValue)?.credentials;

  if (typeof storedCredentials !== "object" || storedCredentials === null) return null;

  const credentialRecord = storedCredentials as Record<string, unknown>;

  return typeof credentialRecord.user === "string" &&
    typeof credentialRecord.token === "string" &&
    typeof credentialRecord.salt === "string"
    ? { user: credentialRecord.user, token: credentialRecord.token, salt: credentialRecord.salt }
    : null;
}

function localStorageValue(storageKey: string): string | null {
  try {
    return localStorage.getItem(storageKey);
  } catch {
    return null;
  }
}

function sessionStorageValue(storageKey: string): string | null {
  try {
    return sessionStorage.getItem(storageKey);
  } catch {
    return null;
  }
}

function writeLocalStorage(storageKey: string, storageValue: string): boolean {
  try {
    localStorage.setItem(storageKey, storageValue);

    return true;
  } catch {
    return false;
  }
}

function writeSessionStorage(storageKey: string, storageValue: string): void {
  try {
    sessionStorage.setItem(storageKey, storageValue);
  } catch {
    return;
  }
}

function removeLocalStorage(storageKey: string): void {
  try {
    localStorage.removeItem(storageKey);
  } catch {
    return;
  }
}

function removeSessionStorage(storageKey: string): void {
  try {
    sessionStorage.removeItem(storageKey);
  } catch {
    return;
  }
}

function persistCredentials(credentials: Credentials | null): void {
  const sessionState: StoredSession = { credentials };
  const storedSession = JSON.stringify({ state: sessionState, version: 2 });

  if (writeLocalStorage(SESSION_STORAGE_KEY, storedSession)) {
    removeSessionStorage(SESSION_STORAGE_KEY);
  } else {
    removeLocalStorage(SESSION_STORAGE_KEY);
    writeSessionStorage(SESSION_STORAGE_KEY, storedSession);
  }
}

const browserSessionStorage: PersistStorage<SessionState> = {
  getItem: () => {
    const storedSession = localStorageValue(SESSION_STORAGE_KEY);
    const storedTabSession = sessionStorageValue(SESSION_STORAGE_KEY);
    const storedIdentity = deviceIdentity(localStorageValue(DEVICE_STORAGE_KEY));
    const legacyIdentity = deviceIdentity(storedSession);
    const identity = storedIdentity ?? legacyIdentity;
    const credentials = sessionCredentials(storedSession ?? storedTabSession);

    if (storedSession !== null) {
      removeSessionStorage(SESSION_STORAGE_KEY);
    } else if (storedTabSession !== null) {
      persistCredentials(credentials);
    }

    if (identity && !storedIdentity) {
      writeLocalStorage(DEVICE_STORAGE_KEY, JSON.stringify({ state: identity, version: 1 }));
    }

    if (!identity && !credentials) return null;

    return {
      state: {
        credentials,
        deviceId: identity?.deviceId ?? randomId(),
        deviceName: identity?.deviceName ?? defaultDeviceName(),
      },
      version: 2,
    } as StorageValue<SessionState>;
  },
  setItem: (_storageKey, storedSession) => {
    const { deviceId, deviceName } = storedSession.state;
    const identityState: StoredDeviceIdentity = { deviceId, deviceName };

    writeLocalStorage(DEVICE_STORAGE_KEY, JSON.stringify({ state: identityState, version: 1 }));
  },
  removeItem: () => {
    removeLocalStorage(SESSION_STORAGE_KEY);
    removeSessionStorage(SESSION_STORAGE_KEY);
  },
};

export const useSession = create<SessionState>()(
  persist(
    (set, get) => ({
      credentials: null,
      deviceId: randomId(),
      deviceName: defaultDeviceName(),
      signIn: (credentials) => {
        if (get().credentials?.user !== credentials.user) resetAccountState();

        persistCredentials(credentials);

        set({ credentials });
      },
      signOut: () => {
        if (get().credentials) resetAccountState();

        persistCredentials(null);

        set({ credentials: null });
      },
      rename: (deviceName) => set({ deviceName: deviceName.trim() || defaultDeviceName() }),
    }),
    { name: SESSION_STORAGE_KEY, version: 2, storage: browserSessionStorage },
  ),
);

export const credentials = () => useSession.getState().credentials;
