import { songSource, youtubeMusicLink } from "@needle/shared";
import type { Song } from "@needle/shared";
import { usePlayer } from "../../../player/store.ts";
import { Icon } from "../../../components/Icon.tsx";
import { translate } from "../../../i18n/index.ts";

export function YouTubeMusicPlaybackError({ song }: { song: Song | null }) {
  const playbackError = usePlayer((playerState) => playerState.error);

  if (!playbackError || !song || songSource(song) !== "youtubeMusic") return null;

  return (
    <div className="yt-notice" role="status">
      <Icon name="info" size={18} />
      <div>
        <b>{translate("youtube.playbackStopped")}</b>
        <p>{playbackError}</p>
        <a className="show-all" href={youtubeMusicLink("song", song.id)} target="_blank" rel="noopener noreferrer">
          {translate("youtube.open")}
        </a>
      </div>
    </div>
  );
}
