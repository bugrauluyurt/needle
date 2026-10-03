import { useSpotifyStatus } from "../api/client.ts";
import { useSpotifyOn } from "../hooks/useSpotify.ts";
import { i18next, translate } from "../../../i18n/index.ts";

export function SpotifyNotice() {
  const on = useSpotifyOn();
  const { blocked, until } = useSpotifyStatus();
  if (!on || !blocked) return null;
  const retryAt = new Date(until);
  return (
    <aside className="spotify-notice" role="status" aria-live="polite" aria-label={translate("spotify.status")}>
      <strong>{translate("spotify.paused")}</strong>
      <p>
        {translate("spotify.pausedHintPrefix")}{" "}
        <time dateTime={retryAt.toISOString()}>
          {retryAt.toLocaleString(i18next.resolvedLanguage, {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </time>
        .
      </p>
    </aside>
  );
}
