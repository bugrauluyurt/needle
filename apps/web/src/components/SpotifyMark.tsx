import { Icon } from "./Icon.tsx";
import type { MusicSource } from "@needle/shared";

export function SpotifyMark({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <span className={["sp-badge", compact ? "compact" : "", className ?? ""].filter(Boolean).join(" ")} role="img" aria-label="From Spotify" title="From Spotify">
      <Icon name="waves" size={compact ? 16 : 17} />
      {compact ? <span className="sr-only">From Spotify</span> : "Spotify"}
    </span>
  );
}

export function SourceMark({ source, compact = false, className }: { source?: MusicSource | undefined; compact?: boolean; className?: string }) {
  if (source === "spotify") return <SpotifyMark compact={compact} {...(className ? { className } : {})} />;

  if (source === "youtubeMusic") return (
    <span className={["yt-badge", compact ? "compact" : "", className ?? ""].filter(Boolean).join(" ")} role="img" aria-label="From YouTube Music" title="From YouTube Music">
      <Icon name="play" size={compact ? 16 : 17} />
      {compact ? <span className="sr-only">From YouTube Music</span> : "YouTube Music"}
    </span>
  );

  return (
    <span className={["sp-badge", "library-badge", compact ? "compact" : "", className ?? ""].filter(Boolean).join(" ")} role="img" aria-label="From your library" title="From your library">
      <Icon name="library" size={compact ? 16 : 17} />
      {compact ? <span className="sr-only">From your library</span> : "Library"}
    </span>
  );
}
