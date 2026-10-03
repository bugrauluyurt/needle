import { useMemo, useState } from "react";
import { useParams } from "react-router";
import type { Song } from "@needle/shared";
import { Art } from "../../../components/Art.tsx";
import { CollectionTools } from "../../../components/Collection.tsx";
import { ActBar, Hero, PageSkeleton, PlayContextButton, ShuffleButton } from "../../../components/Hero.tsx";
import { Icon } from "../../../components/Icon.tsx";
import { SearchField } from "../../../components/SearchField.tsx";
import { TrackList } from "../../../components/tracks/TrackList.tsx";
import { ago, longDuration, plain, plural } from "../../../lib/format.ts";
import { AS_GIVEN, shownSongs, songSorts, totalSongDuration } from "../../../lib/songs.ts";
import type { SongOrder } from "../../../lib/songs.ts";
import { useTone } from "../../../lib/tone.ts";
import { image, spId, spotifyLink } from "../api/client.ts";
import { usePageTone } from "../../../layout/pageTone.ts";
import { player } from "../../../player/controller.ts";
import type { PlayContext } from "../../../player/store.ts";
import { useSpotifyOn, useSpotifyPlaylist, useSpotifyPlaylistEdits, useSpotifyPlaylists } from "../hooks/useSpotify.ts";
import { translate } from "../../../i18n/index.ts";
import { NotConnected, OpenInSpotify, SpotifyError } from "./SpotifyRouteState.tsx";

export function SpotifyPlaylistPage() {
  const { id = "" } = useParams();
  const on = useSpotifyOn();
  const { data, isLoading, refetch } = useSpotifyPlaylist(id);
  const edits = useSpotifyPlaylistEdits();
  const { data: playlists } = useSpotifyPlaylists();
  const mine = playlists?.find((p) => p.id === id)?.mine;
  const [filter, setFilter] = useState("");
  const [order, setOrder] = useState<SongOrder>(AS_GIVEN);
  const shown = useMemo(() => (data?.songs ? shownSongs(data.songs, order, filter) : null), [data, order, filter]);
  const tone = useTone(image(data?.meta.images, 64));
  usePageTone(tone);
  if (!on) return <NotConnected />;
  if (isLoading) return <PageSkeleton />;
  if (!data) return <SpotifyError what="playlist" retry={() => void refetch()} />;
  const { meta, songs } = data;
  const context: PlayContext = {
    kind: "playlist",
    id: spId(id),
    name: meta.name,
  };
  const total = meta.items?.total ?? meta.tracks?.total ?? songs?.length ?? 0;
  const editable = Boolean(mine) && songs !== null && order.key === "custom" && !filter;
  return (
    <div className="tinted">
      <Hero
        art={<Art images={meta.images} px={232} eager />}
        kind={translate(mine ? "spotify.playlist" : "spotify.followedPlaylist")}
        title={meta.name}
        description={plain(meta.description)}
        meta={
          <>
            <b>{meta.owner.display_name ?? meta.owner.id}</b>
            <span>
              {plural(total, "song")}
              {songs?.length ? `, ${longDuration(totalSongDuration(songs))}` : ""}
            </span>
          </>
        }
      />
      {songs ? (
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
                <CollectionTools sorts={songSorts()} order={order} onOrder={setOrder} />
              </>
            ) : null
          }
        >
          {songs.length ? (
            <>
              <PlayContextButton
                contextId={context.id ?? ""}
                label={meta.name}
                onPlay={() => player.playSongs(songs, 0, context)}
              />
              <ShuffleButton
                label={meta.name}
                onShuffle={() => player.playSongs(songs, 0, context, { shuffle: true })}
              />
            </>
          ) : null}
          <OpenInSpotify kind="playlist" id={id} />
        </ActBar>
      ) : null}
      {songs === null ? (
        <div className="pad sp-note">
          <h2>{translate("spotify.lockedHeading")}</h2>
          <p className="muted">{translate("spotify.lockedHint")}</p>
          <a className="btn light" href={spotifyLink("playlist", id)} target="_blank" rel="noopener noreferrer">
            <Icon name="link" size={16} />
            {translate("spotify.open")}
          </a>
        </div>
      ) : songs.length && shown ? (
        <TrackList
          songs={shown}
          context={context}
          art
          album
          column={{
            label: translate("sort.dateAdded"),
            value: (s) => ago(s.created),
            sort: "added",
          }}
          order={order}
          onOrder={setOrder}
          {...(editable
            ? {
                onReorder: (from: number, to: number) => void edits.reorder(id, from, to),
                menuExtra: (s: Song) => [
                  {
                    label: translate("playlist.remove"),
                    icon: "trash" as const,
                    run: () => void edits.remove(id, s),
                  },
                ],
              }
            : {})}
        />
      ) : (
        <div className="pad empty-inline">
          <h2>{translate("spotify.emptyPlaylist")}</h2>
          <p className="muted">{translate("spotify.emptyPlaylistHint")}</p>
        </div>
      )}
    </div>
  );
}
