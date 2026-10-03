import { Link } from "react-router";
import { useYouTubeMusicStatus } from "../lib/youtube-music.ts";
import { useCapabilities } from "../queries/hooks.ts";
import { Icon } from "./Icon.tsx";

export function YouTubeMusicNotice({ error, retry }: { error?: boolean; retry?: () => void }) {
  const capabilities = useCapabilities().data;
  const { blocked, until } = useYouTubeMusicStatus();
  const reconnect = capabilities?.youtubeMusicReconnect;

  if (!capabilities?.youtubeMusicEnabled || !capabilities.youtubeMusicConnected || !blocked && !error && !reconnect) return null;

  return (
    <div className="yt-notice" role="status">
      <Icon name="info" size={18} />
      <div>
        <b>{reconnect ? "Reconnect YouTube Music" : blocked ? "YouTube Music requests are paused" : "YouTube Music didn’t answer"}</b>
        <p>{reconnect ? "Open Settings to reconnect your account." : blocked ? `Previously loaded music stays visible. Needle will try again at ${new Date(until).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.` : "Try again in a moment. Your other music is still available."}</p>
        {reconnect ? <Link className="show-all" to="/settings">Open Settings</Link> : retry && !blocked ? <button type="button" className="show-all" onClick={retry}>Try again</button> : null}
      </div>
    </div>
  );
}
