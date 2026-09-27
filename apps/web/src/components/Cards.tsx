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

export function AlbumCard({ album, subtitle }: { album: Album; subtitle?: ReactNode }) {
  return (
    <Card
      to={`/album/${album.id}`}
      art={<Art id={album.coverArt} px={180} />}
      title={album.name}
      subtitle={subtitle ?? [album.year, album.displayArtist ?? album.artist].filter(Boolean).join(", ")}
      onPlay={() => void playAlbum(album.id, album.name)}
    />
  );
}

export function ArtistCard({ artist, subtitle = "Artist" }: { artist: Artist; subtitle?: ReactNode }) {
  return (
    <Card
      to={artistPath(artist.id)}
      art={<Art id={artist.coverArt} px={180} round fallback="artist" />}
      title={artist.name}
      subtitle={subtitle}
      {...(isSpotify(artist.id) ? {} : { onPlay: () => void playArtist(artist) })}
    />
  );
}

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

export function CardRow({ children, grid = false }: { children: ReactNode; grid?: boolean }) {
  return <div className={grid ? "cards grid" : "cards"}>{children}</div>;
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
