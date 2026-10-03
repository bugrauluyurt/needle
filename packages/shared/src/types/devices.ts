import type { MusicSource } from "../music-source.ts";
import type { Song } from "../subsonic.ts";

export type DeviceKind = "desktop" | "phone" | "tablet";

export type RemoteState = {
  songId: string;
  title: string;
  artist: string;
  coverArt?: string;
  uri?: string;
  source?: MusicSource;
  position: number;
  duration: number;
  playing: boolean;
  volume: number;
  updatedAt: number;
};

export type Device = {
  id: string;
  name: string;
  kind: DeviceKind;
  lastSeen: number;
  state: RemoteState | null;
};

export type RemoteCommand =
  | { action: "play" | "pause" | "next" | "previous" }
  | { action: "seek"; position: number }
  | { action: "volume"; volume: number }
  | { action: "transfer"; songs: Song[]; index: number; position: number; playing: boolean }
  | { action: "pull" };

export type ClientMessage =
  | { type: "hello"; device: { id: string; name: string; kind: DeviceKind } }
  | { type: "state"; state: RemoteState | null }
  | { type: "command"; to: string; command: RemoteCommand };

export type ServerMessage =
  | { type: "devices"; devices: Device[]; activeId: string | null }
  | { type: "command"; from: string; command: RemoteCommand };
