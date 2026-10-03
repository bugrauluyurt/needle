import type { DownloadItem, RequestItem } from "@needle/shared";

type State = RequestItem["state"] | DownloadItem["state"];

const LABELS: Record<State, string> = {
  queued: "Waiting to start",
  missing: "Not requested",
  wanted: "Waiting for a source",
  searching: "Searching indexers",
  downloading: "Downloading",
  importing: "Adding to your library",
  moving: "Adding to your library",
  available: "In your library",
  failed: "Didn’t work",
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
        {LABELS.downloading}, {pct}%
      </div>
    );
  }
  if (state === "available") return <div className="get-state ok">{LABELS.available}</div>;
  if (state === "failed") return <div className="get-state bad">{detail ?? LABELS.failed}</div>;
  return (
    <div className="get-state">
      {state === "missing" ? null : <span className="spin" />}
      {kind === "song" && state === "searching" ? "Searching Soulseek" : LABELS[state]}
    </div>
  );
}
