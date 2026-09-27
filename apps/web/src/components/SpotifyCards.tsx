import type { ReactNode } from "react";
import { image, spId } from "../lib/spotify.ts";
import type { SpAlbumRef, SpArtist, SpPlaylist } from "../lib/spotify.ts";
import { player } from "../player/controller.ts";
import { queryClient } from "../queries/client.ts";
import { spotifyAlbumQuery, spotifyArtistQuery, spotifyPlaylistQuery } from "../queries/spotify.ts";
import { toast } from "../state/ui.ts";
import { Art } from "./Art.tsx";
import { Card } from "./Cards.tsx";

const years = (a: SpAlbumRef) => a.release_date?.slice(0, 4);

export async function playSpotifyAlbum(id: string, shuffle = false) {
  const { album, songs } = await queryClient.fetchQuery(spotifyAlbumQuery(id));
  player.playSongs(songs, 0, { kind: "album", id: spId(album.id), name: album.name, ordered: true }, { shuffle });
}

export async function playSpotifyArtist(id: string, shuffle = false) {
  const { artist, albums } = await queryClient.fetchQuery(spotifyArtistQuery(id));
  const picks = albums.filter((a) => a.album_type === "album").slice(0, 3);
  const loaded = await Promise.all((picks.length ? picks : albums.slice(0, 5)).map((a) => queryClient.fetchQuery(spotifyAlbumQuery(a.id))));
  player.playSongs(loaded.flatMap((a) => a.songs), 0, { kind: "artist", id: spId(artist.id), name: artist.name }, { shuffle });
}

export async function playSpotifyPlaylist(id: string, shuffle = false) {
  const { meta, songs } = await queryClient.fetchQuery(spotifyPlaylistQuery(id));
  if (!songs?.length) {
    toast(songs ? "This playlist is empty" : "Spotify doesn’t let Needle read this playlist");
    return;
  }
  player.playSongs(songs, 0, { kind: "playlist", id: spId(id), name: meta.name }, { shuffle });
}

const failed = () => toast("Spotify didn’t answer. Try again in a moment.");

export function SpotifyAlbumCard({ album, subtitle }: { album: SpAlbumRef; subtitle?: ReactNode }) {
  return (
    <Card
      to={`/spotify/album/${album.id}`}
      art={<Art id={image(album.images, 300)} px={180} />}
      title={album.name}
      subtitle={subtitle ?? [years(album), album.artists?.map((a) => a.name).join(", ")].filter(Boolean).join(", ")}
      onPlay={() => void playSpotifyAlbum(album.id).catch(failed)}
    />
  );
}

export function SpotifyArtistCard({ artist }: { artist: SpArtist }) {
  return (
    <Card
      to={`/spotify/artist/${artist.id}`}
      art={<Art id={image(artist.images, 300)} px={180} round fallback="artist" />}
      title={artist.name}
      subtitle="Artist"
      onPlay={() => void playSpotifyArtist(artist.id).catch(failed)}
    />
  );
}

export function SpotifyPlaylistCard({ playlist }: { playlist: SpPlaylist }) {
  return (
    <Card
      to={`/spotify/playlist/${playlist.id}`}
      art={<Art id={image(playlist.images, 300)} px={180} />}
      title={playlist.name}
      subtitle={`Playlist, ${playlist.owner.display_name ?? playlist.owner.id}`}
      onPlay={() => void playSpotifyPlaylist(playlist.id).catch(failed)}
    />
  );
}

export function SpotifyBadge() {
  return <span className="sp-badge">Spotify</span>;
}
