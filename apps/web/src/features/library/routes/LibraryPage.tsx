import { useMemo, useState } from "react";
import { useLocation, useSearchParams } from "react-router";
import type { Song } from "@needle/shared";
import { RowHeader } from "../../../components/Cards.tsx";
import { CollectionBody, CollectionTools } from "../../../components/Collection.tsx";
import { Icon } from "../../../components/Icon.tsx";
import { FilterChips, LIBRARY_FILTERS, LibrarySource } from "../../../components/SearchResults.tsx";
import type { Filter } from "../../../components/SearchResults.tsx";
import { TrackList } from "../../../components/tracks/TrackList.tsx";
import { AS_GIVEN, librarySongSorts, likedSorts, RECENT_FIRST, shownSongs } from "../../../lib/songs.ts";
import type { SongOrder } from "../../../lib/songs.ts";
import { useDebounced } from "../../../lib/useDelayed.ts";
import { useIsMobile } from "../../../lib/media.ts";
import { usePageTone } from "../../../layout/pageTone.ts";
import {
  librarySorts,
  libraryEmptyText,
  useLibraryEntries,
  useLibraryOrigin,
  useLibrarySort,
  useNewPlaylist,
} from "../../../layout/Sidebar.tsx";
import { SearchHeader } from "../../../layout/SearchHeader.tsx";
import { useLibrarySongs } from "../../../queries/hooks.ts";
import { useSpotifyLiked, useSpotifyOn } from "../../../features/spotify/hooks/useSpotify.ts";
import {
  useYouTubeMusicAlbums,
  useYouTubeMusicArtists,
  useYouTubeMusicLiked,
  useYouTubeMusicOn,
  useYouTubeMusicPlaylists,
} from "../../../features/youtube-music/hooks/useYouTubeMusic.ts";
import { useYouTubeMusicStatus } from "../../../features/youtube-music/api/client.ts";
import { YouTubeMusicNotice } from "../../../features/youtube-music/components/YouTubeMusicNotice.tsx";
import type { CollectionOrder } from "../../../components/Collection.tsx";
import type { CollectionView, LibraryFilter, LibraryOrigin } from "../../../state/ui.ts";
import { translate } from "../../../i18n/index.ts";

const KINDS: Partial<Record<Filter, LibraryFilter>> = {
  Albums: "albums",
  Artists: "artists",
  Playlists: "playlists",
};
const context = () => ({
  kind: "search" as const,
  name: translate("library.title"),
});

function useSongs(
  origin: LibraryOrigin,
  query: string,
  order: SongOrder,
  youtubeMusicLimit = 100,
): { songs: Song[]; pending: boolean } {
  const includeLocal = origin === "server" || origin === "all";
  const server = useLibrarySongs(includeLocal);
  const spotify = useSpotifyLiked();
  const spotifyOn = useSpotifyOn();
  const youtubeMusic = useYouTubeMusicLiked(youtubeMusicLimit);
  return useMemo(() => {
    const localSongs = includeLocal ? (server.data ?? []) : [];
    const spotifySongs = spotifyOn && (origin === "spotify" || origin === "all") ? (spotify.data ?? []) : [];
    const youtubeSongs = origin === "youtubeMusic" || origin === "all" ? (youtubeMusic.data ?? []) : [];

    return {
      songs: shownSongs([...localSongs, ...spotifySongs, ...youtubeSongs], order, query),
      pending:
        (includeLocal && server.isPending) ||
        (origin === "spotify" && spotify.isLoading) ||
        (origin === "youtubeMusic" && youtubeMusic.isLoading),
    };
  }, [
    origin,
    includeLocal,
    query,
    order,
    server.data,
    server.isPending,
    spotify.data,
    spotify.isLoading,
    spotifyOn,
    youtubeMusic.data,
    youtubeMusic.isLoading,
  ]);
}

function AllSongs({
  origin,
  order,
  onOrder,
  youtubeMusicLimit,
}: {
  origin: LibraryOrigin;
  order: SongOrder;
  onOrder: (o: SongOrder) => void;
  youtubeMusicLimit: number;
}) {
  const { songs, pending } = useSongs(origin, "", order, youtubeMusicLimit);
  if (pending)
    return (
      <p className="muted source-note">
        <span className="spin" />
        {translate("common.loading")}
      </p>
    );
  if (!songs.length)
    return (
      <p className="muted">
        {translate(
          origin === "spotify"
            ? "library.noLikedSpotify"
            : origin === "youtubeMusic"
              ? "library.noLikedYouTube"
              : "library.noSongs",
        )}
      </p>
    );
  return (
    <TrackList songs={songs} context={context()} art album order={order} onOrder={onOrder} fallback={RECENT_FIRST} />
  );
}

