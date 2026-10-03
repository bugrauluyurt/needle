import { Icon } from "./Icon.tsx";
import type { MusicSource } from "@needle/shared";
import { translate } from "../i18n/index.ts";

export function SpotifyMark({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  return (
    <span
      className={["sp-badge", compact ? "compact" : "", className ?? ""]
        .filter(Boolean)
        .join(" ")}
      role="img"
      aria-label={translate("source.fromSpotify")}
      title={translate("source.fromSpotify")}
    >
      <Icon name="waves" size={compact ? 16 : 17} />
      {compact ? (
        <span className="sr-only">{translate("source.fromSpotify")}</span>
      ) : (
        translate("source.spotify")
      )}
    </span>
  );
}

export function SourceMark({
  source,
  compact = false,
  className,
}: {
  source?: MusicSource | undefined;
  compact?: boolean;
  className?: string;
}) {
  if (source === "spotify")
    return (
      <SpotifyMark compact={compact} {...(className ? { className } : {})} />
    );

  if (source === "youtubeMusic")
    return (
      <span
        className={["yt-badge", compact ? "compact" : "", className ?? ""]
          .filter(Boolean)
          .join(" ")}
        role="img"
        aria-label={translate("source.fromYouTubeMusic")}
        title={translate("source.fromYouTubeMusic")}
      >
        <Icon name="play" size={compact ? 16 : 17} />
        {compact ? (
          <span className="sr-only">
            {translate("source.fromYouTubeMusic")}
          </span>
        ) : (
          translate("source.youtubeMusic")
        )}
      </span>
    );

  return (
    <span
      className={[
        "sp-badge",
        "library-badge",
        compact ? "compact" : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      role="img"
      aria-label={translate("source.fromLibrary")}
      title={translate("source.fromLibrary")}
    >
      <Icon name="library" size={compact ? 16 : 17} />
      {compact ? (
        <span className="sr-only">{translate("source.fromLibrary")}</span>
      ) : (
        translate("source.library")
      )}
    </span>
  );
}
