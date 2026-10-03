import { useCallback, useSyncExternalStore } from "react";
import { useSession } from "../../../state/session.ts";
import {
  clearRecentSearches,
  recentSearchesForAccount,
  rememberRecentSearch,
  removeRecentSearch,
  subscribeToRecentSearches,
} from "../services/recentSearches.ts";

export function useRecentSearches() {
  const accountUser = useSession((sessionState) => sessionState.credentials?.user ?? null);
  const recentSearchesSnapshot = useCallback(() => recentSearchesForAccount(accountUser), [accountUser]);
  const recentSearches = useSyncExternalStore(
    subscribeToRecentSearches,
    recentSearchesSnapshot,
    recentSearchesSnapshot,
  );

  const rememberSearch = (searchQuery: string) => {
    rememberRecentSearch(accountUser, searchQuery);
  };

  const removeSearch = (searchQuery: string) => {
    removeRecentSearch(accountUser, searchQuery);
  };

  const clearSearches = () => {
    clearRecentSearches(accountUser);
  };

  return {
    clearSearches,
    recentSearches,
    rememberSearch,
    removeSearch,
  };
}
