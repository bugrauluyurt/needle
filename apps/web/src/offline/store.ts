import { create } from "zustand";
import type { Song } from "@needle/shared";
import { subsonicUrl } from "../lib/subsonic.ts";
import { settings } from "../state/settings.ts";
import { idbAll, idbDelete, idbGet, idbPut } from "./idb.ts";

const CACHE = "needle-audio";
const CONCURRENCY = 2;

export type CollectionKind = "album" | "playlist" | "liked";
export type OfflineCollection = { id: string; kind: CollectionKind; name: string; subtitle: string; coverArt?: string; songIds: string[]; savedAt: number };
type OfflineSong = { id: string; song: Song; bytes: number; savedAt: number };
export type Job = { done: number; total: number; waiting: boolean; failed: number };

type OfflineState = {
  ready: boolean;
  supported: boolean;
  songs: Set<string>;
  collections: OfflineCollection[];
  bytes: number;
  jobs: Record<string, Job>;
};

export const offlineSupported = typeof window !== "undefined" && "caches" in window && window.isSecureContext && "indexedDB" in window;

export const useOffline = create<OfflineState>(() => ({
  ready: false,
  supported: offlineSupported,
  songs: new Set(),
  collections: [],
  bytes: 0,
  jobs: {},
}));

const key = (id: string) => `/offline/${encodeURIComponent(id)}`;

export async function loadOffline() {
  if (!offlineSupported) {
    useOffline.setState({ ready: true });
    return;
  }
  const [songs, collections] = await Promise.all([idbAll<OfflineSong>("songs"), idbAll<OfflineCollection>("collections")]);
  useOffline.setState({
    ready: true,
    songs: new Set(songs.map((s) => s.id)),
    collections: collections.sort((a, b) => b.savedAt - a.savedAt),
    bytes: songs.reduce((n, s) => n + s.bytes, 0),
  });
  void navigator.storage?.persist?.().catch(() => false);
}

export async function offlineSource(songId: string): Promise<string | null> {
  if (!offlineSupported || !useOffline.getState().songs.has(songId)) return null;
  const hit = await (await caches.open(CACHE)).match(key(songId));
  return hit ? URL.createObjectURL(await hit.blob()) : null;
}

export async function offlineSongs(ids: string[]): Promise<Song[]> {
  const rows = await Promise.all(ids.map((id) => idbGet<OfflineSong>("songs", id)));
  return rows.filter((r): r is OfflineSong => Boolean(r)).map((r) => r.song);
}

function onCellular(): boolean {
  return (navigator as Navigator & { connection?: { type?: string } }).connection?.type === "cellular";
}

function downloadUrl(song: Song): string {
  const q = settings().downloadQuality;
  if (q === "original") return subsonicUrl("download", { id: song.id });
  const probe = document.createElement("audio");
  const format = probe.canPlayType("audio/aac") ? "aac" : "mp3";
  return subsonicUrl("stream", { id: song.id, format, maxBitRate: Number(q) });
}

function setJob(id: string, job: Job | null) {
  const jobs = { ...useOffline.getState().jobs };
  if (job) jobs[id] = job;
  else delete jobs[id];
  useOffline.setState({ jobs });
}

async function saveSong(cache: Cache, song: Song): Promise<number> {
  const res = await fetch(downloadUrl(song));
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const blob = await res.blob();
  await cache.put(key(song.id), new Response(blob, { headers: { "content-type": res.headers.get("content-type") ?? "audio/mpeg" } }));
  await idbPut<OfflineSong>("songs", { id: song.id, song, bytes: blob.size, savedAt: Date.now() });
  return blob.size;
}

export async function download(collection: Omit<OfflineCollection, "savedAt" | "songIds">, songs: Song[]) {
  if (!offlineSupported) return;
  const entry: OfflineCollection = { ...collection, songIds: songs.map((s) => s.id), savedAt: Date.now() };
  await idbPut("collections", entry);
  useOffline.setState((s) => ({ collections: [entry, ...s.collections.filter((c) => c.id !== entry.id)] }));

  const cache = await caches.open(CACHE);
  const pending = songs.filter((s) => !useOffline.getState().songs.has(s.id));
  const job: Job = { done: songs.length - pending.length, total: songs.length, waiting: false, failed: 0 };
  setJob(entry.id, { ...job });
  const queue = pending.slice();
  const worker = async () => {
    for (let song = queue.shift(); song; song = queue.shift()) {
      while (onCellular() && !settings().downloadOnCellular) {
        setJob(entry.id, { ...job, waiting: true });
        await new Promise((r) => setTimeout(r, 15_000));
      }
      if (!useOffline.getState().collections.some((c) => c.id === entry.id)) return;
      try {
        const bytes = await saveSong(cache, song);
        const id = song.id;
        useOffline.setState((s) => ({ songs: new Set(s.songs).add(id), bytes: s.bytes + bytes }));
        job.done++;
      } catch {
        job.failed++;
      }
      setJob(entry.id, { ...job, waiting: false });
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  setJob(entry.id, job.failed ? { ...job } : null);
}

export async function removeDownload(collectionId: string) {
  const state = useOffline.getState();
  const target = state.collections.find((c) => c.id === collectionId);
  if (!target) return;
  const remaining = state.collections.filter((c) => c.id !== collectionId);
  const stillNeeded = new Set(remaining.flatMap((c) => c.songIds));
  const cache = await caches.open(CACHE);
  let freed = 0;
  const songs = new Set(state.songs);
  for (const id of target.songIds) {
    if (stillNeeded.has(id)) continue;
    const row = await idbGet<OfflineSong>("songs", id);
    freed += row?.bytes ?? 0;
    await cache.delete(key(id));
    await idbDelete("songs", id);
    songs.delete(id);
  }
  await idbDelete("collections", collectionId);
  setJob(collectionId, null);
  useOffline.setState({ collections: remaining, songs, bytes: Math.max(0, state.bytes - freed) });
}

export async function removeAllDownloads() {
  for (const c of useOffline.getState().collections) await removeDownload(c.id);
  if (offlineSupported) await caches.delete(CACHE);
  useOffline.setState({ songs: new Set(), bytes: 0, jobs: {} });
}

export function useIsDownloaded(collectionId: string | undefined): boolean {
  return useOffline((s) => Boolean(collectionId && s.collections.some((c) => c.id === collectionId)));
}
