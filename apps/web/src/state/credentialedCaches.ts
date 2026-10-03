const COVER_CACHE = "covers";

let requestedClearGeneration = 0;
let completedClearGeneration = 0;
let activeClear: Promise<void> | null = null;

async function clearRequestedCoverCaches(): Promise<void> {
  while (completedClearGeneration < requestedClearGeneration) {
    const clearGeneration = requestedClearGeneration;

    if (typeof caches !== "undefined") {
      await caches.delete(COVER_CACHE).catch(() => false);
    }

    completedClearGeneration = clearGeneration;
  }
}

export function clearCredentialedCoverCache(): void {
  requestedClearGeneration++;
  startCoverCacheClear();
}

function startCoverCacheClear(): void {
  if (activeClear) return;

  const clearPromise = clearRequestedCoverCaches();
  activeClear = clearPromise;
  void clearPromise.then(() => {
    if (activeClear !== clearPromise) return;

    activeClear = null;
    if (completedClearGeneration < requestedClearGeneration) startCoverCacheClear();
  });
}

export function credentialedCoverCacheCleared(): Promise<void> {
  return activeClear ?? Promise.resolve();
}
