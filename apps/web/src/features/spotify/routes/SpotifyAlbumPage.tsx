import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { Art } from "../../../components/Art.tsx";
import { ActBar, Hero, PageSkeleton, PlayContextButton, ShuffleButton } from "../../../components/Hero.tsx";
import { Icon } from "../../../components/Icon.tsx";
import { SearchField } from "../../../components/SearchField.tsx";
import { TrackList } from "../../../components/tracks/TrackList.tsx";
import { api } from "../../../lib/api.ts";
import { longDuration, plural, releaseKind } from "../../../lib/format.ts";
import { artistPath } from "../../../lib/paths.ts";
import { AS_GIVEN, shownSongs } from "../../../lib/songs.ts";
import type { SongOrder } from "../../../lib/songs.ts";
import { useTone } from "../../../lib/tone.ts";
import { image, sp, spId } from "../api/client.ts";
import { usePageTone } from "../../../layout/pageTone.ts";
import { player } from "../../../player/controller.ts";
import type { PlayContext } from "../../../player/store.ts";
import { useCapabilities } from "../../../queries/hooks.ts";
import { spKeys, useSpotifyAlbum, useSpotifyAlbums, useSpotifyOn } from "../hooks/useSpotify.ts";
import { toast } from "../../../state/ui.ts";
import { translate } from "../../../i18n/index.ts";
import { duration, NotConnected, OpenInSpotify, SpotifyError } from "./SpotifyRouteState.tsx";

export function SpotifyAlbumPage() {
  const { id = "" } = useParams();
  const on = useSpotifyOn();
  const { data, isLoading, refetch } = useSpotifyAlbum(id);
  const { data: saved } = useSpotifyAlbums();
  const caps = useCapabilities();
  const qc = useQueryClient();
  const tone = useTone(image(data?.album.images, 64));
  usePageTone(tone);
  const [busy, setBusy] = useState(false);
  const [songFilter, setSongFilter] = useState("");
  const [songOrder, setSongOrder] = useState<SongOrder>(AS_GIVEN);
  const visibleSongs = useMemo(
    () => shownSongs(data?.songs ?? [], songOrder, songFilter),
    [data?.songs, songOrder, songFilter],
  );
  if (!on) return <NotConnected />;
  if (isLoading) return <PageSkeleton />;
  if (!data) return <SpotifyError what="album" retry={() => void refetch()} />;
  const { album, songs } = data;
  const context: PlayContext = {
    kind: "album",
    id: spId(album.id),
    name: album.name,
    ordered: true,
  };
  const isSaved = Boolean(saved?.some((a) => a.id === album.id));
  const year = album.release_date?.slice(0, 4);
  const toggleSave = async () => {
    const uri = album.uri ?? `spotify:album:${album.id}`;
    try {
      await (isSaved ? sp.unsave([uri]) : sp.save([uri]));
      await qc.invalidateQueries({ queryKey: spKeys.albums });
      toast(translate(isSaved ? "spotify.removedLibrary" : "spotify.savedLibrary"));
    } catch {
      toast(translate("spotify.updateFailed"));
    }
  };
  const getAlbum = async () => {
    setBusy(true);
    try {
      const {
        albums: [hit],
      } = await api.lidarrSearch(`${album.artists?.[0]?.name ?? ""} ${album.name}`);
      if (!hit) toast(translate("menu.lidarrNotFound"));
      else {
        await api.lidarrGet(hit.foreignAlbumId);
        toast(translate("menu.lidarrLooking", { title: hit.title }));
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : translate("settings.lidarrRequestFailed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="tinted">
      <Hero
        art={<Art images={album.images} px={232} eager />}
        kind={translate("spotify.albumKind", {
          kind:
            album.album_type === "album"
              ? translate("catalog.album")
              : album.album_type === "compilation"
                ? translate("catalog.compilation")
                : releaseKind(songs.length, duration(songs)),
        })}
        title={album.name}
        meta={
          <>
            {(album.artists ?? []).map((a) => (
              <Link key={a.id} to={artistPath(spId(a.id))} className="meta-artist">
                {a.name}
              </Link>
            ))}
            {year ? <span>{year}</span> : null}
            <span>
              {plural(songs.length, "song")}, {longDuration(duration(songs))}
            </span>
          </>
        }
      />
      <ActBar
        end={
          <SearchField
            variant="inline"
            collapsible
            value={songFilter}
            onChange={setSongFilter}
            label={translate("catalog.findAlbum")}
          />
        }
      >
        <PlayContextButton
          contextId={context.id ?? ""}
          label={album.name}
          onPlay={() => player.playSongs(songs, 0, context)}
        />
        <ShuffleButton label={album.name} onShuffle={() => player.playSongs(songs, 0, context, { shuffle: true })} />
        <button
          type="button"
          className="icon-btn big"
          aria-pressed={isSaved}
          aria-label={isSaved ? translate("spotify.removeLibrary") : translate("spotify.saveLibrary")}
          onClick={() => void toggleSave()}
        >
          <Icon name={isSaved ? "heartFill" : "heart"} size={28} />
        </button>
        {caps.data?.lidarr ? (
          <button type="button" className="btn ghost sm" disabled={busy} onClick={() => void getAlbum()}>
            <Icon name="download" size={15} />
            {translate(busy ? "settings.askingLidarr" : "spotify.getAlbum")}
          </button>
        ) : null}
        <OpenInSpotify kind="album" id={album.id} />
      </ActBar>
      <TrackList
        songs={visibleSongs}
        context={context}
        numbers="track"
        order={songOrder}
        onOrder={setSongOrder}
        onPlay={(songIndex) => {
          const selectedSong = visibleSongs[songIndex];

          if (selectedSong) player.playSongs(songs, songs.indexOf(selectedSong), context);
        }}
      />
      <div className="pad">
        {album.label || album.copyrights?.[0] ? (
          <p className="album-foot muted">
            {[year, album.label, album.copyrights?.[0]?.text].filter(Boolean).join(". ")}
          </p>
        ) : null}
      </div>
    </div>
  );
}
