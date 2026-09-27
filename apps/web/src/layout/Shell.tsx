import { createContext, lazy, Suspense, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { Outlet, useLocation, useNavigate } from "react-router";
import { ScrollContext } from "../components/ScrollContext.ts";
import { DEFAULT_TONE } from "../lib/tone.ts";
import { player, warmSpotify } from "../player/controller.ts";
import { useCapabilities } from "../queries/hooks.ts";
import { useSpotifyOn } from "../queries/spotify.ts";
import { current, usePlayer } from "../player/store.ts";
import { setFullScreen, useUi, toggleRightPanel } from "../state/ui.ts";
import { useSongLikes } from "../queries/likes.ts";
import { isIOS, isStandalone } from "../lib/device.ts";
import { InstallHint } from "../components/InstallHint.tsx";
import { MiniPlayer, NowPlayingSheet, TabBar } from "./Mobile.tsx";
import { Toasts } from "./Overlays.tsx";
import { TrackMenuHost } from "../components/TrackMenu.tsx";
import { Tooltips } from "../components/Tooltips.tsx";

const FullScreenPlayer = lazy(() => import("./FullScreen.tsx"));
const ShortcutsDialog = lazy(() => import("./Shortcuts.tsx"));
import { PlayerBar } from "./PlayerBar.tsx";
import { RightPanel } from "./RightPanel.tsx";
import { Sidebar } from "./Sidebar.tsx";

const MOBILE = "(max-width: 767px)";

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export const useIsMobile = () => useMediaQuery(MOBILE);

const ToneContext = createContext<(tone: string) => void>(() => undefined);

export function usePageTone(tone: string | null) {
  const setTone = useContext(ToneContext);
  useEffect(() => setTone(tone ?? DEFAULT_TONE), [tone, setTone]);
}

function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return Boolean(el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)));
}

function useShortcuts() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const songLikes = useSongLikes();
  const likes = useRef(songLikes);
  useEffect(() => {
    likes.current = songLikes;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      const s = usePlayer.getState();
      const handled = () => e.preventDefault();
      switch (e.key) {
        case " ":
          if ((e.target as HTMLElement | null)?.closest("button,[role=slider],[role=row],a")) return;
          handled();
          player.toggle();
          break;
        case "ArrowRight":
          handled();
          if (e.shiftKey) void player.next();
          else player.seekBy(10);
          break;
        case "ArrowLeft":
          handled();
          if (e.shiftKey) void player.previous();
          else player.seekBy(-10);
          break;
        case "ArrowUp":
          if ((e.target as HTMLElement | null)?.closest("[role=row],[role=slider]")) return;
          handled();
          player.setVolume(s.volume + 0.1);
          break;
        case "ArrowDown":
          if ((e.target as HTMLElement | null)?.closest("[role=row],[role=slider]")) return;
          handled();
          player.setVolume(s.volume - 0.1);
          break;
        case "l":
        case "L": {
          const song = current(s);
          if (!song) return;
          handled();
          likes.current.setLiked(song, !likes.current.isLiked(song));
          break;
        }
        case "s":
        case "S":
          handled();
          player.setShuffle(!s.shuffle);
          break;
        case "r":
        case "R":
          handled();
          player.cycleRepeat();
          break;
        case "/":
          handled();
          void navigate("/search");
          window.setTimeout(() => document.querySelector<HTMLInputElement>(".searchbox input, .psearch input")?.focus(), 50);
          break;
        case "q":
        case "Q":
          handled();
          toggleRightPanel("queue");
          break;
        case "y":
        case "Y":
          handled();
          if (pathname === "/lyrics") void navigate(-1);
          else void navigate("/lyrics");
          break;
        case "f":
        case "F":
          handled();
          setFullScreen(!useUi.getState().fullScreen);
          break;
        case "?":
          handled();
          useUi.setState({ shortcutsOpen: true });
          break;
        case "Escape":
          if (useUi.getState().fullScreen) setFullScreen(false);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, pathname]);
}

function Main({ children, mobile }: { children: ReactNode; mobile: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const [tone, setTone] = useState(DEFAULT_TONE);
  const { pathname } = useLocation();
  useLayoutEffect(() => {
    ref.current?.scrollTo(0, 0);
  }, [pathname]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => el.toggleAttribute("data-scrolled", el.scrollTop > 60));
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <ToneContext.Provider value={setTone}>
      <ScrollContext.Provider value={ref}>
        <main ref={ref} className={mobile ? "pmain scroll-thin" : "main scroll-thin"} style={{ "--tone": tone } as React.CSSProperties} id="main">
          {children}
        </main>
      </ScrollContext.Provider>
    </ToneContext.Provider>
  );
}

export function Shell() {
  const mobile = useIsMobile();
  const panel = useUi((s) => s.rightPanel);
  const fullScreen = useUi((s) => s.fullScreen);
  const shortcuts = useUi((s) => s.shortcutsOpen);
  const hasSong = usePlayer((s) => s.items.length > 0 || Boolean(s.station));
  const wide = useMediaQuery("(min-width: 1180px)");
  const spotifyOn = useSpotifyOn();
  const spotifyPlayback = Boolean(useCapabilities().data?.spotifyPlayback) && spotifyOn;
  useShortcuts();
  useEffect(() => {
    if (spotifyPlayback) warmSpotify();
  }, [spotifyPlayback]);
  if (mobile) {
    return (
      <div className={`phone-app ${hasSong ? "has-mini" : ""}`}>
        <Main mobile>
          <Outlet />
        </Main>
        <MiniPlayer />
        <TabBar />
        <NowPlayingSheet />
        <TrackMenuHost />
        {isIOS && !isStandalone ? <InstallHint /> : null}
        <Toasts />
      </div>
    );
  }
  const showRight = Boolean(panel) && wide && hasSong;
  return (
    <div className={`app ${showRight ? "" : "solo"}`}>
      <a href="#main" className="skip">Skip to content</a>
      <Sidebar />
      <Main mobile={false}>
        <Outlet />
      </Main>
      {showRight ? <RightPanel /> : null}
      <PlayerBar />
      <TrackMenuHost />
      <Tooltips />
      {fullScreen ? <Suspense fallback={null}><FullScreenPlayer /></Suspense> : null}
      {shortcuts ? <Suspense fallback={null}><ShortcutsDialog /></Suspense> : null}
      <Toasts />
    </div>
  );
}
