import { Icon } from "./Icon.tsx";

export function SpotifyMark({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <span className={["sp-badge", compact ? "compact" : "", className ?? ""].filter(Boolean).join(" ")} role="img" aria-label="From Spotify" title="From Spotify">
      <Icon name="waves" size={compact ? 16 : 17} />
      {compact ? <span className="sr-only">From Spotify</span> : "Spotify"}
    </span>
  );
}

export function SourceMark({ source, compact = false, className }: { source?: "spotify" | undefined; compact?: boolean; className?: string }) {
  if (source === "spotify") return <SpotifyMark compact={compact} {...(className ? { className } : {})} />;

  return (
    <span className={["sp-badge", "library-badge", compact ? "compact" : "", className ?? ""].filter(Boolean).join(" ")} role="img" aria-label="From your library" title="From your library">
      <Icon name="library" size={compact ? 16 : 17} />
      {compact ? <span className="sr-only">From your library</span> : "Library"}
    </span>
  );
}
