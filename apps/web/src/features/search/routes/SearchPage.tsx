import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { useIsFetching } from "@tanstack/react-query";
import type { YouTubeMusicSearchKind } from "@needle/shared";
import { GetCard, GetSongCard } from "../../../components/GetCard.tsx";
import { Art } from "../../../components/Art.tsx";
import { RowHeader } from "../../../components/Cards.tsx";
import { Icon } from "../../../components/Icon.tsx";
import { TrackList } from "../../../components/tracks/TrackList.tsx";
import { useScrollContainer } from "../../../components/ScrollContext.ts";
import {
  cardBlock,
  FILTERS,
  FilterChips,
  LIBRARY_FILTERS,
  LibrarySource,
  searchKindLabel,
  Source,
} from "../../../components/SearchResults.tsx";
import type {
  Block,
  Filter,
  SearchKind,
  Top,
} from "../../../components/SearchResults.tsx";
import { artistName, releaseDateLabel } from "../../../lib/format.ts";
import { useDebounced } from "../../../lib/useDelayed.ts";
import { player } from "../../../player/controller.ts";
import type { PlayContext } from "../../../player/store.ts";
import {
  useCapabilities,
  useLidarrSearch,
  useRequests,
  useSearch,
  useSongCandidates,
} from "../../../queries/hooks.ts";
import { usePageTone } from "../../../layout/pageTone.ts";
import { SearchHeader } from "../../../layout/SearchHeader.tsx";
import { albumPath } from "../../../lib/paths.ts";
import {
  useSpotifyOn,
  useSpotifyPlaylists,
  useSpotifySearch,
  useSpotifySearchCategory,
} from "../../spotify/hooks/useSpotify.ts";
import {
  uniqueSpotifyItems,
  useSpotifyStatus,
} from "../../spotify/api/client.ts";
import type { SpotifySearchKind } from "../../spotify/api/client.ts";
import {
  playSpotifyArtist,
  spotifyAlbumItem,
  spotifyArtistItem,
  spotifyPlaylistItem,
} from "../../spotify/components/SpotifyCards.tsx";
import {
  useYouTubeMusicOn,
  useYouTubeMusicSearch,
} from "../../youtube-music/hooks/useYouTubeMusic.ts";
import { useYouTubeMusicStatus } from "../../youtube-music/api/client.ts";
import {
  playYouTubeMusicArtist,
  youtubeMusicAlbumItem,
  youtubeMusicArtistItem,
  youtubeMusicPlaylistItem,
} from "../../youtube-music/components/YouTubeMusicCards.tsx";
import { YouTubeMusicNotice } from "../../youtube-music/components/YouTubeMusicNotice.tsx";
import { artistPath } from "../../../lib/paths.ts";
import { toast } from "../../../state/ui.ts";
import { translate } from "../../../i18n/index.ts";
import { SearchBrowse } from "../components/SearchBrowse.tsx";

const RECENT_KEY = "needle.recentSearches";

function loadRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

function saveRecent(list: string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 8)));
  } catch {
    return;
  }
}

const SPOTIFY_KINDS: Record<SearchKind, SpotifySearchKind> = {
  Songs: "songs",
  Albums: "albums",
  Artists: "artists",
  Playlists: "playlists",
};

const YOUTUBE_MUSIC_KINDS: Record<SearchKind, YouTubeMusicSearchKind> = {
  Songs: "songs",
  Albums: "albums",
  Artists: "artists",
  Playlists: "playlists",
};

