import type { InternetRadioStation, Song } from "@needle/shared";
import { api } from "../lib/api.ts";
import { isIOS } from "../lib/device.ts";
import { artistName } from "../lib/format.ts";
import { coverUrl, sub, subsonicUrl } from "../lib/subsonic.ts";
import { offlineSource } from "../offline/store.ts";
import { settings } from "../state/settings.ts";
import { useSession } from "../state/session.ts";
import type { Quality } from "../state/settings.ts";
import { AudioEngine, dbToGain } from "./engine.ts";
import { prepareSpotify, spotifyPlayer } from "./spotify.ts";
import { isSpotify, rawId } from "../lib/spotify.ts";
import { spotifyArtistSongs } from "../queries/spotify.ts";
import { toast } from "../state/ui.ts";
import { progress } from "./progress.ts";
import * as Q from "./queue.ts";
import type { PlayContext, PlayerState, ResumeOffer } from "./store.ts";
import { current, usePlayer } from "./store.ts";

const PRELOAD_AT = 30;
const MIN_REPORT_MS = 30_000;
const SCROBBLE_CAP_MS = 240_000;
const RESTART_THRESHOLD = 3;
const SAVE_DELAY = 5_000;
const RESUME_WINDOW_MS = 7 * 86_400_000;
const AUTOPLAY_BATCH = 40;
const RADIO_ALBUMS = 6;
const SAVED_AT = "needle.queueSavedAt";
const CLOCK_SLACK_MS = 3_000;

export const canCrossfade = !isIOS;

let engine: AudioEngine | null = null;
let backend: "local" | "spotify" = "local";
let spotifyTicker: number | null = null;
const SPOTIFY_TICK = 500;
let loadedUid: string | null = null;
let listenedMs = 0;
let lastTick = 0;
let scrobbled = false;
let reported = false;
let saveTimer: number | null = null;
let dirty = false;
let dismissed = "";
let lastPositionSave = 0;
let lastSessionPosition = 0;
const resolved = new Map<string, string>();
const objectUrls = new Set<string>();

const set = (patch: Partial<PlayerState>) => usePlayer.setState(patch);
const onSpotify = (song: Song | null | undefined) => song?.source === "spotify";
const position = () => (backend === "spotify" ? spotifyPlayer.position() : (engine?.position() ?? 0));
const get = () => usePlayer.getState();

function codecFor(): string {
  const probe = document.createElement("audio");
  if (probe.canPlayType('audio/ogg; codecs="opus"') && !isIOS) return "opus";
  if (probe.canPlayType("audio/aac")) return "aac";
  return "mp3";
}
let codec: string | null = null;

function quality(): Quality {
  const conn = (navigator as Navigator & { connection?: { type?: string } }).connection;
  const s = settings();
  return conn?.type === "cellular" ? s.cellularQuality : s.wifiQuality;
}

export function streamUrl(song: Song, q: Quality = quality()): string {
  if (q === "original") return subsonicUrl("stream", { id: song.id });
  codec ??= codecFor();
  return subsonicUrl("stream", { id: song.id, format: codec, maxBitRate: Number(q), estimateContentLength: true });
}

async function sourceFor(item: Q.QueueItem): Promise<string> {
  const cached = resolved.get(item.uid);
  if (cached) return cached;
  const offline = await offlineSource(item.song.id);
  const src = offline ?? streamUrl(item.song);
  if (offline) objectUrls.add(offline);
  resolved.set(item.uid, src);
  return src;
}

function releaseSources(keep: Set<string>) {
  for (const [uid, src] of resolved) {
    if (keep.has(uid)) continue;
    resolved.delete(uid);
    if (objectUrls.delete(src)) URL.revokeObjectURL(src);
  }
}

function gainFor(song: Song): number {
  const mode = settings().normalize;
  if (mode === "off" || !song.replayGain) return 1;
  const rg = song.replayGain;
  return mode === "album"
    ? dbToGain(rg.albumGain ?? rg.trackGain, rg.albumPeak ?? rg.trackPeak)
    : dbToGain(rg.trackGain ?? rg.albumGain, rg.trackPeak ?? rg.albumPeak);
}

function crossfadeSeconds(): number {
  const s = get();
  const cf = settings().crossfade;
  if (!canCrossfade || cf <= 0) return 0;
  if (s.context?.kind === "album" && !s.shuffle) return 0;
  return cf;
}

