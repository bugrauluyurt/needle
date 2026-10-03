import { translate } from "../../../i18n/index.ts";
import { plural, sizeLabel } from "../../../lib/format.ts";
import { bytesOf, removeAllDownloads, useOffline } from "../../../offline/store.ts";
import { useStorageEstimate } from "../../../queries/hooks.ts";
import { toast } from "../../../state/ui.ts";
import { SettingRow } from "./SettingRow.tsx";

export function StorageSettings() {
  const bytes = useOffline((offlineState) => bytesOf(offlineState.songs));
  const collections = useOffline((offlineState) => offlineState.collections);
  const supported = useOffline((offlineState) => offlineState.supported);
  const { data: quota } = useStorageEstimate();

  if (!supported) {
    return (
      <SettingRow
        title={translate("settings.downloadUnavailable")}
        hint={translate("settings.downloadUnavailableHint")}
      >
        <span />
      </SettingRow>
    );
  }

  const percentage = quota?.quota ? Math.min(100, (bytes / quota.quota) * 100) : 0;
  const albums = collections.filter((collection) => collection.kind === "album").length;
  const playlists = collections.filter((collection) => collection.kind === "playlist").length;
  const liked = collections.some((collection) => collection.kind === "liked");
  const parts = [
    albums ? plural(albums, "album") : null,
    playlists ? plural(playlists, "playlist") : null,
    liked ? translate("settings.downloadStorageLiked") : null,
  ].filter(Boolean);

  return (
    <div className="set-row">
      <div>
        <b>
          {translate("settings.downloadStorageUsed", {
            size: sizeLabel(bytes),
          })}
        </b>
        <span>
          {parts.length ? `${parts.join(", ")}.` : translate("settings.downloadStorageEmpty")}
          {quota?.quota
            ? ` ${translate("settings.downloadStorageRoom", {
                size: sizeLabel(quota.quota - (quota.usage ?? 0)),
              })}`
            : ""}
        </span>
        <div className="storage">
          <i style={{ width: `${Math.max(percentage, bytes ? 2 : 0)}%` }} />
        </div>
      </div>
      <button
        type="button"
        className="btn ghost sm"
        disabled={!bytes}
        onClick={() => void removeAllDownloads().then(() => toast(translate("settings.removeAll")))}
      >
        {translate("settings.removeAll")}
      </button>
    </div>
  );
}
