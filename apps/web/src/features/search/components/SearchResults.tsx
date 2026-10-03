import { useLayoutEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { Icon } from "../../../components/Icon.tsx";
import { FILTERS, FilterChips, LIBRARY_FILTERS, LibrarySource } from "../../../components/SearchResults.tsx";
import type { Filter, SearchKind } from "../../../components/SearchResults.tsx";
import { useScrollContainer } from "../../../components/ScrollContext.ts";
import { translate } from "../../../i18n/index.ts";
import { useCapabilities, useSearch } from "../../../queries/hooks.ts";
import { useSpotifyOn } from "../../spotify/hooks/useSpotify.ts";
import { useYouTubeMusicOn } from "../../youtube-music/hooks/useYouTubeMusic.ts";
import { GetMusicSearchSource } from "./GetMusicSearchSource.tsx";
import { SpotifySearchSource } from "./SpotifySearchSource.tsx";
import { YouTubeMusicSearchSource } from "./YouTubeMusicSearchSource.tsx";

export function SearchResults({ q }: { q: string }) {
  const [filter, setFilter] = useState<Filter>("All");
  const [params, setParams] = useSearchParams();
  const { isFetching } = useSearch(q);
  const capabilities = useCapabilities().data;
  const albumsOn = Boolean(capabilities?.lidarr);
  const songsOn = Boolean(capabilities?.songs);
  const spotifyOn = useSpotifyOn();
  const youtubeMusicOn = useYouTubeMusicOn();
  const local = filter !== "Get music";
  const requestedSource = params.get("source");
  const requestedCategory = params.get("category");
  const focusedCategory = LIBRARY_FILTERS.find(
    (category): category is SearchKind => category !== "All" && category === requestedCategory,
  );
  const focusedSource =
    focusedCategory &&
    (requestedSource === "library" || requestedSource === "spotify" || requestedSource === "youtubeMusic")
      ? requestedSource
      : null;
  const scrollContainer = useScrollContainer();
  const overviewScrollTop = useRef(0);

  useLayoutEffect(() => {
    scrollContainer?.current?.scrollTo(0, focusedSource ? 0 : overviewScrollTop.current);
  }, [focusedSource, focusedCategory, scrollContainer]);

  const showAll = (source: "library" | "spotify" | "youtubeMusic", searchKind: SearchKind) => {
    overviewScrollTop.current = scrollContainer?.current?.scrollTop ?? 0;

    setParams({ q, source, category: searchKind });
  };
  const back = () => setParams({ q }, { replace: true });

  return (
    <div className={isFetching ? "results fetching" : "results"}>
      {focusedSource && focusedCategory ? (
        <>
          <button
            type="button"
            className="btn ghost sm search-focus-back"
            aria-label={translate("search.backAll")}
            onClick={back}
          >
            <Icon name="back" size={16} />
            {translate("search.allResults")}
          </button>
          {focusedSource === "library" ? (
            <LibrarySource q={q} filter={focusedCategory} setFilter={setFilter} />
          ) : focusedSource === "spotify" ? (
            spotifyOn ? (
              <SpotifySearchSource
                q={q}
                filter={focusedCategory}
                setFilter={setFilter}
                onShowAll={(searchKind) => showAll("spotify", searchKind)}
              />
            ) : (
              <p className="muted source-note">{translate("search.spotifyUnavailable")}</p>
            )
          ) : youtubeMusicOn ? (
            <YouTubeMusicSearchSource
              key={`${q}:${focusedCategory}`}
              q={q}
              filter={focusedCategory}
              setFilter={setFilter}
              onShowAll={(searchKind) => showAll("youtubeMusic", searchKind)}
            />
          ) : (
            <p className="muted source-note">{translate("search.youtubeUnavailable")}</p>
          )}
        </>
      ) : (
        <>
          <FilterChips
            filters={albumsOn || songsOn ? FILTERS : LIBRARY_FILTERS}
            value={filter}
            onChange={setFilter}
            label={translate("search.filterResults")}
          />
          {local ? (
            <LibrarySource
              q={q}
              filter={filter}
              setFilter={setFilter}
              onShowAll={(searchKind) => showAll("library", searchKind)}
            />
          ) : null}
          {local && spotifyOn ? (
            <SpotifySearchSource
              q={q}
              filter={filter}
              setFilter={setFilter}
              onShowAll={(searchKind) => showAll("spotify", searchKind)}
            />
          ) : null}
          {local && youtubeMusicOn ? (
            <YouTubeMusicSearchSource
              key={`${q}:${filter}`}
              q={q}
              filter={filter}
              setFilter={setFilter}
              onShowAll={(searchKind) => showAll("youtubeMusic", searchKind)}
            />
          ) : null}
          {(albumsOn || songsOn) && filter !== "Playlists" && filter !== "Artists" ? (
            <GetMusicSearchSource q={q} filter={filter} albumsOn={albumsOn} songsOn={songsOn} />
          ) : null}
        </>
      )}
    </div>
  );
}
