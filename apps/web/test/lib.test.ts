import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ago, clock, formatLabel, hours, longDuration, paragraphs, plainBio, plural, releaseKind } from "../src/lib/format.ts";
import { lineAt, pickLyrics } from "../src/lib/lyrics.ts";
import { md5 } from "../src/lib/md5.ts";
import { toneFromPixels } from "../src/lib/tone.ts";
import { dbToGain } from "../src/player/engine.ts";
import { albumPath, artistPath } from "../src/lib/paths.ts";
import { browserChecks } from "../src/lib/connections.ts";
import { image, isSpotify, rawId, sizedCover, spotifyLink, toSong } from "../src/lib/spotify.ts";

describe("md5", () => {
  it.each(["", "a", "needle-testabc123", "ğüşİöç ♪", "x".repeat(200)])("matches node for %j", (s) => {
    expect(md5(s)).toBe(createHash("md5").update(s).digest("hex"));
  });
});

describe("format", () => {
  it("formats clock times", () => {
    expect(clock(0)).toBe("0:00");
    expect(clock(65.9)).toBe("1:05");
    expect(clock(3725)).toBe("1:02:05");
    expect(clock(undefined)).toBe("0:00");
  });

  it("formats long durations", () => {
    expect(longDuration(43 * 60)).toBe("43 min");
    expect(longDuration(112 * 60)).toBe("1 h 52 min");
    expect(longDuration(120 * 60)).toBe("2 h");
  });

  it("formats hours and plurals", () => {
    expect(hours(90_000)).toBe("2 minutes");
    expect(hours(56 * 3_600_000)).toBe("56 hours");
    expect(plural(1, "song")).toBe("1 song");
    expect(plural(1204, "play")).toBe("1,204 plays");
  });

  it("says when something happened in plain words", () => {
    const now = new Date(2026, 8, 27, 12).getTime();
    const day = 86_400_000;
    expect(ago(new Date(now - 3_600_000).toISOString(), now)).toBe("Today");
    expect(ago(new Date(now - day).toISOString(), now)).toBe("Yesterday");
    expect(ago(new Date(now - 3 * day).toISOString(), now)).toBe("3 days ago");
    expect(ago(new Date(now - 9 * day).toISOString(), now)).toBe("Last week");
    expect(ago(new Date(now - 20 * day).toISOString(), now)).toBe("2 weeks ago");
    expect(ago(new Date(now - 40 * day).toISOString(), now)).toBe("Last month");
    expect(ago(undefined, now)).toBe("");
  });

  it("labels formats the way the design shows them", () => {
    expect(formatLabel({ suffix: "flac", bitDepth: 16, samplingRate: 44100 })).toBe("FLAC 16/44.1");
    expect(formatLabel({ suffix: "flac", bitDepth: 24, samplingRate: 96000 })).toBe("FLAC 24/96");
    expect(formatLabel({ suffix: "mp3", bitRate: 320 })).toBe("MP3 320 kbps");
    expect(formatLabel(null)).toBeNull();
  });

  it("tells albums, EPs and singles apart", () => {
    expect(releaseKind(2, 400)).toBe("Single");
    expect(releaseKind(5, 1500)).toBe("EP");
    expect(releaseKind(5, 2400)).toBe("Album");
    expect(releaseKind(12, 2800)).toBe("Album");
    expect(releaseKind(3, 300, true)).toBe("Compilation");
  });
});

describe("artist bio", () => {
  it("drops links and tags", () => {
    expect(plainBio('Great band.  <a href="https://last.fm">Read more on Last.fm</a>.')).toBe("Great band.");
  });

  it("groups sentences into paragraphs", () => {
    expect(paragraphs("One. Two! Three? Four. Five 2.0 rocks. “Six” said.")).toEqual(["One. Two! Three?", "Four. Five 2.0 rocks. “Six” said."]);
  });
});

describe("lyrics", () => {
  const lines = [{ start: 2000, value: "a" }, { start: 7000, value: "b" }, { start: 12000, value: "c" }];

  it("finds the line being sung", () => {
    expect(lineAt(lines, 0)).toBe(-1);
    expect(lineAt(lines, 2000)).toBe(0);
    expect(lineAt(lines, 11999)).toBe(1);
    expect(lineAt(lines, 99999)).toBe(2);
    expect(lineAt([], 5000)).toBe(-1);
  });

  it("prefers timed lyrics", () => {
    const plain = { synced: false, line: [{ value: "x" }] };
    const synced = { synced: true, line: lines };
    expect(pickLyrics([plain, synced])).toBe(synced);
    expect(pickLyrics([plain])).toBe(plain);
    expect(pickLyrics([])).toBeNull();
  });
});

