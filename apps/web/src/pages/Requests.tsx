import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import type { DownloadItem, RequestItem } from "@needle/shared";
import { RemoteCover } from "../components/GetCard.tsx";
import { Icon } from "../components/Icon.tsx";
import { RequestState } from "../components/RequestState.tsx";
import { api } from "../lib/api.ts";
import { ago } from "../lib/format.ts";
import { MobileHeader } from "../layout/Mobile.tsx";
import { useIsMobile, usePageTone } from "../layout/Shell.tsx";
import { TopBar } from "../layout/TopBar.tsx";
import { useCapabilities, useLidarrDownloads, useRequests } from "../queries/hooks.ts";
import { keys } from "../queries/keys.ts";
import { toast } from "../state/ui.ts";

const RETRY = new Set<RequestItem["state"]>(["failed", "wanted", "missing"]);

function RequestRow({ r }: { r: RequestItem }) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: keys.requests });
  const retry = () => void api.retryRequest(r.id).then(refresh, (e: unknown) => toast(e instanceof Error ? e.message : "Couldn’t try again"));
  return (
    <li className="req-row">
      <RemoteCover url={r.coverUrl} />
      <div className="req-text">
        <div className="t">{r.title}</div>
        <div className="s">{r.kind === "album" ? "Album" : "Song"}, {r.artist}, {ago(new Date(r.created).toISOString())}</div>
        <RequestState kind={r.kind} state={r.state} progress={r.progress} detail={r.detail} />
      </div>
      <div className="req-acts">
        {r.state === "available" ? (
          <Link className="btn ghost sm" to={`/search?q=${encodeURIComponent(`${r.artist} ${r.title}`)}`}>Open</Link>
        ) : RETRY.has(r.state) ? (
          <button type="button" className="btn ghost sm" onClick={retry}>Try again</button>
        ) : null}
        <button type="button" className="icon-btn" aria-label={`Remove ${r.title} from this list`} onClick={() => void api.removeRequest(r.id).then(refresh)}>
          <Icon name="close" size={18} />
        </button>
      </div>
    </li>
  );
}

const ACTIVE_SONG = new Set<RequestItem["state"]>(["searching", "downloading", "moving"]);

function DownloadRow({ d }: { d: DownloadItem }) {
  return (
    <li className="req-row">
      <RemoteCover url={d.coverUrl} />
      <div className="req-text">
        <div className="t">{d.title}</div>
        <div className="s">Album, {d.artist}</div>
        <RequestState state={d.state} progress={d.progress} detail={d.detail} />
      </div>
    </li>
  );
}

function DownloadingNow() {
  const lidarr = Boolean(useCapabilities().data?.lidarr);
  const { data: downloads = [] } = useLidarrDownloads(lidarr);
  const { data: requests = [] } = useRequests();
  const songs = requests.filter((r) => r.kind === "song" && ACTIVE_SONG.has(r.state));
  return (
    <section className="req-section" aria-label="Downloading now">
      <h2>Downloading now</h2>
      {downloads.length || songs.length ? (
        <ul className="req-list">
          {downloads.map((d) => <DownloadRow key={`d${d.id}`} d={d} />)}
          {songs.map((r) => <RequestRow key={`s${r.id}`} r={r} />)}
        </ul>
      ) : (
        <p className="muted">Nothing is downloading right now.</p>
      )}
    </section>
  );
}

export default function RequestsPage() {
  const mobile = useIsMobile();
  const { data, isLoading } = useRequests();
  usePageTone(null);
  return (
    <>
      {mobile ? <MobileHeader title="Requests" /> : <TopBar />}
      <div className="pad requests-page">
        {!mobile ? <h1 className="hello">Requests</h1> : null}
        <p className="muted req-intro">Everything Lidarr is downloading, and the albums and songs you asked for. Progress updates by itself.</p>
        <DownloadingNow />
        <h2 className="req-heading">Your requests</h2>
        {isLoading ? <p className="muted source-note"><span className="spin" />Loading your requests…</p> : null}
        {data?.length ? <ul className="req-list">{data.map((r) => <RequestRow key={r.id} r={r} />)}</ul> : null}
        {data && !data.length ? (
          <div className="empty-inline">
            <h2>Nothing requested yet</h2>
            <p className="muted">Search for music you don’t have, then pick Get album or Get song.</p>
          </div>
        ) : null}
      </div>
    </>
  );
}
