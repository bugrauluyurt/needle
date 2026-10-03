import { create } from "zustand";
import type { Song } from "@needle/shared";
import { isLocalSong, musicSource } from "@needle/shared";
import { sub, subsonicUrl } from "../lib/subsonic.ts";
import { settings } from "../state/settings.ts";
import { credentials } from "../state/session.ts";
import { idbAll, idbDelete, idbGet, idbPut, removeLegacyOfflineDatabase } from "./idb.ts";
import { translate } from "../i18n/index.ts";

const LEGACY_CACHE = "needle-audio";
const CACHE_PREFIX = "needle-audio:";
const CONCURRENCY = 2;
const STALL_MS = 60_000;

export type CollectionKind = "album" | "playlist" | "liked";
export type OfflineCollection = {
  id: string;
  kind: CollectionKind;
  name: string;
  subtitle: string;
  coverArt?: string;
  songIds: string[];
  savedAt: number;
};
type OfflineSong = { id: string; song: Song; bytes: number; savedAt: number };
export type Job = {
  done: number;
  total: number;
  waiting: boolean;
  failed: number;
  progress: number;
};

type OfflineState = {
  ready: boolean;
  supported: boolean;
  songs: Map<string, number>;
  collections: OfflineCollection[];
  jobs: Record<string, Job>;
};

export const offlineSupported =
  typeof window !== "undefined" && "caches" in window && window.isSecureContext && "indexedDB" in window;

export const useOffline = create<OfflineState>(() => ({
  ready: false,
  supported: offlineSupported,
  songs: new Map(),
  collections: [],
  jobs: {},
}));

export const bytesOf = (songs: Map<string, number>, ids?: string[]) =>
  (ids ?? [...songs.keys()]).reduce((n, id) => n + (songs.get(id) ?? 0), 0);

const key = (id: string) => `/offline/${encodeURIComponent(id)}`;

type AccountSnapshot = { accountUser: string; generation: number };

let activeAccountUser: string | null = null;
let accountGeneration = 0;
let legacyCleanup: Promise<void> | null = null;
const downloadControllers = new Set<AbortController>();
const running = new Set<string>();

export function offlineCacheName(accountUser: string): string {
  return `${CACHE_PREFIX}${encodeURIComponent(accountUser)}`;
}

function clearDownloads(): void {
  for (const downloadController of downloadControllers) downloadController.abort();

  downloadControllers.clear();
}

function activateAccount(accountUser: string): AccountSnapshot {
  if (activeAccountUser !== accountUser) {
    clearDownloads();
    accountGeneration++;
    activeAccountUser = accountUser;
    useOffline.setState({ ready: false, songs: new Map(), collections: [], jobs: {} });
  }

  return { accountUser, generation: accountGeneration };
}

function currentAccount(): AccountSnapshot | null {
  const accountUser = credentials()?.user;
  if (!accountUser || accountUser !== activeAccountUser) return null;

  return { accountUser, generation: accountGeneration };
}

function accountIsCurrent(account: AccountSnapshot): boolean {
  return (
    activeAccountUser === account.accountUser &&
    accountGeneration === account.generation &&
    credentials()?.user === account.accountUser
  );
}

async function removeLegacyOfflineData(): Promise<void> {
  legacyCleanup ??= Promise.all([
    removeLegacyOfflineDatabase(),
    caches
      .delete(LEGACY_CACHE)
      .then(() => undefined)
      .catch(() => undefined),
  ]).then(() => undefined);

  await legacyCleanup;
}

export function resetOfflineAccount(): void {
  clearDownloads();
  activeAccountUser = null;
  accountGeneration++;
  running.clear();
  useOffline.setState({ ready: false, songs: new Map(), collections: [], jobs: {} });
}

export async function loadOffline() {
  if (!offlineSupported) {
    useOffline.setState({ ready: true });
    return;
  }

  const accountUser = credentials()?.user;
  if (!accountUser) {
    resetOfflineAccount();
    useOffline.setState({ ready: true });

    return;
  }

  const account = activateAccount(accountUser);

  await removeLegacyOfflineData();

  const [songs, collections] = await Promise.all([
    idbAll<OfflineSong>(account.accountUser, "songs"),
    idbAll<OfflineCollection>(account.accountUser, "collections"),
  ]);

  if (!accountIsCurrent(account)) return;

  useOffline.setState({
    ready: true,
    songs: new Map(songs.map((s) => [s.id, s.bytes])),
    collections: collections.sort((a, b) => b.savedAt - a.savedAt),
  });
  void navigator.storage?.persist?.().catch(() => false);
  const have = useOffline.getState().songs;
  for (const c of collections)
    if (c.songIds.some((id) => !have.has(id))) void resumeDownloadForAccount(account, c).catch(() => undefined);
}

