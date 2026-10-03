import type { DownloadItem, RequestItem } from "@needle/shared";
import { translate } from "../i18n/index.ts";
import type { TranslationKey } from "../i18n/locales/en.ts";

type State = RequestItem["state"] | DownloadItem["state"];

const LABELS: Record<State, TranslationKey> = {
  queued: "requestState.queued",
  missing: "requestState.missing",
  wanted: "requestState.wanted",
  searching: "requestState.searching",
  downloading: "requestState.downloading",
  importing: "requestState.importing",
  moving: "requestState.moving",
  available: "requestState.available",
  failed: "requestState.failed",
};

export function RequestState({
  state,
  progress,
  detail,
  kind = "album",
}: {
  state: State;
  progress: number | null;
  detail?: string | null;
  kind?: RequestItem["kind"];
}) {
  const pct = Math.round((progress ?? 0) * 100);
  if (state === "downloading") {
    return (
      <div className="get-state">
        <div className="line static" style={{ "--p": `${pct}%` } as React.CSSProperties}>
          <i />
        </div>
        {translate(LABELS.downloading)}, {pct}%
      </div>
    );
  }
  if (state === "available") return <div className="get-state ok">{translate(LABELS.available)}</div>;
  if (state === "failed") return <div className="get-state bad">{detail ?? translate(LABELS.failed)}</div>;
  return (
    <div className="get-state">
      {state === "missing" ? null : <span className="spin" />}
      {translate(kind === "song" && state === "searching" ? "requestState.soulseek" : LABELS[state])}
    </div>
  );
}
