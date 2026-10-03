import { useEffect, useState } from "react";
import { useIsFetching } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { translate } from "../../../i18n/index.ts";
import { SearchHeader } from "../../../layout/SearchHeader.tsx";
import { usePageTone } from "../../../layout/pageTone.ts";
import { SearchBrowse } from "../components/SearchBrowse.tsx";
import { SearchResults } from "../components/SearchResults.tsx";
import { useRecentSearches } from "../hooks/useRecentSearches.ts";

export default function Search() {
  const [params, setParams] = useSearchParams();
  const urlQuery = params.get("q") ?? "";
  const [text, setText] = useState(urlQuery);
  const { clearSearches, recentSearches, rememberSearch, removeSearch } = useRecentSearches();

  usePageTone(null);

  useEffect(() => {
    const searchTimer = window.setTimeout(() => {
      if (text.trim() === urlQuery) return;

      setParams(text.trim() ? { q: text.trim() } : {}, { replace: true });
    }, 220);

    return () => window.clearTimeout(searchTimer);
  }, [text, urlQuery, setParams]);

  const query = urlQuery.trim();
  const busy =
    useIsFetching({
      predicate: (searchQuery) => searchQuery.queryKey.includes("search"),
    }) > 0 && Boolean(text.trim());

  return (
    <>
      <SearchHeader
        title={translate("navigation.search")}
        label={translate("navigation.search")}
        placeholder={translate("search.placeholder")}
        value={text}
        onChange={setText}
        onCommit={() => text.trim() && rememberSearch(text.trim())}
        busy={busy}
        autoFocus
      />
      <div className="pad">
        {query ? (
          <SearchResults q={query} />
        ) : (
          <SearchBrowse
            recent={recentSearches}
            onPick={(recentSearch) => setText(recentSearch)}
            onRemove={removeSearch}
            onClear={clearSearches}
          />
        )}
      </div>
    </>
  );
}
