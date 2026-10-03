import type { Album, Artist } from "@needle/shared";
import type { Song } from "@needle/shared";
import { download, removeDownload, useIsDownloaded, useOffline } from "../offline/store.ts";
import type { CollectionKind } from "../offline/store.ts";
import { useStarredIds, useToggleStar } from "../queries/hooks.ts";
import { useNavigate } from "react-router";
import { toast } from "../state/ui.ts";
import { Icon } from "./Icon.tsx";
import { translate } from "../i18n/index.ts";

export function LikeButton({
  kind,
  item,
  size = 28,
  className = "icon-btn big",
}: {
  kind: "album" | "artist";
  item: Album | Artist;
  size?: number;
  className?: string;
}) {
  const starred = useStarredIds();
  const star = useToggleStar();
  const on = kind === "album" ? starred.albums.has(item.id) : starred.artists.has(item.id);
  const addedKey = kind === "album" ? "like.addedAlbums" : "like.addedArtists";
  const addKey = kind === "album" ? "like.addAlbums" : "like.addArtists";
  const removedKey = kind === "album" ? "like.removedAlbums" : "like.removedArtists";
  const removeKey = kind === "album" ? "like.removeAlbums" : "like.removeArtists";
  return (
    <button
      type="button"
      className={className}
      aria-pressed={on}
      aria-label={translate(on ? removeKey : addKey)}
      onClick={() => {
        star.mutate({ kind, item, on: !on });
        toast(translate(on ? removedKey : addedKey));
      }}
    >
      <Icon name={on ? "heartFill" : "heart"} size={size} />
    </button>
  );
}

type DownloadTarget = {
  id: string;
  kind: CollectionKind;
  name: string;
  subtitle: string;
  coverArt?: string;
};

export function DownloadButton({
  target,
  songs,
  size = 32,
}: {
  target: DownloadTarget;
  songs: Song[] | undefined;
  size?: number;
}) {
  const navigate = useNavigate();
  const supported = useOffline((s) => s.supported);
  const done = useIsDownloaded(target.id);
  const job = useOffline((s) => s.jobs[target.id]);
  if (!supported) return null;
  const pct = job ? Math.round(job.progress * 100) : 0;
  const label = job
    ? translate("download.downloading", { percent: pct })
    : done
      ? translate("download.remove")
      : translate("download.label");
  return (
    <button
      type="button"
      className={`dl-ring ${done && !job ? "on" : ""} ${job ? "busy" : ""}`}
      style={{ width: size, height: size, "--p": `${pct}%` } as React.CSSProperties}
      aria-label={label}
      title={label}
      disabled={!songs?.length}
      onClick={() => {
        if (!songs?.length) return;
        if (done) {
          void removeDownload(target.id);
          toast(translate("download.removed", { name: target.name }));
        } else {
          void download(target, songs);
          toast(translate("download.saving", { name: target.name }), {
            label: translate("common.downloads"),
            run: () => void navigate("/downloads"),
          });
        }
      }}
    >
      <Icon name="download" size={Math.round(size * 0.53)} />
    </button>
  );
}