function SpotifyMatches({
  q,
  filter,
  kind,
  order,
  view,
}: {
  q: string;
  filter: Filter;
  kind: LibraryFilter;
  order: CollectionOrder;
  view: CollectionView;
}) {
  const entries = useLibraryEntries(kind, q, order, "spotify");
  const { songs } = useSongs("spotify", q, AS_GIVEN);
  const shownSongs = filter === "All" || filter === "Songs" ? songs : [];
  const shownEntries = filter === "Songs" ? [] : entries;
  if (!shownSongs.length && !shownEntries.length)
    return <p className="muted source-note">{translate("library.noSpotifyMatch", { query: q })}</p>;
  return (
    <section className="res-source bare" aria-label={translate("library.inSpotify")}>
      {shownSongs.length ? (
        <>
          <RowHeader title={translate("library.likedSpotify")} />
          <TrackList
            songs={shownSongs}
            context={{
              kind: "search",
              name: translate("library.spotifyContext", { query: q }),
            }}
            art
            album
          />
        </>
      ) : null}
      {shownEntries.length ? (
        <>
          <RowHeader title={translate("library.savedSpotify")} />
          <CollectionBody items={shownEntries} view={view} empty="" />
        </>
      ) : null}
    </section>
  );
}

function YouTubeMusicMatches({
  q,
  filter,
  kind,
  order,
  view,
  limit,
}: {
  q: string;
  filter: Filter;
  kind: LibraryFilter;
  order: CollectionOrder;
  view: CollectionView;
  limit: number;
}) {
  const entries = useLibraryEntries(kind, q, order, "youtubeMusic", limit);
  const { songs } = useSongs("youtubeMusic", q, AS_GIVEN, limit);
  const matchingSongs = filter === "All" || filter === "Songs" ? songs : [];
  const matchingEntries = filter === "Songs" ? [] : entries;

  if (!matchingSongs.length && !matchingEntries.length)
    return <p className="muted source-note">{translate("library.noYouTubeMatch", { query: q })}</p>;

  return (
    <section className="res-source bare" aria-label={translate("library.title")}>
      {matchingSongs.length ? (
        <>
          <RowHeader title={translate("library.likedYouTube")} />
          <TrackList
            songs={matchingSongs}
            context={{
              kind: "search",
              name: translate("library.youtubeContext", { query: q }),
            }}
            art
            album
          />
        </>
      ) : null}
      {matchingEntries.length ? (
        <>
          <RowHeader title={translate("library.savedYouTube")} />
          <CollectionBody items={matchingEntries} view={view} empty="" />
        </>
      ) : null}
    </section>
  );
}

