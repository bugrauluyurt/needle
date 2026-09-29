import type { Device, RemoteState, Song } from "@needle/shared";
import { isSpotify } from "../lib/spotify.ts";

export const FRESH_MS = 15_000;

export function activeRemote(devices: Device[], activeId: string | null, me: string, now: number): Device | null {
  const d = activeId === me ? undefined : devices.find((x) => x.id === activeId);
  return d?.state && now - d.state.updatedAt < FRESH_MS ? d : null;
}

export function remotePosition(s: RemoteState, now: number): number {
  const at = s.playing ? s.position + Math.max(0, now - s.updatedAt) / 1000 : s.position;
  return s.duration > 0 ? Math.min(at, s.duration) : at;
}

export const remoteSong = (s: RemoteState): Song => ({
  id: s.songId,
  title: s.title,
  artist: s.artist,
  ...(s.coverArt ? { coverArt: s.coverArt } : {}),
  duration: s.duration,
  ...(isSpotify(s.songId) ? { source: "spotify" as const } : {}),
});