function finishListen() {
  const song = current();
  if (!song || reported || listenedMs < MIN_REPORT_MS) return;
  reported = true;
  void api.reportPlay({
    songId: song.id,
    title: song.title,
    artist: artistName(song),
    ...(song.artistId ? { artistId: song.artistId } : {}),
    album: song.album ?? "",
    ...(song.albumId ? { albumId: song.albumId } : {}),
    ...(song.genre ? { genre: song.genre } : {}),
    ...(song.coverArt ? { coverArt: song.coverArt } : {}),
    duration: song.duration ?? 0,
    msPlayed: listenedMs,
    device: useSession.getState().deviceName,
  }).catch(() => undefined);
}

function beginListen(item: Q.QueueItem, announce: boolean) {
  loadedUid = item.uid;
  listenedMs = 0;
  lastTick = performance.now();
  scrobbled = false;
  reported = false;
  updateMediaSession(item.song);
  if (announce && !onSpotify(item.song)) void sub.scrobble(item.song.id, false).catch(() => undefined);
}

async function loadCurrent(autoplay: boolean, startAt = 0) {
  const s = get();
  const item = s.items[s.index];
  if (!engine) return;
  if (!item) {
    engine.stop();
    loadedUid = null;
    set({ playing: false });
    return;
  }
  finishListen();
  beginListen(item, autoplay);
  set({ playing: autoplay, error: null, station: null, buffering: autoplay });
  if (onSpotify(item.song)) {
    engine.stop();
    backend = "spotify";
    progress.set({ position: startAt, duration: item.song.duration ?? 0, buffered: 0 });
    if (autoplay) await startSpotify(item, startAt);
    scheduleSave();
    return;
  }
  if (backend === "spotify") leaveSpotify();
  const src = await sourceFor(item);
  if (get().items[get().index]?.uid !== item.uid) return;
  engine.load(src, { autoplay, startAt, gain: gainFor(item.song) });
  const nextIdx = Q.nextIndex(get(), get().repeat);
  releaseSources(new Set([item.uid, ...(nextIdx !== null ? [get().items[nextIdx]?.uid ?? ""] : [])]));
  scheduleSave();
}

function spotifyEvents() {
  return {
    state: ({ paused }: { paused: boolean }) => {
      if (backend !== "spotify") return;
      set({ playing: !paused, buffering: false });
    },
    ended: () => {
      if (backend === "spotify") onEnded();
    },
    error: (message: string) => {
      if (backend === "spotify") set({ error: message, playing: false, buffering: false });
    },
  };
}

const connectSpotify = () => prepareSpotify(`Needle ${useSession.getState().deviceName}`, spotifyEvents());

export function warmSpotify() {
  void connectSpotify().catch(() => undefined);
}

function tickSpotify() {
  if (backend !== "spotify") return;
  const song = current();
  const duration = spotifyPlayer.duration() || (song?.duration ?? 0);
  onTime(Math.min(spotifyPlayer.position(), duration), duration, duration);
}

async function startSpotify(item: Q.QueueItem, startAt: number) {
  if (!item.song.uri) {
    onError("This song has no Spotify link.");
    return;
  }
  try {
    await connectSpotify();
    if (get().items[get().index]?.uid !== item.uid) return;
    spotifyPlayer.setVolume(get().muted ? 0 : get().volume);
    await spotifyPlayer.play(item.song.uri, startAt);
    spotifyTicker ??= window.setInterval(tickSpotify, SPOTIFY_TICK);
  } catch (e) {
    set({ playing: false, buffering: false, error: e instanceof Error ? e.message : "Spotify couldn’t play that song" });
  }
}

function leaveSpotify() {
  spotifyPlayer.stop();
  if (spotifyTicker !== null) window.clearInterval(spotifyTicker);
  spotifyTicker = null;
  backend = "local";
}

function onTime(position: number, duration: number, buffered: number) {
  progress.set({ position, duration, buffered });
  const s = get();
  if (s.station || !engine) return;
  const now = performance.now();
  if (s.playing) {
    const delta = now - lastTick;
    if (delta > 0 && delta < 1500) listenedMs += delta;
    dirty = true;
  }
  lastTick = now;

  const song = current(s);
  if (!song) return;
  if (!scrobbled && !onSpotify(song) && listenedMs >= Math.min((song.duration ?? duration) * 500, SCROBBLE_CAP_MS)) {
    scrobbled = true;
    void sub.scrobble(song.id, true).catch(() => undefined);
  }
  if (now - lastPositionSave > SAVE_DELAY) {
    lastPositionSave = now;
    set({ lastPosition: position });
  }
  if (now - lastSessionPosition > 1000) {
    lastSessionPosition = now;
    setPositionState(position, duration);
  }

  const remaining = duration - position;
  const nextIdx = s.repeat === "one" ? null : Q.nextIndex(s, s.repeat);
  const next = nextIdx !== null ? s.items[nextIdx] : undefined;
  if (!next || onSpotify(next.song) || !duration || !s.playing) return;
  if (onSpotify(song)) {
    if (remaining < PRELOAD_AT && !resolved.has(next.uid)) void sourceFor(next).then((src) => engine?.preload(src));
    return;
  }
  const cf = crossfadeSeconds();
  if (cf > 0 && remaining <= cf && !engine.fading && duration > cf * 2) {
    const src = resolved.get(next.uid);
    if (src) {
      finishListen();
      set({ index: nextIdx as number });
      beginListen(next, true);
      engine.crossfade(src, cf, gainFor(next.song));
      scheduleSave();
      return;
    }
  }
  if (remaining < PRELOAD_AT && !resolved.has(next.uid)) {
    void sourceFor(next).then((src) => {
      if (settings().gapless || crossfadeSeconds() > 0) engine?.preload(src);
    });
  }
}

