import { useEffect, useState } from "react";
import { Art } from "../components/Art.tsx";
import { Icon, Logo } from "../components/Icon.tsx";
import { LyricsView } from "../components/Lyrics.tsx";
import { YouTubeMusicPlaybackError } from "../features/youtube-music/components/YouTubeMusicPlaybackError.tsx";
import { artistName, formatLabel } from "../lib/format.ts";
import { useTone } from "../lib/tone.ts";
import { player } from "../player/controller.ts";
import { usePlayer } from "../player/store.ts";
import { setFullScreen, useUi } from "../state/ui.ts";
import { usePlayback } from "../features/remote/client.ts";
import { DevicesButton } from "../features/remote/components/DevicesButton.tsx";
import { LikeCurrent, LiveLabel, SeekBar, Transport, Volume } from "./PlayerBar.tsx";
import { translate } from "../i18n/index.ts";

export default function FullScreenPlayer() {
  const open = useUi((s) => s.fullScreen);
  const { remote, song, station } = usePlayback();
  const items = usePlayer((s) => s.items);
  const index = usePlayer((s) => s.index);
  const context = usePlayer((s) => s.context);
  const tone = useTone(song?.coverArt);
  const [lyrics, setLyrics] = useState(false);
  useEffect(() => {
    if (!open) return;
    const exit = () => !document.fullscreenElement && useUi.setState({ fullScreen: false });
    document.addEventListener("fullscreenchange", exit);
    return () => document.removeEventListener("fullscreenchange", exit);
  }, [open]);
  if (!open || (!song && !station)) return null;
  const upNext = remote ? [] : items.slice(index + 1, index + 4);
  const close = () => setFullScreen(false);
  return (
    <div
      className="full"
      style={{ "--tone": tone } as React.CSSProperties}
      role="dialog"
      aria-modal="true"
      aria-label={translate("player.fullScreenPlayer")}
    >
      <div className="full-top">
        <Logo size={26} />
        <div className="from">
          {remote
            ? translate("player.playingOnShort")
            : station
              ? translate("player.internetRadio")
              : context?.kind === "playlist"
                ? translate("player.playingFromPlaylist")
                : context?.kind === "album"
                  ? translate("player.playingFromAlbum")
                  : translate("player.playing")}
          <b>{remote?.name ?? station?.name ?? context?.name ?? song?.album}</b>
        </div>
        <div className="full-top-r">
          <button
            type="button"
            className="icon-btn"
            aria-pressed={lyrics}
            aria-label={translate("player.lyrics")}
            onClick={() => setLyrics(!lyrics)}
          >
            <Icon name="mic" />
          </button>
          <button type="button" className="icon-btn" aria-label={translate("player.exitFullScreen")} onClick={close}>
            <Icon name="close" />
          </button>
        </div>
      </div>
      <div className="full-mid">
        {station ? (
          <div className="art station-art">
            <Icon name="radio" size={96} />
          </div>
        ) : (
          <Art id={song?.coverArt} px={520} eager />
        )}
        <div className="full-info">
          <h2>{station?.name ?? song?.title}</h2>
          <div className="by">{station ? <LiveLabel /> : song ? artistName(song) : ""}</div>
          {!remote ? <YouTubeMusicPlaybackError song={song} /> : null}
          {lyrics && song ? (
            <div className="full-lyrics">
              <LyricsView song={song} variant="panel" />
            </div>
          ) : upNext.length ? (
            <div className="upnext">
              <h6>{translate("panel.upNext")}</h6>
              {upNext.map((it) => (
                <button key={it.uid} type="button" className="mini" onClick={() => player.playQueueItem(it.uid)}>
                  <Art id={it.song.coverArt} px={44} />
                  <div className="mini-text">
                    <div className="t">{it.song.title}</div>
                    <div className="s">{artistName(it.song)}</div>
                  </div>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <div className="full-bot">
        <SeekBar />
        <div className="side-btns">
          {song ? <LikeCurrent size={22} /> : null}
          {song ? <span className="fmt">{formatLabel(song)}</span> : null}
        </div>
        <Transport big />
        <div className="side-btns r">
          <DevicesButton />
          <Volume />
        </div>
      </div>
    </div>
  );
}
