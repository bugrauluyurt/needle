import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { Art } from "../../../components/Art.tsx";
import { ActBar, Hero, PageSkeleton, PlayContextButton, ShuffleButton } from "../../../components/Hero.tsx";
import { Icon } from "../../../components/Icon.tsx";
import { SearchField } from "../../../components/SearchField.tsx";
import { TrackList } from "../../../components/tracks/TrackList.tsx";
import { YouTubeMusicNotice } from "../components/YouTubeMusicNotice.tsx";
import { api } from "../../../lib/api.ts";
import { longDuration, plural } from "../../../lib/format.ts";
import { artistPath } from "../../../lib/paths.ts";
import { AS_GIVEN, shownSongs, totalSongDuration } from "../../../lib/songs.ts";
import type { SongOrder } from "../../../lib/songs.ts";
import { image } from "../../spotify/api/client.ts";
import { useTone } from "../../../lib/tone.ts";
import { useYouTubeMusicStatus } from "../api/client.ts";
import { usePageTone } from "../../../layout/pageTone.ts";
import { player } from "../../../player/controller.ts";
import type { PlayContext } from "../../../player/store.ts";
import { useCapabilities } from "../../../queries/hooks.ts";
import {
  useToggleYouTubeMusicAlbum,
  useYouTubeMusicAlbum,
  useYouTubeMusicAlbums,
  useYouTubeMusicOn,
} from "../hooks/useYouTubeMusic.ts";
import { toast } from "../../../state/ui.ts";
import { translate } from "../../../i18n/index.ts";
import { EMPTY_SONGS, OpenInYouTubeMusic, YouTubeMusicUnavailable } from "./YouTubeMusicRouteState.tsx";

export function YouTubeMusicAlbumPage() {
  const { id = "" } = useParams();
  const on = useYouTubeMusicOn();
  const albumQuery = useYouTubeMusicAlbum(id);
  const savedAlbums = useYouTubeMusicAlbums(3000);
  const save = useToggleYouTubeMusicAlbum();
  const capabilities = useCapabilities().data;
  const blocked = useYouTubeMusicStatus((status) => status.blocked);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");
  const [order, setOrder] = useState<SongOrder>(AS_GIVEN);
  const songs = albumQuery.data?.songs ?? EMPTY_SONGS;
  const visibleSongs = useMemo(() => shownSongs(songs, order, filter), [songs, order, filter]);
  const tone = useTone(image(albumQuery.data?.album.images, 64));

  usePageTone(tone);

  if (!on) return <YouTubeMusicUnavailable />;
  if (albumQuery.isLoading) return <PageSkeleton />;
  if (!albumQuery.data) return <YouTubeMusicUnavailable what="album" retry={() => void albumQuery.refetch()} />;

  const { album } = albumQuery.data;
  const isSaved = Boolean(savedAlbums.data?.some((savedAlbum) => savedAlbum.id === album.id));
  const savedMembershipKnown = Boolean(savedAlbums.data) && (isSaved || !savedAlbums.hasMore);
  const context: PlayContext = {
    kind: "album",
    id: album.id,
    name: album.title,
    ordered: true,
  };
  const getAlbum = async () => {
    setBusy(true);

    try {
      const { albums: matchingAlbums } = await api.lidarrSearch(`${album.artists[0]?.name ?? ""} ${album.title}`);
      const matchingAlbum = matchingAlbums[0];

      if (!matchingAlbum) toast(translate("menu.lidarrNotFound"));
      else {
        await api.lidarrGet(matchingAlbum.foreignAlbumId);

        toast(translate("menu.lidarrLooking", { title: matchingAlbum.title }));
      }
    } catch (requestError) {
      toast(requestError instanceof Error ? requestError.message : translate("settings.lidarrRequestFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="tinted">
      <Hero
        art={<Art images={album.images} px={232} eager />}
        kind={translate("youtube.albumKind")}
        title={album.title}
        description={album.description}
        meta={
          <>
            {album.artists.map((artist) => (
              <Link key={artist.id} to={artistPath(artist.id)} className="meta-artist">
                {artist.name}
              </Link>
            ))}
            {album.year ? <span>{album.year}</span> : null}
            <span>
              {plural(songs.length, "song")}, {longDuration(totalSongDuration(songs))}
            </span>
          </>
        }
      />
      <ActBar
        end={
          <SearchField
            variant="inline"
            collapsible
            value={filter}
            onChange={setFilter}
            label={translate("catalog.findAlbum")}
          />
        }
      >
        <PlayContextButton
          contextId={album.id}
          label={album.title}
          disabled={!songs.length}
          onPlay={() => player.playSongs(songs, 0, context)}
        />
        <ShuffleButton
          label={album.title}
          disabled={!songs.length}
          onShuffle={() => player.playSongs(songs, 0, context, { shuffle: true })}
        />
        <button
          type="button"
          className="icon-btn big"
          disabled={blocked || !savedMembershipKnown || save.isPending}
          aria-pressed={savedMembershipKnown ? isSaved : undefined}
          aria-label={
            !savedMembershipKnown
              ? translate("youtube.libraryStatusUnavailable")
              : isSaved
                ? translate("youtube.removeLibrary")
                : translate("youtube.saveLibrary")
          }
          onClick={() => save.mutate({ album, on: !isSaved })}
        >
          <Icon name={isSaved ? "heartFill" : "heart"} size={28} />
        </button>
        {capabilities?.lidarr ? (
          <button type="button" className="btn ghost sm" disabled={busy} onClick={() => void getAlbum()}>
            <Icon name="download" size={15} />
            {translate(busy ? "youtube.lidarrAsking" : "get.album")}
          </button>
        ) : null}
        <OpenInYouTubeMusic kind="album" id={album.id} />
      </ActBar>
      <div className="pad yt-notice-wrap">
        <YouTubeMusicNotice error={albumQuery.isError} retry={() => void albumQuery.refetch()} />
      </div>
      <TrackList
        songs={visibleSongs}
        context={context}
        numbers="track"
        order={order}
        onOrder={setOrder}
        onPlay={(songIndex) => {
          const selectedSong = visibleSongs[songIndex];

          if (selectedSong) player.playSongs(songs, songs.indexOf(selectedSong), context);
        }}
      />
    </div>
  );
}
