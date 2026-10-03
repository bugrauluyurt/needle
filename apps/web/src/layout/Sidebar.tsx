import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router";
import { translate } from "../i18n/index.ts";
import type { TranslationKey } from "../i18n/locales/en.ts";
import { Art, LikedArt } from "../components/Art.tsx";
import { Icon, Logo } from "../components/Icon.tsx";
import {
  CollectionTools,
  ItemList,
  sortItems,
  useCollectionView,
} from "../components/Collection.tsx";
import type {
  CollectionItem,
  CollectionOrder,
  ShowFilter,
  SortOption,
} from "../components/Collection.tsx";
import type { IconName } from "../components/Icon.tsx";
import { useOffline } from "../offline/store.ts";
import {
  useAllAlbums,
  useArtists,
  useCreatePlaylist,
  usePlaylists,
  useStarred,
} from "../queries/hooks.ts";
import {
  useSpotifyAlbums,
  useSpotifyFollowed,
  useSpotifyLiked,
  useSpotifyOn,
  useSpotifyPlaylists,
} from "../features/spotify/hooks/useSpotify.ts";
import {
  useYouTubeMusicAlbums,
  useYouTubeMusicArtists,
  useYouTubeMusicLiked,
  useYouTubeMusicOn,
  useYouTubeMusicPlaylists,
} from "../features/youtube-music/hooks/useYouTubeMusic.ts";
import {
  youtubeMusicAlbumItem,
  youtubeMusicArtistItem,
  youtubeMusicPlaylistItem,
} from "../features/youtube-music/components/YouTubeMusicCards.tsx";
import { matchesTerms, queryTerms } from "@needle/shared";
import { spId } from "../features/spotify/api/client.ts";
import { plural } from "../lib/format.ts";
import type {
  CollectionView,
  LibraryFilter,
  LibraryOrigin,
} from "../state/ui.ts";
import { useUi } from "../state/ui.ts";

export type LibraryEntry = CollectionItem & {
  kind: Exclude<LibraryFilter, null | "downloaded">;
  spotify?: boolean;
  contextId: string;
  downloaded: boolean;
  added: string;
};

const originOptions = (): [LibraryOrigin, string][] => [
  ["all", translate("library.originAll")],
  ["server", translate("library.originMusic")],
  ["spotify", "Spotify"],
  ["youtubeMusic", "YouTube Music"],
];

export const librarySorts = (): SortOption[] => [
  ["default", translate("library.recents")],
  ["title", translate("library.alphabetical")],
  ["by", translate("library.creator")],
];

export const useLibrarySort = (fallback: CollectionView = "list") =>
  useCollectionView("library", librarySorts(), fallback);

export function useLibraryOrigin(): {
  origin: LibraryOrigin;
  show: ShowFilter<LibraryOrigin> | undefined;
} {
  const picked = useUi((s) => s.libraryOrigin);
  const spotifyOn = useSpotifyOn();
  const youtubeMusicOn = useYouTubeMusicOn();

  if (!spotifyOn && !youtubeMusicOn)
    return { origin: "server", show: undefined };

  const options = originOptions().filter(
    ([origin]) =>
      (origin !== "spotify" && origin !== "youtubeMusic") ||
      (origin === "spotify" && spotifyOn) ||
      (origin === "youtubeMusic" && youtubeMusicOn),
  );
  const origin = options.some(([availableOrigin]) => availableOrigin === picked)
    ? picked
    : "all";

  return {
    origin,
    show: {
      value: origin,
      options,
      onChange: (nextOrigin) => useUi.setState({ libraryOrigin: nextOrigin }),
    },
  };
}

