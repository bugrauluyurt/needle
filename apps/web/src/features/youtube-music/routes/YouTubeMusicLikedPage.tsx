import { useMemo, useState } from "react";
import { LikedArt } from "../../../components/Art.tsx";
import { CollectionTools } from "../../../components/Collection.tsx";
import { ActBar, Hero, PageSkeleton, PlayContextButton, ShuffleButton } from "../../../components/Hero.tsx";
import { SearchField } from "../../../components/SearchField.tsx";
import { TrackList } from "../../../components/tracks/TrackList.tsx";
import { YouTubeMusicNotice } from "../components/YouTubeMusicNotice.tsx";
import { plural } from "../../../lib/format.ts";
import { AS_GIVEN, shownSongs } from "../../../lib/songs.ts";
import type { SongOrder } from "../../../lib/songs.ts";
import { useYouTubeMusicStatus } from "../api/client.ts";
import { usePageTone } from "../../../layout/pageTone.ts";
import { player } from "../../../player/controller.ts";
import type { PlayContext } from "../../../player/store.ts";
import { useYouTubeMusicLiked, useYouTubeMusicOn } from "../hooks/useYouTubeMusic.ts";
import { translate } from "../../../i18n/index.ts";
import { EMPTY_SONGS, LoadMore, YouTubeMusicUnavailable, youtubeMusicSorts } from "./YouTubeMusicRouteState.tsx";

export function YouTubeMusicLikedPage() {
  const on = useYouTubeMusicOn();
  const blocked = useYouTubeMusicStatus((status) => status.blocked);
  const [limit, setLimit] = useState(100);
  const liked = useYouTubeMusicLiked(limit);
  const [filter, setFilter] = useState("");
  const [order, setOrder] = useState<SongOrder>(AS_GIVEN);
  const songs = liked.data ?? EMPTY_SONGS;
  const visibleSongs = useMemo(() => shownSongs(songs, order, filter), [songs, order, filter]);

  usePageTone("#70332E");

  if (!on) return <YouTubeMusicUnavailable />;
  if (liked.isLoading) return <PageSkeleton />;
  if (!liked.data) return <YouTubeMusicUnavailable what="list" retry={() => void liked.refetch()} />;

  const context: PlayContext = {
    kind: "liked",
    id: "ytm:liked",
    name: translate("youtube.liked"),
  };

  return (
    <div className="tinted">
      <Hero
        art={<LikedArt className="yt-liked" />}
        kind="YouTube Music"
        title={translate("home.likedYouTube")}
        meta={<span>{plural(liked.total ?? songs.length, "song")}</span>}
      />
      <ActBar
        end={
          <>
            <SearchField
              variant="inline"
              value={filter}
              onChange={setFilter}
              label={translate("library.findLikedSongs")}
            />
            <CollectionTools sorts={youtubeMusicSorts()} order={order} onOrder={setOrder} />
          </>
        }
      >
        <PlayContextButton
          contextId="ytm:liked"
          label={translate("youtube.liked")}
          disabled={!visibleSongs.length}
          onPlay={() => player.playSongs(visibleSongs, 0, context)}
        />
        <ShuffleButton
          label={translate("youtube.liked")}
          disabled={!visibleSongs.length}
          onShuffle={() => player.playSongs(visibleSongs, 0, context, { shuffle: true })}
        />
      </ActBar>
      <div className="pad yt-notice-wrap">
        <YouTubeMusicNotice error={liked.isError} retry={() => void liked.refetch()} />
      </div>
      <TrackList
        songs={visibleSongs}
        context={context}
        art
        album
        order={order}
        onOrder={setOrder}
        fallback={AS_GIVEN}
      />
      {!songs.length ? <p className="pad muted">{translate("library.noLikedYouTube")}</p> : null}
      <LoadMore
        visible={liked.hasMore && limit < 3000}
        busy={liked.isFetching}
        blocked={blocked}
        onMore={() => setLimit(Math.min(limit + 100, 3000))}
      />
    </div>
  );
}