function onEnded() {
  const s = get();
  if (s.station) return;
  if (s.repeat === "one") {
    finishListen();
    const item = s.items[s.index];
    if (item) beginListen(item, true);
    if (backend === "spotify" && item) {
      void startSpotify(item, 0);
      return;
    }
    engine?.seek(0);
    void engine?.play();
    return;
  }
  void next();
}

function onError(message: string) {
  const s = get();
  if (s.station) {
    set({ error: `${s.station.name} isn't responding`, playing: false });
    return;
  }
  const song = current(s);
  const detail = message.trim() || "The file couldn’t be played.";
  set({ error: song ? `Couldn’t play “${song.title}”. ${detail}` : detail });
  const n = Q.nextIndex(s, s.repeat === "one" ? "off" : s.repeat);
  if (n !== null && n !== s.index) window.setTimeout(() => void next(), 1200);
  else set({ playing: false });
}

async function appendSimilar(): Promise<boolean> {
  const song = current();
  if (!song || onSpotify(song)) return false;
  const have = new Set(get().items.map((i) => i.song.id));
  let songs = (await sub.similarSongs(song.id, AUTOPLAY_BATCH).catch(() => [])).filter((x) => !have.has(x.id));
  if (songs.length < 5) songs = (await sub.randomSongs(AUTOPLAY_BATCH, song.genre).catch(() => [])).filter((x) => !have.has(x.id));
  if (!songs.length) return false;
  set({ items: [...get().items, ...songs.map((x) => Q.makeItem(x))] });
  return true;
}

export async function next() {
  const s = get();
  if (s.station) return;
  let n = Q.nextIndex(s, s.repeat);
  if (n === null && settings().autoplay && (await appendSimilar())) n = get().index + 1;
  if (n === null) {
    finishListen();
    engine?.pause();
    engine?.seek(0);
    if (backend === "spotify") spotifyPlayer.pause();
    set({ playing: false });
    return;
  }
  set({ index: n });
  await loadCurrent(true);
}

export async function previous() {
  const s = get();
  if (s.station) return;
  if (position() > RESTART_THRESHOLD) {
    seek(0);
    return;
  }
  const p = Q.previousIndex(s, s.repeat);
  if (p === null) {
    seek(0);
    return;
  }
  set({ index: p });
  await loadCurrent(true);
}

export function playSongs(songs: Song[], startIndex = 0, context: PlayContext | null = null, opts: { shuffle?: boolean } = {}) {
  if (!songs.length) return;
  spotifyPlayer.activate();
  const shuffle = opts.shuffle ?? get().shuffle;
  set({ ...Q.start(songs, startIndex, shuffle), shuffle, context, station: null, resume: null });
  void loadCurrent(true);
}

export function playQueueItem(uid: string) {
  const i = get().items.findIndex((it) => it.uid === uid);
  if (i < 0) return;
  spotifyPlayer.activate();
  set({ index: i });
  void loadCurrent(true);
}

export function toggle() {
  const s = get();
  if (!engine) return;
  if (s.playing) {
    pause();
    return;
  }
  if (s.station) {
    set({ playing: true });
    void engine.play();
    return;
  }
  const item = s.items[s.index];
  if (!item) return;
  spotifyPlayer.activate();
  if (onSpotify(item.song)) {
    if (backend === "spotify" && loadedUid === item.uid && spotifyPlayer.playingUri === item.song.uri) {
      set({ playing: true });
      lastTick = performance.now();
      spotifyPlayer.resume();
    } else void loadCurrent(true, s.lastPosition);
    return;
  }
  if (loadedUid !== item.uid || !engine.currentSrc) {
    void loadCurrent(true, s.lastPosition);
    return;
  }
  set({ playing: true });
  lastTick = performance.now();
  void engine.play();
  if (!scrobbled) void sub.scrobble(item.song.id, false).catch(() => undefined);
}

