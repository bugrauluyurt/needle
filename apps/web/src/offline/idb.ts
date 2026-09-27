const DB = "needle-offline";
const VERSION = 1;

export type StoreName = "songs" | "collections";

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("songs")) db.createObjectStore("songs", { keyPath: "id" });
      if (!db.objectStoreNames.contains("collections")) db.createObjectStore("collections", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB unavailable"));
  });
  return dbPromise;
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

export async function idbGet<T>(store: StoreName, key: string): Promise<T | undefined> {
  const db = await open();
  return wrap(db.transaction(store).objectStore(store).get(key) as IDBRequest<T | undefined>);
}

export async function idbAll<T>(store: StoreName): Promise<T[]> {
  const db = await open();
  return wrap(db.transaction(store).objectStore(store).getAll() as IDBRequest<T[]>);
}

export async function idbPut<T>(store: StoreName, value: T): Promise<void> {
  const db = await open();
  await wrap(db.transaction(store, "readwrite").objectStore(store).put(value));
}

export async function idbDelete(store: StoreName, key: string): Promise<void> {
  const db = await open();
  await wrap(db.transaction(store, "readwrite").objectStore(store).delete(key));
}
