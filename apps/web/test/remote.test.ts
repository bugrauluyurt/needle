import { describe, expect, it } from "vitest";
import type { Device, RemoteState } from "@needle/shared";
import { activeRemote, FRESH_MS, remotePosition, remoteSong } from "../src/remote/active.ts";

const NOW = 1_000_000;

const state = (patch: Partial<RemoteState> = {}): RemoteState => ({
  songId: "s1",
  title: "Blue Minutes",
  artist: "The Quiet Hours",
  coverArt: "al-1",
  position: 30,
  duration: 200,
  playing: true,
  volume: 0.8,
  updatedAt: NOW - 2_000,
  ...patch,
});

const device = (id: string, s: RemoteState | null = state()): Device => ({
  id,
  name: id,
  kind: "desktop",
  lastSeen: NOW,
  state: s,
});

describe("activeRemote", () => {
  const devices = [device("mac"), device("phone")];

  it("returns the active device when it is another device", () => {
    expect(activeRemote(devices, "phone", "mac", NOW)?.id).toBe("phone");
  });

  it("ignores this device", () => {
    expect(activeRemote(devices, "mac", "mac", NOW)).toBeNull();
  });

  it("ignores a playing device that has not reported for a while", () => {
    const quiet = [device("mac"), device("phone", state({ updatedAt: NOW - FRESH_MS }))];
    expect(activeRemote(quiet, "phone", "mac", NOW)).toBeNull();
  });

  it("keeps a paused device active however long it has been paused", () => {
    const paused = [device("mac"), device("phone", state({ playing: false, updatedAt: NOW - 10 * FRESH_MS }))];
    expect(activeRemote(paused, "phone", "mac", NOW)?.id).toBe("phone");
  });

  it("ignores a device with nothing loaded or no active device", () => {
    expect(activeRemote([device("mac"), device("phone", null)], "phone", "mac", NOW)).toBeNull();
    expect(activeRemote(devices, null, "mac", NOW)).toBeNull();
  });
});

describe("remotePosition", () => {
  it("moves on from the last report while playing", () => {
    expect(remotePosition(state(), NOW)).toBe(32);
  });

  it("stays put while paused", () => {
    expect(remotePosition(state({ playing: false }), NOW)).toBe(30);
  });

  it("stops at the end of the song", () => {
    expect(remotePosition(state({ position: 199 }), NOW)).toBe(200);
  });
});

describe("remoteSong", () => {
  it("describes the song for the player", () => {
    expect(remoteSong(state())).toEqual({
      id: "s1",
      title: "Blue Minutes",
      artist: "The Quiet Hours",
      coverArt: "al-1",
      duration: 200,
    });
  });

  it("marks Spotify songs and keeps their link", () => {
    expect(remoteSong(state({ songId: "sp:abc", coverArt: undefined, uri: "spotify:track:abc" }))).toEqual({
      id: "sp:abc",
      title: "Blue Minutes",
      artist: "The Quiet Hours",
      duration: 200,
      source: "spotify",
      uri: "spotify:track:abc",
    });
  });

  it("restores YouTube Music from a namespaced state without source metadata", () => {
    expect(
      remoteSong(state({ songId: "ytm:abc", coverArt: undefined, uri: "https://music.youtube.com/watch?v=abc" })),
    ).toEqual({
      id: "ytm:abc",
      title: "Blue Minutes",
      artist: "The Quiet Hours",
      duration: 200,
      source: "youtubeMusic",
      uri: "https://music.youtube.com/watch?v=abc",
    });
  });

  it("preserves the explicit source when receiving newer device state", () => {
    expect(remoteSong(state({ songId: "abc", source: "youtubeMusic" })).source).toBe("youtubeMusic");
  });
});
