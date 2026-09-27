import { useCallback } from "react";
import type { Song } from "@needle/shared";
import { useStarredIds, useToggleStar } from "./hooks.ts";
import { useSpotifySaved, useToggleSpotifySave } from "./spotify.ts";

export function useSongLikes() {
  const starred = useStarredIds();
  const saved = useSpotifySaved();
  const star = useToggleStar();
  const save = useToggleSpotifySave();
  const isLiked = (song: Song) => (song.source === "spotify" ? saved.has(song.id) : starred.songs.has(song.id));
  const setLiked = useCallback(
    (song: Song, on: boolean) => (song.source === "spotify" ? save.mutate({ song, on }) : star.mutate({ kind: "song", item: song, on })),
    [save, star],
  );
  return { isLiked, setLiked };
}
