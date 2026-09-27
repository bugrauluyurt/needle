import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { Art } from "../components/Art.tsx";
import { Icon } from "../components/Icon.tsx";
import { Slider } from "../components/Slider.tsx";
import { artistName, clock, formatLabel } from "../lib/format.ts";
import { player } from "../player/controller.ts";
import { useProgress } from "../player/progress.ts";
import { useCurrentSong, usePlayer } from "../player/store.ts";
import { useStarredIds, useToggleStar } from "../queries/hooks.ts";
import { setFullScreen, toggleRightPanel, useUi } from "../state/ui.ts";
import { DevicesButton } from "../remote/DevicesButton.tsx";

export function SeekBar({ className = "seek", times = "side" }: { className?: string; times?: "side" | "below" | "remaining" }) {
  const position = useProgress((p) => Math.floor(p.position * 4) / 4);
  const duration = useProgress((p) => p.duration);
  const buffered = useProgress((p) => Math.floor(p.buffered));
  const station = usePlayer((s) => s.station);
  const [preview, setPreview] = useState<number | null>(null);
  const shown = preview ?? position;
  if (station) {
    return (
      <div className={className}>
        <span className="live">Live</span>
      </div>
    );
  }
  const slider = (
    <Slider
      value={shown}
      max={duration}
      buffered={buffered}
      needle
      label="Seek"
      step={5}
      valueText={(v) => `${clock(v)} of ${clock(duration)}`}
      onChange={setPreview}
      onCommit={(v) => {
        setPreview(null);
        player.seek(v);
      }}
    />
  );
  if (times === "below") {
    return (
      <div className={`${className} below`}>
        {slider}
        <div className="times">
          <span>{clock(shown)}</span>
          <span>{clock(duration)}</span>
        </div>
      </div>
    );
  }
  return (
    <div className={className}>
      <span className="time">{clock(shown)}</span>
      {slider}
      <span className="time">{times === "remaining" ? `-${clock(Math.max(0, duration - shown))}` : clock(duration)}</span>
    </div>
  );
}

export function Transport({ big = false }: { big?: boolean }) {
  const playing = usePlayer((s) => s.playing);
  const buffering = usePlayer((s) => s.buffering);
  const shuffle = usePlayer((s) => s.shuffle);
  const repeat = usePlayer((s) => s.repeat);
  const station = usePlayer((s) => s.station);
  const empty = usePlayer((s) => !s.items.length && !s.station);
  const size = big ? 26 : 18;
  if (station) {
    return (
      <div className="ctl-btns">
        <button type="button" className="pp" aria-label={playing ? "Stop" : "Play"} onClick={player.toggle}>
          <Icon name={playing ? "pause" : "play"} size={big ? 26 : 16} />
        </button>
      </div>
    );
  }
  return (
    <div className="ctl-btns">
      <button type="button" className="icon-btn" aria-pressed={shuffle} aria-label={shuffle ? "Turn off shuffle" : "Shuffle"} disabled={empty} onClick={() => player.setShuffle(!shuffle)}>
        <Icon name="shuffle" size={big ? 22 : size} />
      </button>
      <button type="button" className="icon-btn" aria-label="Previous" disabled={empty} onClick={() => void player.previous()}>
        <Icon name="prev" size={big ? 30 : size} />
      </button>
      <button type="button" className={`pp ${buffering && playing ? "buffering" : ""}`} aria-label={playing ? "Pause" : "Play"} disabled={empty} onClick={player.toggle}>
        <Icon name={playing ? "pause" : "play"} size={big ? 26 : 16} />
      </button>
      <button type="button" className="icon-btn" aria-label="Next" disabled={empty} onClick={() => void player.next()}>
        <Icon name="next" size={big ? 30 : size} />
      </button>
      <button
        type="button"
        className="icon-btn"
        aria-pressed={repeat !== "off"}
        aria-label={repeat === "off" ? "Repeat" : repeat === "all" ? "Repeat one" : "Turn off repeat"}
        disabled={empty}
        onClick={player.cycleRepeat}
      >
        <Icon name={repeat === "one" ? "repeatOne" : "repeat"} size={big ? 22 : size} />
      </button>
    </div>
  );
}

