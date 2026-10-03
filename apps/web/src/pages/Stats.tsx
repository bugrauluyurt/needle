import { SourceMark } from "../components/SpotifyMark.tsx";
import { MIN_REPORT_MS } from "../player/controller.ts";
import { useState } from "react";
import { HOUR_MS, QUARTER_DAYS, musicSource } from "@needle/shared";
import { Link } from "react-router";
import type { Period, Stats } from "@needle/shared";
import { Art } from "../components/Art.tsx";
import { Icon } from "../components/Icon.tsx";
import { count, hours, plural } from "../lib/format.ts";
import { hashPalette } from "../lib/palette.ts";
import { MobileHeader } from "../layout/Mobile.tsx";
import { useIsMobile } from "../lib/media.ts";
import { usePageTone } from "../layout/pageTone.ts";
import { TopBar } from "../layout/TopBar.tsx";
import { useArtists, useStats } from "../queries/hooks.ts";
import { albumPath, artistPath } from "../lib/paths.ts";
import { i18next, translate } from "../i18n/index.ts";

const periodOptions = (): [Period, string][] => [
  ["month", translate("stats.thisMonth")],
  ["quarter", translate("stats.lastDays", { count: QUARTER_DAYS })],
  ["year", translate("stats.thisYear")],
  ["all", translate("stats.allTime")],
];

function hourLabel(h: number): string {
  return new Intl.DateTimeFormat(i18next.resolvedLanguage, {
    hour: "numeric",
  }).format(new Date(2020, 0, 1, h));
}

function when(h: number | null): string | null {
  if (h === null) return null;
  if (h >= 21 || h < 2) return translate("stats.whenAfter", { time: hourLabel(h >= 21 ? h : 21) });
  if (h < 6) return translate("stats.whenNight");
  if (h < 12) return translate("stats.whenMorning");
  if (h < 17) return translate("stats.whenAfternoon");

  return translate("stats.whenEvening");
}

function headline(s: Stats, period: Period): { lead: string; accent: string | null } {
  const now = new Date();
  const month = new Intl.DateTimeFormat(i18next.resolvedLanguage, {
    month: "long",
  }).format(now);
  const listenedHours = hours(s.msPlayed);
  let lead: string;

  switch (period) {
    case "month":
      lead = translate("stats.leadMonth", { hours: listenedHours, month });
      break;
    case "quarter":
      lead = translate("stats.leadQuarter", {
        hours: listenedHours,
        count: QUARTER_DAYS,
      });
      break;
    case "year":
      lead = translate("stats.leadYear", {
        hours: listenedHours,
        year: now.getFullYear(),
      });
      break;
    case "all":
      lead = translate("stats.leadAll", { hours: listenedHours });
      break;
  }

  return { lead, accent: when(s.peakHour) };
}

