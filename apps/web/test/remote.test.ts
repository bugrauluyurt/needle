import { afterEach, describe, expect, it, vi } from "vitest";
import type { Device, RemoteState } from "@needle/shared";
import { activeRemote, FRESH_MS, remotePosition, remoteSong } from "../src/features/remote/active.ts";
import { startRemote, stopRemote } from "../src/features/remote/client.ts";
import { usePlayer } from "../src/player/store.ts";
import { useSession } from "../src/state/session.ts";

vi.mock("../src/player/controller.ts", () => ({
  player: {
    next: vi.fn(),
    pause: vi.fn(),
    play: vi.fn(),
    playSongs: vi.fn(),
    previous: vi.fn(),
    seek: vi.fn(),
    setVolume: vi.fn(),
    toggle: vi.fn(),
    toggleMute: vi.fn(),
  },
}));

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
    expect(
      remoteSong(
        state({
          songId: "sp:abc",
          coverArt: undefined,
          uri: "spotify:track:abc",
        }),
      ),
    ).toEqual({
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
      remoteSong(
        state({
          songId: "ytm:abc",
          coverArt: undefined,
          uri: "https://music.youtube.com/watch?v=abc",
        }),
      ),
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

describe("remote lifecycle", () => {
  afterEach(() => {
    stopRemote();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps one set of player and session subscriptions across restart cycles", () => {
    const firstPlayerUnsubscribe = vi.fn();
    const secondPlayerUnsubscribe = vi.fn();
    const firstSessionUnsubscribe = vi.fn();
    const secondSessionUnsubscribe = vi.fn();
    const playerSubscribe = vi
      .spyOn(usePlayer, "subscribe")
      .mockReturnValueOnce(firstPlayerUnsubscribe)
      .mockReturnValueOnce(secondPlayerUnsubscribe);
    const sessionSubscribe = vi
      .spyOn(useSession, "subscribe")
      .mockReturnValueOnce(firstSessionUnsubscribe)
      .mockReturnValueOnce(secondSessionUnsubscribe);

    vi.stubGlobal("window", {
      clearInterval: vi.fn(),
      clearTimeout: vi.fn(),
      setInterval: vi.fn(() => 1),
    });

    startRemote();
    startRemote();

    expect(playerSubscribe).toHaveBeenCalledTimes(1);
    expect(sessionSubscribe).toHaveBeenCalledTimes(1);

    stopRemote();

    expect(firstPlayerUnsubscribe).toHaveBeenCalledTimes(1);
    expect(firstSessionUnsubscribe).toHaveBeenCalledTimes(1);

    startRemote();
    stopRemote();

    expect(playerSubscribe).toHaveBeenCalledTimes(2);
    expect(sessionSubscribe).toHaveBeenCalledTimes(2);
    expect(secondPlayerUnsubscribe).toHaveBeenCalledTimes(1);
    expect(secondSessionUnsubscribe).toHaveBeenCalledTimes(1);
  });
});
