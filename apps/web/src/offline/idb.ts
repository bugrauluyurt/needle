const LEGACY_DATABASE = "needle-offline";
const DATABASE_PREFIX = "needle-offline:";
const VERSION = 1;

export type StoreName = "songs" | "collections";

const databasePromises = new Map<string, Promise<IDBDatabase>>();

export function offlineDatabaseName(accountUser: string): string {
  return `${DATABASE_PREFIX}${encodeURIComponent(accountUser)}`;
}

function open(accountUser: string): Promise<IDBDatabase> {
  const databaseName = offlineDatabaseName(accountUser);
  const existingDatabase = databasePromises.get(databaseName);
  if (existingDatabase) return existingDatabase;

  const databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(databaseName, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("songs")) db.createObjectStore("songs", { keyPath: "id" });
      if (!db.objectStoreNames.contains("collections")) db.createObjectStore("collections", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB unavailable"));
  });

  databasePromises.set(databaseName, databasePromise);

  return databasePromise;
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

export async function idbGet<T>(accountUser: string, store: StoreName, key: string): Promise<T | undefined> {
  const db = await open(accountUser);
  return wrap(db.transaction(store).objectStore(store).get(key) as IDBRequest<T | undefined>);
}

export async function idbAll<T>(accountUser: string, store: StoreName): Promise<T[]> {
  const db = await open(accountUser);
  return wrap(db.transaction(store).objectStore(store).getAll() as IDBRequest<T[]>);
}

export async function idbPut<T>(accountUser: string, store: StoreName, value: T): Promise<void> {
  const db = await open(accountUser);
  await wrap(db.transaction(store, "readwrite").objectStore(store).put(value));
}

export async function idbDelete(accountUser: string, store: StoreName, key: string): Promise<void> {
  const db = await open(accountUser);
  await wrap(db.transaction(store, "readwrite").objectStore(store).delete(key));
}

export async function removeLegacyOfflineDatabase(): Promise<void> {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(LEGACY_DATABASE);

    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}
