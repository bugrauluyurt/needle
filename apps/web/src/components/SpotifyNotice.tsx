import { useSpotifyStatus } from "../lib/spotify.ts";
import { useSpotifyOn } from "../queries/spotify.ts";

export function SpotifyNotice() {
  const on = useSpotifyOn();
  const { blocked, until } = useSpotifyStatus();
  if (!on || !blocked) return null;
  const retryAt = new Date(until);
  return (
    <aside className="spotify-notice" role="status" aria-live="polite" aria-label="Spotify status">
      <strong>Spotify requests are paused</strong>
      <p>
        Previously loaded Spotify items are still shown. Requests resume automatically at{" "}
        <time dateTime={retryAt.toISOString()}>
          {retryAt.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
        </time>
        .
      </p>
    </aside>
  );
}
