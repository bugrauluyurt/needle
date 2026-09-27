import { Link } from "react-router";
import { Art, LikedArt } from "../components/Art.tsx";
import { Icon } from "../components/Icon.tsx";
import { plural } from "../lib/format.ts";
import { MobileHeader } from "../layout/Mobile.tsx";
import { useIsMobile, usePageTone } from "../layout/Shell.tsx";
import { TopBar } from "../layout/TopBar.tsx";
import { offlineSongs, removeDownload, useOffline } from "../offline/store.ts";
import type { OfflineCollection } from "../offline/store.ts";
import { player } from "../player/controller.ts";
import { useSettings } from "../state/settings.ts";
import { deviceKind } from "../lib/device.ts";

const gb = (bytes: number) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`);

function Row({ c }: { c: OfflineCollection }) {
  const job = useOffline((s) => s.jobs[c.id]);
  const to = c.kind === "liked" ? "/liked" : `/${c.kind}/${c.id}`;
  const pct = job ? Math.round((job.done / Math.max(1, job.total)) * 100) : 100;
  const status = job
    ? job.waiting ? "Waiting for Wi-Fi" : job.done < job.total ? `Downloading ${job.done + 1} of ${job.total}` : `${plural(job.failed, "song")} didn’t download`
    : plural(c.songIds.length, "song");
  return (
    <div className="dl-row">
      <Link to={to} className="dl-link">
        {c.kind === "liked" ? <LikedArt /> : <Art id={c.coverArt} px={56} />}
        <div className="dl-text">
          <div className="t">{c.name}</div>
          <div className="s">{status}</div>
          {job ? <div className="line static" style={{ "--p": `${pct}%` } as React.CSSProperties}><i /></div> : null}
        </div>
      </Link>
      <button
        type="button"
        className="icon-btn"
        aria-label={`Play ${c.name}`}
        disabled={Boolean(job && job.done === 0)}
        onClick={() => void offlineSongs(c.songIds).then((songs) => player.playSongs(songs, 0, { kind: "downloads", id: c.id, name: c.name }))}
      >
        <Icon name="play" size={18} />
      </button>
      <button type="button" className="icon-btn" aria-label={`Remove ${c.name} from this device`} onClick={() => void removeDownload(c.id)}>
        <Icon name="trash" size={18} />
      </button>
    </div>
  );
}

export default function DownloadsPage() {
  const mobile = useIsMobile();
  const collections = useOffline((s) => s.collections);
  const bytes = useOffline((s) => s.bytes);
  const supported = useOffline((s) => s.supported);
  const onCellular = useSettings((s) => s.downloadOnCellular);
  const set = useSettings((s) => s.set);
  usePageTone(null);
  const where = deviceKind() === "phone" ? "iPhone" : "device";
  return (
    <>
      {mobile ? <MobileHeader title="Downloads" /> : <TopBar />}
      <div className="pad downloads">
        {!mobile ? <h1 className="hello">Downloads</h1> : null}
        {!supported ? (
          <div className="dl-sum">
            <b>Downloads need the secure address</b>
            <span>Open Needle at its https:// address, then download albums and playlists to play them with no connection.</span>
          </div>
        ) : (
          <>
            <div className="dl-sum">
              <b>{gb(bytes)} on this {where}</b>
              <span>Plays with no connection, even away from home.</span>
            </div>
            {collections.map((c) => <Row key={c.id} c={c} />)}
            {!collections.length ? <p className="muted">Nothing downloaded yet. Use the download button on an album, a playlist or your liked songs.</p> : null}
            <div className="set-row">
              <div>
                <b>Download on mobile data</b>
                <span>{onCellular ? "On: downloads use mobile data too." : "Off: downloads wait for Wi-Fi."}</span>
              </div>
              <button type="button" className="toggle" role="switch" aria-checked={onCellular} aria-label="Download on mobile data" onClick={() => set("downloadOnCellular", !onCellular)} />
            </div>
          </>
        )}
      </div>
    </>
  );
}
