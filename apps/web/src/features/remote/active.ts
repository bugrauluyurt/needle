import type { Device, RemoteState, Song } from "@needle/shared";
import { musicSource } from "@needle/shared";

export const FRESH_MS = 15_000;

export function activeRemote(
  devices: Device[],
  activeId: string | null,
  me: string,
  now: number,
): Device | null {
  const d =
    activeId === me ? undefined : devices.find((x) => x.id === activeId);
  return d?.state && (!d.state.playing || now - d.state.updatedAt < FRESH_MS)
    ? d
    : null;
}

export function remotePosition(s: RemoteState, now: number): number {
  const at = s.playing
    ? s.position + Math.max(0, now - s.updatedAt) / 1000
    : s.position;
  return s.duration > 0 ? Math.min(at, s.duration) : at;
}

export function remoteSong(remoteState: RemoteState): Song {
  const source = remoteState.source ?? musicSource(remoteState.songId);

  return {
    id: remoteState.songId,
    title: remoteState.title,
    artist: remoteState.artist,
    ...(remoteState.coverArt ? { coverArt: remoteState.coverArt } : {}),
    duration: remoteState.duration,
    ...(source !== "library" ? { source } : {}),
    ...(remoteState.uri ? { uri: remoteState.uri } : {}),
  };
}
