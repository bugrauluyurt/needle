import * as DM from "@radix-ui/react-dropdown-menu";
import * as Popover from "@radix-ui/react-popover";
import { useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { Art } from "../components/Art.tsx";
import { Icon } from "../components/Icon.tsx";
import type { IconName } from "../components/Icon.tsx";
import { Slider } from "../components/Slider.tsx";
import { artistName, clock, formatLabel } from "../lib/format.ts";
import { player } from "../player/controller.ts";
import { useProgress } from "../player/progress.ts";
import { useCurrentSong, usePlayer } from "../player/store.ts";
import { useSongLikes } from "../queries/likes.ts";
import { setFullScreen, toggleRightPanel, useUi } from "../state/ui.ts";
import { DevicesButton } from "../remote/DevicesButton.tsx";
import { albumPath, artistPath } from "../lib/paths.ts";
import { useIsWide } from "./Shell.tsx";

export const LiveLabel = () => <span className="live">Live radio</span>;

export function SeekBar({ className = "seek", times = "side" }: { className?: string; times?: "side" | "below" | "remaining" }) {
  const position = useProgress((p) => Math.floor(p.position * 4) / 4);
  const duration = useProgress((p) => p.duration);
  const buffered = useProgress((p) => Math.floor(p.buffered));
  const station = usePlayer((s) => s.station);
  const [preview, setPreview] = useState<number | null>(null);
  const shown = preview ?? position;
  if (station) return <div className={className} aria-hidden="true" />;
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
      <button type="button" className="icon-btn" data-key="S" aria-pressed={shuffle} aria-label={shuffle ? "Turn off shuffle" : "Shuffle"} disabled={empty} onClick={() => player.setShuffle(!shuffle)}>
        <Icon name="shuffle" size={big ? 22 : size} />
      </button>
      <button type="button" className="icon-btn" data-key="Shift ←" aria-label="Previous" disabled={empty} onClick={() => void player.previous()}>
        <Icon name="prev" size={big ? 30 : size} />
      </button>
      <button type="button" className={`pp ${buffering && playing ? "buffering" : ""}`} data-key="Space" aria-label={playing ? "Pause" : "Play"} disabled={empty} onClick={player.toggle}>
        <Icon name={playing ? "pause" : "play"} size={big ? 26 : 16} />
      </button>
      <button type="button" className="icon-btn" data-key="Shift →" aria-label="Next" disabled={empty} onClick={() => void player.next()}>
        <Icon name="next" size={big ? 30 : size} />
      </button>
      <button
        type="button"
        className="icon-btn"
        data-key="R"
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

const useVolume = () => usePlayer((s) => (s.muted ? 0 : s.volume));

const volumeIcon = (volume: number): IconName => (volume === 0 ? "mute" : volume < 0.5 ? "volumeLow" : "volume");

export function Volume() {
  const volume = useVolume();
  return (
    <>
      <button type="button" className="icon-btn" aria-label={volume === 0 ? "Unmute" : "Mute"} onClick={player.toggleMute}>
        <Icon name={volumeIcon(volume)} size={18} />
      </button>
      <Slider className="vol" value={volume} max={1} step={0.05} label="Volume" valueText={(v) => `${Math.round(v * 100)}%`} onChange={player.setVolume} />
    </>
  );
}

export function LikeCurrent({ size = 18, className = "icon-btn" }: { size?: number; className?: string }) {
  const song = useCurrentSong();
  const likes = useSongLikes();
  if (!song) return null;
  const on = likes.isLiked(song);
  return (
    <button type="button" className={className} aria-pressed={on} aria-label={on ? "Remove from liked songs" : "Add to liked songs"} onClick={() => likes.setLiked(song, !on)}>
      <Icon name={on ? "heartFill" : "heart"} size={size} />
    </button>
  );
}

type BarAction = { label: string; icon: IconName; size: number; keyHint?: string; pressed?: boolean; disabled?: boolean; run: () => void };

function BarButton({ action: a }: { action: BarAction }) {
  return (
    <button type="button" className="icon-btn" aria-pressed={a.pressed} data-key={a.keyHint} aria-label={a.label} disabled={a.disabled} onClick={a.run}>
      <Icon name={a.icon} size={a.size} />
    </button>
  );
}

function MoreMenu({ actions }: { actions: BarAction[] }) {
  const picked = useRef<BarAction | null>(null);
  return (
    <DM.Root modal={false}>
      <DM.Trigger asChild>
        <button type="button" className="icon-btn" aria-label="More">
          <Icon name="more" size={18} />
        </button>
      </DM.Trigger>
      <DM.Portal>
        <DM.Content
          className="menu bar-menu"
          side="top"
          align="end"
          sideOffset={12}
          collisionPadding={12}
          onCloseAutoFocus={() => {
            picked.current?.run();
            picked.current = null;
          }}
        >
          {actions.map((a) => (
            <DM.Item key={a.label} className="menu-item" disabled={a.disabled} onSelect={() => (picked.current = a)}>
              <Icon name={a.icon} size={18} />
              <span className="menu-label">{a.label}</span>
              {a.pressed ? <Icon name="check" size={16} className="menu-end" /> : null}
            </DM.Item>
          ))}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

function VolumeButton() {
  const volume = useVolume();
  const box = useRef<HTMLDivElement>(null);
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className="icon-btn" aria-label="Volume">
          <Icon name={volumeIcon(volume)} size={18} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          ref={box}
          className="popover vol-pop"
          side="top"
          sideOffset={12}
          collisionPadding={12}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            box.current?.querySelector<HTMLElement>("[role=slider]")?.focus();
          }}
        >
          <Volume />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function PlayerBar() {
  const song = useCurrentSong();
  const station = usePlayer((s) => s.station);
  const panel = useUi((s) => s.rightPanel);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const wide = useIsWide();
  const fmt = station ? null : formatLabel(song);
  const nowPanel: BarAction = { label: "Now playing panel", icon: "album", size: 18, pressed: panel === "now", run: () => toggleRightPanel("now") };
  const queue: BarAction = { label: "Queue", icon: "queue", size: 18, keyHint: "Q", pressed: panel === "queue", run: () => toggleRightPanel("queue") };
  const lyrics: BarAction = { label: "Lyrics", icon: "mic", size: 18, keyHint: "Y", pressed: pathname === "/lyrics", run: () => void (pathname === "/lyrics" ? navigate(-1) : navigate("/lyrics")) };
  const full: BarAction = { label: "Full screen", icon: "expand", size: 17, keyHint: "F", disabled: !song && !station, run: () => setFullScreen(true) };
  return (
    <footer className="bar" aria-label="Player">
      <div className="np">
        {station ? (
          <>
            <div className="art station-art"><Icon name="radio" size={24} /></div>
            <div className="np-text">
              <div className="np-t">{station.name}</div>
              <div className="np-a"><LiveLabel /></div>
            </div>
          </>
        ) : song ? (
          <>
            <Link to={song.albumId ? albumPath(song.albumId) : "#"} aria-label={`Go to ${song.album ?? "album"}`}>
              <Art id={song.coverArt} px={56} />
            </Link>
            <div className="np-text">
              <div className="np-t">{song.albumId ? <Link to={albumPath(song.albumId)}>{song.title}</Link> : song.title}</div>
              <div className="np-a">{song.artistId ? <Link to={artistPath(song.artistId)}>{artistName(song)}</Link> : artistName(song)}</div>
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
        {wide ? (
          <>
            {fmt ? <span className="fmt">{fmt}</span> : null}
            <BarButton action={nowPanel} />
            <BarButton action={lyrics} />
          </>
        ) : null}
        <BarButton action={queue} />
        <DevicesButton />
        {wide ? (
          <>
            <Volume />
            <BarButton action={full} />
          </>
        ) : (
          <>
            <VolumeButton />
            <MoreMenu actions={[nowPanel, lyrics, full]} />
          </>
        )}
      </div>
    </footer>
  );
}
