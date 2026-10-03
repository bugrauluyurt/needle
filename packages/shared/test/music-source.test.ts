import { describe, expect, it } from "vitest";
import { isLocalSong, musicSource, songSource, youtubeMusicId, youtubeMusicLink, youtubeMusicRawId } from "../src/music-source.ts";

describe("music source identity", () => {
  it("recognizes persisted source prefixes without changing local ids", () => {
    expect(musicSource("song-1")).toBe("library");
    expect(musicSource("sp:track-1")).toBe("spotify");
    expect(musicSource("ytm:track-1")).toBe("youtubeMusic");
    expect(musicSource(undefined)).toBe("library");
  });

  it("never sends a restored external song through local song operations", () => {
    expect(isLocalSong({ id: "ytm:track-1" })).toBe(false);
    expect(isLocalSong({ id: "sp:track-1" })).toBe(false);
    expect(isLocalSong({ id: "song-1" })).toBe(true);
    expect(songSource({ id: "track-1", source: "youtubeMusic" })).toBe("youtubeMusic");
  });

  it("namespaces ids once and keeps album, artist and playlist links distinct", () => {
    expect(youtubeMusicId("track-1")).toBe("ytm:track-1");
    expect(youtubeMusicId("ytm:track-1")).toBe("ytm:track-1");
    expect(youtubeMusicRawId("ytm:track-1")).toBe("track-1");
    expect(youtubeMusicLink("song", "ytm:video-1")).toBe("https://music.youtube.com/watch?v=video-1");
    expect(youtubeMusicLink("album", "ytm:MPRE_album")).toBe("https://music.youtube.com/browse/MPRE_album");
    expect(youtubeMusicLink("artist", "ytm:UC_artist")).toBe("https://music.youtube.com/browse/UC_artist");
    expect(youtubeMusicLink("playlist", "ytm:PL_list")).toBe("https://music.youtube.com/playlist?list=PL_list");
    expect(youtubeMusicLink("song", "ytm:unsafe&id")).toContain("unsafe%26id");
  });
});
