import { useEffect, useState } from "react";
import { Art } from "../components/Art.tsx";
import { Icon, Logo } from "../components/Icon.tsx";
import { LyricsView } from "../components/Lyrics.tsx";
import { artistName, formatLabel } from "../lib/format.ts";
import { useTone } from "../lib/tone.ts";
import { player } from "../player/controller.ts";
import { useCurrentSong, usePlayer } from "../player/store.ts";
import { setFullScreen, useUi } from "../state/ui.ts";
import { DevicesButton } from "../remote/DevicesButton.tsx";
import { LikeCurrent, LiveLabel, SeekBar, Transport, Volume } from "./PlayerBar.tsx";

export default function FullScreenPlayer() {
  const open = useUi((s) => s.fullScreen);
  const song = useCurrentSong();
  const station = usePlayer((s) => s.station);
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
  const upNext = items.slice(index + 1, index + 4);
  const close = () => setFullScreen(false);
  return (
    <div className="full" style={{ "--tone": tone } as React.CSSProperties} role="dialog" aria-modal="true" aria-label="Full screen player">
      <div className="full-top">
        <Logo size={26} />
        <div className="from">
          {station ? "Internet radio" : `Playing from ${context?.kind === "playlist" ? "playlist" : context?.kind === "album" ? "album" : ""}`}
          <b>{station?.name ?? context?.name ?? song?.album}</b>
        </div>
        <div className="full-top-r">
          <button type="button" className="icon-btn" aria-pressed={lyrics} aria-label="Lyrics" onClick={() => setLyrics(!lyrics)}>
            <Icon name="mic" />
          </button>
          <button type="button" className="icon-btn" aria-label="Exit full screen" onClick={close}>
            <Icon name="close" />
          </button>
        </div>
      </div>
      <div className="full-mid">
        {station ? <div className="art station-art"><Icon name="radio" size={96} /></div> : <Art id={song?.coverArt} px={520} eager />}
        <div className="full-info">
          <h2>{station?.name ?? song?.title}</h2>
          <div className="by">{station ? <LiveLabel /> : song ? artistName(song) : ""}</div>
          {lyrics && song ? (
            <div className="full-lyrics"><LyricsView song={song} variant="panel" /></div>
          ) : upNext.length ? (
            <div className="upnext">
              <h6>Up next</h6>
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

