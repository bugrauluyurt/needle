import { useMemo, useState } from "react";
import { CollectionTools } from "../../../components/Collection.tsx";
import { SearchField } from "../../../components/SearchField.tsx";
import { likedSorts, RECENT_FIRST, shownSongs } from "../../../lib/songs.ts";
import type { SongOrder } from "../../../lib/songs.ts";
import { LikedArt } from "../../../components/Art.tsx";
import { ActBar, Hero, PageSkeleton, PlayContextButton, ShuffleButton } from "../../../components/Hero.tsx";
import { TrackList } from "../../../components/tracks/TrackList.tsx";
import { ago, plural } from "../../../lib/format.ts";
import { usePageTone } from "../../../layout/pageTone.ts";
import { player } from "../../../player/controller.ts";
import type { PlayContext } from "../../../player/store.ts";
import { useSpotifyLiked, useSpotifyOn } from "../hooks/useSpotify.ts";
import { translate } from "../../../i18n/index.ts";
import { NotConnected, SpotifyError } from "./SpotifyRouteState.tsx";

export function SpotifyLikedPage() {
  const on = useSpotifyOn();
  const { data: songs, isLoading, refetch } = useSpotifyLiked();
  const [filter, setFilter] = useState("");
  const [order, setOrder] = useState<SongOrder>(RECENT_FIRST);
  usePageTone("#1F5A3A");
  const shown = useMemo(() => shownSongs(songs ?? [], order, filter), [songs, order, filter]);
  if (!on) return <NotConnected />;
  if (isLoading) return <PageSkeleton />;
  if (!songs) return <SpotifyError what="list" retry={() => void refetch()} />;
  const context: PlayContext = {
    kind: "liked",
    id: "sp:liked",
    name: translate("spotify.liked"),
  };
  return (
    <div className="tinted">
      <Hero
        art={<LikedArt className="sp-liked" />}
        kind="Spotify"
        title={translate("home.likedSpotify")}
        meta={<span>{plural(songs.length, "song")}</span>}
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
            <CollectionTools sorts={likedSorts()} order={order} onOrder={setOrder} />
          </>
        }
      >
        <PlayContextButton
          contextId="sp:liked"
          label={translate("spotify.liked")}
          onPlay={() => player.playSongs(shown, 0, context)}
        />
        <ShuffleButton
          label={translate("spotify.liked")}
          onShuffle={() => player.playSongs(shown, 0, context, { shuffle: true })}
        />
      </ActBar>
      <TrackList
        songs={shown}
        context={context}
        art
        album
        column={{
          label: translate("sort.dateAdded"),
          value: (s) => ago(s.starred),
          sort: "added",
        }}
        order={order}
        onOrder={setOrder}
        fallback={RECENT_FIRST}
      />
    </div>
  );
}
