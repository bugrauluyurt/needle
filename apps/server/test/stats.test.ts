import { describe, expect, it } from "vitest";
import type { PlayReport } from "@needle/shared";
import { openDatabase } from "../src/db.ts";
import { buildMix, hash, seededShuffle } from "../src/mixes.ts";
import { periodStart, PlayLog } from "../src/stats.ts";

const play = (over: Partial<PlayReport> = {}): PlayReport => ({
  songId: "s1",
  title: "Afterglow",
  artist: "Neon Harbor",
  artistId: "ar1",
  album: "Afterglow Avenue",
  albumId: "al1",
  genre: "Synthwave",
  coverArt: "al-1",
  duration: 200,
  msPlayed: 180_000,
  device: "test",
  ...over,
});

describe("periods", () => {
  const now = new Date(2026, 8, 27, 12);
  it("starts this month on the 1st and compares with last month", () => {
    const { from, prevFrom } = periodStart("month", now);
    expect(new Date(from)).toEqual(new Date(2026, 8, 1));
    expect(new Date(prevFrom)).toEqual(new Date(2026, 7, 1));
  });
  it("covers the calendar year and all time", () => {
    expect(new Date(periodStart("year", now).from)).toEqual(new Date(2026, 0, 1));
    expect(periodStart("all", now).from).toBe(0);
  });
});

describe("play log", () => {
  it("adds up listening, ranks artists and albums, and finds the busiest hour", () => {
    const log = new PlayLog(openDatabase(":memory:"));
    const now = new Date(2026, 8, 20, 23, 30);
    const at = (d: number, h: number) => new Date(2026, 8, d, h).getTime();
    log.record("alex", play(), at(20, 22));
    log.record("alex", play({ songId: "s2" }), at(20, 22));
    log.record(
      "alex",
      play({
        songId: "s3",
        artist: "Lumen Field",
        artistId: "ar2",
        album: "Weightless",
        albumId: "al2",
        genre: "Ambient",
      }),
      at(19, 9),
    );
    log.record("alex", play({ msPlayed: 100_000 }), at(15, 3) - 40 * 86_400_000);
    log.record("someone-else", play(), at(20, 22));

    const s = log.stats("alex", "month", now);
    expect(s.msPlayed).toBe(540_000);
    expect(s.prevMsPlayed).toBe(100_000);
    expect(s.songs).toBe(3);
    expect(s.artists).toBe(2);
    expect(s.topArtists[0]).toMatchObject({ id: "ar1", name: "Neon Harbor", plays: 2 });
    expect(s.topAlbums[0]).toMatchObject({ id: "al1", plays: 2, coverArt: "al-1" });
    expect(s.peakHour).toBe(22);
    expect(s.hours[9]).toBe(180_000);
    expect(s.genres.map((g) => g.name)).toEqual(["Synthwave", "Ambient"]);
    expect(s.genres[0]?.share).toBeCloseTo(2 / 3);
    expect(log.topGenres("alex", 0, 1)).toEqual(["Synthwave"]);
  });

  it("returns empty stats for someone who hasn't played anything", () => {
    const s = new PlayLog(openDatabase(":memory:")).stats("nobody", "all");
    expect(s).toMatchObject({ msPlayed: 0, songs: 0, peakHour: null, topArtists: [], genres: [] });
  });
});

describe("mixes", () => {
  const songs = Array.from({ length: 60 }, (_, i) => ({
    id: `s${i}`,
    title: `T${i}`,
    artist: `A${i % 4}`,
    coverArt: `c${i % 7}`,
  }));

  it("shuffles the same way for the same seed", () => {
    expect(seededShuffle(songs, "x")).toEqual(seededShuffle(songs, "x"));
    expect(seededShuffle(songs, "x")).not.toEqual(seededShuffle(songs, "y"));
    expect(new Set(seededShuffle(songs, "x").map((s) => s.id)).size).toBe(60);
  });

  it("builds a mix of 40 unique songs with covers and top artists", () => {
    const mix = buildMix("Synthwave", [...songs, ...songs], "seed");
    expect(mix?.songs).toHaveLength(40);
    expect(new Set(mix?.songs.map((s) => s.id)).size).toBe(40);
    expect(mix?.coverArts.length).toBeLessThanOrEqual(4);
    expect(mix?.artists).toHaveLength(3);
    expect(mix?.id).toBe(`mix-${hash("Synthwave").toString(36)}`);
  });

  it("skips genres with too few songs", () => {
    expect(buildMix("Tiny", songs.slice(0, 5), "seed")).toBeNull();
  });
});
