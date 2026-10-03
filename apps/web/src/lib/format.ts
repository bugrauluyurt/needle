import type { Song } from "@needle/shared";
import { DAY_MS, HOUR_MS } from "@needle/shared";

const nf = new Intl.NumberFormat("en-US");

export const count = (n: number) => nf.format(n);

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${count(n)} ${n === 1 ? one : many}`;
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
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
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
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "Last week";
  if (days < 31) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 62) return "Last month";
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return then.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
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

export const artistName = (s: Pick<Song, "displayArtist" | "artist">) =>
  s.displayArtist ?? s.artist ?? "Unknown artist";

export function releaseDateLabel(song: Pick<Song, "year" | "releaseDate">): string {
  const releaseDate = song.releaseDate ?? String(song.year ?? "");

  if (!releaseDate) return "Unknown";
  if (releaseDate.length === 4) return releaseDate;

  const parsedReleaseDate = new Date(`${releaseDate.length === 7 ? `${releaseDate}-01` : releaseDate}T12:00:00Z`);

  if (Number.isNaN(parsedReleaseDate.getTime())) return releaseDate;

  return parsedReleaseDate.toLocaleDateString("en-GB", {
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

export function releaseKind(songCount: number, duration: number, compilation = false): string {
  if (compilation) return "Compilation";
  if (songCount <= 3 && duration < 1800) return "Single";
  if (songCount <= 6 && duration < 1800) return "EP";
  return "Album";
}

export function greeting(date = new Date()): string {
  const h = date.getHours();
  if (h < 5) return "Good night";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export function sizeLabel(bytes: number): string {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`;
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
