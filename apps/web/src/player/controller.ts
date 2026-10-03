import type { InternetRadioStation, Song } from "@needle/shared";
import { DAY_MS, isLocalSong, musicSource, songSource, youtubeMusicRawId } from "@needle/shared";
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
import { rawId } from "../features/spotify/api/client.ts";
import { ytm } from "../features/youtube-music/api/client.ts";
import { spotifyArtistSongs } from "../features/spotify/hooks/useSpotify.ts";
import { toast } from "../state/ui.ts";
import { progress } from "./progress.ts";
import * as Q from "./queue.ts";
import type { PlayContext, PlayerState, ResumeOffer } from "./store.ts";
import { current, usePlayer } from "./store.ts";
import { translate } from "../i18n/index.ts";

const PRELOAD_AT = 30;
export const MIN_REPORT_MS = 30_000;
export const SEEK_STEP_S = 10;
const SCROBBLE_CAP_MS = 240_000;
const RESTART_THRESHOLD = 3;
const SAVE_DELAY = 5_000;
const RESUME_WINDOW_MS = 7 * DAY_MS;
const AUTOPLAY_BATCH = 40;
const RADIO_ALBUMS = 6;
const SAVED_AT = "needle.queueSavedAt";
const CLOCK_SLACK_MS = 3_000;
const RESUME_CHECK_MS = 30_000;

export const canCrossfade = !isIOS;

let engine: AudioEngine | null = null;
let backend: "local" | "spotify" = "local";
let spotifyTicker: number | null = null;
const SPOTIFY_TICK = 500;
let loadedUid: string | null = null;
let listenedSong: Song | null = null;
let listenedMs = 0;
let lastTick = 0;
let scrobbled = false;
let reported = false;
let saveTimer: number | null = null;
let dirty = false;
let dismissed = "";
let lastPositionSave = 0;
let lastSessionPosition = 0;
let accountGeneration = 0;
const resolved = new Map<string, string>();
const objectUrls = new Set<string>();

const set = (patch: Partial<PlayerState>) => usePlayer.setState(patch);
const onSpotify = (song: Song | null | undefined) => Boolean(song && songSource(song) === "spotify");
const onYouTubeMusic = (song: Song | null | undefined) => Boolean(song && songSource(song) === "youtubeMusic");
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
  if (onYouTubeMusic(song)) {
    if (!youtubeMusicAllowed) throw new Error(translate("player.youtubeUnavailable"));

    const credentials = useSession.getState().credentials;
    if (!credentials) throw new Error(translate("player.signInYouTube"));

    const query = new URLSearchParams({
      u: credentials.user,
      t: credentials.token,
      s: credentials.salt,
    });

    return `/youtube-music/stream/${encodeURIComponent(youtubeMusicRawId(song.id))}?${query.toString()}`;
  }

  if (!isLocalSong(song)) throw new Error(translate("player.spotifyOnly"));

  if (q === "original") return subsonicUrl("stream", { id: song.id });
  codec ??= codecFor();
  return subsonicUrl("stream", {
    id: song.id,
    format: codec,
    maxBitRate: Number(q),
    estimateContentLength: true,
  });
}

async function sourceFor(item: Q.QueueItem, sourceGeneration = accountGeneration): Promise<string | null> {
  const cached = resolved.get(item.uid);
  if (cached) return cached;
  const offline = isLocalSong(item.song) ? await offlineSource(item.song.id) : null;

  if (sourceGeneration !== accountGeneration) {
    if (offline) URL.revokeObjectURL(offline);

    return null;
  }

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
  if (!isLocalSong(song) || mode === "off" || !song.replayGain) return 1;
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
  const song = listenedSong;
  if (!song || reported || listenedMs < MIN_REPORT_MS) return;
  reported = true;
  void api
    .reportPlay({
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
    })
    .catch(() => undefined);
}

function beginListen(item: Q.QueueItem, announce: boolean) {
  loadedUid = item.uid;
  listenedSong = item.song;
  listenedMs = 0;
  lastTick = performance.now();
  scrobbled = false;
  reported = false;
  updateMediaSession(item.song);
  if (announce && isLocalSong(item.song)) void sub.scrobble(item.song.id, false).catch(() => undefined);
}

