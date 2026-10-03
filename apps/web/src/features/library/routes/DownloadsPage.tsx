import { useMemo, useState } from "react";
import { matchesTerms, queryTerms } from "@needle/shared";
import { Link } from "react-router";
import { Art, LikedArt } from "../../../components/Art.tsx";
import { Icon } from "../../../components/Icon.tsx";
import { SearchField } from "../../../components/SearchField.tsx";
import { plural, sizeLabel } from "../../../lib/format.ts";
import { useStorageEstimate } from "../../../queries/hooks.ts";
import { useSession } from "../../../state/session.ts";
import { MobileHeader } from "../../../layout/Mobile.tsx";
import { useIsMobile } from "../../../lib/media.ts";
import { usePageTone } from "../../../layout/pageTone.ts";
import { TopBar } from "../../../layout/TopBar.tsx";
import {
  bytesOf,
  offlineSongs,
  removeDownload,
  resumeDownload,
  useOffline,
} from "../../../offline/store.ts";
import type { OfflineCollection } from "../../../offline/store.ts";
import { player } from "../../../player/controller.ts";
import { useSettings } from "../../../state/settings.ts";
import { deviceKind } from "../../../lib/device.ts";
import { translate } from "../../../i18n/index.ts";

function Row({ c }: { c: OfflineCollection }) {
  const job = useOffline((s) => s.jobs[c.id]);
  const saved = useOffline(
    (s) => c.songIds.filter((id) => s.songs.has(id)).length,
  );
  const size = useOffline((s) => bytesOf(s.songs, c.songIds));
  const to = c.kind === "liked" ? "/liked" : `/${c.kind}/${c.id}`;
  const pct = Math.round(
    (job ? job.progress : saved / Math.max(1, c.songIds.length)) * 100,
  );
  const running = job && job.done + job.failed < job.total;
  const status = running
    ? job.waiting
      ? translate("downloads.waitingWifi")
      : translate("downloads.progress", {
          current: Math.min(job.done + job.failed + 1, job.total),
          total: job.total,
          percent: pct,
        })
    : job?.failed
      ? translate("downloads.failed", {
          songs: plural(job.failed, "song"),
        })
      : saved < c.songIds.length
        ? translate("downloads.saved", {
            saved,
            songs: plural(c.songIds.length, "song"),
            size: sizeLabel(size),
          })
        : translate("downloads.summary", {
            songs: plural(c.songIds.length, "song"),
            size: sizeLabel(size),
          });
  const incomplete = !running && saved < c.songIds.length;
  return (
    <div className="dl-row">
      <Link to={to} className="dl-link">
        {c.kind === "liked" ? <LikedArt /> : <Art id={c.coverArt} px={56} />}
        <div className="dl-text">
          <div className="t">{c.name}</div>
          <div className="s">{status}</div>
          {running || incomplete ? (
            <div
              className="line static"
              style={{ "--p": `${pct}%` } as React.CSSProperties}
            >
              <i />
            </div>
          ) : null}
        </div>
      </Link>
      <button
        type="button"
        className="icon-btn"
        aria-label={translate("track.play", { title: c.name })}
        disabled={Boolean(job && job.done === 0)}
        onClick={() =>
          void offlineSongs(c.songIds).then((songs) =>
            player.playSongs(songs, 0, {
              kind: "downloads",
              id: c.id,
              name: c.name,
            }),
          )
        }
      >
        <Icon name="play" size={18} />
      </button>
      {incomplete ? (
        <button
          type="button"
          className="btn ghost sm"
          onClick={() => void resumeDownload(c)}
        >
          {translate("common.retry")}
        </button>
      ) : null}
      <button
        type="button"
        className="icon-btn"
        aria-label={translate("downloads.remove", { name: c.name })}
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
        matchesTerms(
          queryTerms(collectionFilter),
          collection.name,
          collection.subtitle,
        ),
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
      {mobile ? (
        <MobileHeader title={translate("common.downloads")} />
      ) : (
        <TopBar />
      )}
      <div className="pad downloads">
        {!mobile ? (
          <h1 className="hello">{translate("common.downloads")}</h1>
        ) : null}
        {!supported ? (
          <div className="dl-sum">
            <b>{translate("downloads.secure")}</b>
            <span>{translate("downloads.secureHint")}</span>
          </div>
        ) : (
          <>
            <div className="dl-sum">
              <b>
                {translate("downloads.onDevice", {
                  size: sizeLabel(bytes),
                  device: where,
                })}
              </b>
              <span>{translate("downloads.offlineHint")}</span>
            </div>
            <dl className="dl-where">
              <div>
                <dt>{translate("downloads.where")}</dt>
                <dd>
                  {translate("downloads.whereValue", { device: deviceName })}
                </dd>
              </div>
              {quota?.quota ? (
                <div>
                  <dt>{translate("downloads.free")}</dt>
                  <dd>
                    {sizeLabel(Math.max(0, quota.quota - (quota.usage ?? 0)))}
                  </dd>
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
                  label={translate("downloads.find")}
                />
              </div>
            ) : null}
            {visibleCollections.map((collection) => (
              <Row key={collection.id} c={collection} />
            ))}
            {collections.length && !visibleCollections.length ? (
              <p className="muted">{translate("library.noDownloadsMatch")}</p>
            ) : null}
            {!collections.length ? (
              <p className="muted">{translate("downloads.empty")}</p>
            ) : null}
            <div className="set-row">
              <div>
                <b>{translate("settings.downloadCellular")}</b>
                <span>
                  {translate(
                    onCellular
                      ? "downloads.cellularOn"
                      : "downloads.cellularOff",
                  )}
                </span>
              </div>
              <button
                type="button"
                className="toggle"
                role="switch"
                aria-checked={onCellular}
                aria-label={translate("settings.downloadCellular")}
                onClick={() => set("downloadOnCellular", !onCellular)}
              />
            </div>
          </>
        )}
      </div>
    </>
  );
}
