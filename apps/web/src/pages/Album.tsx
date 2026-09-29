import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import type { Song } from "@needle/shared";
import { Art } from "../components/Art.tsx";
import { DownloadButton, LikeButton } from "../components/Buttons.tsx";
import { AlbumCard, CardRow, RowHeader } from "../components/Cards.tsx";
import { GetCard } from "../components/GetCard.tsx";
import { ActBar, Hero, NotFoundState, PageSkeleton, PlayContextButton, ShuffleButton } from "../components/Hero.tsx";
import { TrackMoreButton } from "../components/TrackMenu.tsx";
import { TrackList } from "../components/TrackList.tsx";
import type { TrackColumn } from "../components/TrackList.tsx";
import { AS_GIVEN, shownSongs } from "../lib/songs.ts";
import type { SongOrder } from "../lib/songs.ts";
import { count, formatLabel, longDuration, plural, releaseKind } from "../lib/format.ts";
import { useTone } from "../lib/tone.ts";
import { usePageTone } from "../layout/Shell.tsx";
import { player } from "../player/controller.ts";
import type { PlayContext } from "../player/store.ts";
import { useAlbum, useArtist, useCapabilities, useLidarrSearch } from "../queries/hooks.ts";

const PLAYS: TrackColumn = { label: "Plays", value: (s) => (s.playCount ? count(s.playCount) : ""), sort: "plays" };

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
  const sorted = useMemo(() => shownSongs(songs, order, ""), [songs, order]);
  const discs = useMemo(() => {
    const map = new Map<number, Song[]>();
    for (const s of songs) map.set(s.discNumber ?? 1, [...(map.get(s.discNumber ?? 1) ?? []), s]);
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [songs]);

  if (isLoading) return <PageSkeleton />;
  if (isError || !album) return <NotFoundState what="album" error={error} retry={() => void refetch()} />;

  const context: PlayContext = { kind: "album", id: album.id, name: album.name, ordered: true };
  const fmt = commonFormat(songs);
  const artistName = album.displayArtist ?? album.artist ?? "Unknown artist";
  const others = (artist?.album ?? []).filter((a) => a.id !== album.id);
  const notOwned = (missing.data?.albums ?? []).filter((m) => m.artist.toLowerCase() === (album.artist ?? "").toLowerCase()).slice(0, 3);
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
            ) : <b>{artistName}</b>}
            {album.year ? <span>{album.year}</span> : null}
            <span>{plural(album.songCount, "song")}, {longDuration(album.duration)}</span>
            {fmt ? <span className="fmt on-hero">{fmt}</span> : null}
          </>
        }
      />
      <ActBar end={plays ? <span className="muted">{plural(plays, "play")}</span> : null}>
        <PlayContextButton contextId={album.id} label={album.name} onPlay={() => player.playSongs(songs, 0, context)} />
        <ShuffleButton label={album.name} onShuffle={() => player.playSongs(songs, 0, context, { shuffle: true })} />
        <LikeButton kind="album" item={album} />
        <DownloadButton target={{ id: album.id, kind: "album", name: album.name, subtitle: `Album, ${artistName}`, ...(album.coverArt ? { coverArt: album.coverArt } : {}) }} songs={songs} />
        <TrackMoreButton songs={songs} className="icon-btn big" size={26} label={`More options for ${album.name}`} />
      </ActBar>
      {order.key === "custom" ? (
        discs.map(([disc, list], i) => {
          const offset = discs.slice(0, i).reduce((n, [, l]) => n + l.length, 0);
          return (
            <section key={disc} className="disc">
              {discs.length > 1 ? <h3 className="disc-h">Disc {disc}</h3> : null}
              <TrackList
                songs={list}
                context={context}
                numbers="track"
                header={i === 0}
                column={PLAYS}
                order={order}
                onOrder={setOrder}
                onPlay={(idx) => player.playSongs(songs, offset + idx, context)}
              />
            </section>
          );
        })
      ) : (
        <section className="disc">
          <TrackList songs={sorted} context={context} numbers="track" column={PLAYS} order={order} onOrder={setOrder} onPlay={(idx) => player.playSongs(sorted, idx, context)} />
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
            <RowHeader title={`More by ${artistName}`} {...(album.artistId ? { to: `/artist/${album.artistId}` } : {})} />
            <CardRow>{others.map((a) => <AlbumCard key={a.id} album={a} subtitle={String(a.year ?? "")} />)}</CardRow>
          </>
        ) : null}
        {notOwned.length ? (
          <>
            <RowHeader title={`More by ${artistName} you don’t have`} subtitle="Lidarr can fetch these" />
            <div className="get">{notOwned.map((a) => <GetCard key={a.foreignAlbumId} album={a} />)}</div>
          </>
        ) : null}
      </div>
    </div>
  );
}
