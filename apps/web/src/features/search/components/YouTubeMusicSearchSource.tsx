import { useState } from "react";
import { Art } from "../../../components/Art.tsx";
import { TrackList } from "../../../components/tracks/TrackList.tsx";
import { cardBlock, searchKindLabel, Source } from "../../../components/SearchResults.tsx";
import type { Block, Filter, SearchKind, Top } from "../../../components/SearchResults.tsx";
import { translate } from "../../../i18n/index.ts";
import { artistName, releaseDateLabel } from "../../../lib/format.ts";
import { albumPath, artistPath } from "../../../lib/paths.ts";
import { player } from "../../../player/controller.ts";
import type { PlayContext } from "../../../player/store.ts";
import { toast } from "../../../state/ui.ts";
import { useYouTubeMusicStatus } from "../../youtube-music/api/client.ts";
import {
  playYouTubeMusicArtist,
  youtubeMusicAlbumItem,
  youtubeMusicArtistItem,
  youtubeMusicPlaylistItem,
} from "../../youtube-music/components/YouTubeMusicCards.tsx";
import { YouTubeMusicNotice } from "../../youtube-music/components/YouTubeMusicNotice.tsx";
import { useYouTubeMusicSearch } from "../../youtube-music/hooks/useYouTubeMusic.ts";
import { SEARCH_KINDS } from "../constants/search.ts";

type YouTubeMusicSearchSourceProps = {
  filter: Filter;
  onShowAll: (searchKind: SearchKind) => void;
  q: string;
  setFilter: (filter: Filter) => void;
};

export function YouTubeMusicSearchSource({ q, filter, setFilter, onShowAll }: YouTubeMusicSearchSourceProps) {
  const [limit, setLimit] = useState(20);
  const category = filter !== "All" && filter !== "Get music" ? SEARCH_KINDS[filter] : undefined;
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
  const matchingArtist = artists.find((artist) => artist.name.toLowerCase() === q.toLowerCase());
  const firstSong = songs[0];
  const top: Top | undefined = matchingArtist
    ? {
        to: artistPath(matchingArtist.id),
        art: <Art images={matchingArtist.images} px={104} round fallback="artist" />,
        title: matchingArtist.name,
        subtitle: translate("search.artistOnYouTube"),
        onPlay: () =>
          void playYouTubeMusicArtist(matchingArtist.id).catch(() => toast(translate("youtube.answerFailedHint"))),
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
        status={search.data ? "ok" : blocked ? "paused" : search.isError ? "error" : "loading"}
        empty={(searchKind) =>
          translate("search.youtubeEmpty", {
            kind: searchKind ? searchKindLabel(searchKind).toLocaleLowerCase() : translate("search.results"),
            query: q,
          })
        }
      />
      <YouTubeMusicNotice error={search.isError} retry={() => void search.refetch()} />
      {category && search.data?.hasMore && limit < 100 ? (
        <div className="search-pagination">
          <button
            type="button"
            className="btn ghost sm"
            disabled={blocked || search.isFetching}
            onClick={() => setLimit(Math.min(limit + 20, 100))}
          >
            {translate(search.isFetching ? "search.loading" : "search.loadMore")}
          </button>
        </div>
      ) : null}
    </>
  );
}