export function play() {
  if (!get().playing) toggle();
}

export function pause() {
  const at = position();
  engine?.pause();
  if (backend === "spotify") spotifyPlayer.pause();
  set({ playing: false, lastPosition: at });
  saveNow();
}

export function seek(seconds: number) {
  if (backend === "spotify") spotifyPlayer.seek(seconds);
  else engine?.seek(seconds);
  progress.set({ position: seconds });
  set({ lastPosition: seconds });
  scheduleSave();
}

export function seekBy(delta: number) {
  seek(position() + delta);
}

export function setVolume(volume: number) {
  const v = Math.min(1, Math.max(0, volume));
  set({ volume: v, muted: v === 0 });
  engine?.setVolume(v);
  spotifyPlayer.setVolume(v);
}

export function toggleMute() {
  const s = get();
  const muted = !s.muted;
  set({ muted });
  engine?.setVolume(muted ? 0 : s.volume || 0.5);
  spotifyPlayer.setVolume(muted ? 0 : s.volume || 0.5);
}

export function setShuffle(on: boolean) {
  const s = get();
  set({ ...Q.setShuffle(s, on), shuffle: on });
  scheduleSave();
}

export function cycleRepeat() {
  const order = ["off", "all", "one"] as const;
  set({ repeat: order[(order.indexOf(get().repeat) + 1) % order.length] });
}

export function addToQueue(songs: Song[]) {
  const s = get();
  const wasEmpty = !s.items.length;
  set(Q.addToQueue(s, songs));
  if (wasEmpty) void loadCurrent(true);
  scheduleSave();
}

export function playNext(songs: Song[]) {
  const s = get();
  const wasEmpty = !s.items.length;
  set(Q.playNext(s, songs));
  if (wasEmpty) void loadCurrent(true);
  scheduleSave();
}

export function removeFromQueue(uid: string) {
  set(Q.remove(get(), uid));
  scheduleSave();
}

export function moveInQueue(uid: string, toIndex: number) {
  set(Q.move(get(), uid, toIndex));
  scheduleSave();
}

export function clearUserQueue() {
  set(Q.clearUserQueue(get()));
  scheduleSave();
}

export function playStation(station: InternetRadioStation) {
  if (!engine) return;
  finishListen();
  if (backend === "spotify") leaveSpotify();
  loadedUid = null;
  set({ station, playing: true, buffering: true, error: null });
  const c = useSession.getState().credentials;
  const src = c ? `/radio/${encodeURIComponent(station.id)}?${new URLSearchParams({ u: c.user, t: c.token, s: c.salt }).toString()}` : station.streamUrl;
  engine.load(src, { autoplay: true, gain: 1 });
  if ("mediaSession" in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: station.name, artist: "Internet radio", album: "Needle" });
  }
}

async function similarTo(id: string, genre: string | undefined): Promise<Song[]> {
  const similar = await sub.similarSongs(id, 60).catch(() => [] as Song[]);
  return similar.length < 5 && genre ? sub.randomSongs(60, genre).catch(() => []) : similar;
}

async function spotifyRadio(artistId: string): Promise<Song[]> {
  const { songs } = await spotifyArtistSongs(rawId(artistId), RADIO_ALBUMS).catch(() => ({ songs: [] as Song[] }));
  return Q.shuffleArray(songs);
}

export async function startRadio(seed: { song?: Song; artistId?: string; name: string }) {
  const id = seed.song?.id ?? seed.artistId;
  if (!id) return;
  const artistId = seed.artistId ?? seed.song?.artistId;
  const pool = isSpotify(id) ? (artistId ? await spotifyRadio(artistId) : []) : await similarTo(id, seed.song?.genre);
  const songs = seed.song ? [seed.song, ...pool.filter((x) => x.id !== seed.song?.id)] : pool;
  if (songs.length < 2) {
    toast(`Couldn’t find songs for ${seed.name} radio`);
    return;
  }
  playSongs(songs, 0, { kind: "radio", name: `${seed.name} radio` }, { shuffle: false });
}

export function acceptResume() {
  const offer = get().resume;
  if (!offer) return;
  set({ ...Q.start(offer.songs, offer.index, false), shuffle: false, context: { kind: "queue", name: "Your queue" }, resume: null });
  void loadCurrent(true, offer.position);
}

export function dismissResume() {
  dismissed = get().resume?.changed ?? "";
  set({ resume: null });
}

function scheduleSave() {
  dirty = true;
  if (saveTimer !== null) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(saveNow, SAVE_DELAY);
}