describe("tone", () => {
  const fill = (rgb: [number, number, number], n = 64) => {
    const px = new Uint8ClampedArray(n * 4);
    for (let i = 0; i < n; i++) px.set([...rgb, 255], i * 4);
    return px;
  };
  const lightness = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
    return (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
  };

  it("keeps the hue and darkens enough for white text", () => {
    const pink = toneFromPixels(fill([224, 69, 123]));
    expect(pink).toMatch(/^#[0-9a-f]{6}$/);
    expect(lightness(pink)).toBeLessThanOrEqual(0.41);
    expect(parseInt(pink.slice(1, 3), 16)).toBeGreaterThan(parseInt(pink.slice(5, 7), 16));
  });

  it("falls back to a quiet violet for grey covers", () => {
    const grey = toneFromPixels(fill([128, 128, 128]));
    expect(lightness(grey)).toBeLessThan(0.35);
  });
});

describe("ReplayGain", () => {
  it("turns decibels into gain and protects the peak", () => {
    expect(dbToGain(0)).toBe(1);
    expect(dbToGain(-6)).toBeCloseTo(0.501, 3);
    expect(dbToGain(6, 0.9)).toBeCloseTo(1 / 0.9, 5);
    expect(dbToGain(undefined)).toBe(1);
  });
});

describe("spotify", () => {
  const album = { id: "al1", name: "Discovery", release_date: "2001-03-12", images: [{ url: "big", width: 640 }, { url: "small", width: 64 }, { url: "mid", width: 300 }] };
  const track = { id: "t1", uri: "spotify:track:t1", name: "One More Time", duration_ms: 320_357, artists: [{ id: "ar1", name: "Daft Punk" }, { id: "ar2", name: "Romanthony" }], track_number: 1, disc_number: 1 };

  it("picks the smallest image that is big enough", () => {
    expect(image(album.images, 50)).toBe("small");
    expect(image(album.images, 200)).toBe("mid");
    expect(image(album.images, 1000)).toBe("big");
    expect(image([], 300)).toBeUndefined();
  });

  it("turns a Spotify track into a song", () => {
    expect(toSong(track, album)).toEqual({
      id: "sp:t1",
      title: "One More Time",
      artist: "Daft Punk, Romanthony",
      displayArtist: "Daft Punk, Romanthony",
      artistId: "sp:ar1",
      artists: [{ id: "sp:ar1", name: "Daft Punk" }, { id: "sp:ar2", name: "Romanthony" }],
      album: "Discovery",
      albumId: "sp:al1",
      coverArt: "big",
      duration: 320,
      track: 1,
      discNumber: 1,
      year: 2001,
      source: "spotify",
      uri: "spotify:track:t1",
    });
  });

  it("asks Spotify's CDN for an album cover sized to the tile", () => {
    const cover = "https://i.scdn.co/image/ab67616d0000b273aaaa";
    expect(sizedCover(cover, 64)).toBe("https://i.scdn.co/image/ab67616d00004851aaaa");
    expect(sizedCover(cover, 256)).toBe("https://i.scdn.co/image/ab67616d00001e02aaaa");
    expect(sizedCover(cover, 600)).toBe(cover);
    expect(sizedCover("https://mosaic.scdn.co/640/abc", 64)).toBe("https://mosaic.scdn.co/640/abc");
  });

  it("routes Spotify ids to Spotify pages", () => {
    expect(isSpotify("sp:al1")).toBe(true);
    expect(isSpotify("al1")).toBe(false);
    expect(rawId("sp:al1")).toBe("al1");
    expect(albumPath("sp:al1")).toBe("/spotify/album/al1");
    expect(albumPath("nd1")).toBe("/album/nd1");
    expect(artistPath("sp:ar1")).toBe("/spotify/artist/ar1");
    expect(artistPath("nd2")).toBe("/artist/nd2");
    expect(spotifyLink("track", "sp:t1")).toBe("https://open.spotify.com/track/t1");
  });
});

describe("browser connection checks", () => {
  it("warns without HTTPS and when PUBLIC_URL differs from the page", () => {
    const [https, address] = browserChecks("https://music.example.com", "http://192.168.1.5:4535", false);
    expect(https?.state).toBe("warn");
    expect(address).toMatchObject({ state: "warn", detail: "PUBLIC_URL is https://music.example.com, but this page is http://192.168.1.5:4535" });
  });

  it("is happy on the public HTTPS address, and off without PUBLIC_URL", () => {
    expect(browserChecks("https://music.example.com", "https://music.example.com", true).map((c) => c.state)).toEqual(["ok", "ok"]);
    expect(browserChecks(null, "https://music.example.com", true)[1]?.state).toBe("off");
  });
});
