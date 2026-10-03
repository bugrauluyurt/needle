import { useCallback } from "react";
import type { Song } from "@needle/shared";
import { songSource } from "@needle/shared";
import { useStarredIds, useToggleStar } from "./hooks.ts";
import { useSpotifySaved, useToggleSpotifySave } from "./spotify.ts";
import { useYouTubeMusicSaved, useToggleYouTubeMusicSave } from "./youtube-music.ts";

export function useSongLikes() {
  const starred = useStarredIds();
  const saved = useSpotifySaved();
  const star = useToggleStar();
  const save = useToggleSpotifySave();
  const youtubeMusicSaved = useYouTubeMusicSaved();
  const youtubeMusicSave = useToggleYouTubeMusicSave();
  const isLiked = (song: Song) => songSource(song) === "youtubeMusic" ? youtubeMusicSaved.has(song.id) : songSource(song) === "spotify" ? saved.has(song.id) : starred.songs.has(song.id);
  const setLiked = useCallback(
    (song: Song, on: boolean) => songSource(song) === "youtubeMusic" ? youtubeMusicSave.mutate({ song, on }) : songSource(song) === "spotify" ? save.mutate({ song, on }) : star.mutate({ kind: "song", item: song, on }),
    [save, star, youtubeMusicSave],
  );
  return { isLiked, setLiked };
}