function YouTubeMusicSource({
  q,
  filter,
  setFilter,
  onShowAll,
}: {
  q: string;
  filter: Filter;
  setFilter: (filter: Filter) => void;
  onShowAll: (kind: SearchKind) => void;
}) {
  const [limit, setLimit] = useState(20);
  const category =
    filter !== "All" && filter !== "Get music"
      ? YOUTUBE_MUSIC_KINDS[filter]
      : undefined;
  const search = useYouTubeMusicSearch(q, category, limit);
  const blocked = useYouTubeMusicStatus((status) => status.blocked);
  const songs = search.data?.songs ?? [];
  const albums = search.data?.albums ?? [];
  const artists = search.data?.artists ?? [];
  const playlists = search.data?.playlists ?? [];
  const context: PlayContext = {
    kind: "search",
    name: translate("search.providerContext", {
      provider: "YouTube Music",
      query: q,
    }),
  };
  const matchingArtist = artists.find(
    (artist) => artist.name.toLowerCase() === q.toLowerCase(),
  );
  const firstSong = songs[0];
  const top: Top | undefined = matchingArtist
    ? {
        to: artistPath(matchingArtist.id),
        art: (
          <Art
            images={matchingArtist.images}
            px={104}
            round
            fallback="artist"
          />
        ),
        title: matchingArtist.name,
        subtitle: translate("search.artistOnYouTube"),
        onPlay: () =>
          void playYouTubeMusicArtist(matchingArtist.id).catch(() =>
            toast(translate("youtube.answerFailedHint")),
          ),
      }
    : firstSong
      ? {
          to: firstSong.albumId ? albumPath(firstSong.albumId) : "#",
          art: <Art id={firstSong.coverArt} px={104} />,
          title: firstSong.title,
          subtitle: translate("search.songArtist", {
            artist: artistName(firstSong),
          }),
          onPlay: () => player.playSongs(songs, 0, context),
        }
      : undefined;
  const blocks: Block[] = [
    {
      kind: "Songs",
      count: songs.length,
      row: null,
      all: (
        <TrackList
          songs={songs}
          context={context}
          art
          album
          canSort={false}
          column={{
            label: translate("search.released"),
            value: releaseDateLabel,
          }}
        />
      ),
    },
    cardBlock(
      "Albums",
      albums.map((album) => youtubeMusicAlbumItem(album)),
      { source: "youtubeMusic" },
    ),
    cardBlock("Artists", artists.map(youtubeMusicArtistItem), {
      source: "youtubeMusic",
    }),
    cardBlock("Playlists", playlists.map(youtubeMusicPlaylistItem), {
      source: "youtubeMusic",
    }),
  ];

  return (
    <>
      <Source
        title={translate("search.onYouTube")}
        sourceName="YouTube Music"
        subtitle={translate("search.youtubeExperimental")}
        filter={filter}
        setFilter={setFilter}
        onShowAll={onShowAll}
        blocks={blocks}
        top={top}
        songs={songs}
        context={context}
        status={
          search.data
            ? "ok"
            : blocked
              ? "paused"
              : search.isError
                ? "error"
                : "loading"
        }
        empty={(kind) =>
          translate("search.youtubeEmpty", {
            kind: kind
              ? searchKindLabel(kind).toLocaleLowerCase()
              : translate("search.results"),
            query: q,
          })
        }
      />
      <YouTubeMusicNotice
        error={search.isError}
        retry={() => void search.refetch()}
      />
      {category && search.data?.hasMore && limit < 100 ? (
        <div className="search-pagination">
          <button
            type="button"
            className="btn ghost sm"
            disabled={blocked || search.isFetching}
            onClick={() => setLimit(Math.min(limit + 20, 100))}
          >
            {translate(
              search.isFetching ? "search.loading" : "search.loadMore",
            )}
          </button>
        </div>
      ) : null}
    </>
  );
}

