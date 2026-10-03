import { Link } from "react-router";
import { useYouTubeMusicStatus } from "../api/client.ts";
import { useCapabilities } from "../../../queries/hooks.ts";
import { Icon } from "../../../components/Icon.tsx";
import { i18next, translate } from "../../../i18n/index.ts";

export function YouTubeMusicNotice({
  error,
  retry,
}: {
  error?: boolean;
  retry?: () => void;
}) {
  const capabilities = useCapabilities().data;
  const { blocked, until } = useYouTubeMusicStatus();
  const reconnect = capabilities?.youtubeMusicReconnect;

  if (
    !capabilities?.youtubeMusicEnabled ||
    !capabilities.youtubeMusicConnected ||
    (!blocked && !error && !reconnect)
  )
    return null;

  return (
    <div className="yt-notice" role="status">
      <Icon name="info" size={18} />
      <div>
        <b>
          {translate(
            reconnect
              ? "youtube.reconnect"
              : blocked
                ? "youtube.paused"
                : "youtube.answerFailed",
          )}
        </b>
        <p>
          {reconnect
            ? translate("youtube.reconnectHint")
            : blocked
              ? translate("youtube.pausedHint", {
                  time: new Date(until).toLocaleTimeString(
                    i18next.resolvedLanguage,
                    { hour: "numeric", minute: "2-digit" },
                  ),
                })
              : translate("youtube.answerFailedHint")}
        </p>
        {reconnect ? (
          <Link className="show-all" to="/settings">
            {translate("youtube.openSettings")}
          </Link>
        ) : retry && !blocked ? (
          <button type="button" className="show-all" onClick={retry}>
            {translate("common.retry")}
          </button>
        ) : null}
      </div>
    </div>
  );
}