export default function LibraryPage() {
  const mobile = useIsMobile();
  const [filter, setFilter] = useState<Filter>("All");
  const [songOrder, setSongOrder] = useState<SongOrder>(RECENT_FIRST);
  const [query, setQuery] = useState("");
  const q = useDebounced(query.trim(), 250);
  const [params] = useSearchParams();
  const location = useLocation();
  const find = params.has("find");
  const { origin, show } = useLibraryOrigin();
  const youtubeMusicOn = useYouTubeMusicOn();
  const spotifyOn = useSpotifyOn();
  const [youtubeMusicLimit, setYouTubeMusicLimit] = useState(100);
  const youtubeLiked = useYouTubeMusicLiked(youtubeMusicLimit);
  const youtubeAlbums = useYouTubeMusicAlbums(youtubeMusicLimit);
  const youtubeArtists = useYouTubeMusicArtists(youtubeMusicLimit);
  const youtubePlaylists = useYouTubeMusicPlaylists(youtubeMusicLimit);
  const blocked = useYouTubeMusicStatus((status) => status.blocked);
  const youtubeLibraryPages =
    filter === "Songs"
      ? [youtubeLiked]
      : filter === "Albums"
        ? [youtubeAlbums]
        : filter === "Artists"
          ? [youtubeArtists]
          : filter === "Playlists"
            ? [youtubePlaylists]
            : [youtubeLiked, youtubeAlbums, youtubeArtists, youtubePlaylists];
  const hasMoreYouTubeMusic =
    youtubeMusicOn &&
    (origin === "all" || origin === "youtubeMusic") &&
    youtubeMusicLimit < 3000 &&
    youtubeLibraryPages.some((libraryPage) => libraryPage.hasMore);
  const youtubeMusicError = youtubeLibraryPages.some((libraryPage) => libraryPage.isError);
  const youtubeMusicUnavailable =
    origin === "youtubeMusic" && youtubeMusicError && youtubeLibraryPages.every((libraryPage) => !libraryPage.data);
  const visibleSongOrder =
    origin !== "server" && !likedSorts().some(([songSort]) => songSort === songOrder.key) ? RECENT_FIRST : songOrder;
  const kind = KINDS[filter] ?? null;
  const { order, setOrder, view, setView } = useLibrarySort(mobile ? "list" : "grid");
  const entries = useLibraryEntries(kind, "", order, origin, youtubeMusicLimit);
  const newPlaylist = useNewPlaylist();
  usePageTone(null);
  const create = (
    <button
      type="button"
      className="icon-btn light"
      aria-label={translate("library.createPlaylist")}
      onClick={newPlaylist}
    >
      <Icon name="plus" size={24} />
    </button>
  );
  const tools = q ? (
    <CollectionTools sorts={[]} show={show} />
  ) : filter === "Songs" ? (
    <CollectionTools
      sorts={origin === "server" ? librarySongSorts() : likedSorts()}
      order={visibleSongOrder}
      onOrder={setSongOrder}
      show={show}
    />
  ) : (
    <CollectionTools sorts={librarySorts()} order={order} onOrder={setOrder} view={view} onView={setView} show={show} />
  );
  const body = youtubeMusicUnavailable ? null : q ? (
    <>
      {origin === "server" || origin === "all" ? (
        <LibrarySource q={q} filter={filter} setFilter={setFilter} heading={false} />
      ) : null}
      {spotifyOn && (origin === "all" || origin === "spotify") ? (
        <SpotifyMatches q={q} filter={filter} kind={kind} order={order} view={view} />
      ) : null}
      {youtubeMusicOn && (origin === "all" || origin === "youtubeMusic") ? (
        <YouTubeMusicMatches q={q} filter={filter} kind={kind} order={order} view={view} limit={youtubeMusicLimit} />
      ) : null}
    </>
  ) : filter === "Songs" ? (
    <AllSongs origin={origin} order={visibleSongOrder} onOrder={setSongOrder} youtubeMusicLimit={youtubeMusicLimit} />
  ) : (
    <CollectionBody items={entries} view={view} empty={libraryEmptyText(kind, "")} />
  );
  return (
    <>
      <SearchHeader
        key={find ? location.key : "library"}
        autoFocus={find}
        title={translate("library.title")}
        label={translate("library.search")}
        placeholder={translate("library.search")}
        value={query}
        onChange={setQuery}
        actions={create}
      />
      <div className="pad library-page">
        {!mobile ? (
          <div className="library-head">
            <h1 className="hello">{translate("library.title")}</h1>
            {create}
          </div>
        ) : null}
        <FilterChips
          filters={LIBRARY_FILTERS}
          value={filter}
          onChange={setFilter}
          label={translate("library.filter")}
        />
        <div className="lib-tools">{tools}</div>
        {youtubeMusicOn && origin !== "server" && origin !== "spotify" ? (
          <YouTubeMusicNotice
            error={youtubeMusicError}
            retry={() => {
              for (const libraryPage of youtubeLibraryPages) void libraryPage.refetch();
            }}
          />
        ) : null}
        {body}
        {hasMoreYouTubeMusic ? (
          <div className="search-pagination">
            <button
              type="button"
              className="btn ghost sm"
              disabled={blocked || youtubeLibraryPages.some((libraryPage) => libraryPage.isFetching)}
              onClick={() => setYouTubeMusicLimit(Math.min(youtubeMusicLimit + 100, 3000))}
            >
              {translate("library.loadYouTube")}
            </button>
          </div>
        ) : null}
      </div>
    </>
  );
}
