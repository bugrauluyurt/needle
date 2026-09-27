import type { Album, Artist } from "@needle/shared";
import type { Song } from "@needle/shared";
import { download, removeDownload, useIsDownloaded, useOffline } from "../offline/store.ts";
import type { CollectionKind } from "../offline/store.ts";
import { useStarredIds, useToggleStar } from "../queries/hooks.ts";
import { toast } from "../state/ui.ts";
import { Icon } from "./Icon.tsx";

export function LikeButton({ kind, item, size = 28, className = "icon-btn big" }: { kind: "album" | "artist"; item: Album | Artist; size?: number; className?: string }) {
  const starred = useStarredIds();
  const star = useToggleStar();
  const on = kind === "album" ? starred.albums.has(item.id) : starred.artists.has(item.id);
  const noun = kind === "album" ? "your liked albums" : "your liked artists";
  return (
    <button
      type="button"
      className={className}
      aria-pressed={on}
      aria-label={on ? `Remove from ${noun}` : `Add to ${noun}`}
      onClick={() => {
        star.mutate({ kind, item, on: !on });
        toast(on ? `Removed from ${noun}` : `Added to ${noun}`);
      }}
    >
      <Icon name={on ? "heartFill" : "heart"} size={size} />
    </button>
  );
}

type DownloadTarget = { id: string; kind: CollectionKind; name: string; subtitle: string; coverArt?: string };

export function DownloadButton({ target, songs, size = 32 }: { target: DownloadTarget; songs: Song[] | undefined; size?: number }) {
  const supported = useOffline((s) => s.supported);
  const done = useIsDownloaded(target.id);
  const job = useOffline((s) => s.jobs[target.id]);
  if (!supported) return null;
  const pct = job ? Math.round((job.done / Math.max(1, job.total)) * 100) : 0;
  const label = job ? `Downloading, ${pct}%` : done ? "Remove download" : "Download";
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
          toast(`Removed ${target.name} from this device`);
        } else {
          void download(target, songs);
          toast(`Downloading ${target.name}`);
        }
      }}
    >
      <Icon name="download" size={Math.round(size * 0.53)} />
    </button>
  );
}