function comparison(s: Stats, period: Period): string {
  const base = translate("stats.comparisonBase", {
    songs: plural(s.songs, "song"),
    artists: plural(s.artists, "artist"),
  });
  if (period === "all" || !s.prevMsPlayed) return base;
  const diffH = Math.round((s.msPlayed - s.prevMsPlayed) / HOUR_MS);
  const previousMonth = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1);
  const prev =
    period === "month"
      ? new Intl.DateTimeFormat(i18next.resolvedLanguage, {
          month: "long",
        }).format(previousMonth)
      : period === "year"
        ? String(new Date().getFullYear() - 1)
        : translate("stats.previousQuarter", { count: QUARTER_DAYS });
  if (diffH === 0) return translate("stats.comparisonSame", { base, previous: prev });

  return translate(diffH > 0 ? "stats.comparisonMore" : "stats.comparisonLess", {
    base,
    hours: plural(Math.abs(diffH), "hour"),
    previous: prev,
  });
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
      {mobile ? <MobileHeader title={translate("common.yourListening")} /> : <TopBar />}
      <div className="pad stats">
        <div className="chips page-chips flush" role="group" aria-label={translate("stats.period")}>
          {periodOptions().map(([p, label]) => (
            <button key={p} type="button" className="pill" aria-pressed={period === p} onClick={() => setPeriod(p)}>
              {label}
            </button>
          ))}
        </div>
        {isLoading || !s ? (
          <div className="skeleton title-skel" />
        ) : !s.msPlayed ? (
          <div className="empty-inline">
            <h1 className="stat-lede">
              {translate("stats.emptyHeading", {
                period: period === "all" ? "" : translate("stats.inPeriod"),
              })}
            </h1>
            <p className="muted">{translate("stats.empty")}</p>
          </div>
        ) : (
          <>
            <h1 className="stat-lede">
              {h?.lead}
              {h?.accent ? (
                <>
                  , <em>{h.accent}</em>.
                </>
              ) : (
                "."
              )}
            </h1>
            <p className="muted stat-sub">{comparison(s, period)}</p>
            <div className="stat-grid">
              <section className="stat-box">
                <h3>
                  {translate("stats.topArtists")} <span>{translate("stats.plays")}</span>
                </h3>
                {s.topArtists.map((a, i) => (
                  <Link
                    key={a.id}
                    to={known(a.id) || musicSource(a.id) !== "library" ? artistPath(a.id) : "/stats"}
                    className="rank"
                  >
                    <span className="n">{i + 1}</span>
                    <Art id={cover(a.id)} px={44} round fallback="artist" />
                    <div>
                      <div className="t">
                        {a.name}
                        {musicSource(a.id) !== "library" ? <SourceMark source={musicSource(a.id)} compact /> : null}
                      </div>
                      <div className="bar-in">
                        <i
                          style={{
                            width: `${(a.plays / (s.topArtists[0]?.plays ?? 1)) * 100}%`,
                          }}
                        />
                      </div>
                    </div>
                    <span className="c">{count(a.plays)}</span>
                  </Link>
                ))}
              </section>
              <section className="stat-box">
                <h3>
                  {translate("stats.topAlbums")} <span>{translate("stats.plays")}</span>
                </h3>
                {s.topAlbums.map((a, i) => (
                  <Link key={a.id} to={albumPath(a.id)} className="rank">
                    <span className="n">{i + 1}</span>
                    <Art id={a.coverArt} px={44} />
                    <div>
                      <div className="t">
                        {a.name}
                        {musicSource(a.id) !== "library" ? <SourceMark source={musicSource(a.id)} compact /> : null}
                      </div>
                      <div className="bar-in">
                        <i
                          style={{
                            width: `${(a.plays / (s.topAlbums[0]?.plays ?? 1)) * 100}%`,
                          }}
                        />
                      </div>
                    </div>
                    <span className="c">{count(a.plays)}</span>
                  </Link>
                ))}
              </section>
              <section className="stat-box">
                <h3>
                  {translate("stats.when")} <span>{translate("stats.byHour")}</span>
                </h3>
                <div
                  className="hours"
                  role="img"
                  aria-label={
                    s.peakHour !== null
                      ? translate("stats.mostAround", {
                          time: hourLabel(s.peakHour),
                        })
                      : translate("stats.listeningByHour")
                  }
                >
                  {s.hours.map((ms, i) => (
                    <i
                      key={i}
                      className={ms >= maxHour * 0.75 ? "hot" : ""}
                      style={{
                        height: `${Math.max(2, (ms / maxHour) * 130)}px`,
                      }}
                      title={`${hourLabel(i)}: ${hours(ms)}`}
                    />
                  ))}
                </div>
                <div className="hours-x">
                  <span>{translate("stats.midnight")}</span>
                  <span>{hourLabel(6)}</span>
                  <span>{translate("stats.noon")}</span>
                  <span>{hourLabel(18)}</span>
                  <span>{hourLabel(23)}</span>
                </div>
              </section>
              <section className="stat-box">
                <h3>
                  {translate("stats.genres")} <span>{translate("stats.share")}</span>
                </h3>
                <div className="genrebar">
                  {s.genres.map((g) => (
                    <i
                      key={g.name}
                      style={{
                        background: g.name === "Other" ? "var(--dim)" : hashPalette(g.name)[1],
                        flex: g.share,
                      }}
                    />
                  ))}
                </div>
                <div className="legend">
                  {s.genres.map((g) => (
                    <span
                      key={g.name}
                      style={
                        {
                          "--c": g.name === "Other" ? "var(--dim)" : hashPalette(g.name)[1],
                        } as React.CSSProperties
                      }
                    >
                      {g.name === "Other" ? translate("stats.other") : g.name}
                      <em>{Math.round(g.share * 100)}%</em>
                    </span>
                  ))}
                </div>
              </section>
            </div>
          </>
        )}
        <p className="help">
          <Icon name="info" size={15} />
          {translate("stats.help", { seconds: MIN_REPORT_MS / 1000 })}
        </p>
      </div>
    </>
  );
}