export function useLibraryEntries(
  filter: LibraryFilter,
  query: string,
  order: CollectionOrder,
  origin: LibraryOrigin,
  youtubeMusicLimit = 100,
): LibraryEntry[] {
  const { data: playlists = [] } = usePlaylists();
  const { data: starred } = useStarred();
  const { data: albums = [] } = useAllAlbums();
  const { data: artists = [] } = useArtists();
  const collections = useOffline((s) => s.collections);
  const { data: spLiked } = useSpotifyLiked();
  const { data: spPlaylists = [] } = useSpotifyPlaylists();
  const { data: spAlbums = [] } = useSpotifyAlbums();
  const { data: spArtists = [] } = useSpotifyFollowed();
  const spotifyOn = useSpotifyOn();
  const { data: youtubeLiked } = useYouTubeMusicLiked(youtubeMusicLimit);
  const { data: youtubePlaylists = [] } =
    useYouTubeMusicPlaylists(youtubeMusicLimit);
  const { data: youtubeAlbums = [] } = useYouTubeMusicAlbums(youtubeMusicLimit);
  const { data: youtubeArtists = [] } =
    useYouTubeMusicArtists(youtubeMusicLimit);
  return useMemo(() => {
    const down = new Set(collections.map((c) => c.id));
    const entries: LibraryEntry[] = [
      {
        key: "liked",
        to: "/liked",
        art: () => <LikedArt />,
        title: translate("library.likedSongs"),
        subtitle: translate("library.entrySummary", {
          kind: translate("playlist.kind"),
          count: plural(starred?.song?.length ?? 0, "song"),
        }),
        kind: "playlists",
        contextId: "liked",
        downloaded: down.has("liked"),
        added: "9999",
        pinned: true,
      },
      ...(starred?.artist?.length
        ? [
            {
              key: "liked-artists",
              to: "/artists/liked",
              art: () => <LikedArt className="artists" />,
              title: translate("library.likedArtists"),
              subtitle: translate("library.entrySummary", {
                kind: translate("library.artists"),
                count: plural(starred.artist.length, "artist"),
              }),
              kind: "artists",
              contextId: "liked-artists",
              downloaded: false,
              added: "9996",
              pinned: true,
            } satisfies LibraryEntry,
          ]
        : []),
      ...(starred?.album?.length
        ? [
            {
              key: "liked-albums",
              to: "/albums/starred",
              art: () => <LikedArt className="albums" />,
              title: translate("albumGrid.liked"),
              subtitle: translate("library.entrySummary", {
                kind: translate("library.albums"),
                count: plural(starred.album.length, "album"),
              }),
              kind: "albums",
              contextId: "liked-albums",
              downloaded: false,
              added: "9997",
              pinned: true,
            } satisfies LibraryEntry,
          ]
        : []),
      ...(spLiked
        ? [
            {
              key: "sp-liked",
              to: "/spotify/liked",
              art: () => <LikedArt className="sp-liked" />,
              title: translate("spotify.liked"),
              subtitle: translate("library.entrySummary", {
                kind: "Spotify",
                count: plural(spLiked.length, "song"),
              }),
              kind: "playlists",
              spotify: true,
              source: "spotify",
              contextId: "sp:liked",
              downloaded: false,
              added: "9998",
              pinned: true,
            } satisfies LibraryEntry,
          ]
        : []),
      ...playlists.map((p): LibraryEntry => ({
        key: `pl-${p.id}`,
        to: `/playlist/${p.id}`,
        art: (px) => <Art id={p.coverArt} version={p.changed} px={px} />,
        title: p.name,
        subtitle: p.owner
          ? translate("search.playlistOwner", { owner: p.owner })
          : translate("playlist.kind"),
        by: p.owner ?? "",
        kind: "playlists",
        contextId: p.id,
        downloaded: down.has(p.id),
        added: p.changed ?? p.created ?? "",
      })),
      ...albums.map((a): LibraryEntry => ({
        key: `al-${a.id}`,
        to: `/album/${a.id}`,
        art: (px) => <Art id={a.coverArt} px={px} />,
        title: a.name,
        subtitle: translate("catalog.albumArtist", {
          artist: a.displayArtist ?? a.artist ?? "",
        }),
        by: a.displayArtist ?? a.artist ?? "",
        kind: "albums",
        contextId: a.id,
        downloaded: down.has(a.id),
        added: a.created ?? "",
      })),
      ...artists.map((a): LibraryEntry => ({
        key: `ar-${a.id}`,
        to: `/artist/${a.id}`,
        art: (px) => <Art id={a.coverArt} px={px} round fallback="artist" />,
        title: a.name,
        subtitle: translate("catalog.artist"),
        by: a.name,
        kind: "artists",
        contextId: a.id,
        downloaded: false,
        added: "",
      })),
      ...spPlaylists.map((p): LibraryEntry => ({
        key: `sp-pl-${p.id}`,
        to: `/spotify/playlist/${p.id}`,
        art: (px) => <Art images={p.images} px={px} />,
        title: p.name,
        subtitle: translate("library.itemBy", {
          kind: translate("spotify.playlist"),
          by: p.owner.display_name ?? p.owner.id,
        }),
        by: p.owner.display_name ?? p.owner.id,
        kind: "playlists",
        spotify: true,
        source: "spotify",
        contextId: spId(p.id),
        downloaded: false,
        added: "",
      })),
      ...spAlbums.map((a): LibraryEntry => ({
        key: `sp-al-${a.id}`,
        to: `/spotify/album/${a.id}`,
        art: (px) => <Art images={a.images} px={px} />,
        title: a.name,
        subtitle: translate("library.itemBy", {
          kind: translate("spotify.albumKind", {
            kind: translate("catalog.album"),
          }),
          by: a.artists?.map((artist) => artist.name).join(", ") ?? "",
        }),
        by: a.artists?.[0]?.name ?? "",
        kind: "albums",
        spotify: true,
        source: "spotify",
        contextId: spId(a.id),
        downloaded: false,
        added: a.added_at ?? "",
      })),
      ...spArtists.map((a): LibraryEntry => ({
        key: `sp-ar-${a.id}`,
        to: `/spotify/artist/${a.id}`,
        art: (px) => <Art images={a.images} px={px} round fallback="artist" />,
        title: a.name,
        subtitle: translate("spotify.followedArtist"),
        by: a.name,
        kind: "artists",
        spotify: true,
        source: "spotify",
        contextId: spId(a.id),
        downloaded: false,
        added: "",
      })),
      ...(youtubeLiked
        ? [
            {
              key: "ytm-liked",
              to: "/youtube-music/liked",
              art: () => <LikedArt className="yt-liked" />,
              title: translate("youtube.liked"),
              subtitle: translate("library.entrySummary", {
                kind: "YouTube Music",
                count: plural(youtubeLiked.length, "song"),
              }),
              kind: "playlists",
              source: "youtubeMusic",
              contextId: "ytm:liked",
              downloaded: false,
              added: "9998",
              pinned: true,
            } satisfies LibraryEntry,
          ]
        : []),
      ...youtubePlaylists.map((playlist): LibraryEntry => ({
        ...youtubeMusicPlaylistItem(playlist),
        kind: "playlists",
        contextId: playlist.id,
        downloaded: false,
        added: "",
      })),
      ...youtubeAlbums.map((album): LibraryEntry => ({
        ...youtubeMusicAlbumItem(album),
        kind: "albums",
        contextId: album.id,
        downloaded: false,
        added: "",
      })),
      ...youtubeArtists.map((artist): LibraryEntry => ({
        ...youtubeMusicArtistItem(artist),
        kind: "artists",
        contextId: artist.id,
        downloaded: false,
        added: "",
      })),
    ];
    const terms = queryTerms(query);
    const matches = (e: LibraryEntry) => {
      if (e.spotify && !spotifyOn) return false;
      if (
        origin !== "all" &&
        (origin === "server" ? "library" : origin) !== (e.source ?? "library")
      )
        return false;
      if (filter === "downloaded") return e.downloaded;
      return !filter || e.kind === filter;
    };
    const rank = (e: LibraryEntry) =>
      e.pinned
        ? 0
        : e.source === "spotify" || e.source === "youtubeMusic"
          ? 2
          : 1;
    const shown = entries
      .filter(matches)
      .filter((e) => matchesTerms(terms, e.title, e.subtitle))
      .sort((a, b) => rank(a) - rank(b) || b.added.localeCompare(a.added));
    return sortItems(shown, order);
  }, [
    playlists,
    starred,
    albums,
    artists,
    collections,
    spLiked,
    spPlaylists,
    spAlbums,
    spArtists,
    youtubeLiked,
    youtubePlaylists,
    youtubeAlbums,
    youtubeArtists,
    spotifyOn,
    filter,
    query,
    order,
    origin,
  ]);
}

