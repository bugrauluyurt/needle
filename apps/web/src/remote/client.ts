import { useCallback, useMemo, useSyncExternalStore } from "react";
import { create } from "zustand";
import { REPLACED_CLOSE_CODE, songSource } from "@needle/shared";
import type { ClientMessage, Device, InternetRadioStation, RemoteCommand, RemoteState, ServerMessage, Song } from "@needle/shared";
import { devicesSocketUrl } from "../lib/api.ts";
import { deviceKind } from "../lib/device.ts";
import { artistName } from "../lib/format.ts";
import { player } from "../player/controller.ts";
import { progress, useProgress } from "../player/progress.ts";
import type { Progress } from "../player/progress.ts";
import { current, useCurrentSong, usePlayer } from "../player/store.ts";
import { useSession } from "../state/session.ts";
import { toast } from "../state/ui.ts";
import { activeRemote, remotePosition, remoteSong } from "./active.ts";

type RemoteStore = { connected: boolean; devices: Device[]; activeId: string | null };

export const useRemote = create<RemoteStore>(() => ({ connected: false, devices: [], activeId: null }));

const STATE_EVERY = 5_000;
const FRESH_CHECK_EVERY = 1_000;
const REMOTE_TICK = 250;
const UNMUTE_TO = 0.5;
const RETRY_MAX = 30_000;
const TRANSFER_LIMIT = 300;
const PULL_WAIT = 2_000;

let socket: WebSocket | null = null;
let retry = 1_000;
let lastSent = "";
let stateTimer: number | null = null;
let stopped = false;
let pullTimer: number | null = null;

function send(msg: ClientMessage) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}

function snapshot(): RemoteState | null {
  const s = usePlayer.getState();
  const song = current(s);
  if (!song) return null;
  return {
    songId: song.id,
    title: song.title,
    artist: artistName(song),
    source: songSource(song),
    ...(song.coverArt ? { coverArt: song.coverArt } : {}),
    ...(song.uri ? { uri: song.uri } : {}),
    position: progress.get().position,
    duration: progress.get().duration > 0 ? progress.get().duration : (song.duration ?? 0),
    playing: s.playing,
    volume: s.muted ? 0 : s.volume,
    updatedAt: Date.now(),
  };
}

function publish(force = false) {
  const state = snapshot();
  const sig = JSON.stringify(state && { ...state, position: Math.round(state.position / 5), updatedAt: 0 });
  if (!force && sig === lastSent) return;
  lastSent = sig;
  send({ type: "state", state });
}

export function transferTo(deviceId: string) {
  const s = usePlayer.getState();
  if (!s.items.length) return;
  const start = Math.max(0, s.index - 20);
  send({
    type: "command",
    to: deviceId,
    command: { action: "transfer", songs: s.items.slice(start, start + TRANSFER_LIMIT).map((i) => i.song), index: s.index - start, position: progress.get().position, playing: true },
  });
  player.pause();
}

export function command(deviceId: string, cmd: RemoteCommand) {
  send({ type: "command", to: deviceId, command: cmd });
}

function stopWaiting() {
  if (pullTimer !== null) window.clearTimeout(pullTimer);
  pullTimer = null;
}

function playHere(from: string, songs: Song[], index: number, position: number, playing: boolean) {
  stopWaiting();
  player.playSongs(songs, index, { kind: "queue", name: "Your queue" }, { shuffle: false, at: position, autoplay: playing });
  const sender = useRemote.getState().devices.find((d) => d.id === from)?.name;
  toast(sender ? `Now playing here, sent from ${sender}` : "Now playing here");
}

export function pullFrom(d: Device) {
  command(d.id, { action: "pull" });
  stopWaiting();
  const state = d.state;
  if (state) pullTimer = window.setTimeout(() => playHere(d.id, [remoteSong(state)], 0, remotePosition(state, Date.now()), true), PULL_WAIT);
}

function receive(from: string, cmd: RemoteCommand) {
  switch (cmd.action) {
    case "play":
      player.play();
      break;
    case "pause":
      player.pause();
      break;
    case "next":
      void player.next();
      break;
    case "previous":
      void player.previous();
      break;
    case "seek":
      player.seek(cmd.position);
      break;
    case "volume":
      player.setVolume(cmd.volume);
      break;
    case "pull":
      transferTo(from);
      break;
    case "transfer":
      playHere(from, cmd.songs, cmd.index, cmd.position, cmd.playing);
      break;
  }
  window.setTimeout(() => publish(true), 300);
}