async function loadCurrent(autoplay: boolean, startAt = 0) {
  const loadGeneration = accountGeneration;
  const s = get();
  const item = s.items[s.index];
  if (!engine) return;
  if (!item) {
    finishListen();
    listenedSong = null;
    listenedMs = 0;

    engine.stop();
    loadedUid = null;
    set({ playing: false });
    return;
  }

  finishListen();

  if (item.song.isAvailable === false || (onYouTubeMusic(item.song) && !youtubeMusicAllowed)) {
    if (backend === "spotify") leaveSpotify();

    engine.stop();
    loadedUid = null;
    listenedSong = null;
    listenedMs = 0;
    set({
      playing: false,
      buffering: false,
      error: translate(item.song.isAvailable === false ? "player.unavailableYouTube" : "player.youtubeUnavailable"),
    });

    return;
  }

  beginListen(item, autoplay);
  set({ playing: autoplay, error: null, station: null, buffering: autoplay });
  if (onSpotify(item.song)) {
    engine.stop();
    backend = "spotify";
    progress.set({
      position: startAt,
      duration: item.song.duration ?? 0,
      buffered: 0,
    });
    if (autoplay) await startSpotify(item, startAt, loadGeneration);
    if (loadGeneration !== accountGeneration) return;

    scheduleSave();
    return;
  }
  if (backend === "spotify") leaveSpotify();
  const src = await sourceFor(item).catch((error: unknown) => {
    if (loadGeneration === accountGeneration && get().items[get().index]?.uid === item.uid)
      onError(error instanceof Error ? error.message : translate("player.streamFailed"));

    return null;
  });
  if (!src || loadGeneration !== accountGeneration) return;
  if (get().items[get().index]?.uid !== item.uid) return;
  if (onYouTubeMusic(item.song) && !youtubeMusicAllowed) return;

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
    lost: () => {
      if (backend !== "spotify") return;
      stopSpotifyTicker();
      set({
        playing: false,
        buffering: false,
        lastPosition: spotifyPlayer.position(),
      });
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

let spotifyAllowed = false;
let youtubeMusicAllowed = false;

export function allowYouTubeMusic(on: boolean) {
  youtubeMusicAllowed = on;
  if (on) return;

  const playerState = get();
  const nextIndex = Q.nextIndex(playerState, playerState.repeat);
  const previousIndex = Q.previousIndex(playerState, playerState.repeat);
  if (
    (nextIndex !== null && onYouTubeMusic(playerState.items[nextIndex]?.song)) ||
    (engine?.fading && previousIndex !== null && onYouTubeMusic(playerState.items[previousIndex]?.song))
  )
    engine?.clearPreload();

  for (const queueItem of playerState.items) {
    if (onYouTubeMusic(queueItem.song)) resolved.delete(queueItem.uid);
  }

  if (playerState.station || !onYouTubeMusic(current(playerState))) return;

  finishListen();
  engine?.stop();
  loadedUid = null;
  listenedSong = null;
  listenedMs = 0;
  set({ playing: false, buffering: false });
}

export function allowSpotify(on: boolean) {
  spotifyAllowed = on;
  if (!on && backend === "spotify") leaveSpotify();
}

async function startSpotify(item: Q.QueueItem, startAt: number, loadGeneration: number) {
  if (!spotifyAllowed) {
    onError(translate("player.spotifyUnavailable"));
    return;
  }
  if (!item.song.uri) {
    onError(translate("player.noSpotifyLink"));
    return;
  }
  try {
    await connectSpotify();
    if (loadGeneration !== accountGeneration || get().items[get().index]?.uid !== item.uid) return;

    spotifyPlayer.setVolume(get().muted ? 0 : get().volume);
    await spotifyPlayer.play(item.song.uri, startAt);
    if (loadGeneration !== accountGeneration) {
      spotifyPlayer.stop();

      return;
    }

    spotifyTicker ??= window.setInterval(tickSpotify, SPOTIFY_TICK);
  } catch (e) {
    if (loadGeneration !== accountGeneration) return;

    set({
      playing: false,
      buffering: false,
      error: e instanceof Error ? e.message : translate("player.spotifyFailed"),
    });
  }
}

function stopSpotifyTicker() {
  if (spotifyTicker !== null) window.clearInterval(spotifyTicker);
  spotifyTicker = null;
}

function leaveSpotify() {
  spotifyPlayer.stop();
  stopSpotifyTicker();
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
  if (!scrobbled && isLocalSong(song) && listenedMs >= Math.min((song.duration ?? duration) * 500, SCROBBLE_CAP_MS)) {
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
  if (
    !next ||
    onSpotify(next.song) ||
    next.song.isAvailable === false ||
    (onYouTubeMusic(next.song) && !youtubeMusicAllowed) ||
    !duration ||
    !s.playing
  )
    return;
  if (onSpotify(song)) {
    if (remaining < PRELOAD_AT && !resolved.has(next.uid))
      void sourceFor(next, accountGeneration)
        .then((src) => {
          if (src && (!onYouTubeMusic(next.song) || youtubeMusicAllowed)) engine?.preload(src);
        })
        .catch(() => undefined);
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
    void sourceFor(next, accountGeneration)
      .then((src) => {
        if (
          src &&
          (!onYouTubeMusic(next.song) || youtubeMusicAllowed) &&
          (settings().gapless || crossfadeSeconds() > 0)
        )
          engine?.preload(src);
      })
      .catch(() => undefined);
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
      void startSpotify(item, 0, accountGeneration);
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
    set({
      error: translate("player.stationFailed", { name: s.station.name }),
      playing: false,
    });
    return;
  }
  const song = current(s);
  const detail = message.trim() || translate("player.fileFailed");
  set({
    error: song ? translate("player.playFailed", { title: song.title, detail }) : detail,
  });
  if (onYouTubeMusic(song)) {
    engine?.stop();
    loadedUid = null;
    set({ playing: false, buffering: false });

    return;
  }

  const n = Q.nextIndex(s, s.repeat === "one" ? "off" : s.repeat);
  if (n !== null && n !== s.index) window.setTimeout(() => void next(), 1200);
  else set({ playing: false });
}

async function appendSimilar(): Promise<boolean> {
  const appendGeneration = accountGeneration;
  const song = current();
  if (!song || !isLocalSong(song)) return false;
  const have = new Set(get().items.map((i) => i.song.id));
  let songs = (await sub.similarSongs(song.id, AUTOPLAY_BATCH).catch(() => [])).filter((x) => !have.has(x.id));

  if (appendGeneration !== accountGeneration) return false;

  if (songs.length < 5) {
    songs = (await sub.randomSongs(AUTOPLAY_BATCH, song.genre).catch(() => [])).filter((x) => !have.has(x.id));
  }

  if (appendGeneration !== accountGeneration) return false;
  if (!songs.length) return false;

  set({ items: [...get().items, ...songs.map((x) => Q.makeItem(x))] });

  return true;
}

export async function next() {
  const nextGeneration = accountGeneration;
  const s = get();
  if (s.station) return;
  let n = Q.nextIndex(s, s.repeat);
  if (n === null && settings().autoplay && (await appendSimilar())) n = get().index + 1;
  if (nextGeneration !== accountGeneration) return;
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

export function playSongs(
  songs: Song[],
  startIndex = 0,
  context: PlayContext | null = null,
  opts: { shuffle?: boolean; at?: number; autoplay?: boolean } = {},
) {
  if (!songs.length) return;

  const shuffle = opts.shuffle ?? get().shuffle;
  const selectedIndex = shuffle
    ? songs[startIndex]
      ? startIndex
      : 0
    : Math.max(0, Math.min(startIndex, songs.length - 1));
  const selectedSong = songs[selectedIndex];
  if (!selectedSong || selectedSong.isAvailable === false || (onYouTubeMusic(selectedSong) && !youtubeMusicAllowed)) {
    toast(translate(selectedSong?.isAvailable === false ? "player.unavailableYouTube" : "player.youtubeUnavailable"));

    return;
  }

  const playableSongs = songs.filter(
    (song) => song.isAvailable !== false && (!onYouTubeMusic(song) || youtubeMusicAllowed),
  );
  const playableIndex = songs
    .slice(0, selectedIndex)
    .filter((song) => song.isAvailable !== false && (!onYouTubeMusic(song) || youtubeMusicAllowed)).length;

  spotifyPlayer.activate();
  const at = opts.at ?? 0;
  set({
    ...Q.start(playableSongs, playableIndex, shuffle),
    shuffle,
    context,
    station: null,
    resume: null,
    lastPosition: at,
  });
  void loadCurrent(opts.autoplay ?? true, at);
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

  if (item.song.isAvailable === false || (onYouTubeMusic(item.song) && !youtubeMusicAllowed)) {
    void loadCurrent(true, s.lastPosition);

    return;
  }

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
  if (!scrobbled && isLocalSong(item.song)) void sub.scrobble(item.song.id, false).catch(() => undefined);
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
  const playableSongs = songs.filter(
    (song) => song.isAvailable !== false && (!onYouTubeMusic(song) || youtubeMusicAllowed),
  );
  if (!playableSongs.length) return;

  const s = get();
  const wasEmpty = !s.items.length;
  set(Q.addToQueue(s, playableSongs));
  if (wasEmpty) void loadCurrent(true);
  scheduleSave();
}

export function playNext(songs: Song[]) {
  const playableSongs = songs.filter(
    (song) => song.isAvailable !== false && (!onYouTubeMusic(song) || youtubeMusicAllowed),
  );
  if (!playableSongs.length) return;

  const s = get();
  const wasEmpty = !s.items.length;
  set(Q.playNext(s, playableSongs));
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
  listenedSong = null;
  listenedMs = 0;

  if (backend === "spotify") leaveSpotify();
  loadedUid = null;
  set({ station, playing: true, buffering: true, error: null });
  const c = useSession.getState().credentials;
  const src = c
    ? `/radio/${encodeURIComponent(station.id)}?${new URLSearchParams({ u: c.user, t: c.token, s: c.salt }).toString()}`
    : station.streamUrl;
  engine.load(src, { autoplay: true, gain: 1 });
  if ("mediaSession" in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: station.name,
      artist: translate("player.internetRadio"),
      album: "Needle",
    });
  }
}

async function similarTo(id: string, genre: string | undefined, radioGeneration: number): Promise<Song[]> {
  const similar = await sub.similarSongs(id, 60).catch(() => [] as Song[]);

  if (radioGeneration !== accountGeneration) return [];

  return similar.length < 5 && genre ? sub.randomSongs(60, genre).catch(() => []) : similar;
}

async function spotifyRadio(artistId: string): Promise<Song[]> {
  const { songs } = await spotifyArtistSongs(rawId(artistId), RADIO_ALBUMS).catch(() => ({ songs: [] as Song[] }));
  return Q.shuffleArray(songs);
}

export async function startRadio(seed: { song?: Song; artistId?: string; name: string }) {
  const radioGeneration = accountGeneration;
  const id = seed.song?.id ?? seed.artistId;
  if (!id) return;
  const artistId = seed.artistId ?? seed.song?.artistId;
  const source = seed.song ? songSource(seed.song) : musicSource(id);
  if (source === "youtubeMusic" && !youtubeMusicAllowed) {
    toast(translate("player.youtubeUnavailable"));

    return;
  }

  const pool =
    source === "youtubeMusic"
      ? await (seed.song ? ytm.radio(id) : ytm.artist(id).then((artistDetail) => artistDetail.songs)).catch(
          () => [] as Song[],
        )
      : source === "spotify"
        ? artistId
          ? await spotifyRadio(artistId)
          : []
        : await similarTo(id, seed.song?.genre, radioGeneration);

  if (radioGeneration !== accountGeneration) return;

  const songs = seed.song ? [seed.song, ...pool.filter((x) => x.id !== seed.song?.id)] : pool;
  if (songs.length < 2) {
    toast(translate("player.radioNotFound", { name: seed.name }));
    return;
  }
  playSongs(songs, 0, { kind: "radio", name: translate("player.radioName", { name: seed.name }) }, { shuffle: false });
}

export function acceptResume() {
  const offer = get().resume;
  if (!offer) return;
  set({
    ...Q.start(offer.songs, offer.index, false),
    shuffle: false,
    context: { kind: "queue", name: translate("player.queueName") },
    resume: null,
  });
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
  const saveGeneration = accountGeneration;
  const song = current(s);
  if (!dirty || !song || s.station || !isLocalSong(song)) return;
  dirty = false;
  const ids = s.items
    .slice(Math.max(0, s.index - 100), s.index + 400)
    .filter((queueItem) => isLocalSong(queueItem.song))
    .map((queueItem) => queueItem.song.id);
  void sub.savePlayQueue(ids, song.id, Math.round((engine?.position() ?? s.lastPosition) * 1000)).then(
    () => {
      if (saveGeneration !== accountGeneration) return;

      try {
        localStorage.setItem(SAVED_AT, String(Date.now()));
      } catch {
        return;
      }
    },
    () => {
      if (saveGeneration !== accountGeneration) return;

      dirty = true;
    },
  );
}

function updateMediaSession(song: Song) {
  if (!("mediaSession" in navigator)) return;
  const art = [96, 192, 256, 512]
    .map((size) => ({
      src: coverUrl(song.coverArt, size) ?? "",
      sizes: `${size}x${size}`,
      type: "image/jpeg",
    }))
    .filter((a) => a.src);
  navigator.mediaSession.metadata = new MediaMetadata({
    title: song.title,
    artist: artistName(song),
    album: song.album ?? "",
    artwork: art,
  });
}

function setPositionState(position: number, duration: number) {
  if (!("mediaSession" in navigator) || !duration || !Number.isFinite(duration)) return;
  try {
    navigator.mediaSession.setPositionState({
      duration,
      position: Math.min(position, duration),
      playbackRate: 1,
    });
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
    ["seekbackward", (d) => seekBy(-(d.seekOffset ?? SEEK_STEP_S))],
    ["seekforward", (d) => seekBy(d.seekOffset ?? SEEK_STEP_S)],
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

let resumeCheckedAt = 0;

async function offerResume() {
  if (Date.now() - resumeCheckedAt < RESUME_CHECK_MS) return;

  const resumeGeneration = accountGeneration;
  resumeCheckedAt = Date.now();
  const q = await sub.playQueue().catch(() => null);

  if (resumeGeneration !== accountGeneration) return;
  if (!q?.entry?.length || !q.current) return;
  const index = q.entry.findIndex((e) => e.id === q.current);
  if (index < 0) return;
  const s = get();
  const position = (q.position ?? 0) / 1000;
  if (!s.items.length) {
    set({
      ...Q.start(q.entry, index, false),
      lastPosition: position,
      context: { kind: "queue", name: translate("player.queueName") },
    });
    return;
  }
  const changed = q.changed ? Date.parse(q.changed) : 0;
  const savedHere = Number(
    (() => {
      try {
        return localStorage.getItem(SAVED_AT);
      } catch {
        return null;
      }
    })() ?? 0,
  );
  if (changed <= savedHere + CLOCK_SLACK_MS || Date.now() - changed > RESUME_WINDOW_MS || q.changed === dismissed)
    return;
  if (current(s)?.id === q.current && Math.abs(s.lastPosition - position) < 5) return;
  const offer: ResumeOffer = {
    songs: q.entry,
    index,
    position,
    changedBy: (q.changedBy ?? translate("player.anotherDevice")).replace(/^Needle /, ""),
    changed: q.changed ?? "",
  };
  set({ resume: offer });
}

export function resetPlayerAccount(): void {
  accountGeneration++;

  if (saveTimer !== null) window.clearTimeout(saveTimer);
  saveTimer = null;

  engine?.stop();
  spotifyPlayer.dispose();
  stopSpotifyTicker();
  backend = "local";
  loadedUid = null;
  listenedSong = null;
  listenedMs = 0;
  lastTick = 0;
  scrobbled = false;
  reported = false;
  dirty = false;
  dismissed = "";
  lastPositionSave = 0;
  lastSessionPosition = 0;
  resumeCheckedAt = 0;
  spotifyAllowed = false;
  youtubeMusicAllowed = false;
  releaseSources(new Set());

  const { volume, muted } = get();
  set({
    items: [],
    index: -1,
    original: null,
    context: null,
    shuffle: false,
    repeat: "off",
    playing: false,
    buffering: false,
    volume,
    muted,
    station: null,
    lastPosition: 0,
    resume: null,
    error: null,
  });
  progress.set({ position: 0, duration: 0, buffered: 0 });

  if ("mediaSession" in navigator) {
    navigator.mediaSession.metadata = null;
    navigator.mediaSession.playbackState = "none";
  }

  try {
    localStorage.removeItem(SAVED_AT);
  } catch {
    return;
  }
}

export function startPlayer() {
  if (engine) {
    void offerResume();

    return;
  }
  engine = new AudioEngine(
    {
      time: onTime,
      ended: onEnded,
      playing: (playing) => set({ playing, ...(playing ? { buffering: false } : {}) }),
      waiting: (buffering) => set({ buffering }),
      error: onError,
    },
    canCrossfade,
  );
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
  playSongs,
  playQueueItem,
  toggle,
  play,
  pause,
  next,
  previous,
  seek,
  seekBy,
  setVolume,
  toggleMute,
  setShuffle,
  cycleRepeat,
  addToQueue,
  playNext,
  removeFromQueue,
  moveInQueue,
  clearUserQueue,
  playStation,
  startRadio,
  acceptResume,
  dismissResume,
};
