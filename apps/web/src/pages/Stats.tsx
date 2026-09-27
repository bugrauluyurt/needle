import { useState } from "react";
import { Link } from "react-router";
import type { Period, Stats } from "@needle/shared";
import { Art } from "../components/Art.tsx";
import { Icon } from "../components/Icon.tsx";
import { count, hours, plural } from "../lib/format.ts";
import { hashPalette } from "../lib/palette.ts";
import { MobileHeader } from "../layout/Mobile.tsx";
import { useIsMobile, usePageTone } from "../layout/Shell.tsx";
import { TopBar } from "../layout/TopBar.tsx";
import { useArtists, useStats } from "../queries/hooks.ts";
import { albumPath, artistPath } from "../lib/paths.ts";
import { isSpotify } from "../lib/spotify.ts";

const PERIODS: [Period, string][] = [["month", "This month"], ["quarter", "Last 3 months"], ["year", "This year"], ["all", "All time"]];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function hourLabel(h: number): string {
  if (h === 0) return "midnight";
  if (h === 12) return "noon";
  return h < 12 ? `${h} am` : `${h - 12} pm`;
}

function when(h: number | null): string | null {
  if (h === null) return null;
  if (h >= 21 || h < 2) return `most of it after ${hourLabel(h >= 21 ? h : 21)}`;
  if (h < 6) return "most of it in the small hours";
  if (h < 12) return "most of it in the morning";
  if (h < 17) return "most of it in the afternoon";
  return "most of it in the evening";
}

function headline(s: Stats, period: Period): { lead: string; accent: string | null } {
  const now = new Date();
  const span = period === "month" ? `in ${MONTHS[now.getMonth()]}` : period === "quarter" ? "in the last 3 months" : period === "year" ? `in ${now.getFullYear()}` : "so far";
  return { lead: `${hours(s.msPlayed)} of music ${span}`, accent: when(s.peakHour) };
}

function comparison(s: Stats, period: Period): string {
  const base = `${plural(s.songs, "song")} from ${plural(s.artists, "artist")}.`;
  if (period === "all" || !s.prevMsPlayed) return base;
  const diffH = Math.round((s.msPlayed - s.prevMsPlayed) / 3_600_000);
  const prev = period === "month" ? MONTHS[(new Date().getMonth() + 11) % 12] : period === "year" ? String(new Date().getFullYear() - 1) : "the 3 months before";
  if (diffH === 0) return `${base} About the same as ${prev}.`;
  return `${base} That’s ${plural(Math.abs(diffH), "hour")} ${diffH > 0 ? "more" : "less"} than ${prev}.`;
}

export default function StatsPage() {
  const mobile = useIsMobile();
  const [period, setPeriod] = useState<Period>("month");
  const { data: s, isLoading } = useStats(period);
  const { data: artists } = useArtists();
  const cover = (id: string) => artists?.find((a) => a.id === id)?.coverArt;
  const known = (id: string) => Boolean(artists?.some((a) => a.id === id));
  usePageTone(null);
  const maxHour = Math.max(1, ...(s?.hours ?? [1]));
  const h = s ? headline(s, period) : null;
  return (
    <>
      {mobile ? <MobileHeader title="Your listening" /> : <TopBar />}
      <div className="pad stats">
        <div className="chips page-chips flush" role="group" aria-label="Period">
          {PERIODS.map(([p, label]) => (
            <button key={p} type="button" className="pill" aria-pressed={period === p} onClick={() => setPeriod(p)}>{label}</button>
          ))}
        </div>
        {isLoading || !s ? (
          <div className="skeleton title-skel" />
        ) : !s.msPlayed ? (
          <div className="empty-inline">
            <h1 className="stat-lede">Nothing played yet {period === "all" ? "" : "in this period"}</h1>
            <p className="muted">Listen for a bit and your hours, top artists and favourite times show up here.</p>
          </div>
        ) : (
          <>
            <h1 className="stat-lede">
              {h?.lead}
              {h?.accent ? <>, <em>{h.accent}</em>.</> : "."}
            </h1>
            <p className="muted stat-sub">{comparison(s, period)}</p>
            <div className="stat-grid">
              <section className="stat-box">
                <h3>Top artists <span>Plays</span></h3>
                {s.topArtists.map((a, i) => (
                  <Link key={a.id} to={known(a.id) || isSpotify(a.id) ? artistPath(a.id) : "/stats"} className="rank">
                    <span className="n">{i + 1}</span>
                    <Art id={cover(a.id)} px={44} round fallback="artist" />
                    <div>
                      <div className="t">{a.name}</div>
                      <div className="bar-in"><i style={{ width: `${(a.plays / (s.topArtists[0]?.plays ?? 1)) * 100}%` }} /></div>
                    </div>
                    <span className="c">{count(a.plays)}</span>
                  </Link>
                ))}
              </section>
              <section className="stat-box">
                <h3>Top albums <span>Plays</span></h3>
                {s.topAlbums.map((a, i) => (
                  <Link key={a.id} to={albumPath(a.id)} className="rank">
                    <span className="n">{i + 1}</span>
                    <Art id={a.coverArt} px={44} />
                    <div>
                      <div className="t">{a.name}</div>
                      <div className="bar-in"><i style={{ width: `${(a.plays / (s.topAlbums[0]?.plays ?? 1)) * 100}%` }} /></div>
                    </div>
                    <span className="c">{count(a.plays)}</span>
                  </Link>
                ))}
              </section>
              <section className="stat-box">
                <h3>When you listen <span>By hour of day</span></h3>
                <div className="hours" role="img" aria-label={s.peakHour !== null ? `You listen most around ${hourLabel(s.peakHour)}` : "Listening by hour"}>
                  {s.hours.map((ms, i) => (
                    <i key={i} className={ms >= maxHour * 0.75 ? "hot" : ""} style={{ height: `${Math.max(2, (ms / maxHour) * 130)}px` }} title={`${hourLabel(i)}: ${hours(ms)}`} />
                  ))}
                </div>
                <div className="hours-x"><span>Midnight</span><span>6 am</span><span>Noon</span><span>6 pm</span><span>11 pm</span></div>
              </section>
              <section className="stat-box">
                <h3>Genres <span>Share of listening</span></h3>
                <div className="genrebar">
                  {s.genres.map((g) => <i key={g.name} style={{ background: g.name === "Other" ? "var(--dim)" : hashPalette(g.name)[1], flex: g.share }} />)}
                </div>
                <div className="legend">
                  {s.genres.map((g) => (
                    <span key={g.name} style={{ "--c": g.name === "Other" ? "var(--dim)" : hashPalette(g.name)[1] } as React.CSSProperties}>
                      {g.name}<em>{Math.round(g.share * 100)}%</em>
                    </span>
                  ))}
                </div>
              </section>
            </div>
          </>
        )}
        <p className="help"><Icon name="info" size={15} />Counted from every song you play for 30 seconds or more, on any device signed in as you.</p>
      </div>
    </>
  );
}
