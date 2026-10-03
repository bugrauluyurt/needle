import { isYouTubeMusic, youtubeMusicRawId } from "@needle/shared";
import { isSpotify, rawId } from "./spotify.ts";

export const albumPath = (id: string) =>
  isYouTubeMusic(id)
    ? `/youtube-music/album/${youtubeMusicRawId(id)}`
    : isSpotify(id)
      ? `/spotify/album/${rawId(id)}`
      : `/album/${id}`;
export const artistPath = (id: string) =>
  isYouTubeMusic(id)
    ? `/youtube-music/artist/${youtubeMusicRawId(id)}`
    : isSpotify(id)
      ? `/spotify/artist/${rawId(id)}`
      : `/artist/${id}`;
