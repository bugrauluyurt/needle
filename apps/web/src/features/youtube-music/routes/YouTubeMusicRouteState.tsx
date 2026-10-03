import { youtubeMusicLink } from "@needle/shared";
import type { Song } from "@needle/shared";
import { Link } from "react-router";
import { Icon } from "../../../components/Icon.tsx";
import { YouTubeMusicNotice } from "../components/YouTubeMusicNotice.tsx";
import { useIsMobile } from "../../../lib/media.ts";
import { songSorts } from "../../../lib/songs.ts";
import { MobileBack } from "../../../layout/Mobile.tsx";
import { TopBar } from "../../../layout/TopBar.tsx";
import { useCapabilities } from "../../../queries/hooks.ts";
import { useYouTubeMusicOn } from "../hooks/useYouTubeMusic.ts";
import { translate } from "../../../i18n/index.ts";

export const totalDuration = (songs: Song[]) =>
  songs.reduce((durationSeconds, song) => durationSeconds + (song.duration ?? 0), 0);

export const EMPTY_SONGS: Song[] = [];

export const youtubeMusicSorts = () =>
  songSorts()
    .filter(([songSort]) => songSort !== "added")
    .map(([songSort, songLabel]): [typeof songSort, string] => [
      songSort,
      songSort === "custom" ? translate("youtube.order") : songLabel,
    ]);

export function OpenInYouTubeMusic({ kind, id }: { kind: "album" | "artist" | "playlist"; id: string }) {
  return (
    <a
      className="icon-btn big"
      href={youtubeMusicLink(kind, id)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={translate("youtube.open")}
    >
      <Icon name="link" size={22} />
    </a>
  );
}

type YouTubeMusicItem = "album" | "artist" | "list" | "playlist";

function youtubeMusicItemLabel(youtubeMusicItem: YouTubeMusicItem | undefined): string {
  switch (youtubeMusicItem) {
    case "album":
      return translate("youtube.itemAlbum");
    case "artist":
      return translate("youtube.itemArtist");
    case "list":
      return translate("youtube.itemList");
    case "playlist":
      return translate("youtube.itemPlaylist");
    case undefined:
      return translate("youtube.item");
  }
}

export function YouTubeMusicUnavailable({ what, retry }: { what?: YouTubeMusicItem; retry?: () => void }) {
  const mobile = useIsMobile();
  const on = useYouTubeMusicOn();
  const capabilities = useCapabilities().data;

  return (
    <>
      {mobile ? <MobileBack /> : <TopBar />}
      <div className="empty">
        <div className="empty-in">
          <h1>
            {on
              ? translate("youtube.loadItemFailed", {
                  item: youtubeMusicItemLabel(what),
                })
              : capabilities?.youtubeMusicConnected
                ? translate("youtube.switchedOff")
                : translate("youtube.connectFirst")}
          </h1>
          {on ? (
            <YouTubeMusicNotice error retry={retry} />
          ) : (
            <>
              <p>{translate("youtube.reconnectHint")}</p>
              <div className="acts">
                <Link to="/settings" className="btn primary">
                  {translate("empty.goSettings")}
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

export function LoadMore({
  visible,
  busy,
  blocked,
  onMore,
}: {
  visible: boolean;
  busy: boolean;
  blocked: boolean;
  onMore: () => void;
}) {
  if (!visible) return null;

  return (
    <div className="yt-more">
      <button type="button" className="btn ghost sm" disabled={busy || blocked} onClick={onMore}>
        {translate(busy ? "search.loading" : "search.loadMore")}
      </button>
    </div>
  );
}
