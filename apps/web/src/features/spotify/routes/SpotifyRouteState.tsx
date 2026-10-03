import type { Song } from "@needle/shared";
import { Link } from "react-router";
import { Icon } from "../../../components/Icon.tsx";
import { localeCode } from "../../../lib/format.ts";
import { useIsMobile } from "../../../lib/media.ts";
import { MobileBack } from "../../../layout/Mobile.tsx";
import { TopBar } from "../../../layout/TopBar.tsx";
import { spotifyLink, useSpotifyStatus } from "../api/client.ts";
import { translate } from "../../../i18n/index.ts";

export const duration = (songs: Song[]) =>
  songs.reduce((durationSeconds, song) => durationSeconds + (song.duration ?? 0), 0);

export function OpenInSpotify({ kind, id }: { kind: "album" | "artist" | "playlist"; id: string }) {
  return (
    <a
      className="icon-btn big"
      href={spotifyLink(kind, id)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={translate("spotify.open")}
    >
      <Icon name="link" size={22} />
    </a>
  );
}

export function NotConnected() {
  return (
    <>
      <TopBar />
      <div className="empty">
        <div className="empty-in">
          <h1>{translate("spotify.connectFirst")}</h1>
          <p>{translate("spotify.connectHint")}</p>
          <div className="acts">
            <Link to="/settings" className="btn primary">
              {translate("empty.goSettings")}
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}

type SpotifyItem = "album" | "artist" | "list" | "playlist";

function spotifyItemLabel(spotifyItem: SpotifyItem): string {
  switch (spotifyItem) {
    case "album":
      return translate("spotify.itemAlbum");
    case "artist":
      return translate("spotify.itemArtist");
    case "list":
      return translate("spotify.itemList");
    case "playlist":
      return translate("spotify.itemPlaylist");
  }
}

export function SpotifyError({ what, retry }: { what: SpotifyItem; retry: () => void }) {
  const { blocked, until } = useSpotifyStatus();
  const mobile = useIsMobile();
  const item = spotifyItemLabel(what);

  return (
    <>
      {mobile ? <MobileBack /> : <TopBar />}
      <div className="empty">
        <div className="empty-in">
          <h1>{blocked ? translate("spotify.paused") : translate("spotify.loadFailed", { item })}</h1>
          <p>
            {blocked
              ? translate("spotify.pausedHint", {
                  time: new Intl.DateTimeFormat(localeCode(), {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  }).format(until),
                })
              : translate("spotify.unavailableHint", { item })}
          </p>
          {!blocked ? (
            <div className="acts">
              <button type="button" className="btn primary" onClick={retry}>
                <Icon name="refresh" size={16} />
                {translate("common.retry")}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
