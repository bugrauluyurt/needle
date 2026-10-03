import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/features/spotify/api/client.ts", () => ({
  sp: { play: vi.fn(() => Promise.resolve()) },
  spotifyToken: vi.fn(() => Promise.resolve("token")),
}));

type Listener = (payload: unknown) => void;

class FakeSdkPlayer {
  static last: FakeSdkPlayer | null = null;
  listeners = new Map<string, Listener>();
  constructor() {
    FakeSdkPlayer.last = this;
  }
  addListener(event: string, cb: Listener) {
    this.listeners.set(event, cb);
    return true;
  }
  connect() {
    queueMicrotask(() => this.emit("ready", { device_id: "needle-device" }));
    return Promise.resolve(true);
  }
  emit(event: string, payload: unknown) {
    this.listeners.get(event)?.(payload);
  }
  disconnect() {
    return undefined;
  }
  getCurrentState() {
    return Promise.resolve(null);
  }
  setVolume() {
    return Promise.resolve();
  }
  pause() {
    return Promise.resolve();
  }
  resume() {
    return Promise.resolve();
  }
  seek() {
    return Promise.resolve();
  }
}

const sdkState = (position: number, paused = false) => ({
  paused,
  position,
  duration: 200_000,
  track_window: {
    current_track: { uri: "spotify:track:1" },
    previous_tracks: [],
  },
});

async function playing() {
  vi.stubGlobal("window", {
    Spotify: { Player: FakeSdkPlayer },
    setTimeout,
    clearTimeout,
  });
  const { prepareSpotify, spotifyPlayer } =
    await import("../src/player/spotify.ts");
  const events = {
    state: vi.fn(),
    ended: vi.fn(),
    error: vi.fn(),
    lost: vi.fn(),
  };
  await prepareSpotify("Needle test", events);
  await spotifyPlayer.play("spotify:track:1", 0);
  const sdk = FakeSdkPlayer.last as FakeSdkPlayer;
  sdk.emit("player_state_changed", sdkState(30_000));
  return { spotifyPlayer, events, sdk };
}

describe("Spotify playback moving to another device", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ["performance"] });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("reports the loss and freezes the position when Spotify sends an empty state", async () => {
    const { spotifyPlayer, events, sdk } = await playing();
    vi.advanceTimersByTime(4_000);
    sdk.emit("player_state_changed", null);
    expect(events.lost).toHaveBeenCalledOnce();
    expect(spotifyPlayer.playingUri).toBeNull();
    vi.advanceTimersByTime(10_000);
    expect(spotifyPlayer.position()).toBeCloseTo(34);
  });

  it("reports the loss when the player goes offline", async () => {
    const { spotifyPlayer, events, sdk } = await playing();
    sdk.emit("not_ready", { device_id: "needle-device" });
    expect(events.lost).toHaveBeenCalledOnce();
    expect(spotifyPlayer.playingUri).toBeNull();
  });

  it("ignores an empty state when nothing was playing here", async () => {
    const { events, sdk } = await playing();
    sdk.emit("player_state_changed", null);
    sdk.emit("player_state_changed", null);
    expect(events.lost).toHaveBeenCalledOnce();
  });
});