function saveNow() {
  if (saveTimer !== null) window.clearTimeout(saveTimer);
  saveTimer = null;
  const s = get();
  const song = current(s);
  if (!dirty || !song || s.station || onSpotify(song)) return;
  dirty = false;
  const ids = s.items.slice(Math.max(0, s.index - 100), s.index + 400).filter((i) => !onSpotify(i.song)).map((i) => i.song.id);
  void sub.savePlayQueue(ids, song.id, Math.round((engine?.position() ?? s.lastPosition) * 1000)).then(() => {
    try {
      localStorage.setItem(SAVED_AT, String(Date.now()));
    } catch {
      return;
    }
  }, () => {
    dirty = true;
  });
}

function updateMediaSession(song: Song) {
  if (!("mediaSession" in navigator)) return;
  const art = [96, 192, 256, 512].map((size) => ({ src: coverUrl(song.coverArt, size) ?? "", sizes: `${size}x${size}`, type: "image/jpeg" })).filter((a) => a.src);
  navigator.mediaSession.metadata = new MediaMetadata({ title: song.title, artist: artistName(song), album: song.album ?? "", artwork: art });
}

function setPositionState(position: number, duration: number) {
  if (!("mediaSession" in navigator) || !duration || !Number.isFinite(duration)) return;
  try {
    navigator.mediaSession.setPositionState({ duration, position: Math.min(position, duration), playbackRate: 1 });
  } catch {
    return;
  }
}

function bindMediaSession() {
  if (!("mediaSession" in navigator)) return;
  const ms = navigator.mediaSession;
  const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
    ["play", () => play()],
    ["pause", () => pause()],
    ["previoustrack", () => void previous()],
    ["nexttrack", () => void next()],
    ["seekto", (d) => d.seekTime !== undefined && seek(d.seekTime)],
    ["seekbackward", (d) => seekBy(-(d.seekOffset ?? 10))],
    ["seekforward", (d) => seekBy(d.seekOffset ?? 10)],
    ["stop", () => pause()],
  ];
  for (const [action, handler] of handlers) {
    try {
      ms.setActionHandler(action, handler);
    } catch {
      continue;
    }
  }
  usePlayer.subscribe((s, prev) => {
    if (s.playing !== prev.playing) ms.playbackState = s.playing ? "playing" : "paused";
  });
}

async function offerResume() {
  const q = await sub.playQueue().catch(() => null);
  if (!q?.entry?.length || !q.current) return;
  const index = q.entry.findIndex((e) => e.id === q.current);
  if (index < 0) return;
  const s = get();
  const position = (q.position ?? 0) / 1000;
  if (!s.items.length) {
    set({ ...Q.start(q.entry, index, false), lastPosition: position, context: { kind: "queue", name: "Your queue" } });
    return;
  }
  const changed = q.changed ? Date.parse(q.changed) : 0;
  const savedHere = Number((() => {
    try {
      return localStorage.getItem(SAVED_AT);
    } catch {
      return null;
    }
  })() ?? 0);
  if (changed <= savedHere + CLOCK_SLACK_MS || Date.now() - changed > RESUME_WINDOW_MS || q.changed === dismissed) return;
  if (current(s)?.id === q.current && Math.abs(s.lastPosition - position) < 5) return;
  const offer: ResumeOffer = { songs: q.entry, index, position, changedBy: (q.changedBy ?? "another device").replace(/^Needle /, ""), changed: q.changed ?? "" };
  set({ resume: offer });
}

export function startPlayer() {
  if (engine) return;
  engine = new AudioEngine({
    time: onTime,
    ended: onEnded,
    playing: (playing) => set({ playing, ...(playing ? { buffering: false } : {}) }),
    waiting: (buffering) => set({ buffering }),
    error: onError,
  }, canCrossfade);
  const s = get();
  engine.setVolume(s.muted ? 0 : s.volume);
  set({ playing: false, buffering: false, station: null });
  const song = current(s);
  if (song) {
    progress.set({ position: s.lastPosition, duration: song.duration ?? 0 });
    updateMediaSession(song);
  }
  bindMediaSession();
  void offerResume();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      if (!get().playing) void offerResume();
      return;
    }
    finishListen();
    saveNow();
  });
  window.addEventListener("pagehide", () => {
    finishListen();
    saveNow();
  });
}

export const player = {
  playSongs, playQueueItem, toggle, play, pause, next, previous, seek, seekBy, setVolume, toggleMute,
  setShuffle, cycleRepeat, addToQueue, playNext, removeFromQueue, moveInQueue, clearUserQueue,
  playStation, startRadio, acceptResume, dismissResume,
};
