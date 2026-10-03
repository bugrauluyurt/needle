import { useMemo, useState } from "react";
import { useParams } from "react-router";
import { Art } from "../../../components/Art.tsx";
import { CollectionTools } from "../../../components/Collection.tsx";
import { ActBar, Hero, PageSkeleton, PlayContextButton, ShuffleButton } from "../../../components/Hero.tsx";
import { SearchField } from "../../../components/SearchField.tsx";
import { TrackList } from "../../../components/tracks/TrackList.tsx";
import { YouTubeMusicNotice } from "../components/YouTubeMusicNotice.tsx";
import { longDuration, plural } from "../../../lib/format.ts";
import { AS_GIVEN, shownSongs, totalSongDuration } from "../../../lib/songs.ts";
import type { SongOrder } from "../../../lib/songs.ts";
import { image } from "../../spotify/api/client.ts";
import { useTone } from "../../../lib/tone.ts";
import { useYouTubeMusicStatus } from "../api/client.ts";
import { usePageTone } from "../../../layout/pageTone.ts";
import { player } from "../../../player/controller.ts";
import type { PlayContext } from "../../../player/store.ts";
import { useYouTubeMusicOn, useYouTubeMusicPlaylist } from "../hooks/useYouTubeMusic.ts";
import { translate } from "../../../i18n/index.ts";
import {
  EMPTY_SONGS,
  LoadMore,
  OpenInYouTubeMusic,
  YouTubeMusicUnavailable,
  youtubeMusicSorts,
} from "./YouTubeMusicRouteState.tsx";

export function YouTubeMusicPlaylistPage() {
  const { id = "" } = useParams();
  const on = useYouTubeMusicOn();
  const blocked = useYouTubeMusicStatus((status) => status.blocked);
  const [limit, setLimit] = useState(100);
  const playlistQuery = useYouTubeMusicPlaylist(id, limit);
  const [filter, setFilter] = useState("");
  const [order, setOrder] = useState<SongOrder>(AS_GIVEN);
  const songs = playlistQuery.data?.songs.items ?? EMPTY_SONGS;
  const visibleSongs = useMemo(() => shownSongs(songs, order, filter), [songs, order, filter]);
  const tone = useTone(image(playlistQuery.data?.playlist.images, 64));

  usePageTone(tone);

  if (!on) return <YouTubeMusicUnavailable />;
  if (playlistQuery.isLoading) return <PageSkeleton />;
  if (!playlistQuery.data)
    return <YouTubeMusicUnavailable what="playlist" retry={() => void playlistQuery.refetch()} />;

  const { playlist, songs: songPage } = playlistQuery.data;
  const context: PlayContext = {
    kind: "playlist",
    id: playlist.id,
    name: playlist.title,
  };

  return (
    <div className="tinted">
      <Hero
        art={<Art images={playlist.images} px={232} eager />}
        kind={translate("youtube.playlist")}
        title={playlist.title}
        description={playlist.description}
        meta={
          <>
            <b>{playlist.author}</b>
            <span>
              {plural(playlist.songCount ?? songPage.total ?? songs.length, "song")}
              {songs.length ? `, ${longDuration(totalSongDuration(songs))}` : ""}
            </span>
          </>
        }
      />
      <ActBar
        end={
          songs.length ? (
            <>
              <SearchField
                variant="inline"
                collapsible
                value={filter}
                onChange={setFilter}
                label={translate("playlist.find")}
              />
              <CollectionTools sorts={youtubeMusicSorts()} order={order} onOrder={setOrder} />
            </>
          ) : null
        }
      >
        <PlayContextButton
          contextId={playlist.id}
          label={playlist.title}
          disabled={!songs.length}
          onPlay={() => player.playSongs(songs, 0, context)}
        />
        <ShuffleButton
          label={playlist.title}
          disabled={!songs.length}
          onShuffle={() => player.playSongs(songs, 0, context, { shuffle: true })}
        />
        <OpenInYouTubeMusic kind="playlist" id={playlist.id} />
      </ActBar>
      <div className="pad yt-notice-wrap">
        <YouTubeMusicNotice error={playlistQuery.isError} retry={() => void playlistQuery.refetch()} />
      </div>
      <TrackList songs={visibleSongs} context={context} art album order={order} onOrder={setOrder} />
      {!songs.length ? <p className="pad muted">{translate("youtube.emptyPlaylist")}.</p> : null}
      <LoadMore
        visible={songPage.hasMore && limit < 3000}
        busy={playlistQuery.isFetching}
        blocked={blocked}
        onMore={() => setLimit(Math.min(limit + 100, 3000))}
      />
    </div>
  );
}