function SpotifySource({
  q,
  filter,
  setFilter,
  onShowAll,
}: {
  q: string;
  filter: Filter;
  setFilter: (f: Filter) => void;
  onShowAll: (kind: SearchKind) => void;
}) {
  const blocked = useSpotifyStatus((s) => s.blocked);
  const debouncedQuery = useDebounced(q);
  const search = useSpotifySearch(debouncedQuery);
  const { isError } = search;
  const data = blocked && search.isPlaceholderData ? undefined : search.data;
  const category =
    filter !== "All" && filter !== "Get music"
      ? SPOTIFY_KINDS[filter]
      : undefined;
  const pagination = useSpotifySearchCategory(
    debouncedQuery,
    category,
    search.isPlaceholderData ? undefined : data,
  );
  const { data: own = [] } = useSpotifyPlaylists();
  const resultPages = pagination.data?.pages;
  const songs = uniqueSpotifyItems(
    resultPages?.flatMap((searchPage) => searchPage.songs) ?? data?.songs ?? [],
  );
  const albums = uniqueSpotifyItems(
    resultPages?.flatMap((searchPage) => searchPage.albums) ??
      data?.albums ??
      [],
  );
  const artists = uniqueSpotifyItems(
    resultPages?.flatMap((searchPage) => searchPage.artists) ??
      data?.artists ??
      [],
  );
  const playlists = useMemo(() => {
    const matchingPlaylists = own.filter((playlist) =>
      playlist.name.toLowerCase().includes(q.toLowerCase()),
    );
    const searchPlaylists =
      resultPages?.flatMap((searchPage) => searchPage.playlists) ??
      data?.playlists ??
      [];

    return uniqueSpotifyItems([...matchingPlaylists, ...searchPlaylists]);
  }, [own, data?.playlists, resultPages, q]);
  const context: PlayContext = {
    kind: "search",
    name: translate("search.providerContext", {
      provider: "Spotify",
      query: q,
    }),
  };
  const artist = artists.find((a) => a.name.toLowerCase() === q.toLowerCase());
  const song = songs[0];
  const top: Top | undefined = artist
    ? {
        to: `/spotify/artist/${artist.id}`,
        art: <Art images={artist.images} px={104} round fallback="artist" />,
        title: artist.name,
        subtitle: translate("search.artistOnSpotify"),
        onPlay: () => void playSpotifyArtist(artist.id),
      }
    : song
      ? {
          to: song.albumId ? albumPath(song.albumId) : "#",
          art: <Art id={song.coverArt} px={104} />,
          title: song.title,
          subtitle: translate("search.songArtist", {
            artist: artistName(song),
          }),
          onPlay: () => player.playSongs(songs, 0, context),
        }
      : undefined;
  const blocks: Block[] = [
    {
      kind: "Songs",
      count: songs.length,
      row: null,
      all: (
        <TrackList
          songs={songs}
          context={context}
          art
          album
          canSort={false}
          column={{
            label: translate("search.released"),
            value: releaseDateLabel,
          }}
        />
      ),
    },
    cardBlock(
      "Albums",
      albums.map((album) => spotifyAlbumItem(album)),
      { source: "spotify" },
    ),
    cardBlock("Artists", artists.map(spotifyArtistItem), { source: "spotify" }),
    cardBlock("Playlists", playlists.map(spotifyPlaylistItem), {
      source: "spotify",
    }),
  ];
  const page = category
    ? (resultPages?.at(-1)?.pagination[category] ?? data?.pagination[category])
    : undefined;

  return (
    <>
      <Source
        title={translate("search.onSpotify")}
        sourceName="Spotify"
        filter={filter}
        setFilter={setFilter}
        onShowAll={onShowAll}
        blocks={blocks}
        top={top}
        songs={songs}
        context={context}
        status={
          data || resultPages
            ? "ok"
            : blocked
              ? "paused"
              : isError
                ? "error"
                : "loading"
        }
        empty={(kind) =>
          translate("search.providerEmpty", {
            provider: "Spotify",
            kind: kind
              ? searchKindLabel(kind).toLocaleLowerCase()
              : translate("search.results"),
            query: q,
          })
        }
      />
      {category && page && !search.isPlaceholderData ? (
        <div className="search-pagination">
          {pagination.isFetchNextPageError ? (
            <p className="muted source-note">
              {translate("search.spotifyNextError")}
            </p>
          ) : null}
          {pagination.hasNextPage ? (
            <button
              type="button"
              className="btn ghost sm"
              disabled={blocked || pagination.isFetchingNextPage}
              onClick={() => void pagination.fetchNextPage()}
            >
              {translate(
                pagination.isFetchingNextPage
                  ? "search.loading"
                  : "search.loadMore",
              )}
            </button>
          ) : !pagination.isPending && page.total > 0 ? (
            <p className="muted source-note">
              {translate(
                page.next ? "search.spotifyLimit" : "search.spotifyAllLoaded",
              )}
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

const GETS: Record<"albums" | "songs", Filter[]> = {
  albums: ["All", "Albums", "Get music"],
  songs: ["All", "Songs", "Get music"],
};

function GetSource({
  q,
  filter,
  albumsOn,
  songsOn,
}: {
  q: string;
  filter: Filter;
  albumsOn: boolean;
  songsOn: boolean;
}) {
  const showAlbums = albumsOn && GETS.albums.includes(filter);
  const showSongs = songsOn && GETS.songs.includes(filter);
  const lidarr = useLidarrSearch(q, showAlbums);
  const songs = useSongCandidates(q, showSongs);
  const { data: requests = [] } = useRequests();
  const byRef = new Map(requests.map((r) => [`${r.kind}:${r.ref}`, r]));
  const few = filter === "All";
  const albums = lidarr.data?.albums ?? [];
  const asking = lidarr.isPending || lidarr.isFetching;
  const heading = showAlbums && showSongs;
  return (
    <section
      className="res-source"
      aria-label={translate("search.notInLibrary")}
    >
      <div className="source-h">
        <h2>{translate("search.notInLibrary")}</h2>
        <p className="sub">
          {albumsOn && songsOn
            ? translate("search.getBothHint")
            : albumsOn
              ? translate("search.getAlbumsHint")
              : translate("search.getSongsHint")}{" "}
          {translate("search.getSuffix")}
        </p>
      </div>
      {showAlbums ? (
        <>
          {heading ? <RowHeader title={translate("catalog.albums")} /> : null}
          {albums.length ? (
            <div className="get">
              {(few ? albums.slice(0, 6) : albums).map((a) => (
                <GetCard
                  key={a.foreignAlbumId}
                  album={a}
                  request={byRef.get(`album:${a.foreignAlbumId}`)}
                />
              ))}
            </div>
          ) : asking ? (
            <p className="muted source-note">
              <span className="spin" />
              {translate("search.lidarrLoading", { query: q })}
            </p>
          ) : (
            <p className="muted source-note">
              {translate("search.lidarrEmpty", { query: q })}
            </p>
          )}
        </>
      ) : null}
      {showSongs ? (
        <>
          {heading ? <RowHeader title={translate("catalog.songs")} /> : null}
          {songs.data?.length ? (
            <div className="get">
              {(few ? songs.data.slice(0, 4) : songs.data).map((s) => (
                <GetSongCard
                  key={s.id}
                  song={s}
                  request={byRef.get(`song:${s.id}`)}
                />
              ))}
            </div>
          ) : songs.isPending || songs.isFetching ? (
            <p className="muted source-note">
              <span className="spin" />
              {translate("search.songLookup", { query: q })}
            </p>
          ) : (
            <p className="muted source-note">
              {songs.isError
                ? translate("search.musicBrainzError")
                : translate("search.noSongs", { query: q })}
            </p>
          )}
        </>
      ) : null}
    </section>
  );
}

function Results({ q }: { q: string }) {
  const [filter, setFilter] = useState<Filter>("All");
  const [params, setParams] = useSearchParams();
  const { isFetching } = useSearch(q);
  const caps = useCapabilities().data;
  const albumsOn = Boolean(caps?.lidarr);
  const songsOn = Boolean(caps?.songs);
  const spotifyOn = useSpotifyOn();
  const youtubeMusicOn = useYouTubeMusicOn();
  const local = filter !== "Get music";
  const requestedSource = params.get("source");
  const requestedCategory = params.get("category");
  const focusedCategory = LIBRARY_FILTERS.find(
    (category): category is SearchKind =>
      category !== "All" && category === requestedCategory,
  );
  const focusedSource =
    focusedCategory &&
    (requestedSource === "library" ||
      requestedSource === "spotify" ||
      requestedSource === "youtubeMusic")
      ? requestedSource
      : null;
  const scrollContainer = useScrollContainer();
  const overviewScrollTop = useRef(0);

  useLayoutEffect(() => {
    scrollContainer?.current?.scrollTo(
      0,
      focusedSource ? 0 : overviewScrollTop.current,
    );
  }, [focusedSource, focusedCategory, scrollContainer]);

  const showAll = (
    source: "library" | "spotify" | "youtubeMusic",
    category: SearchKind,
  ) => {
    overviewScrollTop.current = scrollContainer?.current?.scrollTop ?? 0;

    setParams({ q, source, category });
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
            <LibrarySource
              q={q}
              filter={focusedCategory}
              setFilter={setFilter}
            />
          ) : focusedSource === "spotify" ? (
            spotifyOn ? (
              <SpotifySource
                q={q}
                filter={focusedCategory}
                setFilter={setFilter}
                onShowAll={(category) => showAll("spotify", category)}
              />
            ) : (
              <p className="muted source-note">
                {translate("search.spotifyUnavailable")}
              </p>
            )
          ) : youtubeMusicOn ? (
            <YouTubeMusicSource
              key={`${q}:${focusedCategory}`}
              q={q}
              filter={focusedCategory}
              setFilter={setFilter}
              onShowAll={(category) => showAll("youtubeMusic", category)}
            />
          ) : (
            <p className="muted source-note">
              {translate("search.youtubeUnavailable")}
            </p>
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
              onShowAll={(category) => showAll("library", category)}
            />
          ) : null}
          {local && spotifyOn ? (
            <SpotifySource
              q={q}
              filter={filter}
              setFilter={setFilter}
              onShowAll={(category) => showAll("spotify", category)}
            />
          ) : null}
          {local && youtubeMusicOn ? (
            <YouTubeMusicSource
              key={`${q}:${filter}`}
              q={q}
              filter={filter}
              setFilter={setFilter}
              onShowAll={(category) => showAll("youtubeMusic", category)}
            />
          ) : null}
          {(albumsOn || songsOn) &&
          filter !== "Playlists" &&
          filter !== "Artists" ? (
            <GetSource
              q={q}
              filter={filter}
              albumsOn={albumsOn}
              songsOn={songsOn}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

export default function Search() {
  const [params, setParams] = useSearchParams();
  const urlQ = params.get("q") ?? "";
  const [text, setText] = useState(urlQ);
  const [recent, setRecent] = useState(loadRecent);
  usePageTone(null);

  useEffect(() => {
    const t = window.setTimeout(() => {
      if (text.trim() === urlQ) return;
      setParams(text.trim() ? { q: text.trim() } : {}, { replace: true });
    }, 220);
    return () => window.clearTimeout(t);
  }, [text, urlQ, setParams]);

  const remember = (q: string) => {
    const next = [
      q,
      ...recent.filter((r) => r.toLowerCase() !== q.toLowerCase()),
    ].slice(0, 8);
    setRecent(next);
    saveRecent(next);
  };
  const q = urlQ.trim();
  const busy =
    useIsFetching({ predicate: (query) => query.queryKey.includes("search") }) >
      0 && Boolean(text.trim());

  return (
    <>
      <SearchHeader
        title={translate("navigation.search")}
        label={translate("navigation.search")}
        placeholder={translate("search.placeholder")}
        value={text}
        onChange={setText}
        onCommit={() => text.trim() && remember(text.trim())}
        busy={busy}
        autoFocus
      />
      <div className="pad">
        {q ? (
          <Results q={q} />
        ) : (
          <SearchBrowse
            recent={recent}
            onPick={(r) => setText(r)}
            onRemove={(r) => {
              const next = recent.filter((x) => x !== r);
              setRecent(next);
              saveRecent(next);
            }}
            onClear={() => {
              setRecent([]);
              saveRecent([]);
            }}
          />
        )}
      </div>
    </>
  );
}