export async function offlineSource(songId: string): Promise<string | null> {
  if (musicSource(songId) !== "library" || !offlineSupported || !useOffline.getState().songs.has(songId)) return null;

  const account = currentAccount();
  if (!account) return null;

  const hit = await (await caches.open(offlineCacheName(account.accountUser))).match(key(songId));
  if (!accountIsCurrent(account)) return null;

  if (!hit) return null;

  const offlineBlob = await hit.blob();
  if (!accountIsCurrent(account)) return null;

  return URL.createObjectURL(offlineBlob);
}

export async function offlineSongs(ids: string[]): Promise<Song[]> {
  const account = currentAccount();
  if (!account) return [];

  const rows = await Promise.all(ids.map((id) => idbGet<OfflineSong>(account.accountUser, "songs", id)));
  if (!accountIsCurrent(account)) return [];

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

async function saveSong(
  account: AccountSnapshot,
  cache: Cache,
  song: Song,
  onProgress: (fraction: number) => void,
): Promise<number> {
  const abort = new AbortController();
  downloadControllers.add(abort);
  let stall = setTimeout(() => abort.abort(), STALL_MS);
  const alive = () => {
    clearTimeout(stall);
    stall = setTimeout(() => abort.abort(), STALL_MS);
  };
  try {
    const res = await fetch(downloadUrl(song), { signal: abort.signal });
    if (!res.ok || !res.body) throw new Error(translate("error.downloadFailed", { status: res.status }));
    const total = Number(res.headers.get("content-length") ?? 0) || (song.size ?? 0);
    const reader = res.body.getReader();
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let received = 0;
    for (let part = await reader.read(); !part.done; part = await reader.read()) {
      chunks.push(part.value);
      received += part.value.length;
      alive();
      if (total) onProgress(Math.min(1, received / total));
    }
    const type = res.headers.get("content-type") ?? "audio/mpeg";
    const blob = new Blob(chunks, { type });
    if (!accountIsCurrent(account)) throw new Error("Account changed");

    await cache.put(key(song.id), new Response(blob, { headers: { "content-type": type } }));
    if (!accountIsCurrent(account)) throw new Error("Account changed");

    await idbPut<OfflineSong>(account.accountUser, "songs", {
      id: song.id,
      song,
      bytes: blob.size,
      savedAt: Date.now(),
    });
    if (!accountIsCurrent(account)) throw new Error("Account changed");

    return blob.size;
  } finally {
    clearTimeout(stall);
    downloadControllers.delete(abort);
  }
}

function assertLocalSongs(songs: Song[]): void {
  if (!songs.every(isLocalSong)) throw new Error(translate("query.localDownloadOnly"));
}

export async function download(collection: Omit<OfflineCollection, "savedAt" | "songIds">, songs: Song[]) {
  assertLocalSongs(songs);

  const account = currentAccount();
  if (!account) return;

  await downloadForAccount(account, collection, songs);
}

async function downloadForAccount(
  account: AccountSnapshot,
  collection: Omit<OfflineCollection, "savedAt" | "songIds">,
  songs: Song[],
): Promise<void> {
  assertLocalSongs(songs);
  if (!offlineSupported || !accountIsCurrent(account)) return;

  const runningKey = `${account.accountUser}\u0000${collection.id}`;
  if (running.has(runningKey)) return;

  running.add(runningKey);
  try {
    await fetchAll(account, collection, songs);
  } finally {
    running.delete(runningKey);
  }
}

async function fetchAll(
  account: AccountSnapshot,
  collection: Omit<OfflineCollection, "savedAt" | "songIds">,
  songs: Song[],
) {
  if (!accountIsCurrent(account)) return;

  const entry: OfflineCollection = {
    ...collection,
    songIds: songs.map((s) => s.id),
    savedAt: Date.now(),
  };
  if (!accountIsCurrent(account)) return;

  await idbPut(account.accountUser, "collections", entry);
  if (!accountIsCurrent(account)) return;

  useOffline.setState((s) => ({
    collections: [entry, ...s.collections.filter((c) => c.id !== entry.id)],
  }));

  const cache = await caches.open(offlineCacheName(account.accountUser));
  if (!accountIsCurrent(account)) return;

  const pending = songs.filter((s) => !useOffline.getState().songs.has(s.id));
  const job: Job = {
    done: songs.length - pending.length,
    total: songs.length,
    waiting: false,
    failed: 0,
    progress: 0,
  };
  const partial = new Map<string, number>();
  const report = () => {
    if (!accountIsCurrent(account)) return;

    job.progress = (job.done + [...partial.values()].reduce((a, b) => a + b, 0)) / Math.max(1, job.total);
    setJob(entry.id, { ...job });
  };
  report();
  const queue = pending.slice();
  const worker = async () => {
    for (let song = queue.shift(); song; song = queue.shift()) {
      if (!accountIsCurrent(account)) return;

      while (onCellular() && !settings().downloadOnCellular) {
        if (!accountIsCurrent(account)) return;

        setJob(entry.id, { ...job, waiting: true });
        await new Promise((r) => setTimeout(r, 15_000));
      }
      if (!useOffline.getState().collections.some((c) => c.id === entry.id)) return;
      const id = song.id;
      try {
        const bytes = await saveSong(account, cache, song, (f) => {
          if (!accountIsCurrent(account)) return;

          partial.set(id, f);
          report();
        });
        if (!accountIsCurrent(account)) return;

        useOffline.setState((s) => ({
          songs: new Map(s.songs).set(id, bytes),
        }));
        job.done++;
      } catch {
        if (!accountIsCurrent(account)) return;

        job.failed++;
      }
      partial.delete(id);
      job.waiting = false;
      report();
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  if (!accountIsCurrent(account)) return;

  setJob(entry.id, job.failed ? { ...job } : null);
}

async function songsOf(c: OfflineCollection): Promise<Song[]> {
  if (c.kind === "album") return (await sub.album(c.id)).song ?? [];
  if (c.kind === "playlist") return (await sub.playlist(c.id)).entry ?? [];
  return (await sub.starred()).song ?? [];
}

export async function resumeDownload(c: OfflineCollection) {
  const account = currentAccount();
  if (!account) return;

  await resumeDownloadForAccount(account, c);
}

async function resumeDownloadForAccount(account: AccountSnapshot, collection: OfflineCollection): Promise<void> {
  if (!accountIsCurrent(account)) return;

  const songs = await songsOf(collection);
  if (!accountIsCurrent(account)) return;

  await downloadForAccount(account, collection, songs);
}

export async function removeDownload(collectionId: string): Promise<void> {
  const account = currentAccount();
  if (!account) return;

  await removeDownloadForAccount(account, collectionId);
}

async function removeDownloadForAccount(account: AccountSnapshot, collectionId: string): Promise<void> {
  if (!accountIsCurrent(account)) return;

  const state = useOffline.getState();
  const target = state.collections.find((c) => c.id === collectionId);
  if (!target) return;
  const remaining = state.collections.filter((c) => c.id !== collectionId);
  const stillNeeded = new Set(remaining.flatMap((c) => c.songIds));
  const cache = await caches.open(offlineCacheName(account.accountUser));
  if (!accountIsCurrent(account)) return;

  const songs = new Map(state.songs);
  for (const id of target.songIds) {
    if (stillNeeded.has(id)) continue;
    if (!accountIsCurrent(account)) return;

    await cache.delete(key(id));
    if (!accountIsCurrent(account)) return;

    await idbDelete(account.accountUser, "songs", id);
    if (!accountIsCurrent(account)) return;

    songs.delete(id);
  }
  if (!accountIsCurrent(account)) return;

  await idbDelete(account.accountUser, "collections", collectionId);
  if (!accountIsCurrent(account)) return;

  setJob(collectionId, null);
  useOffline.setState({ collections: remaining, songs });
}

export async function removeAllDownloads() {
  const account = currentAccount();
  if (!account) return;

  const collections = useOffline.getState().collections.slice();
  for (const collection of collections) {
    if (!accountIsCurrent(account)) return;

    await removeDownloadForAccount(account, collection.id);
  }
  if (!accountIsCurrent(account)) return;

  if (offlineSupported) await caches.delete(offlineCacheName(account.accountUser));
  if (!accountIsCurrent(account)) return;

  useOffline.setState({ songs: new Map(), jobs: {} });
}

export function useIsDownloaded(collectionId: string | undefined): boolean {
  return useOffline((s) => Boolean(collectionId && s.collections.some((c) => c.id === collectionId)));
}
