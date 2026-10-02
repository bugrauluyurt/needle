import { createContext, lazy, Suspense, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Outlet, useLocation, useNavigate } from "react-router";
import { ScrollContext } from "../components/ScrollContext.ts";
import { DEFAULT_TONE } from "../lib/tone.ts";
import { allowSpotify, player, SEEK_STEP_S, warmSpotify } from "../player/controller.ts";
import { useCapabilities } from "../queries/hooks.ts";
import { useSpotifyRequestsAllowed } from "../queries/spotify.ts";
import { current, locatePlaying, useLocate, usePlayer } from "../player/store.ts";
import { setFullScreen, useUi, toggleRightPanel } from "../state/ui.ts";
import { useSongLikes } from "../queries/likes.ts";
import { isIOS, isStandalone } from "../lib/device.ts";
import { SpotifyNotice } from "../components/SpotifyNotice.tsx";
import { InstallHint } from "../components/InstallHint.tsx";
import { MiniPlayer, NowPlayingSheet, TabBar } from "./Mobile.tsx";
import { Toasts } from "./Overlays.tsx";
import { SearchFocusProxy, useOpenSearch } from "./TopBar.tsx";
import { closeTrackMenu, TrackMenuHost } from "../components/TrackMenu.tsx";
import { Tooltips } from "../components/Tooltips.tsx";
import { useActiveRemote } from "../remote/client.ts";
import { useIsMobile, useIsWide } from "../lib/media.ts";

const FullScreenPlayer = lazy(() => import("./FullScreen.tsx"));
const ShortcutsDialog = lazy(() => import("./Shortcuts.tsx"));
import { PlayerBar } from "./PlayerBar.tsx";
import { RightPanel, RightPanelOver } from "./RightPanel.tsx";
import { Sidebar } from "./Sidebar.tsx";

export { useMediaQuery, useIsMobile, useIsWide } from "../lib/media.ts";

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
  const openSearch = useOpenSearch();
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
          else player.seekBy(SEEK_STEP_S);
          break;
        case "ArrowLeft":
          handled();
          if (e.shiftKey) void player.previous();
          else player.seekBy(-SEEK_STEP_S);
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
          if (e.shiftKey) {
            if (!useLocate.getState().lists) return;
            handled();
            locatePlaying();
            break;
          }
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
          openSearch();
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
  }, [navigate, pathname, openSearch]);
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
          <SpotifyNotice />
          {children}
        </main>
      </ScrollContext.Provider>
    </ToneContext.Provider>
  );
}

function useCloseOverlaysOnNavigate() {
  const { pathname } = useLocation();
  useEffect(() => {
    closeTrackMenu();
    if (useUi.getState().fullScreen) setFullScreen(false);
    useUi.setState({ nowPlayingOpen: false });
  }, [pathname]);
}

function usePanelOver(narrow: boolean): boolean {
  const { pathname } = useLocation();
  const panel = useUi((s) => s.rightPanel);
  const [opened, setOpened] = useState(false);
  useEffect(() => {
    if (!narrow) return;
    const off = useUi.subscribe((s, prev) => {
      if (s.rightPanel !== prev.rightPanel) setOpened(Boolean(s.rightPanel));
    });
    useUi.setState({ rightPanel: null });
    return off;
  }, [narrow, pathname]);
  return narrow && opened && Boolean(panel);
}

export function Shell() {
  const mobile = useIsMobile();
  const panel = useUi((s) => s.rightPanel);
  const fullScreen = useUi((s) => s.fullScreen);
  const shortcuts = useUi((s) => s.shortcutsOpen);
  const remote = useActiveRemote();
  const hasSong = usePlayer((s) => s.items.length > 0 || Boolean(s.station)) || Boolean(remote);
  const wide = useIsWide();
  const panelOver = usePanelOver(!wide && !mobile);
  const spotifyOn = useSpotifyRequestsAllowed();
  const spotifyPlayback = Boolean(useCapabilities().data?.spotifyPlayback) && spotifyOn;
  useShortcuts();
  useCloseOverlaysOnNavigate();
  useEffect(() => {
    allowSpotify(spotifyPlayback);
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
        <SearchFocusProxy />
        <NowPlayingSheet />
        <TrackMenuHost mobile={mobile} />
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
      {panelOver && hasSong ? <RightPanelOver /> : null}
      <PlayerBar />
      <TrackMenuHost mobile={mobile} />
      <Tooltips />
      {fullScreen ? <Suspense fallback={null}><FullScreenPlayer /></Suspense> : null}
      {shortcuts ? <Suspense fallback={null}><ShortcutsDialog /></Suspense> : null}
      <Toasts />
    </div>
  );
}
