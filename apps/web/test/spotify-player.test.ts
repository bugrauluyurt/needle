import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spotifyMocks = vi.hoisted(() => ({
  play: vi.fn(() => Promise.resolve()),
  token: vi.fn(() => Promise.resolve("token")),
}));

vi.mock("../src/features/spotify/api/client.ts", () => ({
  sp: { play: spotifyMocks.play },
  spotifyToken: spotifyMocks.token,
}));

type Listener = (payload: unknown) => void;

class FakeSdkPlayer {
  static last: FakeSdkPlayer | null = null;
  static instances: FakeSdkPlayer[] = [];
  listeners = new Map<string, Listener>();
  disconnect = vi.fn();

  constructor(readonly options: { name: string; getOAuthToken: (callback: (token: string) => void) => void }) {
    FakeSdkPlayer.last = this;
    FakeSdkPlayer.instances.push(this);
  }
  addListener(event: string, cb: Listener) {
    this.listeners.set(event, cb);
    return true;
  }
  connect() {
    const deviceId = `needle-device-${FakeSdkPlayer.instances.length}`;

    queueMicrotask(() => this.emit("ready", { device_id: deviceId }));
    return Promise.resolve(true);
  }
  emit(event: string, payload: unknown) {
    this.listeners.get(event)?.(payload);
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
  const { prepareSpotify, spotifyPlayer } = await import("../src/player/spotify.ts");
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
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["performance"] });
    FakeSdkPlayer.instances = [];
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

  it("disconnects Alice and creates a new Spotify device for Bob", async () => {
    vi.stubGlobal("window", {
      Spotify: { Player: FakeSdkPlayer },
      setTimeout,
      clearTimeout,
    });
    const { prepareSpotify, spotifyPlayer } = await import("../src/player/spotify.ts");
    const aliceEvents = {
      state: vi.fn(),
      ended: vi.fn(),
      error: vi.fn(),
      lost: vi.fn(),
    };
    const bobEvents = {
      state: vi.fn(),
      ended: vi.fn(),
      error: vi.fn(),
      lost: vi.fn(),
    };

    await prepareSpotify("Needle Alice", aliceEvents);
    const alicePlayer = FakeSdkPlayer.instances[0] as FakeSdkPlayer;

    spotifyPlayer.dispose();
    await prepareSpotify("Needle Bob", bobEvents);
    const bobPlayer = FakeSdkPlayer.instances[1] as FakeSdkPlayer;
    await spotifyPlayer.play("spotify:track:bob", 0);

    expect(alicePlayer.disconnect).toHaveBeenCalledOnce();
    expect(bobPlayer).not.toBe(alicePlayer);
    expect(spotifyMocks.play).toHaveBeenLastCalledWith("needle-device-2", ["spotify:track:bob"], 0);

    alicePlayer.emit("player_state_changed", sdkState(60_000));

    expect(bobEvents.state).not.toHaveBeenCalled();
  });

  it("drops an Alice token callback that settles after disposal", async () => {
    let resolveAliceToken: (token: string) => void = () => undefined;
    const aliceToken = new Promise<string>((resolveToken) => {
      resolveAliceToken = resolveToken;
    });
    spotifyMocks.token.mockReturnValueOnce(aliceToken);
    vi.stubGlobal("window", {
      Spotify: { Player: FakeSdkPlayer },
      setTimeout,
      clearTimeout,
    });
    const { prepareSpotify, spotifyPlayer } = await import("../src/player/spotify.ts");
    const events = {
      state: vi.fn(),
      ended: vi.fn(),
      error: vi.fn(),
      lost: vi.fn(),
    };

    await prepareSpotify("Needle Alice", events);
    const alicePlayer = FakeSdkPlayer.instances[0] as FakeSdkPlayer;
    const receiveToken = vi.fn();
    alicePlayer.options.getOAuthToken(receiveToken);

    spotifyPlayer.dispose();
    resolveAliceToken("alice-token");
    await Promise.resolve();
    await Promise.resolve();

    expect(receiveToken).not.toHaveBeenCalled();
  });
});
