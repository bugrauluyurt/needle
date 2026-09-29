import { create } from "zustand";
import { REPLACED_CLOSE_CODE } from "@needle/shared";
import type { ClientMessage, Device, RemoteCommand, RemoteState, ServerMessage } from "@needle/shared";
import { devicesSocketUrl } from "../lib/api.ts";
import { deviceKind } from "../lib/device.ts";
import { artistName } from "../lib/format.ts";
import { player } from "../player/controller.ts";
import { progress } from "../player/progress.ts";
import { current, usePlayer } from "../player/store.ts";
import { useSession } from "../state/session.ts";
import { toast } from "../state/ui.ts";

type RemoteStore = { connected: boolean; devices: Device[]; activeId: string | null };

export const useRemote = create<RemoteStore>(() => ({ connected: false, devices: [], activeId: null }));

const STATE_EVERY = 5_000;
const RETRY_MAX = 30_000;
const TRANSFER_LIMIT = 300;

let socket: WebSocket | null = null;
let retry = 1_000;
let lastSent = "";
let stateTimer: number | null = null;
let stopped = false;

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
    ...(song.coverArt ? { coverArt: song.coverArt } : {}),
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
    case "transfer": {
      player.playSongs(cmd.songs, cmd.index, { kind: "queue", name: "Your queue" }, { shuffle: false });
      if (cmd.position > 1) window.setTimeout(() => player.seek(cmd.position), 400);
      const sender = useRemote.getState().devices.find((d) => d.id === from)?.name;
      toast(sender ? `Now playing here, sent from ${sender}` : "Now playing here");
      break;
    }
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
