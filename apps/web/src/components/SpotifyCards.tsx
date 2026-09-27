import { spId } from "../lib/spotify.ts";
import type { SpAlbumRef, SpArtist, SpPlaylist } from "../lib/spotify.ts";
import { player } from "../player/controller.ts";
import { queryClient } from "../queries/client.ts";
import { spotifyAlbumQuery, spotifyArtistSongs, spotifyPlaylistQuery } from "../queries/spotify.ts";
import { toast } from "../state/ui.ts";
import { Art } from "./Art.tsx";
import { ItemCard } from "./Cards.tsx";
import type { CollectionItem } from "./Collection.tsx";

export const releaseYear = (a: SpAlbumRef) => a.release_date?.slice(0, 4);

export async function playSpotifyAlbum(id: string, shuffle = false) {
  const { album, songs } = await queryClient.fetchQuery(spotifyAlbumQuery(id));
  player.playSongs(songs, 0, { kind: "album", id: spId(album.id), name: album.name, ordered: true }, { shuffle });
}

export async function playSpotifyArtist(id: string, shuffle = false) {
  const { artist, songs } = await spotifyArtistSongs(id);
  player.playSongs(songs, 0, { kind: "artist", id: spId(artist.id), name: artist.name }, { shuffle });
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

export function spotifyAlbumItem(album: SpAlbumRef & { added_at?: string }, subtitle?: string): CollectionItem {
  const by = album.artists?.map((a) => a.name).join(", ") ?? "";
  const year = Number.parseInt(album.release_date ?? "", 10);
  return {
    key: album.id,
    to: `/spotify/album/${album.id}`,
    art: (px) => <Art images={album.images} px={px} />,
    title: album.name,
    subtitle: subtitle ?? [releaseYear(album), by].filter(Boolean).join(", "),
    by,
    contextId: spId(album.id),
    ...(Number.isNaN(year) ? {} : { year }),
    ...(album.added_at ? { added: album.added_at } : {}),
    onPlay: () => void playSpotifyAlbum(album.id).catch(failed),
  };
}

export function spotifyArtistItem(artist: SpArtist): CollectionItem {
  return {
    key: artist.id,
    to: `/spotify/artist/${artist.id}`,
    art: (px) => <Art images={artist.images} px={px} round fallback="artist" />,
    title: artist.name,
    subtitle: "Artist",
    by: artist.name,
    contextId: spId(artist.id),
    onPlay: () => void playSpotifyArtist(artist.id).catch(failed),
  };
}

export function spotifyPlaylistItem(playlist: SpPlaylist): CollectionItem {
  const by = playlist.owner.display_name ?? playlist.owner.id;
  return {
    key: playlist.id,
    to: `/spotify/playlist/${playlist.id}`,
    art: (px) => <Art images={playlist.images} px={px} />,
    title: playlist.name,
    subtitle: `Playlist, ${by}`,
    by,
    contextId: spId(playlist.id),
    onPlay: () => void playSpotifyPlaylist(playlist.id).catch(failed),
  };
}

export const SpotifyAlbumCard = ({ album, subtitle }: { album: SpAlbumRef; subtitle?: string }) => <ItemCard item={spotifyAlbumItem(album, subtitle)} />;
export const SpotifyPlaylistCard = ({ playlist }: { playlist: SpPlaylist }) => <ItemCard item={spotifyPlaylistItem(playlist)} />;

export function SpotifyBadge() {
  return <span className="sp-badge">Spotify</span>;
}
