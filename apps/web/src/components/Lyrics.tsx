import { useEffect, useMemo, useRef } from "react";
import type { Song } from "@needle/shared";
import { songSource } from "@needle/shared";
import { lineAt, pickLyrics } from "../lib/lyrics.ts";
import { player } from "../player/controller.ts";
import { useProgress } from "../player/progress.ts";
import { useLyrics } from "../queries/hooks.ts";
import { useYouTubeMusicLyrics } from "../queries/youtube-music.ts";
import { Icon } from "./Icon.tsx";

const USER_SCROLL_PAUSE = 4_000;

export function LyricsView({
  song,
  variant,
  limit,
}: {
  song: Song;
  variant: "page" | "panel" | "mobile" | "peek";
  limit?: number;
}) {
  const source = songSource(song);
  const localLyrics = useLyrics(source === "library" ? song.id : undefined);
  const youtubeMusicLyrics = useYouTubeMusicLyrics(source === "youtubeMusic" ? song.id : undefined);
  const data = source === "youtubeMusic" ? youtubeMusicLyrics.data?.lyrics : localLyrics.data;
  const isLoading = source === "youtubeMusic" ? youtubeMusicLyrics.isLoading : localLyrics.isLoading;
  const lyrics = useMemo(() => pickLyrics(data), [data]);
  const lines = useMemo(() => lyrics?.line ?? [], [lyrics]);
  const offset = lyrics?.offset ?? 0;
  const synced = Boolean(lyrics?.synced);
  const active = useProgress((p) => (synced ? lineAt(lines, p.position * 1000 + offset + 150) : -1));
  const box = useRef<HTMLDivElement>(null);
  const userScrolled = useRef(0);

  useEffect(() => {
    if (!synced || active < 0 || Date.now() - userScrolled.current < USER_SCROLL_PAUSE) return;
    const el = box.current?.querySelector<HTMLElement>(`[data-line="${active}"]`);
    el?.scrollIntoView({ block: variant === "peek" ? "start" : "center", behavior: "smooth" });
  }, [active, synced, variant]);

  if (isLoading) {
    return (
      <div className={`lyrics ${variant}`} aria-busy="true">
        {[70, 55, 80, 62].map((w, i) => (
          <div key={i} className="skeleton lyric-skel" style={{ width: `${w}%` }} />
        ))}
      </div>
    );
  }
  if (!lines.length) {
    return (
      <div className={`lyrics ${variant} none`}>
        <p className="lyrics-none">No lyrics for this song</p>
        {variant !== "peek" ? (
          <p className="lyrics-hint">
            {source === "spotify"
              ? "Spotify doesn’t share lyrics with other apps."
              : source === "youtubeMusic"
                ? "YouTube Music has no lyrics available for this song."
                : "Needle shows the words saved in the song’s file, or in a .lrc file next to it."}
          </p>
        ) : null}
      </div>
    );
  }
  const shown = limit ? lines.slice(Math.max(0, active), Math.max(0, active) + limit) : lines;
  const base = limit ? Math.max(0, active) : 0;
  return (
    <div
      ref={box}
      className={`lyrics ${variant} ${synced ? "synced" : "plain"}`}
      onWheel={() => (userScrolled.current = Date.now())}
      onTouchMove={() => (userScrolled.current = Date.now())}
    >
      {variant === "page" ? (
        <p className="lyrics-src">
          <Icon name="mic" size={15} />
          {source === "youtubeMusic"
            ? `Lyrics from ${youtubeMusicLyrics.data?.source ?? "YouTube Music"}${synced ? ", timed" : ". These aren’t timed, so they don’t follow along."}`
            : synced
              ? "Lyrics, timed, from the song’s file"
              : "Lyrics from the song’s file. These aren’t timed, so they don’t follow along."}
        </p>
      ) : null}
      {shown.map((l, i) => {
        const idx = base + i;
        const state = !synced ? "" : idx < active ? "past" : idx === active ? "now" : "";
        return (
          <p
            key={idx}
            data-line={idx}
            className={`lyric ${state}`}
            {...(synced && l.start !== undefined
              ? {
                  role: "button",
                  tabIndex: 0,
                  onClick: () => player.seek((l.start ?? 0) / 1000),
                  onKeyDown: (e) => e.key === "Enter" && player.seek((l.start ?? 0) / 1000),
                }
              : {})}
          >
            {l.value || "♪"}
          </p>
        );
      })}
    </div>
  );
}
