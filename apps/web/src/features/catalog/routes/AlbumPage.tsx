import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import type { Song } from "@needle/shared";
import { Art } from "../../../components/Art.tsx";
import { DownloadButton, LikeButton } from "../../../components/Buttons.tsx";
import { AlbumCard, CardRow, RowHeader } from "../../../components/Cards.tsx";
import { CollectionTools } from "../../../components/Collection.tsx";
import { GetCard } from "../../../components/GetCard.tsx";
import {
  ActBar,
  Hero,
  NotFoundState,
  PageSkeleton,
  PlayContextButton,
  ShuffleButton,
} from "../../../components/Hero.tsx";
import { TrackMoreButton } from "../../../components/tracks/TrackMenu.tsx";
import { SearchField } from "../../../components/SearchField.tsx";
import { SourceMark } from "../../../components/SpotifyMark.tsx";
import { TrackList } from "../../../components/tracks/TrackList.tsx";
import type { TrackColumn } from "../../../components/tracks/TrackList.tsx";
import { AS_GIVEN, librarySongSorts, shownSongs } from "../../../lib/songs.ts";
import type { SongOrder } from "../../../lib/songs.ts";
import { count, formatLabel, longDuration, plural, releaseKind } from "../../../lib/format.ts";
import { useTone } from "../../../lib/tone.ts";
import { usePageTone } from "../../../layout/pageTone.ts";
import { player } from "../../../player/controller.ts";
import type { PlayContext } from "../../../player/store.ts";
import { useAlbum, useArtist, useCapabilities, useLidarrSearch } from "../../../queries/hooks.ts";
import { translate } from "../../../i18n/index.ts";

const playsColumn = (): TrackColumn => ({
  label: translate("stats.plays"),
  value: (s) => (s.playCount ? count(s.playCount) : ""),
  sort: "plays",
});

