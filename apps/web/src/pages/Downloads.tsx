import { useMemo, useState } from "react";
import { matchesTerms, queryTerms } from "@needle/shared";
import { Link } from "react-router";
import { Art, LikedArt } from "../components/Art.tsx";
import { Icon } from "../components/Icon.tsx";
import { SearchField } from "../components/SearchField.tsx";
import { plural, sizeLabel } from "../lib/format.ts";
import { useStorageEstimate } from "../queries/hooks.ts";
import { useSession } from "../state/session.ts";
import { MobileHeader } from "../layout/Mobile.tsx";
import { useIsMobile, usePageTone } from "../layout/Shell.tsx";
import { TopBar } from "../layout/TopBar.tsx";
import { bytesOf, offlineSongs, removeDownload, resumeDownload, useOffline } from "../offline/store.ts";
import type { OfflineCollection } from "../offline/store.ts";
import { player } from "../player/controller.ts";
import { useSettings } from "../state/settings.ts";
import { deviceKind } from "../lib/device.ts";

function Row({ c }: { c: OfflineCollection }) {
  const job = useOffline((s) => s.jobs[c.id]);
  const saved = useOffline((s) => c.songIds.filter((id) => s.songs.has(id)).length);
  const size = useOffline((s) => bytesOf(s.songs, c.songIds));
  const to = c.kind === "liked" ? "/liked" : `/${c.kind}/${c.id}`;
  const pct = Math.round((job ? job.progress : saved / Math.max(1, c.songIds.length)) * 100);
  const running = job && job.done + job.failed < job.total;
  const status = running
    ? job.waiting
      ? "Waiting for Wi-Fi"
      : `Downloading ${Math.min(job.done + job.failed + 1, job.total)} of ${job.total}, ${pct}%`
    : job?.failed
      ? `${plural(job.failed, "song")} didn’t download`
      : saved < c.songIds.length
        ? `${saved} of ${plural(c.songIds.length, "song")} saved, ${sizeLabel(size)}`
        : `${plural(c.songIds.length, "song")}, ${sizeLabel(size)}`;
  const incomplete = !running && saved < c.songIds.length;
  return (
    <div className="dl-row">
      <Link to={to} className="dl-link">
        {c.kind === "liked" ? <LikedArt /> : <Art id={c.coverArt} px={56} />}
        <div className="dl-text">
          <div className="t">{c.name}</div>
          <div className="s">{status}</div>
          {running || incomplete ? (
            <div className="line static" style={{ "--p": `${pct}%` } as React.CSSProperties}>
              <i />
            </div>
          ) : null}
        </div>
      </Link>
      <button
        type="button"
        className="icon-btn"
        aria-label={`Play ${c.name}`}
        disabled={Boolean(job && job.done === 0)}
        onClick={() =>
          void offlineSongs(c.songIds).then((songs) =>
            player.playSongs(songs, 0, { kind: "downloads", id: c.id, name: c.name }),
          )
        }
      >
        <Icon name="play" size={18} />
      </button>
      {incomplete ? (
        <button type="button" className="btn ghost sm" onClick={() => void resumeDownload(c)}>
          Try again
        </button>
      ) : null}
      <button
        type="button"
        className="icon-btn"
        aria-label={`Remove ${c.name} from this device`}
        onClick={() => void removeDownload(c.id)}
      >
        <Icon name="trash" size={18} />
      </button>
    </div>
  );
}

export default function DownloadsPage() {
  const mobile = useIsMobile();
  const collections = useOffline((s) => s.collections);
  const [collectionFilter, setCollectionFilter] = useState("");
  const visibleCollections = useMemo(
    () =>
      collections.filter((collection) =>
        matchesTerms(queryTerms(collectionFilter), collection.name, collection.subtitle),
      ),
    [collections, collectionFilter],
  );
  const bytes = useOffline((s) => bytesOf(s.songs));
  const { data: quota } = useStorageEstimate();
  const deviceName = useSession((s) => s.deviceName);
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
            <span>
              Open Needle at its https:// address, then download albums and playlists to play them with no connection.
            </span>
          </div>
        ) : (
          <>
            <div className="dl-sum">
              <b>
                {sizeLabel(bytes)} on this {where}
              </b>
              <span>Plays with no connection, even away from home.</span>
            </div>
            <dl className="dl-where">
              <div>
                <dt>Where</dt>
                <dd>In this browser on {deviceName}</dd>
              </div>
              {quota?.quota ? (
                <div>
                  <dt>Free</dt>
                  <dd>{sizeLabel(Math.max(0, quota.quota - (quota.usage ?? 0)))}</dd>
                </div>
              ) : null}
            </dl>
            {collections.length ? (
              <div className="lib-tools">
                <SearchField
                  variant="inline"
                  collapsible
                  value={collectionFilter}
                  onChange={setCollectionFilter}
                  label="Find in downloads"
                />
              </div>
            ) : null}
            {visibleCollections.map((collection) => (
              <Row key={collection.id} c={collection} />
            ))}
            {collections.length && !visibleCollections.length ? (
              <p className="muted">No downloads match your search.</p>
            ) : null}
            {!collections.length ? (
              <p className="muted">
                Nothing downloaded yet. Use the download button on an album, a playlist or your liked songs.
              </p>
            ) : null}
            <div className="set-row">
              <div>
                <b>Download on mobile data</b>
                <span>{onCellular ? "On: downloads use mobile data too." : "Off: downloads wait for Wi-Fi."}</span>
              </div>
              <button
                type="button"
                className="toggle"
                role="switch"
                aria-checked={onCellular}
                aria-label="Download on mobile data"
                onClick={() => set("downloadOnCellular", !onCellular)}
              />
            </div>
          </>
        )}
      </div>
    </>
  );
}
