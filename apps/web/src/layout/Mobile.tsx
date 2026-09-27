import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { NavLink, useNavigate } from "react-router";
import { Art } from "../components/Art.tsx";
import { Icon } from "../components/Icon.tsx";
import type { IconName } from "../components/Icon.tsx";
import { LyricsView } from "../components/Lyrics.tsx";
import { TrackMoreButton } from "../components/TrackMenu.tsx";
import { artistName } from "../lib/format.ts";
import { useTone } from "../lib/tone.ts";
import { player } from "../player/controller.ts";
import { useProgress } from "../player/progress.ts";
import { useCurrentSong, usePlayer } from "../player/store.ts";
import { DevicesButton } from "../remote/DevicesButton.tsx";
import { useSession } from "../state/session.ts";
import { useUi } from "../state/ui.ts";
import { LikeCurrent, SeekBar, Transport } from "./PlayerBar.tsx";
import { QueueView } from "./RightPanel.tsx";
import { AccountMenu } from "./TopBar.tsx";

const TABS: [string, string, IconName][] = [["/", "Home", "home"], ["/search", "Search", "search"], ["/library", "Library", "library"], ["/you", "You", "user"]];

export function TabBar() {
  return (
    <nav className="tabbar" aria-label="Main">
      {TABS.map(([to, label, icon]) => (
        <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => (isActive ? "on" : "")}>
          <Icon name={icon} size={24} />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

export function MiniPlayer() {
  const song = useCurrentSong();
  const station = usePlayer((s) => s.station);
  const playing = usePlayer((s) => s.playing);
  const pct = useProgress((p) => (p.duration ? Math.round((p.position / p.duration) * 1000) / 10 : 0));
  const tone = useTone(song?.coverArt);
  const deviceName = useSession((s) => s.deviceName);
  if (!song && !station) return null;
  return (
    <div className="miniplayer" style={{ "--tone": tone } as React.CSSProperties}>
      <button type="button" className="mini-open" aria-label="Open now playing" onClick={() => useUi.setState({ nowPlayingOpen: true, mobileView: "player" })}>
        {station ? <div className="art station-art"><Icon name="radio" size={20} /></div> : <Art id={song?.coverArt} px={44} />}
        <div className="mini-text">
          <div className="t">{station?.name ?? song?.title}</div>
          <div className="s">
            <Icon name="devices" size={13} />
            {station ? "Internet radio" : deviceName}
          </div>
        </div>
      </button>
      <DevicesButton />
      <button type="button" className="icon-btn light" aria-label={playing ? "Pause" : "Play"} onClick={player.toggle}>
        <Icon name={playing ? "pause" : "play"} size={22} />
      </button>
      <div className="pl"><i style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

export function MobileHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <header className="ph-h">
      <AccountMenu size={34} />
      <h1>{title}</h1>
      {actions}
    </header>
  );
}

export function MobileBack() {
  const navigate = useNavigate();
  return (
    <button type="button" className="icon-btn light mobile-back" aria-label="Go back" onClick={() => void navigate(-1)}>
      <Icon name="back" size={24} />
    </button>
  );
}

function useSwipeDown(onClose: () => void) {
  const start = useRef<number | null>(null);
  return {
    onTouchStart: (e: React.TouchEvent) => {
      start.current = e.touches[0]?.clientY ?? null;
    },
    onTouchEnd: (e: React.TouchEvent) => {
      const s = start.current;
      const end = e.changedTouches[0]?.clientY;
      if (s !== null && end !== undefined && end - s > 110) onClose();
      start.current = null;
    },
  };
}

export function NowPlayingSheet() {
  const open = useUi((s) => s.nowPlayingOpen);
  const view = useUi((s) => s.mobileView);
  const playing = usePlayer((s) => s.playing);
  const song = useCurrentSong();
  const station = usePlayer((s) => s.station);
  const context = usePlayer((s) => s.context);
  const deviceName = useSession((s) => s.deviceName);
  const tone = useTone(song?.coverArt);
  const close = () => useUi.setState({ nowPlayingOpen: false });
  const swipe = useSwipeDown(close);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open]);
  if (!open || (!song && !station)) return null;

  const head = (label: string, name: string) => (
    <div className="nowp-top" {...swipe}>
      <button type="button" className="icon-btn light" aria-label="Close" onClick={view === "player" ? close : () => useUi.setState({ mobileView: "player" })}>
        <Icon name="down" size={26} />
      </button>
      <div>
        {label}
        <b>{name}</b>
      </div>
      {song ? <TrackMoreButton songs={[song]} className="icon-btn light" size={24} /> : <span style={{ width: 32 }} />}
    </div>
  );

  return (
    <div className={`sheet-root view-${view}`} role="dialog" aria-modal="true" aria-label="Now playing" style={{ "--tone": tone } as React.CSSProperties}>
      {view === "lyrics" && song ? (
        <div className="plyr">
          {head(song.title, artistName(song))}
          <div className="plyr-body"><LyricsView song={song} variant="mobile" /></div>
          <div className="plyr-foot">
            <SeekBar className="seek below" times="below" />
            <div className="plyr-pp">
              <button type="button" className="pp" aria-label={playing ? "Pause" : "Play"} onClick={player.toggle}>
                <Icon name={playing ? "pause" : "play"} size={26} />
              </button>
            </div>
          </div>
        </div>
      ) : view === "queue" ? (
        <div className="pqueue">
          {head("", "Queue")}
          <div className="pqueue-body scroll-thin"><QueueView /></div>
        </div>
      ) : (
        <div className="nowp">
          {head(station ? "Internet radio" : context ? `Playing from ${context.kind === "album" ? "album" : context.kind === "playlist" ? "playlist" : context.kind === "artist" ? "artist" : ""}`.trim() : "Playing", station?.name ?? context?.name ?? song?.album ?? "")}
          <div className="nowp-art" {...swipe}>
            {station ? <div className="art big station-art"><Icon name="radio" size={64} /></div> : <Art id={song?.coverArt} px={340} className="big" eager />}
          </div>
          <div className="ti">
            <div>
              <h2>{station?.name ?? song?.title}</h2>
              <p>{station ? "Internet radio" : song ? artistName(song) : ""}</p>
            </div>
            {song ? <LikeCurrent size={26} className="icon-btn big-heart" /> : null}
          </div>
          <SeekBar className="seek below" times="below" />
          <Transport big />
          <div className="under">
            <DevicesButton trigger={<button type="button" className="dev-pill"><Icon name="devices" size={16} />{deviceName}</button>} />
            <button type="button" className="icon-btn light" aria-label="Queue" onClick={() => useUi.setState({ mobileView: "queue" })}>
              <Icon name="queue" size={22} />
            </button>
          </div>
          {song ? (
            <button type="button" className="lyr-peek" onClick={() => useUi.setState({ mobileView: "lyrics" })} aria-label="Open lyrics">
              <h6>Lyrics</h6>
              <LyricsView song={song} variant="peek" limit={2} />
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
