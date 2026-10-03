import { useEffect, useSyncExternalStore } from "react";
import { usePlayer } from "../player/store.ts";
import { useUi } from "../state/ui.ts";
import { translate } from "../i18n/index.ts";

function useOnline(): boolean {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener("online", cb);
      window.addEventListener("offline", cb);
      return () => {
        window.removeEventListener("online", cb);
        window.removeEventListener("offline", cb);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}

export function Toasts() {
  const online = useOnline();
  const toasts = useUi((s) => s.toasts);
  const error = usePlayer((s) => s.error);
  useEffect(() => {
    if (!error) return;
    const t = window.setTimeout(
      () => usePlayer.setState({ error: null }),
      5000,
    );
    return () => window.clearTimeout(t);
  }, [error]);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {!online ? (
        <div className="toast offline">{translate("offline.message")}</div>
      ) : null}
      {error ? <div className="toast error">{error}</div> : null}
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          {t.message}
          {t.action ? (
            <button type="button" onClick={t.action.run}>
              {t.action.label}
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
