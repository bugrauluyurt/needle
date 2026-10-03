import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import type { DownloadItem, RequestItem } from "@needle/shared";
import { RemoteCover } from "../components/GetCard.tsx";
import { Icon } from "../components/Icon.tsx";
import { RequestState } from "../components/RequestState.tsx";
import { api } from "../lib/api.ts";
import { ago } from "../lib/format.ts";
import { MobileHeader } from "../layout/Mobile.tsx";
import { useIsMobile } from "../lib/media.ts";
import { usePageTone } from "../layout/pageTone.ts";
import { TopBar } from "../layout/TopBar.tsx";
import {
  useCapabilities,
  useEveryonesRequests,
  useLidarrDownloads,
  useRequests,
} from "../queries/hooks.ts";
import { keys } from "../queries/keys.ts";
import { toast } from "../state/ui.ts";
import { translate } from "../i18n/index.ts";

const RETRY = new Set<RequestItem["state"]>(["failed", "wanted", "missing"]);

function RequestRow({ r }: { r: RequestItem }) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: keys.requests });
  const mine = r.user === undefined;
  const retry = () =>
    void api
      .retryRequest(r.id)
      .then(refresh, (e: unknown) =>
        toast(
          e instanceof Error ? e.message : translate("requests.retryFailed"),
        ),
      );
  return (
    <li className="req-row">
      <RemoteCover
        url={r.coverUrl}
        record={r.kind === "album" ? r.ref : undefined}
      />
      <div className="req-text">
        <div className="t">{r.title}</div>
        <div className="s">
          {translate(
            r.kind === "album" ? "requests.kindAlbum" : "requests.kindSong",
          )}
          , {r.artist},{" "}
          {mine
            ? ""
            : `${translate("requests.askedBy", { user: r.user ?? "" })} `}
          {ago(new Date(r.created).toISOString())}
        </div>
        <RequestState
          kind={r.kind}
          state={r.state}
          progress={r.progress}
          detail={r.detail}
        />
      </div>
      <div className="req-acts">
        {r.state === "available" ? (
          <Link
            className="btn ghost sm"
            to={`/search?q=${encodeURIComponent(`${r.artist} ${r.title}`)}`}
          >
            {translate("common.open")}
          </Link>
        ) : mine && RETRY.has(r.state) ? (
          <button type="button" className="btn ghost sm" onClick={retry}>
            {translate("common.retry")}
          </button>
        ) : null}
        <button
          type="button"
          className="icon-btn"
          aria-label={translate("requests.removeList", { title: r.title })}
          onClick={() => void api.removeRequest(r.id).then(refresh)}
        >
          <Icon name="close" size={18} />
        </button>
      </div>
    </li>
  );
}

const ACTIVE_SONG = new Set<RequestItem["state"]>([
  "searching",
  "downloading",
  "moving",
]);

function DownloadRow({ d }: { d: DownloadItem }) {
  const qc = useQueryClient();
  const remove = (findAnother: boolean) =>
    void api.removeDownload(d.id, findAnother).then(
      () => {
        toast(
          translate(
            findAnother ? "requests.lookingAnother" : "requests.removed",
            { title: d.title },
          ),
        );
        void qc.invalidateQueries({ queryKey: keys.downloads });
        void qc.invalidateQueries({ queryKey: keys.requests });
      },
      (e: unknown) =>
        toast(
          e instanceof Error ? e.message : translate("requests.removeFailed"),
        ),
    );
  return (
    <li className="req-row">
      <RemoteCover url={d.coverUrl} record={String(d.id)} />
      <div className="req-text">
        <div className="t">{d.title}</div>
        <div className="s">
          {translate("requests.albumArtist", { artist: d.artist })}
        </div>
        <RequestState state={d.state} progress={d.progress} detail={d.detail} />
      </div>
      <div className="req-acts">
        {d.state === "failed" ? (
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => remove(true)}
          >
            {translate("requests.findAnother")}
          </button>
        ) : null}
        <button
          type="button"
          className="icon-btn"
          aria-label={translate("requests.removeDownload", { title: d.title })}
          onClick={() => remove(false)}
        >
          <Icon name="close" size={18} />
        </button>
      </div>
    </li>
  );
}

function DownloadingNow() {
  const { data: downloads = [] } = useLidarrDownloads(true);
  const { data: requests = [] } = useRequests();
  const songs = requests.filter(
    (r) => r.kind === "song" && ACTIVE_SONG.has(r.state),
  );
  return (
    <section
      className="req-section"
      aria-label={translate("requests.downloading")}
    >
      <h2>{translate("requests.downloading")}</h2>
      {downloads.length || songs.length ? (
        <ul className="req-list">
          {downloads.map((d) => (
            <DownloadRow key={`d${d.id}`} d={d} />
          ))}
          {songs.map((r) => (
            <RequestRow key={`s${r.id}`} r={r} />
          ))}
        </ul>
      ) : (
        <p className="muted">{translate("requests.emptyDownloads")}</p>
      )}
    </section>
  );
}

function EveryonesRequests() {
  const { data = [] } = useEveryonesRequests(true);
  if (!data.length) return null;
  return (
    <section
      className="req-section"
      aria-label={translate("requests.everyone")}
    >
      <h2 className="req-heading">{translate("requests.everyone")}</h2>
      <ul className="req-list">
        {data.map((r) => (
          <RequestRow key={r.id} r={r} />
        ))}
      </ul>
    </section>
  );
}

export default function RequestsPage() {
  const mobile = useIsMobile();
  const { data, isLoading } = useRequests();
  const admin = Boolean(useCapabilities().data?.admin);
  usePageTone(null);
  return (
    <>
      {mobile ? (
        <MobileHeader title={translate("requests.title")} />
      ) : (
        <TopBar />
      )}
      <div className="pad requests-page">
        {!mobile ? (
          <h1 className="hello">{translate("requests.title")}</h1>
        ) : null}
        <p className="muted req-intro">
          {translate(admin ? "requests.adminIntro" : "requests.userIntro")}
        </p>
        {admin ? <DownloadingNow /> : null}
        <h2 className="req-heading">{translate("requests.yours")}</h2>
        {isLoading ? (
          <p className="muted source-note">
            <span className="spin" />
            {translate("requests.loading")}
          </p>
        ) : null}
        {data?.length ? (
          <ul className="req-list">
            {data.map((r) => (
              <RequestRow key={r.id} r={r} />
            ))}
          </ul>
        ) : null}
        {data && !data.length ? (
          <div className="empty-inline">
            <h2>{translate("requests.empty")}</h2>
            <p className="muted">{translate("requests.emptyHint")}</p>
          </div>
        ) : null}
        {admin ? <EveryonesRequests /> : null}
      </div>
    </>
  );
}
