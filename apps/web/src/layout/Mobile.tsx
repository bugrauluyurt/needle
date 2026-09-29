import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router";
import { useDragToClose } from "../components/ActionSheet.tsx";
import { Art } from "../components/Art.tsx";
import { useScrollContainer } from "../components/ScrollContext.ts";
import { Icon } from "../components/Icon.tsx";
import type { IconName } from "../components/Icon.tsx";
import { LyricsView } from "../components/Lyrics.tsx";
import { TrackMoreButton } from "../components/TrackMenu.tsx";
import { artistName, formatLabel } from "../lib/format.ts";
import { useTone } from "../lib/tone.ts";
import { usePlayer } from "../player/store.ts";
import { usePlayback, useShownProgress } from "../remote/client.ts";
import { DevicesButton } from "../remote/DevicesButton.tsx";
import { useSession } from "../state/session.ts";
import { useUi } from "../state/ui.ts";
import { LikeCurrent, LiveLabel, SeekBar, Transport } from "./PlayerBar.tsx";
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
  const { remote, song, station, playing, controls } = usePlayback();
  const pct = useShownProgress(remote, (p) => (p.duration ? Math.round((p.position / p.duration) * 1000) / 10 : 0));
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
            {station ? <LiveLabel /> : <><Icon name="devices" size={13} /><span className="ellipsis">{remote ? `Playing on ${remote.name}` : deviceName}</span></>}
          </div>
        </div>
      </button>
      <DevicesButton />
      <button type="button" className="icon-btn light" aria-label={playing ? "Pause" : "Play"} onClick={controls.toggle}>
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

const GLASS_AFTER_PX = 160;

export function MobileBack() {
  const navigate = useNavigate();
  const { key } = useLocation();
  const scroller = useScrollContainer();
  const bar = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const main = scroller?.current;
    const el = bar.current;
    if (!main || !el) return;
    const glass = () => el.style.setProperty("--p", String(Math.min(1, main.scrollTop / GLASS_AFTER_PX)));
    glass();
    main.addEventListener("scroll", glass, { passive: true });
    const heading = main.querySelector("h1");
    if (title.current) title.current.textContent = heading?.textContent ?? "";
    const seen = heading
      ? new IntersectionObserver(([e]) => el.classList.toggle("titled", Boolean(e && !e.isIntersecting && e.boundingClientRect.top < el.offsetHeight)), {
          root: main,
          rootMargin: `-${el.offsetHeight}px 0px 0px 0px`,
        })
      : null;
    if (heading) seen?.observe(heading);
    return () => {
      main.removeEventListener("scroll", glass);
      seen?.disconnect();
    };
  }, [scroller, key]);
  return (
    <div ref={bar} className="mobile-bar">
      <button type="button" className="icon-btn light mobile-back" aria-label="Go back" onClick={() => void navigate(-1)}>
        <Icon name="back" size={24} />
      </button>
      <span ref={title} className="mobile-bar-title" aria-hidden="true" />
    </div>
  );
}

export function NowPlayingSheet() {
  const open = useUi((s) => s.nowPlayingOpen);
  const view = useUi((s) => s.mobileView);
  const { remote, song, station, playing, controls } = usePlayback();
  const context = usePlayer((s) => s.context);
  const deviceName = useSession((s) => s.deviceName);
  const tone = useTone(song?.coverArt);
  const close = () => useUi.setState({ nowPlayingOpen: false });
  const { handlers: swipe } = useDragToClose(close);
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

  const fmt = station ? null : formatLabel(song);
  return (
    <div className={`sheet-root view-${view}`} role="dialog" aria-modal="true" aria-label="Now playing" style={{ "--tone": tone } as React.CSSProperties}>
      {view === "lyrics" && song ? (
        <div className="plyr">
          {head(song.title, artistName(song))}
          <div className="plyr-body"><LyricsView song={song} variant="mobile" /></div>
          <div className="plyr-foot">
            <SeekBar className="seek below" times="below" />
            <div className="plyr-pp">
              <button type="button" className="pp" aria-label={playing ? "Pause" : "Play"} onClick={controls.toggle}>
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
          {remote ? head("Playing on", remote.name) : head(station ? "Internet radio" : context ? `Playing from ${context.kind === "album" ? "album" : context.kind === "playlist" ? "playlist" : context.kind === "artist" ? "artist" : ""}`.trim() : "Playing", station?.name ?? context?.name ?? song?.album ?? "")}
          <div className="nowp-art" {...swipe}>
            {station ? <div className="art big station-art"><Icon name="radio" size={64} /></div> : <Art id={song?.coverArt} px={340} className="big" eager />}
          </div>
          <div className="ti">
            <div>
              <h2>{station?.name ?? song?.title}</h2>
              <p>{station ? <LiveLabel /> : song ? artistName(song) : ""}</p>
            </div>
            {song ? <LikeCurrent size={26} className="icon-btn big-heart" /> : null}
          </div>
          <SeekBar className="seek below" times="below" />
          <Transport big />
          <div className="under">
            <DevicesButton trigger={<button type="button" className="dev-pill"><Icon name="devices" size={16} />{remote?.name ?? deviceName}</button>} />
            <div className="under-end">
              {fmt ? <span className="fmt">{fmt}</span> : null}
              <button type="button" className="icon-btn light" aria-label="Queue" onClick={() => useUi.setState({ mobileView: "queue" })}>
                <Icon name="queue" size={22} />
              </button>
            </div>
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
