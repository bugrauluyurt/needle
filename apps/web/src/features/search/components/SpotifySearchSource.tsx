import { useMemo } from "react";
import { Art } from "../../../components/Art.tsx";
import { TrackList } from "../../../components/tracks/TrackList.tsx";
import { cardBlock, searchKindLabel, Source } from "../../../components/SearchResults.tsx";
import type { Block, Filter, SearchKind, Top } from "../../../components/SearchResults.tsx";
import { translate } from "../../../i18n/index.ts";
import { artistName, releaseDateLabel } from "../../../lib/format.ts";
import { albumPath } from "../../../lib/paths.ts";
import { useDebounced } from "../../../lib/useDelayed.ts";
import { player } from "../../../player/controller.ts";
import type { PlayContext } from "../../../player/store.ts";
import { uniqueSpotifyItems, useSpotifyStatus } from "../../spotify/api/client.ts";
import {
  playSpotifyArtist,
  spotifyAlbumItem,
  spotifyArtistItem,
  spotifyPlaylistItem,
} from "../../spotify/components/SpotifyCards.tsx";
import { useSpotifyPlaylists, useSpotifySearch, useSpotifySearchCategory } from "../../spotify/hooks/useSpotify.ts";
import { SEARCH_KINDS } from "../constants/search.ts";

type SpotifySearchSourceProps = {
  filter: Filter;
  onShowAll: (searchKind: SearchKind) => void;
  q: string;
  setFilter: (filter: Filter) => void;
};

export function SpotifySearchSource({ q, filter, setFilter, onShowAll }: SpotifySearchSourceProps) {
  const blocked = useSpotifyStatus((status) => status.blocked);
  const debouncedQuery = useDebounced(q);
  const search = useSpotifySearch(debouncedQuery);
  const { isError } = search;
  const data = blocked && search.isPlaceholderData ? undefined : search.data;
  const category = filter !== "All" && filter !== "Get music" ? SEARCH_KINDS[filter] : undefined;
  const pagination = useSpotifySearchCategory(debouncedQuery, category, search.isPlaceholderData ? undefined : data);
  const { data: ownPlaylists = [] } = useSpotifyPlaylists();
  const resultPages = pagination.data?.pages;
  const songs = uniqueSpotifyItems(resultPages?.flatMap((searchPage) => searchPage.songs) ?? data?.songs ?? []);
  const albums = uniqueSpotifyItems(resultPages?.flatMap((searchPage) => searchPage.albums) ?? data?.albums ?? []);
  const artists = uniqueSpotifyItems(resultPages?.flatMap((searchPage) => searchPage.artists) ?? data?.artists ?? []);
  const playlists = useMemo(() => {
    const matchingPlaylists = ownPlaylists.filter((playlist) => playlist.name.toLowerCase().includes(q.toLowerCase()));
    const searchPlaylists = resultPages?.flatMap((searchPage) => searchPage.playlists) ?? data?.playlists ?? [];

    return uniqueSpotifyItems([...matchingPlaylists, ...searchPlaylists]);
  }, [ownPlaylists, data?.playlists, resultPages, q]);
  const context: PlayContext = {
    kind: "search",
    name: translate("search.providerContext", {
      provider: "Spotify",
      query: q,
    }),
  };
  const matchingArtist = artists.find((artist) => artist.name.toLowerCase() === q.toLowerCase());
  const firstSong = songs[0];
  const top: Top | undefined = matchingArtist
    ? {
        to: `/spotify/artist/${matchingArtist.id}`,
        art: <Art images={matchingArtist.images} px={104} round fallback="artist" />,
        title: matchingArtist.name,
        subtitle: translate("search.artistOnSpotify"),
        onPlay: () => void playSpotifyArtist(matchingArtist.id),
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
      albums.map((album) => spotifyAlbumItem(album)),
      { source: "spotify" },
    ),
    cardBlock("Artists", artists.map(spotifyArtistItem), {
      source: "spotify",
    }),
    cardBlock("Playlists", playlists.map(spotifyPlaylistItem), {
      source: "spotify",
    }),
  ];
  const page = category ? (resultPages?.at(-1)?.pagination[category] ?? data?.pagination[category]) : undefined;

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
        status={data || resultPages ? "ok" : blocked ? "paused" : isError ? "error" : "loading"}
        empty={(searchKind) =>
          translate("search.providerEmpty", {
            provider: "Spotify",
            kind: searchKind ? searchKindLabel(searchKind).toLocaleLowerCase() : translate("search.results"),
            query: q,
          })
        }
      />
      {category && page && !search.isPlaceholderData ? (
        <div className="search-pagination">
          {pagination.isFetchNextPageError ? (
            <p className="muted source-note">{translate("search.spotifyNextError")}</p>
          ) : null}
          {pagination.hasNextPage ? (
            <button
              type="button"
              className="btn ghost sm"
              disabled={blocked || pagination.isFetchingNextPage}
              onClick={() => void pagination.fetchNextPage()}
            >
              {translate(pagination.isFetchingNextPage ? "search.loading" : "search.loadMore")}
            </button>
          ) : !pagination.isPending && page.total > 0 ? (
            <p className="muted source-note">
              {translate(page.next ? "search.spotifyLimit" : "search.spotifyAllLoaded")}
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