function commonFormat(songs: Song[]): string | null {
  const counts = new Map<string, number>();
  for (const s of songs) {
    const f = formatLabel(s);
    if (f) counts.set(f, (counts.get(f) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

export default function AlbumPage() {
  const { id } = useParams();
  const { data: album, isLoading, isError, error, refetch } = useAlbum(id);
  const tone = useTone(album?.coverArt);
  usePageTone(tone);
  const { data: artist } = useArtist(album?.artistId);
  const caps = useCapabilities();
  const missing = useLidarrSearch(album?.artist ?? "", Boolean(caps.data?.lidarr && album?.artist));
  const songs = useMemo(() => album?.song ?? [], [album]);
  const [order, setOrder] = useState<SongOrder>(AS_GIVEN);
  const [songFilter, setSongFilter] = useState("");
  const orderedSongs = useMemo(() => shownSongs(songs, order, ""), [songs, order]);
  const sorted = useMemo(() => shownSongs(songs, order, songFilter), [songs, order, songFilter]);
  const discs = useMemo(() => {
    const map = new Map<number, Song[]>();
    for (const s of songs) map.set(s.discNumber ?? 1, [...(map.get(s.discNumber ?? 1) ?? []), s]);
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [songs]);
  const visibleDiscs = useMemo(() => {
    const visibleSongIds = new Set(sorted.map((song) => song.id));

    return discs
      .map(([discNumber, discSongs]) => [discNumber, discSongs.filter((song) => visibleSongIds.has(song.id))] as const)
      .filter(([, discSongs]) => discSongs.length > 0);
  }, [discs, sorted]);

  if (isLoading) return <PageSkeleton />;
  if (isError || !album) return <NotFoundState what="album" error={error} retry={() => void refetch()} />;

  const context: PlayContext = {
    kind: "album",
    id: album.id,
    name: album.name,
    ordered: true,
  };
  const fmt = commonFormat(songs);
  const artistName = album.displayArtist ?? album.artist ?? translate("catalog.unknownArtist");
  const others = (artist?.album ?? []).filter((a) => a.id !== album.id);
  const notOwned = (missing.data?.albums ?? [])
    .filter((m) => m.artist.toLowerCase() === (album.artist ?? "").toLowerCase())
    .slice(0, 3);
  const kind = releaseKind(album.songCount, album.duration, album.isCompilation);
  const plays = songs.reduce((n, s) => n + (s.playCount ?? 0), 0);

  return (
    <div className="tinted">
      <Hero
        art={<Art id={album.coverArt} px={232} eager />}
        kind={kind}
        title={album.name}
        meta={
          <>
            {album.artistId ? (
              <Link to={`/artist/${album.artistId}`} className="meta-artist">
                <Art id={artist?.coverArt} px={24} round fallback="artist" />
                {artistName}
              </Link>
            ) : (
              <b>{artistName}</b>
            )}
            <SourceMark />
            {album.year ? <span>{album.year}</span> : null}
            <span>
              {plural(album.songCount, "song")}, {longDuration(album.duration)}
            </span>
            {fmt ? <span className="fmt on-hero">{fmt}</span> : null}
          </>
        }
      />
      <ActBar
        end={
          <>
            <SearchField
              variant="inline"
              collapsible
              value={songFilter}
              onChange={setSongFilter}
              label={translate("catalog.findAlbum")}
            />
            <CollectionTools
              sorts={[["custom", translate("catalog.trackOrder")], ...librarySongSorts()]}
              order={order}
              onOrder={setOrder}
            />
            {plays ? <span className="muted">{plural(plays, "play")}</span> : null}
          </>
        }
      >
        <PlayContextButton contextId={album.id} label={album.name} onPlay={() => player.playSongs(songs, 0, context)} />
        <ShuffleButton label={album.name} onShuffle={() => player.playSongs(songs, 0, context, { shuffle: true })} />
        <LikeButton kind="album" item={album} />
        <DownloadButton
          target={{
            id: album.id,
            kind: "album",
            name: album.name,
            subtitle: translate("catalog.albumArtist", { artist: artistName }),
            ...(album.coverArt ? { coverArt: album.coverArt } : {}),
          }}
          songs={songs}
        />
        <TrackMoreButton
          songs={songs}
          className="icon-btn big"
          size={26}
          label={translate("catalog.moreOptions", { name: album.name })}
        />
      </ActBar>
      {order.key === "custom" ? (
        visibleDiscs.length ? (
          visibleDiscs.map(([discNumber, discSongs], discIndex) => {
            return (
              <section key={discNumber} className="disc">
                {discs.length > 1 ? (
                  <h3 className="disc-h">{translate("catalog.disc", { number: discNumber })}</h3>
                ) : null}
                <TrackList
                  songs={discSongs}
                  context={context}
                  numbers="track"
                  header={discIndex === 0}
                  column={playsColumn()}
                  order={order}
                  onOrder={setOrder}
                  onPlay={(songIndex) => {
                    const selectedSong = discSongs[songIndex];

                    if (selectedSong) player.playSongs(songs, songs.indexOf(selectedSong), context);
                  }}
                />
              </section>
            );
          })
        ) : (
          <section className="disc">
            <TrackList
              songs={sorted}
              context={context}
              numbers="track"
              column={playsColumn()}
              order={order}
              onOrder={setOrder}
            />
          </section>
        )
      ) : (
        <section className="disc">
          <TrackList
            songs={sorted}
            context={context}
            numbers="track"
            column={playsColumn()}
            order={order}
            onOrder={setOrder}
            onPlay={(songIndex) => {
              const selectedSong = sorted[songIndex];

              if (selectedSong) player.playSongs(orderedSongs, orderedSongs.indexOf(selectedSong), context);
            }}
          />
        </section>
      )}
      <div className="pad">
        <p className="album-foot muted">
          {album.year ? `${album.year}. ` : ""}
          {plural(album.songCount, "song")}, {longDuration(album.duration)}
          {album.genres?.length ? `. ${album.genres.map((g) => g.name).join(", ")}` : ""}
        </p>
        {others.length ? (
          <>
            <RowHeader
              title={translate("catalog.moreBy", { artist: artistName })}
              {...(album.artistId ? { to: `/artist/${album.artistId}` } : {})}
            />
            <CardRow>
              {others.map((a) => (
                <AlbumCard key={a.id} album={a} subtitle={String(a.year ?? "")} />
              ))}
            </CardRow>
          </>
        ) : null}
        {notOwned.length ? (
          <>
            <RowHeader
              title={translate("catalog.moreByMissing", { artist: artistName })}
              subtitle={translate("catalog.lidarrFetch")}
            />
            <div className="get">
              {notOwned.map((a) => (
                <GetCard key={a.foreignAlbumId} album={a} />
              ))}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
