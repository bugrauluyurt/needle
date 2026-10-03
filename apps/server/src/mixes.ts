import type { Album, AlbumWithSongs, Genre, Mix, Song } from "@needle/shared";
import { DAY_MS, QUARTER_DAYS } from "@needle/shared";
import type { Auth, Navidrome } from "./navidrome.ts";
import type { PlayLog } from "./stats.ts";

const MIX_COUNT = 6;
const MIX_SIZE = 40;
const MIN_SONGS = 8;
const LOOKBACK = QUARTER_DAYS * DAY_MS;
const DECADES = [2020, 2010, 2000, 1990, 1980, 1970, 1960];
const ALBUMS_PER_DECADE = 12;

export const PALETTES: [string, string, string][] = [
  ["#3A1466", "#E0457B", "#FFB86B"],
  ["#0F2436", "#7FB7D9", "#35E0C8"],
  ["#3B1E12", "#D9A441", "#9C1C2B"],
  ["#1F3A2E", "#9BD46A", "#F2B8C6"],
  ["#07201F", "#1FB5A0", "#6B5BFF"],
  ["#2A1D40", "#F6B23C", "#E03A3A"],
  ["#1E3C78", "#4FD1FF", "#FF4FA3"],
  ["#4A1830", "#FF7EB6", "#FFD27A"],
];

export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function seededShuffle<T>(items: T[], seed: string): T[] {
  const out = items.slice();
  let state = hash(seed) || 1;
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

function topBy<T>(items: T[], key: (t: T) => string | undefined, n: number): string[] {
  const counts = new Map<string, number>();
  for (const it of items) {
    const k = key(it);
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k]) => k);
}

export function buildMix(name: string, songs: Song[], seed: string): Mix | null {
  const unique = [...new Map(songs.map((s) => [s.id, s])).values()];
  if (unique.length < MIN_SONGS) return null;
  const picked = seededShuffle(unique, seed).slice(0, MIX_SIZE);
  const coverArts = [...new Set(picked.map((s) => s.coverArt).filter((c): c is string => Boolean(c)))].slice(0, 4);
  const artists = topBy(picked, (s) => s.artist, 3);
  return {
    id: `mix-${hash(name).toString(36)}`,
    name,
    description: artists.join(", "),
    artists,
    songs: picked,
    coverArts,
    palette: PALETTES[hash(name) % PALETTES.length] as [string, string, string],
  };
}

export class Mixes {
  private readonly cache = new Map<string, { day: string; mixes: Mix[] }>();
  private readonly navidrome: Navidrome;
  private readonly log: PlayLog;

  constructor(navidrome: Navidrome, log: PlayLog) {
    this.navidrome = navidrome;
    this.log = log;
  }

  async forUser(auth: Auth, now = new Date()): Promise<Mix[]> {
    const day = now.toISOString().slice(0, 10);
    const hit = this.cache.get(auth.user);
    if (hit?.day === day) return hit.mixes;

    const played = this.log.topGenres(auth.user, now.getTime() - LOOKBACK, MIX_COUNT);
    const { genres } = await this.navidrome.call<{ genres: { genre?: Genre[] } }>(auth, "getGenres");
    const library = (genres.genre ?? [])
      .filter((g) => g.songCount >= MIN_SONGS)
      .sort((a, b) => b.songCount - a.songCount)
      .map((g) => g.value);
    const chosen = [...new Set([...played, ...library])].slice(0, MIX_COUNT);

    const mixes = (
      await Promise.all(
        chosen.map(async (genre) => {
          const r = await this.navidrome.call<{ songsByGenre: { song?: Song[] } }>(auth, "getSongsByGenre", {
            genre,
            count: 500,
          });
          return buildMix(genre, r.songsByGenre.song ?? [], `${auth.user}:${day}:${genre}`);
        }),
      )
    ).filter((m): m is Mix => m !== null);
    for (const decade of DECADES) {
      if (mixes.length >= MIX_COUNT) break;
      const mix = await this.decadeMix(auth, decade, day);
      if (mix) mixes.push(mix);
    }

    this.cache.set(auth.user, { day, mixes });
    return mixes;
  }

  private async decadeMix(auth: Auth, decade: number, day: string): Promise<Mix | null> {
    const r = await this.navidrome.call<{ albumList2: { album?: Album[] } }>(auth, "getAlbumList2", {
      type: "byYear",
      fromYear: decade,
      toYear: decade + 9,
      size: 100,
    });
    const albums = seededShuffle(r.albumList2.album ?? [], `${auth.user}:${day}:${decade}`).slice(0, ALBUMS_PER_DECADE);
    if (albums.reduce((n, a) => n + a.songCount, 0) < MIN_SONGS) return null;
    const full = await Promise.all(
      albums.map((a) => this.navidrome.call<{ album: AlbumWithSongs }>(auth, "getAlbum", { id: a.id })),
    );
    return buildMix(
      `The ${decade}s`,
      full.flatMap((f) => f.album.song ?? []),
      `${auth.user}:${day}:${decade}`,
    );
  }
}
