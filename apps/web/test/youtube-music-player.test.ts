import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Song } from "@needle/shared";
import type { EngineEvents } from "../src/player/engine.ts";

const playerMocks = vi.hoisted(() => ({
  events: null as EngineEvents | null,
  load: vi.fn(),
  stop: vi.fn(),
  clearPreload: vi.fn(),
  fading: false,
  scrobble: vi.fn(() => Promise.resolve()),
  savePlayQueue: vi.fn(() => Promise.resolve()),
  playQueue: vi.fn(() => Promise.resolve(null)),
  offlineSource: vi.fn(() => Promise.resolve(null)),
  subsonicUrl: vi.fn(() => "/subsonic/stream"),
  similarSongs: vi.fn(() => Promise.resolve([])),
  radio: vi.fn(() => Promise.resolve([])),
  reportPlay: vi.fn(() => Promise.resolve()),
  storageRemoveItem: vi.fn(),
  storageSetItem: vi.fn(),
}));

vi.mock("../src/player/engine.ts", () => ({
  dbToGain: () => 1,
  AudioEngine: class {
    currentSrc: string | null = null;

    constructor(events: EngineEvents) {
      playerMocks.events = events;
    }

    setVolume() {}

    load(source: string, options: { autoplay: boolean }) {
      this.currentSrc = source;
      playerMocks.load(source, options);
    }

    stop() {
      this.currentSrc = null;
      playerMocks.stop();
    }

    pause() {}

    clearPreload() {
      playerMocks.clearPreload();
    }

    get fading() {
      return playerMocks.fading;
    }

    position() {
      return 0;
    }
  },
}));

vi.mock("../src/player/spotify.ts", () => ({
  prepareSpotify: vi.fn(),
  spotifyPlayer: {
    activate: vi.fn(),
    setVolume: vi.fn(),
    stop: vi.fn(),
    pause: vi.fn(),
  },
}));

vi.mock("../src/features/spotify/hooks/useSpotify.ts", () => ({
  spotifyArtistSongs: vi.fn(),
}));

vi.mock("../src/features/youtube-music/api/client.ts", () => ({
  ytm: { radio: playerMocks.radio, artist: vi.fn() },
}));

vi.mock("../src/features/spotify/api/client.ts", () => ({
  isSpotify: (id: string | undefined) => Boolean(id?.startsWith("sp:")),
  rawId: (id: string) => id.replace(/^sp:/, ""),
}));

vi.mock("../src/lib/subsonic.ts", () => ({
  sub: {
    scrobble: playerMocks.scrobble,
    savePlayQueue: playerMocks.savePlayQueue,
    playQueue: playerMocks.playQueue,
    similarSongs: playerMocks.similarSongs,
  },
  subsonicUrl: playerMocks.subsonicUrl,
  coverUrl: () => null,
}));

vi.mock("../src/lib/api.ts", () => ({
  api: { reportPlay: playerMocks.reportPlay },
}));

vi.mock("../src/offline/store.ts", () => ({
  offlineSource: playerMocks.offlineSource,
}));

vi.mock("../src/state/settings.ts", () => ({
  settings: () => ({
    wifiQuality: "original",
    cellularQuality: "original",
    normalize: "off",
    crossfade: 0,
    autoplay: false,
    gapless: false,
  }),
}));

vi.mock("../src/lib/device.ts", () => ({
  isIOS: false,
  randomId: () => "test-device",
  defaultDeviceName: () => "Test device",
}));

const youtubeSong: Song = {
  id: "ytm:video-12345",
  title: "Remote song",
  duration: 200,
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance"],
  });
  playerMocks.events = null;
  playerMocks.fading = false;

  const storage = {
    getItem: () => null,
    setItem: playerMocks.storageSetItem,
    removeItem: playerMocks.storageRemoveItem,
  };

  vi.stubGlobal("window", {
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    addEventListener: vi.fn(),
    localStorage: storage,
  });
  vi.stubGlobal("document", { addEventListener: vi.fn() });
  vi.stubGlobal("navigator", {});
  vi.stubGlobal("localStorage", storage);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function initializedPlayer() {
  const controller = await import("../src/player/controller.ts");
  const { useSession } = await import("../src/state/session.ts");
  const { usePlayer } = await import("../src/player/store.ts");
  useSession.setState({
    credentials: { user: "listener", token: "test-token", salt: "test-salt" },
  });
  controller.startPlayer();

  return { ...controller, usePlayer };
}

