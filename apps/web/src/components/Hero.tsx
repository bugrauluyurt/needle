import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import { MobileBack } from "../layout/Mobile.tsx";
import { useIsMobile } from "../layout/Shell.tsx";
import { ContextPlayButton, TopBar } from "../layout/TopBar.tsx";
import { useShowPagePlay } from "../state/pagePlay.ts";
import type { PagePlay } from "../state/pagePlay.ts";
import { Icon } from "./Icon.tsx";
import { SubsonicError } from "../lib/subsonic.ts";

export function titleSize(title: string): number {
  const n = title.length;
  if (n <= 12) return 96;
  if (n <= 18) return 84;
  if (n <= 26) return 64;
  if (n <= 40) return 48;
  return 38;
}

export function Hero({ art, kind, title, description, meta }: { art: ReactNode; kind: string; title: string; description?: string | undefined; meta: ReactNode }) {
  const mobile = useIsMobile();
  return (
    <>
      {mobile ? <MobileBack /> : <TopBar />}
      <div className="hero">
        <div className="hero-art">{art}</div>
        <div className="hero-text">
          <div className="kind">{kind}</div>
          <h1 style={{ "--title": `${titleSize(title)}px` } as React.CSSProperties}>{title}</h1>
          {description ? <p className="desc">{description}</p> : null}
          <div className="meta">{meta}</div>
        </div>
      </div>
    </>
  );
}

export function PlayContextButton(props: PagePlay) {
  useShowPagePlay(props);
  return <ContextPlayButton {...props} className="bigplay" size={22} />;
}

export function ShuffleButton({ onShuffle, label }: { onShuffle: () => void; label: string }) {
  return (
    <button type="button" className="icon-btn big" aria-label={`Shuffle ${label}`} onClick={onShuffle}>
      <Icon name="shuffle" size={26} />
    </button>
  );
}

export function ActBar({ children, end }: { children: ReactNode; end?: ReactNode }) {
  return (
    <div className="actbar">
      {children}
      {end ? <div className="act-end">{end}</div> : null}
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="page-skeleton" aria-busy="true">
      <div className="hero">
        <div className="skeleton hero-skel" />
        <div className="hero-text">
          <div className="skeleton line-skel" style={{ width: 60 }} />
          <div className="skeleton title-skel" />
          <div className="skeleton line-skel" style={{ width: 240 }} />
        </div>
      </div>
    </div>
  );
}

export function NotFoundState({ what, error, retry, name }: { what: string; error?: unknown; retry?: () => void; name?: string | undefined }) {
  const mobile = useIsMobile();
  const navigate = useNavigate();
  const missing = !error || (error instanceof SubsonicError && error.code === 70);
  const back = <button type="button" className="btn ghost" onClick={() => void navigate(-1)}>Go back</button>;
  return (
    <>
      {mobile ? <MobileBack /> : <TopBar />}
      <div className="empty">
        <div className="empty-in">
          {!missing ? (
            <>
              <h1>Couldn’t reach your music</h1>
              <p>Navidrome didn’t answer. Check that it’s running and that Needle’s server can reach it.</p>
              {retry ? <div className="acts"><button type="button" className="btn primary" onClick={retry}><Icon name="refresh" size={16} />Try again</button></div> : null}
            </>
          ) : name ? (
            <>
              <h1>{name} isn’t in your library</h1>
              <p>None of their music is in your library. Search for them to find their albums and songs.</p>
              <div className="acts">
                <button type="button" className="btn primary" onClick={() => void navigate(`/search?q=${encodeURIComponent(name)}`)}><Icon name="search" size={16} />Search for {name}</button>
                {back}
              </div>
            </>
          ) : (
            <>
              <h1>This {what} isn’t here</h1>
              <p>It may have been removed from Navidrome, or the link is wrong.</p>
              <div className="acts">{back}</div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
