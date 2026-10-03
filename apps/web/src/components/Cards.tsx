import { memo } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import type { Album, Artist, MusicSource } from "@needle/shared";
import { musicSource, releaseDateString } from "@needle/shared";
import { player } from "../player/controller.ts";
import { useContextPlaying } from "../player/store.ts";
import { sub } from "../lib/subsonic.ts";
import { api } from "../lib/api.ts";
import { shownSongs } from "../lib/songs.ts";
import { releaseDateLabel } from "../lib/format.ts";
import { artistPath } from "../lib/paths.ts";
import { Art } from "./Art.tsx";
import { Icon } from "./Icon.tsx";
import { SourceMark } from "./SpotifyMark.tsx";
import { useArtistImage } from "../features/spotify/hooks/useSpotify.ts";
import type { CollectionItem } from "./collectionTypes.ts";
import { translate } from "../i18n/index.ts";

type CardProps = {
  to: string;
  art: ReactNode;
  title: string;
  subtitle?: ReactNode;
  onPlay?: () => void;
  playLabel?: string;
  playingId?: string;
  source?: Exclude<MusicSource, "library"> | null;
};

export const Card = memo(function Card({ to, art, title, subtitle, onPlay, playLabel, playingId, source }: CardProps) {
  const { current, playing } = useContextPlaying(playingId);
  return (
    <article className="card">
      <Link to={to} className="card-link">
        <div className="card-art">
          {art}
          {source !== null ? <SourceMark source={source} className="card-src" /> : null}
        </div>
        <div className="t">{title}</div>
        {subtitle ? <div className="s">{subtitle}</div> : null}
      </Link>
      {onPlay ? (
        <button
          type="button"
          className={current ? "hover-play on" : "hover-play"}
          aria-label={
            playing ? translate("track.pauseNamed", { title }) : (playLabel ?? translate("track.playNamed", { title }))
          }
          onClick={current ? player.toggle : onPlay}
        >
          <Icon name={playing ? "pause" : "play"} size={18} />
        </button>
      ) : null}
    </article>
  );
});

export async function playAlbum(id: string, name: string, shuffle = false) {
  if (musicSource(id) !== "library") return;

  const album = await sub.album(id);
  player.playSongs(album.song ?? [], 0, { kind: "album", id, name, ordered: true }, { shuffle });
}

export async function playArtist(artist: Pick<Artist, "id" | "name">, { shuffle = false }: { shuffle?: boolean } = {}) {
  if (musicSource(artist.id) !== "library") return;

  const librarySongs = await api.librarySongs();
  const artistSongs = librarySongs.filter(
    (song) => song.artistId === artist.id || song.artists?.some((songArtist) => songArtist.id === artist.id),
  );

  player.playSongs(
    shownSongs(artistSongs, { key: "plays", desc: true }, ""),
    0,
    { kind: "artist", id: artist.id, name: artist.name },
    { shuffle },
  );
}

export function albumItem(album: Album, subtitle?: string): CollectionItem {
  const by = album.displayArtist ?? album.artist ?? "";
  const releaseDate = releaseDateString(album.releaseDate);
  return {
    key: album.id,
    to: `/album/${album.id}`,
    art: (px) => <Art id={album.coverArt} px={px} />,
    title: album.name,
    subtitle: subtitle ?? [releaseDate ? releaseDateLabel({ releaseDate }) : album.year, by].filter(Boolean).join(", "),
    by,
    contextId: album.id,
    ...(album.year ? { year: album.year } : {}),
    ...(album.created ? { added: album.created } : {}),
    ...(album.playCount !== undefined ? { playCount: album.playCount } : {}),
    ...(releaseDate ? { releaseDate } : {}),
    onPlay: () => void playAlbum(album.id, album.name),
  };
}

export function artistItem(artist: Artist, subtitle = translate("catalog.artist")): CollectionItem {
  const source = musicSource(artist.id);

  return {
    key: artist.id,
    to: artistPath(artist.id),
    art: (px) => <Art id={artist.coverArt} px={px} round fallback="artist" />,
    title: artist.name,
    subtitle,
    by: artist.name,
    contextId: artist.id,
    ...(source !== "library" ? { source } : { onPlay: () => void playArtist(artist) }),
  };
}

const CARD_ART = 180;

export function ItemCard({ item }: { item: CollectionItem }) {
  return (
    <Card
      to={item.to}
      art={item.art(CARD_ART)}
      title={item.title}
      subtitle={item.subtitle}
      {...(item.onPlay ? { onPlay: item.onPlay } : {})}
      {...(item.contextId ? { playingId: item.contextId } : {})}
      {...(item.source ? { source: item.source } : {})}
    />
  );
}

export const AlbumCard = ({ album, subtitle }: { album: Album; subtitle?: string }) => (
  <ItemCard item={albumItem(album, subtitle)} />
);

export function ArtistCard({ artist, subtitle }: { artist: Artist; subtitle?: string }) {
  const artistCover = useArtistImage(
    artist.coverArt ? undefined : artist.id,
    artist.coverArt ? undefined : artist.name,
  );

  return <ItemCard item={artistItem({ ...artist, ...(artistCover ? { coverArt: artistCover } : {}) }, subtitle)} />;
}

export function RowHeader({
  title,
  subtitle,
  to,
  action,
}: {
  title: string;
  subtitle?: string;
  to?: string;
  action?: ReactNode;
}) {
  return (
    <div className="row-h">
      <div>
        <h2>{to ? <Link to={to}>{title}</Link> : title}</h2>
        {subtitle ? <p className="sub">{subtitle}</p> : null}
      </div>
      {action ??
        (to ? (
          <Link to={to} className="show-all">
            {translate("common.showAll")}
          </Link>
        ) : null)}
    </div>
  );
}

export function CardRow({
  children,
  grid = false,
  dense = false,
}: {
  children: ReactNode;
  grid?: boolean;
  dense?: boolean;
}) {
  return (
    <div className={["cards", grid ? "grid" : "", dense ? "dense" : ""].filter(Boolean).join(" ")}>{children}</div>
  );
}

export function CardSkeletons({ n = 6, round = false }: { n?: number; round?: boolean }) {
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="card" aria-hidden="true">
          <div className={`skeleton card-skel ${round ? "round" : ""}`} />
          <div className="skeleton line-skel" />
          <div className="skeleton line-skel short" />
        </div>
      ))}
    </>
  );
}