describe("YouTube Music playback boundaries", () => {
  it("plays through the authenticated proxy without offline lookup or Navidrome scrobbling", async () => {
    const controller = await initializedPlayer();
    controller.allowYouTubeMusic(true);
    controller.player.playSongs([youtubeSong]);
    await vi.waitFor(() => expect(playerMocks.load).toHaveBeenCalledOnce());

    const proxyUrl = new URL(String(playerMocks.load.mock.calls[0]?.[0]), "https://needle.test");
    expect(proxyUrl.pathname).toBe("/youtube-music/stream/video-12345");
    expect(proxyUrl.searchParams.get("u")).toBe("listener");
    expect(playerMocks.offlineSource).not.toHaveBeenCalled();
    expect(playerMocks.scrobble).not.toHaveBeenCalled();
    expect(playerMocks.subsonicUrl).not.toHaveBeenCalled();
  });

  it("rejects restored YouTube songs while the integration is disabled", async () => {
    const controller = await initializedPlayer();
    controller.usePlayer.setState({
      items: [{ uid: "restored-song", song: youtubeSong }],
      index: 0,
    });

    controller.player.toggle();
    await Promise.resolve();

    expect(playerMocks.load).not.toHaveBeenCalled();
    expect(playerMocks.scrobble).not.toHaveBeenCalled();
    expect(controller.usePlayer.getState().playing).toBe(false);
    expect(controller.usePlayer.getState().error).toContain("YouTube Music is switched off");
  });

  it("stops YouTube playback on disable and does not restart the same source", async () => {
    const controller = await initializedPlayer();
    controller.allowYouTubeMusic(true);
    controller.player.playSongs([youtubeSong]);
    await vi.waitFor(() => expect(playerMocks.load).toHaveBeenCalledOnce());

    controller.allowYouTubeMusic(false);
    controller.player.toggle();

    expect(playerMocks.stop).toHaveBeenCalled();
    expect(playerMocks.load).toHaveBeenCalledOnce();
    expect(controller.usePlayer.getState().playing).toBe(false);
  });

  it("stops after a YouTube stream error without resolving the following songs", async () => {
    const controller = await initializedPlayer();
    controller.allowYouTubeMusic(true);
    controller.player.playSongs([youtubeSong, { ...youtubeSong, id: "ytm:next-123456" }]);
    await vi.waitFor(() => expect(playerMocks.load).toHaveBeenCalledOnce());

    playerMocks.events?.error("The provider is unavailable");
    await vi.advanceTimersByTimeAsync(2_000);

    expect(controller.usePlayer.getState().index).toBe(0);
    expect(controller.usePlayer.getState().playing).toBe(false);
    expect(playerMocks.load).toHaveBeenCalledOnce();
  });

  it("saves only local queue entries to Navidrome when a local song is current", async () => {
    const controller = await initializedPlayer();
    controller.allowYouTubeMusic(true);
    controller.player.playSongs([{ id: "local-1", title: "Local song" }, youtubeSong]);
    await vi.waitFor(() => expect(playerMocks.load).toHaveBeenCalledOnce());

    controller.player.pause();

    expect(playerMocks.savePlayQueue).toHaveBeenCalledWith(["local-1"], "local-1", 0);
  });

  it("preserves the existing clamped start index for library queues", async () => {
    const controller = await initializedPlayer();
    const songs: Song[] = [
      { id: "local-1", title: "First song" },
      { id: "local-2", title: "Last song" },
    ];

    controller.player.playSongs(songs, 50);
    expect(controller.usePlayer.getState().index).toBe(1);

    controller.player.playSongs(songs, -5);
    expect(controller.usePlayer.getState().index).toBe(0);

    controller.player.playSongs(songs, 50, null, { shuffle: true });
    expect(controller.usePlayer.getState().items[0]?.song.id).toBe("local-1");
  });

  it("keeps unavailable YouTube tracks visible in the list but out of playable queues", async () => {
    const controller = await initializedPlayer();
    controller.allowYouTubeMusic(true);

    controller.player.playSongs([youtubeSong, { ...youtubeSong, id: "ytm:unavailable", isAvailable: false }]);
    controller.player.addToQueue([{ ...youtubeSong, id: "ytm:unavailable", isAvailable: false }]);

    expect(controller.usePlayer.getState().items.map((queueItem) => queueItem.song.id)).toEqual([youtubeSong.id]);
  });

  it("clears account playback and metadata while preserving device volume", async () => {
    const mediaSession = {
      metadata: { title: "Alice song" },
      playbackState: "playing",
      setActionHandler: vi.fn(),
    };
    vi.stubGlobal("navigator", { mediaSession });
    const controller = await initializedPlayer();
    controller.usePlayer.setState({
      items: [{ uid: "alice-song", song: youtubeSong }],
      index: 0,
      context: { kind: "album", id: "alice-album", name: "Alice album" },
      shuffle: true,
      repeat: "all",
      playing: true,
      buffering: true,
      volume: 0.35,
      muted: true,
      station: { id: "alice-station", name: "Alice station", streamUrl: "https://radio.invalid" },
      lastPosition: 42,
      resume: {
        songs: [youtubeSong],
        index: 0,
        position: 20,
        changedBy: "Alice device",
        changed: "2026-01-01T00:00:00.000Z",
      },
      error: "Alice playback error",
    });

    controller.resetPlayerAccount();

    expect(playerMocks.stop).toHaveBeenCalled();
    expect(controller.usePlayer.getState()).toMatchObject({
      items: [],
      index: -1,
      context: null,
      shuffle: false,
      repeat: "off",
      playing: false,
      buffering: false,
      volume: 0.35,
      muted: true,
      station: null,
      lastPosition: 0,
      resume: null,
      error: null,
    });
    const playerStorageWrites = playerMocks.storageSetItem.mock.calls.filter(
      ([storageKey]) => storageKey === "needle.player",
    );
    const persistedPlayer = JSON.parse(String(playerStorageWrites.at(-1)?.[1])) as {
      state: { items: unknown[]; index: number; context: unknown; lastPosition: number };
    };

    expect(persistedPlayer.state).toMatchObject({ items: [], index: -1, context: null, lastPosition: 0 });
    expect(playerMocks.storageRemoveItem).toHaveBeenCalledWith("needle.queueSavedAt");
    expect(mediaSession.metadata).toBeNull();
    expect(mediaSession.playbackState).toBe("none");
  });

  it("records YouTube listening in Needle while excluding both Navidrome scrobble modes", async () => {
    const controller = await initializedPlayer();
    controller.allowYouTubeMusic(true);
    controller.player.playSongs([youtubeSong]);
    await vi.waitFor(() => expect(playerMocks.load).toHaveBeenCalledOnce());

    for (let elapsedSeconds = 1; elapsedSeconds <= 35; elapsedSeconds++) {
      vi.advanceTimersByTime(1_000);
      playerMocks.events?.time(elapsedSeconds, 200, 200);
    }

    controller.allowYouTubeMusic(false);

    expect(playerMocks.reportPlay).toHaveBeenCalledWith(expect.objectContaining({ songId: youtubeSong.id }));
    expect(playerMocks.scrobble).not.toHaveBeenCalled();
    expect(playerMocks.savePlayQueue).not.toHaveBeenCalled();
  });

  it("attributes listening to the YouTube song when moving into a local song", async () => {
    const controller = await initializedPlayer();
    controller.allowYouTubeMusic(true);
    controller.player.playSongs([youtubeSong, { id: "local-next", title: "Next local song" }]);
    await vi.waitFor(() => expect(playerMocks.load).toHaveBeenCalledOnce());

    for (let elapsedSeconds = 1; elapsedSeconds <= 35; elapsedSeconds++) {
      vi.advanceTimersByTime(1_000);
      playerMocks.events?.time(elapsedSeconds, 200, 200);
    }

    await controller.player.next();

    expect(playerMocks.reportPlay).toHaveBeenCalledOnce();
    expect(playerMocks.reportPlay).toHaveBeenCalledWith(
      expect.objectContaining({
        songId: youtubeSong.id,
        title: youtubeSong.title,
      }),
    );
    expect(playerMocks.scrobble).toHaveBeenCalledWith("local-next", false);
  });

  it("releases outgoing YouTube audio during a repeat-all crossfade into the first local song", async () => {
    const controller = await initializedPlayer();
    controller.allowYouTubeMusic(true);
    controller.usePlayer.setState({
      items: [
        {
          uid: "local-first",
          song: { id: "local-1", title: "First local song" },
        },
        {
          uid: "local-second",
          song: { id: "local-2", title: "Second local song" },
        },
        { uid: "youtube-last", song: youtubeSong },
      ],
      index: 0,
      repeat: "all",
      playing: true,
    });
    playerMocks.fading = true;

    controller.allowYouTubeMusic(false);

    expect(playerMocks.clearPreload).toHaveBeenCalledOnce();
    expect(playerMocks.stop).not.toHaveBeenCalled();
    expect(controller.usePlayer.getState().playing).toBe(true);
  });

  it("dispatches radio by explicit YouTube source for a raw-ID remote song", async () => {
    const controller = await initializedPlayer();
    controller.allowYouTubeMusic(true);
    const remoteSong: Song = {
      ...youtubeSong,
      id: "video-12345",
      source: "youtubeMusic",
    };

    await controller.player.startRadio({
      song: remoteSong,
      name: remoteSong.title,
    });

    expect(playerMocks.radio).toHaveBeenCalledWith(remoteSong.id);
    expect(playerMocks.similarSongs).not.toHaveBeenCalled();
  });
});
