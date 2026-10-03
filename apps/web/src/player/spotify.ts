import { sp, spotifyToken } from "../features/spotify/api/client.ts";
import { translate } from "../i18n/index.ts";
import type { TranslationKey } from "../i18n/locales/en.ts";

type SdkTrack = { uri: string };
type SdkState = {
  paused: boolean;
  position: number;
  duration: number;
  track_window: { current_track: SdkTrack | null; previous_tracks: SdkTrack[] };
};
type SdkPlayer = {
  connect(): Promise<boolean>;
  disconnect(): void;
  addListener(event: string, cb: (payload: unknown) => void): boolean;
  getCurrentState(): Promise<SdkState | null>;
  setVolume(volume: number): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  seek(ms: number): Promise<void>;
  activateElement?(): Promise<void>;
};
type SdkOptions = {
  name: string;
  getOAuthToken: (cb: (token: string) => void) => void;
  volume?: number;
};

const sdkWindow = window as Window & {
  Spotify?: { Player: new (options: SdkOptions) => SdkPlayer };
  onSpotifyWebPlaybackSDKReady?: () => void;
};

export type SpotifyEvents = {
  state: (s: { position: number; duration: number; paused: boolean }) => void;
  ended: () => void;
  error: (message: string) => void;
  lost: () => void;
};

const SDK = "https://sdk.scdn.co/spotify-player.js";
const READY_TIMEOUT = 15_000;
const ERRORS: Record<string, TranslationKey> = {
  initialization_error: "spotify.browserPlaybackFailed",
  authentication_error: "spotify.signInRefused",
  account_error: "spotify.premiumRequired",
  playback_error: "player.spotifyFailed",
};

let sdk: Promise<void> | null = null;
let player: SdkPlayer | null = null;
let device: Promise<string> | null = null;
let events: SpotifyEvents | null = null;
let current: string | null = null;
let last: { state: SdkState; at: number } | null = null;
let volume = 0.8;
let playerGeneration = 0;
let rejectDevice: ((error: Error) => void) | null = null;
let readyTimer: number | null = null;

function loadSdk(): Promise<void> {
  sdk ??= new Promise((resolve, reject) => {
    if (sdkWindow.Spotify) return resolve();
    sdkWindow.onSpotifyWebPlaybackSDKReady = () => resolve();
    const script = document.createElement("script");
    script.src = SDK;
    script.async = true;
    script.onerror = () => {
      sdk = null;
      reject(new Error(translate("spotify.playerLoadFailed")));
    };
    document.head.appendChild(script);
  });
  return sdk;
}

function positionMs(): number {
  if (!last) return 0;
  const { state, at } = last;
  return state.paused ? state.position : state.position + (performance.now() - at);
}

function lose(eventGeneration: number) {
  if (eventGeneration !== playerGeneration) return;
  if (!current) return;
  current = null;
  if (last)
    last = {
      state: { ...last.state, paused: true, position: positionMs() },
      at: performance.now(),
    };
  events?.lost();
}

function onState(payload: unknown, eventGeneration: number) {
  if (eventGeneration !== playerGeneration) return;

  const state = payload as SdkState | null;
  if (!state) {
    lose(eventGeneration);
    return;
  }
  const prev = last?.state;
  last = { state, at: performance.now() };
  const uri = state.track_window.current_track?.uri ?? null;
  const finished =
    Boolean(current) &&
    state.paused &&
    state.position === 0 &&
    (state.track_window.previous_tracks.some((t) => t.uri === current) ||
      (uri === current && prev !== undefined && !prev.paused && prev.position > prev.duration - 3000));
  if (finished) {
    current = null;
    events?.ended();
    return;
  }
  events?.state({
    position: state.position / 1000,
    duration: state.duration / 1000,
    paused: state.paused,
  });
}

export function prepareSpotify(name: string, on: SpotifyEvents): Promise<string> {
  events = on;
  const prepareGeneration = playerGeneration;
  let preparedPlayer: SdkPlayer | null = null;

  device ??= (async () => {
    await loadSdk();

    if (prepareGeneration !== playerGeneration) throw new Error(translate("spotify.playerNotReady"));

    const Player = sdkWindow.Spotify?.Player;
    if (!Player) throw new Error(translate("spotify.playerStartFailed"));
    const p = new Player({
      name,
      volume,
      getOAuthToken: (cb) =>
        void spotifyToken().then(
          (token) => {
            if (prepareGeneration === playerGeneration && player === p) cb(token);
          },
          () => {
            if (prepareGeneration === playerGeneration && player === p) {
              events?.error(translate(ERRORS.authentication_error ?? "spotify.signInRefused"));
            }
          },
        ),
    });
    preparedPlayer = p;
    player = p;
    const id = await new Promise<string>((resolve, reject) => {
      rejectDevice = reject;
      readyTimer = window.setTimeout(() => reject(new Error(translate("spotify.playerAnswerFailed"))), READY_TIMEOUT);
      p.addListener("ready", (payload) => {
        if (prepareGeneration !== playerGeneration || player !== p) return;

        if (readyTimer !== null) window.clearTimeout(readyTimer);
        readyTimer = null;
        rejectDevice = null;
        resolve((payload as { device_id: string }).device_id);
      });
      for (const [event, messageKey] of Object.entries(ERRORS)) {
        p.addListener(event, () => {
          if (prepareGeneration !== playerGeneration || player !== p) return;

          const message = translate(messageKey);

          if (readyTimer !== null) window.clearTimeout(readyTimer);
          readyTimer = null;
          rejectDevice = null;
          events?.error(message);
          reject(new Error(message));
        });
      }
      p.addListener("player_state_changed", (payload) => onState(payload, prepareGeneration));
      p.addListener("not_ready", () => lose(prepareGeneration));
      void p.connect();
    });
    return id;
  })().catch((e: unknown) => {
    if (prepareGeneration === playerGeneration) {
      preparedPlayer?.disconnect();

      device = null;
      player = null;
      rejectDevice = null;

      if (readyTimer !== null) window.clearTimeout(readyTimer);
      readyTimer = null;
    }

    throw e;
  });
  return device;
}

export const spotifyPlayer = {
  activate() {
    void player?.activateElement?.();
  },
  async play(uri: string, positionSeconds: number) {
    const id = await (device ?? Promise.reject(new Error(translate("spotify.playerNotReady"))));
    current = uri;
    last = null;
    await sp.play(id, [uri], positionSeconds * 1000);
  },
  pause: () => void player?.pause(),
  resume: () => void player?.resume(),
  seek: (seconds: number) => void player?.seek(Math.max(0, seconds * 1000)),
  setVolume(v: number) {
    volume = v;
    void player?.setVolume(Math.max(0.0001, v));
  },
  stop() {
    current = null;
    void player?.pause();
  },
  dispose() {
    playerGeneration += 1;

    if (readyTimer !== null) window.clearTimeout(readyTimer);
    readyTimer = null;

    rejectDevice?.(new Error(translate("spotify.playerNotReady")));
    rejectDevice = null;

    const disposedPlayer = player;
    player = null;
    device = null;
    events = null;
    current = null;
    last = null;

    disposedPlayer?.disconnect();
  },
  get playingUri() {
    return current;
  },
  position: () => positionMs() / 1000,
  duration(): number {
    return (last?.state.duration ?? 0) / 1000;
  },
  get ready() {
    return device !== null;
  },
};
