import { memo } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import type { Album, Artist, Song } from "@needle/shared";
import { player } from "../player/controller.ts";
import { sub } from "../lib/subsonic.ts";
import { artistPath } from "../lib/paths.ts";
import { isSpotify } from "../lib/spotify.ts";
import { Art } from "./Art.tsx";
import { Icon } from "./Icon.tsx";
import type { CollectionItem } from "./Collection.tsx";

type CardProps = {
  to: string;
  art: ReactNode;
  title: string;
  subtitle?: ReactNode;
  onPlay?: () => void;
  playLabel?: string;
};

export const Card = memo(function Card({ to, art, title, subtitle, onPlay, playLabel }: CardProps) {
  return (
    <article className="card">
      <Link to={to} className="card-link">
        <div className="card-art">{art}</div>
        <div className="t">{title}</div>
        {subtitle ? <div className="s">{subtitle}</div> : null}
      </Link>
      {onPlay ? (
        <button type="button" className="hover-play" aria-label={playLabel ?? `Play ${title}`} onClick={onPlay}>
          <Icon name="play" size={18} />
        </button>
      ) : null}
    </article>
  );
});

export async function playAlbum(id: string, name: string, shuffle = false) {
  const album = await sub.album(id);
  player.playSongs(album.song ?? [], 0, { kind: "album", id, name, ordered: true }, { shuffle });
}

export async function playArtist(artist: Pick<Artist, "id" | "name">, shuffle = false) {
  const top = await sub.topSongs(artist.name, 20).catch(() => [] as Song[]);
  let songs = top;
  if (songs.length < 5) {
    const a = await sub.artist(artist.id);
    const albums = await Promise.all((a.album ?? []).slice(0, 8).map((al) => sub.album(al.id)));
    songs = albums.flatMap((al) => al.song ?? []);
  }
  player.playSongs(songs, 0, { kind: "artist", id: artist.id, name: artist.name }, { shuffle });
}

export function albumItem(album: Album, subtitle?: string): CollectionItem {
  const by = album.displayArtist ?? album.artist ?? "";
  return {
    key: album.id,
    to: `/album/${album.id}`,
    art: (px) => <Art id={album.coverArt} px={px} />,
    title: album.name,
    subtitle: subtitle ?? [album.year, by].filter(Boolean).join(", "),
    by,
    ...(album.year ? { year: album.year } : {}),
    ...(album.created ? { added: album.created } : {}),
    onPlay: () => void playAlbum(album.id, album.name),
  };
}

export function artistItem(artist: Artist, subtitle = "Artist"): CollectionItem {
  return {
    key: artist.id,
    to: artistPath(artist.id),
    art: (px) => <Art id={artist.coverArt} px={px} round fallback="artist" />,
    title: artist.name,
    subtitle,
    by: artist.name,
    ...(isSpotify(artist.id) ? {} : { onPlay: () => void playArtist(artist) }),
  };
}

const CARD_ART = 180;

export function ItemCard({ item }: { item: CollectionItem }) {
  return <Card to={item.to} art={item.art(CARD_ART)} title={item.title} subtitle={item.subtitle} {...(item.onPlay ? { onPlay: item.onPlay } : {})} />;
}

export const AlbumCard = ({ album, subtitle }: { album: Album; subtitle?: string }) => <ItemCard item={albumItem(album, subtitle)} />;

export const ArtistCard = ({ artist, subtitle }: { artist: Artist; subtitle?: string }) => <ItemCard item={artistItem(artist, subtitle)} />;

export function RowHeader({ title, subtitle, to, action }: { title: string; subtitle?: string; to?: string; action?: ReactNode }) {
  return (
    <div className="row-h">
      <div>
        <h2>{to ? <Link to={to}>{title}</Link> : title}</h2>
        {subtitle ? <p className="sub">{subtitle}</p> : null}
      </div>
      {action ?? (to ? <Link to={to} className="show-all">Show all</Link> : null)}
    </div>
  );
}

export function CardRow({ children, grid = false, dense = false }: { children: ReactNode; grid?: boolean; dense?: boolean }) {
  return <div className={["cards", grid ? "grid" : "", dense ? "dense" : ""].filter(Boolean).join(" ")}>{children}</div>;
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
