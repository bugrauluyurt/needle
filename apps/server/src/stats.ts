import type { DatabaseSync } from "node:sqlite";
import { DAY_MS, QUARTER_DAYS } from "@needle/shared";
import type { GenreShare, Period, PlayReport, RankedAlbum, RankedArtist, Stats } from "@needle/shared";

const TOP = 5;
const GENRES = 5;

export function periodStart(period: Period, now = new Date()): { from: number; prevFrom: number } {
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (period) {
    case "month":
      return { from: new Date(y, m, 1).getTime(), prevFrom: new Date(y, m - 1, 1).getTime() };
    case "quarter":
      return { from: now.getTime() - QUARTER_DAYS * DAY_MS, prevFrom: now.getTime() - 2 * QUARTER_DAYS * DAY_MS };
    case "year":
      return { from: new Date(y, 0, 1).getTime(), prevFrom: new Date(y - 1, 0, 1).getTime() };
    case "all":
      return { from: 0, prevFrom: 0 };
  }
}

export class PlayLog {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  record(user: string, p: PlayReport, playedAt = Date.now()) {
    this.db
      .prepare(
        `INSERT INTO plays (user, song_id, title, artist, artist_id, album, album_id, genre, cover_art, duration, ms_played, played_at, device)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        user,
        p.songId,
        p.title,
        p.artist,
        p.artistId ?? null,
        p.album,
        p.albumId ?? null,
        p.genre ?? null,
        p.coverArt ?? null,
        Math.round(p.duration),
        Math.max(0, Math.round(p.msPlayed)),
        playedAt,
        p.device,
      );
  }

  topGenres(user: string, since: number, limit: number): string[] {
    return (
      this.db
        .prepare(
          `SELECT genre FROM plays WHERE user = ? AND played_at >= ? AND genre IS NOT NULL AND genre != ''
      GROUP BY genre ORDER BY SUM(ms_played) DESC LIMIT ?`,
        )
        .all(user, since, limit) as { genre: string }[]
    ).map((r) => r.genre);
  }

  stats(user: string, period: Period, now = new Date()): Stats {
    const { from, prevFrom } = periodStart(period, now);
    const to = now.getTime();
    const one = <T>(sql: string, ...args: (string | number)[]) => this.db.prepare(sql).get(...args) as T;
    const all = <T>(sql: string, ...args: (string | number)[]) => this.db.prepare(sql).all(...args) as T[];

    const totals = one<{ ms: number | null; songs: number; artists: number }>(
      `SELECT SUM(ms_played) AS ms, COUNT(DISTINCT song_id) AS songs, COUNT(DISTINCT artist) AS artists
       FROM plays WHERE user = ? AND played_at >= ? AND played_at <= ?`,
      user,
      from,
      to,
    );
    const prev =
      period === "all"
        ? { ms: 0 }
        : one<{ ms: number | null }>(
            "SELECT SUM(ms_played) AS ms FROM plays WHERE user = ? AND played_at >= ? AND played_at < ?",
            user,
            prevFrom,
            from,
          );

    const topArtists = all<RankedArtist>(
      `SELECT COALESCE(artist_id, artist) AS id, MAX(artist) AS name, COUNT(*) AS plays
       FROM plays WHERE user = ? AND played_at >= ? GROUP BY COALESCE(artist_id, artist) ORDER BY plays DESC, MAX(played_at) DESC LIMIT ?`,
      user,
      from,
      TOP,
    );

    const topAlbums = all<RankedAlbum & { coverArt: string | null }>(
      `SELECT COALESCE(album_id, album) AS id, MAX(album) AS name, MAX(artist) AS artist, COUNT(*) AS plays, MAX(cover_art) AS coverArt
       FROM plays WHERE user = ? AND played_at >= ? GROUP BY COALESCE(album_id, album) ORDER BY plays DESC, MAX(played_at) DESC LIMIT ?`,
      user,
      from,
      TOP,
    ).map(({ coverArt, ...a }) => ({ ...a, ...(coverArt ? { coverArt } : {}) }));

    const hours = Array.from({ length: 24 }, () => 0);
    for (const r of all<{ h: string; ms: number }>(
      `SELECT strftime('%H', played_at / 1000, 'unixepoch', 'localtime') AS h, SUM(ms_played) AS ms
       FROM plays WHERE user = ? AND played_at >= ? GROUP BY h`,
      user,
      from,
    )) {
      hours[Number(r.h)] = r.ms;
    }
    const peak = Math.max(...hours);

    const genreRows = all<{ name: string; ms: number }>(
      `SELECT COALESCE(NULLIF(genre, ''), 'Other') AS name, SUM(ms_played) AS ms
       FROM plays WHERE user = ? AND played_at >= ? GROUP BY name ORDER BY ms DESC`,
      user,
      from,
    );
    const genreTotal = genreRows.reduce((s, r) => s + r.ms, 0);
    const genres: GenreShare[] = genreRows.slice(0, GENRES).map((r) => ({ name: r.name, share: r.ms / genreTotal }));
    const rest = genreRows.slice(GENRES).reduce((s, r) => s + r.ms, 0);
    if (rest > 0) genres.push({ name: "Other", share: rest / genreTotal });

    return {
      period,
      from: new Date(from).toISOString(),
      msPlayed: totals.ms ?? 0,
      prevMsPlayed: prev.ms ?? 0,
      songs: totals.songs,
      artists: totals.artists,
      peakHour: peak > 0 ? hours.indexOf(peak) : null,
      topArtists,
      topAlbums,
      hours,
      genres,
    };
  }
}