const FILTERS: [Exclude<LibraryFilter, null>, TranslationKey][] = [
  ["playlists", "library.playlists"],
  ["albums", "library.albums"],
  ["artists", "library.artists"],
  ["downloaded", "library.onDevice"],
];

export function LibraryChips() {
  const libraryFilter = useUi((uiState) => uiState.libraryFilter);
  const libraryFilterScroller = useRef<HTMLDivElement>(null);
  const previousLibraryFiltersButton = useRef<HTMLButtonElement>(null);
  const moreLibraryFiltersButton = useRef<HTMLButtonElement>(null);
  const pendingLibraryFilterFocus = useRef<"previous" | "more" | null>(null);
  const [canShowPreviousLibraryFilters, setCanShowPreviousLibraryFilters] =
    useState(false);
  const [canShowMoreLibraryFilters, setCanShowMoreLibraryFilters] =
    useState(false);
  const updateLibraryFilterScrollControls = useCallback(() => {
    const libraryFilterScrollerElement = libraryFilterScroller.current;

    if (!libraryFilterScrollerElement) return;

    const hasPreviousLibraryFilters =
      libraryFilterScrollerElement.scrollLeft > 1;
    const hasMoreLibraryFilters =
      libraryFilterScrollerElement.scrollLeft +
        libraryFilterScrollerElement.clientWidth <
      libraryFilterScrollerElement.scrollWidth - 1;

    setCanShowPreviousLibraryFilters(hasPreviousLibraryFilters);
    setCanShowMoreLibraryFilters(hasMoreLibraryFilters);
  }, []);

  useLayoutEffect(() => {
    const libraryFilterScrollerElement = libraryFilterScroller.current;

    if (!libraryFilterScrollerElement || libraryFilter) return;

    updateLibraryFilterScrollControls();

    const libraryFilterResizeObserver = new ResizeObserver(
      updateLibraryFilterScrollControls,
    );

    libraryFilterResizeObserver.observe(libraryFilterScrollerElement);

    return () => libraryFilterResizeObserver.disconnect();
  }, [libraryFilter, updateLibraryFilterScrollControls]);

  useLayoutEffect(() => {
    if (
      pendingLibraryFilterFocus.current === "previous" &&
      canShowPreviousLibraryFilters
    ) {
      previousLibraryFiltersButton.current?.focus();
      pendingLibraryFilterFocus.current = null;
    }

    if (
      pendingLibraryFilterFocus.current === "more" &&
      canShowMoreLibraryFilters
    ) {
      moreLibraryFiltersButton.current?.focus();
      pendingLibraryFilterFocus.current = null;
    }
  }, [canShowMoreLibraryFilters, canShowPreviousLibraryFilters]);

  const scrollLibraryFilters = (libraryFilterScrollDirection: -1 | 1) => {
    const libraryFilterScrollerElement = libraryFilterScroller.current;

    if (!libraryFilterScrollerElement) return;

    pendingLibraryFilterFocus.current =
      libraryFilterScrollDirection < 0 ? "more" : "previous";
    libraryFilterScrollerElement.scrollBy({
      left:
        libraryFilterScrollDirection * libraryFilterScrollerElement.clientWidth,
      behavior: "smooth",
    });
  };

  const activeLibraryFilter = FILTERS.find(
    ([filterId]) => filterId === libraryFilter,
  );

  return (
    <div className="library-chips">
      {activeLibraryFilter ? (
        <div
          className="chips selected"
          role="group"
          aria-label={translate("library.filter")}
        >
          <button
            type="button"
            className="icon-btn library-filter-clear"
            aria-label={translate("library.clearFilter")}
            onClick={() => useUi.setState({ libraryFilter: null })}
          >
            <Icon name="close" size={18} />
          </button>
          <button
            type="button"
            className="pill"
            aria-pressed="true"
            onClick={() => useUi.setState({ libraryFilter: null })}
          >
            {translate(activeLibraryFilter[1])}
          </button>
        </div>
      ) : (
        <>
          <div
            ref={libraryFilterScroller}
            className="chips"
            role="group"
            aria-label={translate("library.filter")}
            onScroll={updateLibraryFilterScrollControls}
          >
            {FILTERS.map(([filterId, filterLabelKey]) => (
              <button
                key={filterId}
                type="button"
                className="pill"
                aria-pressed="false"
                onClick={() => useUi.setState({ libraryFilter: filterId })}
              >
                {translate(filterLabelKey)}
              </button>
            ))}
          </div>
          {canShowPreviousLibraryFilters ? (
            <button
              ref={previousLibraryFiltersButton}
              type="button"
              className="icon-btn library-chip-nav previous"
              aria-label={translate("library.previousFilters")}
              onClick={() => scrollLibraryFilters(-1)}
            >
              <Icon name="back" size={20} />
            </button>
          ) : null}
          {canShowMoreLibraryFilters ? (
            <button
              ref={moreLibraryFiltersButton}
              type="button"
              className="icon-btn library-chip-nav next"
              aria-label={translate("library.moreFilters")}
              onClick={() => scrollLibraryFilters(1)}
            >
              <Icon name="forward" size={20} />
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}

export function libraryEmptyText(filter: LibraryFilter, query: string): string {
  if (query.trim())
    return translate("search.libraryNoMatch", { query: query.trim() });

  switch (filter) {
    case "albums":
      return translate("library.albumsHint");
    case "artists":
      return translate("library.artistsHint");
    case "downloaded":
      return translate("library.downloadsHint");
    case "playlists":
      return translate("library.playlistsHint");
    case null:
      return translate("library.entriesHint");
  }
}

export function useNewPlaylist() {
  const create = useCreatePlaylist();
  const navigate = useNavigate();
  const count = usePlaylists().data?.length ?? 0;
  return () =>
    create.mutate(
      { name: translate("library.myPlaylist", { number: count + 1 }) },
      { onSuccess: (p) => void navigate(`/playlist/${p.id}?edit=1`) },
    );
}

function Nav({
  to,
  icon,
  label,
}: {
  to: string;
  icon: IconName;
  label: string;
}) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      aria-label={label}
      className={({ isActive }) => (isActive ? "nav-btn on" : "nav-btn")}
    >
      <Icon name={icon} size={22} />
      <span>{label}</span>
    </NavLink>
  );
}

export function Sidebar() {
  const filter = useUi((s) => s.libraryFilter);
  const { order, setOrder } = useLibrarySort();
  const { origin, show } = useLibraryOrigin();
  const entries = useLibraryEntries(filter, "", order, origin);
  const navigate = useNavigate();
  const newPlaylist = useNewPlaylist();
  return (
    <nav className="side" aria-label={translate("common.main")}>
      <div className="panel side-top">
        <Link to="/" className="brand" aria-label={translate("app.home")}>
          <Logo size={42} />
          <span>Needle</span>
        </Link>
        <Nav to="/" icon="home" label={translate("navigation.home")} />
        <Nav
          to="/search"
          icon="search"
          label={translate("navigation.search")}
        />
        <Nav
          to="/stats"
          icon="chart"
          label={translate("navigation.yourListening")}
        />
        <Nav to="/radio" icon="radio" label={translate("navigation.radio")} />
      </div>
      <div className="panel side-lib">
        <div className="lib-head">
          <Link
            to="/library"
            className="lib-title"
            aria-label={translate("navigation.yourLibrary")}
          >
            <Icon name="library" size={22} />
            <span>{translate("navigation.yourLibrary")}</span>
          </Link>
          <div className="lib-head-acts">
            <button
              type="button"
              className="icon-btn"
              aria-label={translate("library.search")}
              onClick={() => void navigate("/library?find=1")}
            >
              <Icon name="search" size={19} />
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label={translate("library.createPlaylist")}
              onClick={newPlaylist}
            >
              <Icon name="plus" />
            </button>
          </div>
        </div>
        <LibraryChips />
        <div className="lib-tools">
          <CollectionTools
            sorts={librarySorts()}
            order={order}
            onOrder={setOrder}
            show={show}
          />
        </div>
        <ItemList items={entries} empty={libraryEmptyText(filter, "")} />
      </div>
    </nav>
  );
}
