import type { Song } from "@needle/shared";
import { DAY_MS, HOUR_MS } from "@needle/shared";
import { i18next, translate } from "../i18n/index.ts";
import type { TranslationKey } from "../i18n/locales/en.ts";

type CountUnit =
  "album" | "artist" | "connection" | "hour" | "minute" | "play" | "playlist" | "release" | "second" | "song";

export const localeCode = () => (i18next.resolvedLanguage === "tr" ? "tr-TR" : "en-US");

export const count = (number: number) => new Intl.NumberFormat(localeCode()).format(number);

export function plural(n: number, one: string, many = `${one}s`): string {
  const countUnit = countUnitFor(one);

  if (!countUnit) return `${count(n)} ${n === 1 ? one : many}`;

  return translate(`count.${countUnit}` as TranslationKey, {
    count: n,
    formattedCount: count(n),
  });
}

export function clock(seconds: number | undefined): string {
  const s = Math.max(0, Math.floor(seconds ?? 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
}

export function longDuration(seconds: number): string {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return translate("duration.minutes", { minutes: mins });

  const h = Math.floor(mins / 60);
  const m = mins % 60;

  return m ? translate("duration.hoursMinutes", { hours: h, minutes: m }) : translate("duration.hours", { hours: h });
}

export function hours(ms: number): string {
  const h = ms / HOUR_MS;
  if (h < 1) return plural(Math.round(ms / 60_000), "minute");
  return plural(Math.round(h), "hour");
}

export function ago(iso: string | undefined, now = Date.now()): string {
  if (!iso) return "";
  const then = new Date(iso);
  const days = Math.floor((new Date(now).setHours(0, 0, 0, 0) - new Date(then).setHours(0, 0, 0, 0)) / DAY_MS);
  if (days <= 0) return translate("time.today");
  if (days === 1) return translate("time.yesterday");
  if (days < 7) return translate("time.daysAgo", { count: days });
  if (days < 14) return translate("time.lastWeek");
  if (days < 31) return translate("time.weeksAgo", { count: Math.floor(days / 7) });
  if (days < 62) return translate("time.lastMonth");
  if (days < 365) return translate("time.monthsAgo", { count: Math.floor(days / 30) });

  return then.toLocaleDateString(localeCode(), {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatLabel(
  song: Pick<Song, "suffix" | "bitDepth" | "samplingRate" | "bitRate"> | null | undefined,
): string | null {
  if (!song?.suffix) return null;
  const codec = song.suffix.toUpperCase();
  const lossless = ["FLAC", "ALAC", "WAV", "AIFF", "APE", "WV"].includes(codec);
  if (lossless && song.bitDepth && song.samplingRate) {
    const khz = song.samplingRate / 1000;
    return `${codec} ${song.bitDepth}/${Number.isInteger(khz) ? khz : khz.toFixed(1)}`;
  }
  return song.bitRate ? `${codec} ${song.bitRate} kbps` : codec;
}

export function formatLong(song: Song): string {
  const parts = [song.suffix?.toUpperCase()];
  if (song.bitDepth) parts.push(`${song.bitDepth}-bit`);
  if (song.samplingRate) parts.push(`${(song.samplingRate / 1000).toFixed(1).replace(/\.0$/, "")} kHz`);
  return parts.filter(Boolean).join(", ");
}

export const artistName = (song: Pick<Song, "displayArtist" | "artist">) =>
  song.displayArtist ?? song.artist ?? translate("catalog.unknownArtist");

export function releaseDateLabel(song: Pick<Song, "year" | "releaseDate">): string {
  const releaseDate = song.releaseDate ?? String(song.year ?? "");

  if (!releaseDate) return translate("catalog.unknown");
  if (releaseDate.length === 4) return releaseDate;

  const parsedReleaseDate = new Date(`${releaseDate.length === 7 ? `${releaseDate}-01` : releaseDate}T12:00:00Z`);

  if (Number.isNaN(parsedReleaseDate.getTime())) return releaseDate;

  return parsedReleaseDate.toLocaleDateString(localeCode(), {
    ...(releaseDate.length > 7 ? { day: "numeric" } : {}),
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function hoursSince(iso: string, now = Date.now()): number {
  return Math.round((now - Date.parse(iso)) / HOUR_MS);
}

export function minutesSince(iso: string, now = Date.now()): number {
  return Math.round((now - Date.parse(iso)) / 60_000);
}

export type ReleaseKind = "album" | "compilation" | "ep" | "single";

export function releaseKindValue(songCount: number, duration: number, compilation = false): ReleaseKind {
  if (compilation) return "compilation";
  if (songCount <= 3 && duration < 1800) return "single";
  if (songCount <= 6 && duration < 1800) return "ep";

  return "album";
}

export function releaseKind(songCount: number, duration: number, compilation = false): string {
  switch (releaseKindValue(songCount, duration, compilation)) {
    case "album":
      return translate("catalog.album");
    case "compilation":
      return translate("catalog.compilation");
    case "ep":
      return translate("catalog.ep");
    case "single":
      return translate("catalog.single");
  }
}

export function greeting(date = new Date()): string {
  const h = date.getHours();
  if (h < 5) return translate("greeting.night");
  if (h < 12) return translate("greeting.morning");
  if (h < 18) return translate("greeting.afternoon");

  return translate("greeting.evening");
}

export function sizeLabel(bytes: number): string {
  const amount = bytes >= 1e9 ? bytes / 1e9 : bytes / 1e6;
  const unit = bytes >= 1e9 ? "GB" : "MB";

  return `${new Intl.NumberFormat(localeCode(), { maximumFractionDigits: bytes >= 1e9 ? 1 : 0 }).format(amount)} ${unit}`;
}

function countUnitFor(label: string): CountUnit | null {
  switch (label) {
    case "album":
    case "artist":
    case "connection":
    case "hour":
    case "minute":
    case "play":
    case "playlist":
    case "release":
    case "second":
    case "song":
      return label;
    default:
      return null;
  }
}

export function plain(html: string | null | undefined): string | undefined {
  const text = html
    ?.replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "’")
    .replace(/&quot;/g, '"')
    .trim();
  return text === "" ? undefined : text;
}

export const plainBio = (html: string | undefined) =>
  html
    ?.replace(/<a [^>]*>.*?<\/a>\.?/gs, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim() ?? "";

export function paragraphs(text: string, sentences = 3): string[] {
  const all = text.split(/(?<=[.!?])\s+(?=[\p{Lu}\p{N}“"‘'])/u);
  return Array.from({ length: Math.ceil(all.length / sentences) }, (_, i) =>
    all.slice(i * sentences, (i + 1) * sentences).join(" "),
  );
}
