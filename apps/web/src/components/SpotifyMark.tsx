import { Icon } from "./Icon.tsx";

export function SpotifyMark({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <span className={["sp-badge", compact ? "compact" : "", className ?? ""].filter(Boolean).join(" ")} title="From Spotify">
      <Icon name="waves" size={compact ? 12 : 13} />
      {compact ? <span className="sr-only">From Spotify</span> : "Spotify"}
    </span>
  );
}
