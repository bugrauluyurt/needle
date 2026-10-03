const LEGACY_RECENT_SEARCHES_KEY = "needle.recentSearches";
const RECENT_SEARCHES_KEY_PREFIX = `${LEGACY_RECENT_SEARCHES_KEY}:`;
const RECENT_SEARCHES_LIMIT = 8;
const EMPTY_RECENT_SEARCHES: readonly string[] = [];

type RecentSearchListener = () => void;

const recentSearchesByAccount = new Map<string, readonly string[]>();
const recentSearchListeners = new Set<RecentSearchListener>();
let legacyRecentSearchesRemoved = false;

function recentSearchesKey(accountUser: string): string {
  return `${RECENT_SEARCHES_KEY_PREFIX}${encodeURIComponent(accountUser)}`;
}

function removeLegacyRecentSearches(): void {
  if (legacyRecentSearchesRemoved) return;

  try {
    localStorage.removeItem(LEGACY_RECENT_SEARCHES_KEY);
    legacyRecentSearchesRemoved = true;
  } catch {
    return;
  }
}

function storedRecentSearches(accountUser: string): readonly string[] {
  try {
    const storedValue: unknown = JSON.parse(localStorage.getItem(recentSearchesKey(accountUser)) ?? "[]");

    if (!Array.isArray(storedValue)) return EMPTY_RECENT_SEARCHES;

    return storedValue
      .filter((recentSearch): recentSearch is string => typeof recentSearch === "string")
      .slice(0, RECENT_SEARCHES_LIMIT);
  } catch {
    return EMPTY_RECENT_SEARCHES;
  }
}

function saveRecentSearches(accountUser: string, recentSearches: readonly string[]): void {
  try {
    localStorage.setItem(recentSearchesKey(accountUser), JSON.stringify(recentSearches));
  } catch {
    return;
  }
}

function replaceRecentSearches(accountUser: string | null, recentSearches: readonly string[]): void {
  if (!accountUser) return;

  recentSearchesByAccount.set(accountUser, recentSearches);
  saveRecentSearches(accountUser, recentSearches);

  for (const recentSearchListener of recentSearchListeners) recentSearchListener();
}

export function recentSearchesForAccount(accountUser: string | null): readonly string[] {
  removeLegacyRecentSearches();

  if (!accountUser) return EMPTY_RECENT_SEARCHES;

  const cachedRecentSearches = recentSearchesByAccount.get(accountUser);

  if (cachedRecentSearches) return cachedRecentSearches;

  const recentSearches = storedRecentSearches(accountUser);
  recentSearchesByAccount.set(accountUser, recentSearches);

  return recentSearches;
}

export function rememberRecentSearch(accountUser: string | null, searchQuery: string): void {
  if (!accountUser) return;

  const recentSearches = recentSearchesForAccount(accountUser);
  const nextRecentSearches = [
    searchQuery,
    ...recentSearches.filter((recentSearch) => recentSearch.toLowerCase() !== searchQuery.toLowerCase()),
  ].slice(0, RECENT_SEARCHES_LIMIT);

  replaceRecentSearches(accountUser, nextRecentSearches);
}

export function removeRecentSearch(accountUser: string | null, searchQuery: string): void {
  if (!accountUser) return;

  const nextRecentSearches = recentSearchesForAccount(accountUser).filter(
    (recentSearch) => recentSearch !== searchQuery,
  );

  replaceRecentSearches(accountUser, nextRecentSearches);
}

export function clearRecentSearches(accountUser: string | null): void {
  replaceRecentSearches(accountUser, EMPTY_RECENT_SEARCHES);
}

export function subscribeToRecentSearches(recentSearchListener: RecentSearchListener): () => void {
  recentSearchListeners.add(recentSearchListener);

  return () => {
    recentSearchListeners.delete(recentSearchListener);
  };
}