function connect() {
  const url = devicesSocketUrl();
  if (!url || stopped) return;
  const ws = new WebSocket(url);
  socket = ws;
  ws.onopen = () => {
    retry = 1_000;
    const { deviceId, deviceName } = useSession.getState();
    send({ type: "hello", device: { id: deviceId, name: deviceName, kind: deviceKind() } });
    useRemote.setState({ connected: true });
    publish(true);
  };
  ws.onmessage = (e) => {
    const msg = JSON.parse(String(e.data)) as ServerMessage;
    if (msg.type === "devices") useRemote.setState({ devices: msg.devices, activeId: msg.activeId });
    else receive(msg.from, msg.command);
  };
  ws.onclose = (e) => {
    if (socket === ws) socket = null;
    useRemote.setState({ connected: false, devices: [], activeId: null });
    if (stopped || e.code === REPLACED_CLOSE_CODE) return;
    window.setTimeout(connect, retry);
    retry = Math.min(RETRY_MAX, retry * 2);
  };
}

export function startRemote() {
  stopped = false;
  if (socket) return;
  connect();
  usePlayer.subscribe((s, prev) => {
    if (s.playing !== prev.playing || s.index !== prev.index || s.items !== prev.items || s.volume !== prev.volume || s.muted !== prev.muted) publish();
  });
  stateTimer ??= window.setInterval(() => usePlayer.getState().playing && publish(true), STATE_EVERY);
  useSession.subscribe((s, prev) => {
    if (s.deviceName !== prev.deviceName && socket) socket.close();
    if (!s.credentials && prev.credentials) stopRemote();
  });
}

export function stopRemote() {
  stopped = true;
  socket?.close();
  socket = null;
}

function watchRemote(cb: () => void) {
  const off = useRemote.subscribe(cb);
  const timer = window.setInterval(cb, FRESH_CHECK_EVERY);
  return () => {
    off();
    window.clearInterval(timer);
  };
}

export function useActiveRemote(): Device | null {
  const me = useSession((s) => s.deviceId);
  const id = useSyncExternalStore(watchRemote, () => {
    const { devices, activeId } = useRemote.getState();
    return activeRemote(devices, activeId, me, Date.now())?.id ?? null;
  });
  return useRemote((s) => s.devices.find((d) => d.id === id) ?? null);
}

export type Controls = {
  toggle: () => void;
  next: () => void;
  previous: () => void;
  seek: (seconds: number) => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
};

const localControls: Controls = {
  toggle: player.toggle,
  next: () => void player.next(),
  previous: () => void player.previous(),
  seek: player.seek,
  setVolume: player.setVolume,
  toggleMute: player.toggleMute,
};

function patchRemote(id: string, patch: (s: RemoteState) => Partial<RemoteState>) {
  useRemote.setState((r) => ({ devices: r.devices.map((d) => (d.id === id && d.state ? { ...d, state: { ...d.state, ...patch(d.state), updatedAt: Date.now() } } : d)) }));
}

function remoteControls(id: string): Controls {
  const state = () => useRemote.getState().devices.find((d) => d.id === id)?.state;
  const setVolume = (volume: number) => {
    command(id, { action: "volume", volume });
    patchRemote(id, () => ({ volume }));
  };
  return {
    toggle: () => {
      const playing = Boolean(state()?.playing);
      command(id, { action: playing ? "pause" : "play" });
      patchRemote(id, (s) => ({ playing: !playing, position: remotePosition(s, Date.now()) }));
    },
    next: () => command(id, { action: "next" }),
    previous: () => command(id, { action: "previous" }),
    seek: (position) => {
      command(id, { action: "seek", position });
      patchRemote(id, () => ({ position }));
    },
    setVolume,
    toggleMute: () => setVolume(state()?.volume ? 0 : UNMUTE_TO),
  };
}

export type Playback = {
  remote: Device | null;
  song: Song | null;
  station: InternetRadioStation | null;
  playing: boolean;
  buffering: boolean;
  volume: number;
  controls: Controls;
};

export function usePlayback(): Playback {
  const remote = useActiveRemote();
  const song = useCurrentSong();
  const station = usePlayer((s) => s.station);
  const playing = usePlayer((s) => s.playing);
  const buffering = usePlayer((s) => s.buffering);
  const volume = usePlayer((s) => (s.muted ? 0 : s.volume));
  const id = remote?.id;
  const controls = useMemo(() => (id ? remoteControls(id) : localControls), [id]);
  const state = remote?.state;
  const shown = useMemo(() => (state ? remoteSong(state) : song), [state, song]);
  if (!remote || !state) return { remote: null, song, station, playing, buffering, volume, controls };
  return { remote, song: shown, station: null, playing: state.playing, buffering: false, volume: state.volume, controls };
}

export function useShownProgress<T>(remote: Device | null, select: (p: Progress) => T): T {
  const local = useProgress(select);
  const state = remote?.state;
  const tick = useCallback((cb: () => void) => {
    if (!state?.playing) return () => undefined;
    const timer = window.setInterval(cb, REMOTE_TICK);
    return () => window.clearInterval(timer);
  }, [state]);
  return useSyncExternalStore(tick, () => (state ? select({ position: remotePosition(state, Date.now()), duration: state.duration, buffered: state.duration }) : local));
}
