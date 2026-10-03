import { useState } from "react";

const RECENT_SEARCHES_KEY = "needle.recentSearches";
const RECENT_SEARCHES_LIMIT = 8;

function loadRecentSearches(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

function saveRecentSearches(recentSearches: string[]) {
  try {
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(recentSearches.slice(0, RECENT_SEARCHES_LIMIT)));
  } catch {
    return;
  }
}

export function useRecentSearches() {
  const [recentSearches, setRecentSearches] = useState(loadRecentSearches);

  const rememberSearch = (searchQuery: string) => {
    const nextRecentSearches = [
      searchQuery,
      ...recentSearches.filter((recentSearch) => recentSearch.toLowerCase() !== searchQuery.toLowerCase()),
    ].slice(0, RECENT_SEARCHES_LIMIT);

    setRecentSearches(nextRecentSearches);
    saveRecentSearches(nextRecentSearches);
  };

  const removeSearch = (searchQuery: string) => {
    const nextRecentSearches = recentSearches.filter((recentSearch) => recentSearch !== searchQuery);

    setRecentSearches(nextRecentSearches);
    saveRecentSearches(nextRecentSearches);
  };

  const clearSearches = () => {
    setRecentSearches([]);
    saveRecentSearches([]);
  };

  return {
    clearSearches,
    recentSearches,
    rememberSearch,
    removeSearch,
  };
}
