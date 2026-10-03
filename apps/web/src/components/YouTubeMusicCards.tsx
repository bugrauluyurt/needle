import { youtubeMusicRawId } from "@needle/shared";
import type { YouTubeMusicAlbum, YouTubeMusicArtist, YouTubeMusicPlaylist } from "@needle/shared";
import { player } from "../player/controller.ts";
import { queryClient } from "../queries/client.ts";
import { youtubeMusicAlbumQuery, youtubeMusicArtistQuery, youtubeMusicPlaylistQuery } from "../queries/youtube-music.ts";
import { toast } from "../state/ui.ts";
import { Art } from "./Art.tsx";
import { ItemCard } from "./Cards.tsx";
import type { CollectionItem } from "./Collection.tsx";

const playbackFailed = () => toast("YouTube Music didn’t answer. Try again in a moment.");

export async function playYouTubeMusicAlbum(id: string) {
  const { album, songs } = await queryClient.fetchQuery(youtubeMusicAlbumQuery(id));

  player.playSongs(songs, 0, { kind: "album", id: album.id, name: album.title, ordered: true });
}

export async function playYouTubeMusicArtist(id: string) {
  const { artist, songs } = await queryClient.fetchQuery(youtubeMusicArtistQuery(id));

  player.playSongs(songs, 0, { kind: "artist", id: artist.id, name: artist.name });
}

export async function playYouTubeMusicPlaylist(id: string) {
  const { playlist, songs } = await queryClient.fetchQuery(youtubeMusicPlaylistQuery(id));

  if (!songs.items.length) return toast("This playlist is empty");

  player.playSongs(songs.items, 0, { kind: "playlist", id: playlist.id, name: playlist.title });
}

export function youtubeMusicAlbumItem(album: YouTubeMusicAlbum, subtitle?: string): CollectionItem {
  const artistNames = album.artists.map((artist) => artist.name).join(", ");

  return {
    key: album.id,
    to: `/youtube-music/album/${youtubeMusicRawId(album.id)}`,
    art: (pixels) => <Art images={album.images} px={pixels} />,
    title: album.title,
    subtitle: subtitle ?? [album.year, artistNames].filter(Boolean).join(", "),
    by: artistNames,
    contextId: album.id,
    source: "youtubeMusic",
    ...(album.year ? { year: album.year } : {}),
    onPlay: () => void playYouTubeMusicAlbum(album.id).catch(playbackFailed),
  };
}

export function youtubeMusicArtistItem(artist: YouTubeMusicArtist): CollectionItem {
  return {
    key: artist.id,
    to: `/youtube-music/artist/${youtubeMusicRawId(artist.id)}`,
    art: (pixels) => <Art images={artist.images} px={pixels} round fallback="artist" />,
    title: artist.name,
    subtitle: "Artist you follow on YouTube Music",
    by: artist.name,
    contextId: artist.id,
    source: "youtubeMusic",
    onPlay: () => void playYouTubeMusicArtist(artist.id).catch(playbackFailed),
  };
}

export function youtubeMusicPlaylistItem(playlist: YouTubeMusicPlaylist): CollectionItem {
  return {
    key: playlist.id,
    to: `/youtube-music/playlist/${youtubeMusicRawId(playlist.id)}`,
    art: (pixels) => <Art images={playlist.images} px={pixels} />,
    title: playlist.title,
    subtitle: ["Playlist", playlist.author].filter(Boolean).join(", "),
    by: playlist.author ?? "",
    contextId: playlist.id,
    source: "youtubeMusic",
    onPlay: () => void playYouTubeMusicPlaylist(playlist.id).catch(playbackFailed),
  };
}

export const YouTubeMusicAlbumCard = ({ album }: { album: YouTubeMusicAlbum }) => <ItemCard item={youtubeMusicAlbumItem(album)} />;
export const YouTubeMusicPlaylistCard = ({ playlist }: { playlist: YouTubeMusicPlaylist }) => <ItemCard item={youtubeMusicPlaylistItem(playlist)} />;
