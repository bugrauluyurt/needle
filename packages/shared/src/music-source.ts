import type { Song } from "./subsonic.ts";

export type MusicSource = "library" | "spotify" | "youtubeMusic";

export type RemoteImage = { url: string; width?: number | null; height?: number | null };

export function musicSource(id: string | undefined): MusicSource {
  if (id?.startsWith("sp:")) return "spotify";
  if (id?.startsWith("ytm:")) return "youtubeMusic";

  return "library";
}

export function songSource(song: Pick<Song, "id" | "source">): MusicSource {
  return song.source ?? musicSource(song.id);
}

export const isLocalSong = (song: Pick<Song, "id" | "source">): boolean => songSource(song) === "library";

export const isYouTubeMusic = (id: string | undefined): boolean => musicSource(id) === "youtubeMusic";

export const youtubeMusicId = (id: string): string => (id.startsWith("ytm:") ? id : `ytm:${id}`);

export const youtubeMusicRawId = (id: string): string => (id.startsWith("ytm:") ? id.slice(4) : id);

export function youtubeMusicLink(kind: "song" | "album" | "artist" | "playlist", id: string): string {
  const rawId = youtubeMusicRawId(id);

  if (kind === "song") return `https://music.youtube.com/watch?v=${encodeURIComponent(rawId)}`;
  if (kind === "playlist") return `https://music.youtube.com/playlist?list=${encodeURIComponent(rawId)}`;

  return `https://music.youtube.com/browse/${encodeURIComponent(rawId)}`;
}