export function Volume() {
  const volume = usePlayer((s) => (s.muted ? 0 : s.volume));
  return (
    <>
      <button type="button" className="icon-btn" aria-label={volume === 0 ? "Unmute" : "Mute"} onClick={player.toggleMute}>
        <Icon name={volume === 0 ? "mute" : volume < 0.5 ? "volumeLow" : "volume"} size={18} />
      </button>
      <Slider className="vol" value={volume} max={1} step={0.05} label="Volume" valueText={(v) => `${Math.round(v * 100)}%`} onChange={player.setVolume} />
    </>
  );
}

export function LikeCurrent({ size = 18, className = "icon-btn" }: { size?: number; className?: string }) {
  const song = useCurrentSong();
  const starred = useStarredIds();
  const star = useToggleStar();
  if (!song) return null;
  const on = starred.songs.has(song.id);
  return (
    <button type="button" className={className} aria-pressed={on} aria-label={on ? "Remove from liked songs" : "Add to liked songs"} onClick={() => star.mutate({ kind: "song", item: song, on: !on })}>
      <Icon name={on ? "heartFill" : "heart"} size={size} />
    </button>
  );
}

export function PlayerBar() {
  const song = useCurrentSong();
  const station = usePlayer((s) => s.station);
  const panel = useUi((s) => s.rightPanel);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const fmt = station ? null : formatLabel(song);
  return (
    <footer className="bar" aria-label="Player">
      <div className="np">
        {station ? (
          <>
            <div className="art station-art"><Icon name="radio" size={24} /></div>
            <div className="np-text">
              <div className="np-t">{station.name}</div>
              <div className="np-a">Internet radio</div>
            </div>
          </>
        ) : song ? (
          <>
            <Link to={song.albumId ? `/album/${song.albumId}` : "#"} aria-label={`Go to ${song.album ?? "album"}`}>
              <Art id={song.coverArt} px={56} />
            </Link>
            <div className="np-text">
              <div className="np-t">{song.albumId ? <Link to={`/album/${song.albumId}`}>{song.title}</Link> : song.title}</div>
              <div className="np-a">{song.artistId ? <Link to={`/artist/${song.artistId}`}>{artistName(song)}</Link> : artistName(song)}</div>
            </div>
            <LikeCurrent />
          </>
        ) : (
          <>
            <div className="art station-art"><Icon name="album" size={24} /></div>
            <div className="np-text"><div className="np-t muted">Nothing playing</div></div>
          </>
        )}
      </div>
      <div className="ctl">
        <Transport />
        <SeekBar />
      </div>
      <div className="bar-r">
        {fmt ? <span className="fmt">{fmt}</span> : null}
        <button type="button" className="icon-btn" aria-pressed={panel === "now"} aria-label="Now playing view" onClick={() => toggleRightPanel("now")}>
          <Icon name="album" size={18} />
        </button>
        <button type="button" className="icon-btn" aria-pressed={pathname === "/lyrics"} aria-label="Lyrics" onClick={() => (pathname === "/lyrics" ? void navigate(-1) : void navigate("/lyrics"))}>
          <Icon name="mic" size={18} />
        </button>
        <button type="button" className="icon-btn" aria-pressed={panel === "queue"} aria-label="Queue" onClick={() => toggleRightPanel("queue")}>
          <Icon name="queue" size={18} />
        </button>
        <DevicesButton />
        <Volume />
        <button type="button" className="icon-btn" aria-label="Full screen" disabled={!song && !station} onClick={() => setFullScreen(true)}>
          <Icon name="expand" size={17} />
        </button>
      </div>
    </footer>
  );
}
