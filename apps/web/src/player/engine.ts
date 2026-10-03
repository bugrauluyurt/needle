import { translate } from "../i18n/index.ts";

export type EngineEvents = {
  time: (position: number, duration: number, buffered: number) => void;
  ended: () => void;
  playing: (playing: boolean) => void;
  waiting: (waiting: boolean) => void;
  error: (message: string) => void;
};

type Graph = {
  ctx: AudioContext;
  gains: [GainNode, GainNode];
  master: GainNode;
};

const MIN_GAIN = 0.0001;

export function dbToGain(db: number | undefined, peak?: number): number {
  if (db === undefined || Number.isNaN(db)) return 1;
  const g = 10 ** (db / 20);
  return peak && peak > 0 ? Math.min(g, 1 / peak) : g;
}

export class AudioEngine {
  private readonly els: [HTMLAudioElement, HTMLAudioElement];
  private active: 0 | 1 = 0;
  private graph: Graph | null = null;
  private readonly useWebAudio: boolean;
  private readonly on: EngineEvents;
  private volume = 1;
  private gainTargets: [number, number] = [1, 1];
  private fadeTimer: number | null = null;
  private srcs: [string | null, string | null] = [null, null];

  constructor(on: EngineEvents, useWebAudio: boolean) {
    this.on = on;
    this.useWebAudio = useWebAudio;
    this.els = [this.makeElement(0), this.makeElement(1)];
  }

  private makeElement(slot: 0 | 1): HTMLAudioElement {
    const el = new Audio();
    el.preload = "auto";
    el.crossOrigin = "anonymous";
    const mine = () => slot === this.active;
    const time = () => {
      if (!mine()) return;
      const b = el.buffered.length ? el.buffered.end(el.buffered.length - 1) : 0;
      this.on.time(el.currentTime, Number.isFinite(el.duration) ? el.duration : 0, b);
    };
    el.addEventListener("timeupdate", time);
    el.addEventListener("durationchange", time);
    el.addEventListener("progress", time);
    el.addEventListener("ended", () => mine() && this.on.ended());
    el.addEventListener("playing", () => {
      if (!mine()) return;
      this.on.waiting(false);
      this.on.playing(true);
    });
    el.addEventListener("pause", () => mine() && !el.ended && this.on.playing(false));
    el.addEventListener("waiting", () => mine() && this.on.waiting(true));
    el.addEventListener("canplay", () => mine() && this.on.waiting(false));
    el.addEventListener("error", () => {
      if (!mine() || !el.getAttribute("src")) return;
      this.on.error(el.error?.message ?? "");
    });
    return el;
  }

  get element(): HTMLAudioElement {
    return this.els[this.active];
  }

  get currentSrc(): string | null {
    return this.srcs[this.active];
  }

  position(): number {
    return this.element.currentTime;
  }

  private ensureGraph() {
    if (!this.useWebAudio || this.graph) return;
    const Ctx = window.AudioContext as typeof AudioContext | undefined;
    if (!Ctx) return;
    const ctx = new Ctx({ latencyHint: "playback" });
    const master = ctx.createGain();
    master.connect(ctx.destination);
    const gains = this.els.map((el, i) => {
      const g = ctx.createGain();
      g.gain.value = this.gainTargets[i] ?? 1;
      ctx.createMediaElementSource(el).connect(g).connect(master);
      return g;
    }) as [GainNode, GainNode];
    this.graph = { ctx, gains, master };
    this.applyVolume();
  }

  private applyVolume() {
    const v = this.volume * this.volume;
    if (this.graph) {
      this.graph.master.gain.setTargetAtTime(v, this.graph.ctx.currentTime, 0.015);
      for (const el of this.els) el.volume = 1;
    } else {
      this.els.forEach((el, i) => {
        el.volume = Math.min(1, v * (this.gainTargets[i] ?? 1));
      });
    }
  }

  private setGain(slot: 0 | 1, value: number, rampSeconds = 0) {
    this.gainTargets[slot] = value;
    if (this.graph) {
      const g = this.graph.gains[slot].gain;
      const now = this.graph.ctx.currentTime;
      g.cancelScheduledValues(now);
      g.setValueAtTime(Math.max(g.value, MIN_GAIN), now);
      if (rampSeconds > 0) g.exponentialRampToValueAtTime(Math.max(value, MIN_GAIN), now + rampSeconds);
      else g.setValueAtTime(value, now);
    } else {
      this.els[slot].volume = Math.min(1, this.volume * this.volume * value);
    }
  }

  setVolume(volume: number) {
    this.volume = Math.min(1, Math.max(0, volume));
    this.applyVolume();
  }

  load(src: string, opts: { autoplay: boolean; startAt?: number; gain?: number }) {
    this.cancelFade();
    const other = (1 - this.active) as 0 | 1;
    if (this.srcs[other] === src) {
      this.releaseSlot(this.active);
      this.active = other;
    } else {
      this.releaseSlot(other);
      const el = this.element;
      this.srcs[this.active] = src;
      el.src = src;
      el.load();
    }
    this.setGain(this.active, opts.gain ?? 1);
    const el = this.element;
    if (opts.startAt) {
      const seek = () => {
        el.currentTime = opts.startAt ?? 0;
      };
      if (el.readyState >= 1) seek();
      else el.addEventListener("loadedmetadata", seek, { once: true });
    }
    this.on.time(opts.startAt ?? 0, Number.isFinite(el.duration) ? el.duration : 0, 0);
    if (opts.autoplay) void this.play();
  }

  preload(src: string) {
    const other = (1 - this.active) as 0 | 1;
    if (this.srcs[other] === src) return;
    this.srcs[other] = src;
    const el = this.els[other];
    el.src = src;
    el.load();
  }

  clearPreload() {
    this.cancelFade();

    this.releaseSlot((1 - this.active) as 0 | 1);
  }

  isPreloaded(src: string): boolean {
    return this.srcs[(1 - this.active) as 0 | 1] === src;
  }

  crossfade(src: string, seconds: number, gain: number) {
    this.ensureGraph();
    this.cancelFade();
    const from = this.active;
    const to = (1 - from) as 0 | 1;
    if (this.srcs[to] !== src) this.preload(src);
    this.setGain(to, MIN_GAIN);
    this.active = to;
    const incoming = this.els[to];
    incoming.currentTime = 0;
    void incoming
      .play()
      .then(() => {
        this.setGain(to, gain, seconds);
        this.setGain(from, MIN_GAIN, seconds);
      })
      .catch(() => undefined);
    this.fadeTimer = window.setTimeout(
      () => {
        this.fadeTimer = null;
        this.releaseSlot(from);
      },
      seconds * 1000 + 150,
    );
  }

  get fading(): boolean {
    return this.fadeTimer !== null;
  }

  private cancelFade() {
    if (this.fadeTimer === null) return;
    window.clearTimeout(this.fadeTimer);
    this.fadeTimer = null;
    this.releaseSlot((1 - this.active) as 0 | 1);
    this.setGain(this.active, this.gainTargets[this.active] < 0.01 ? 1 : this.gainTargets[this.active]);
  }

  private releaseSlot(slot: 0 | 1) {
    const el = this.els[slot];
    el.pause();
    if (this.srcs[slot]) {
      el.removeAttribute("src");
      el.load();
    }
    this.srcs[slot] = null;
  }

  async play(): Promise<void> {
    this.ensureGraph();
    if (this.graph?.ctx.state === "suspended") await this.graph.ctx.resume().catch(() => undefined);
    try {
      await this.element.play();
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      this.on.playing(false);
      if (e instanceof DOMException && e.name === "NotAllowedError") return;
      this.on.error(e instanceof Error ? e.message : translate("player.playbackFailed"));
    }
  }

  pause() {
    this.cancelFade();
    this.element.pause();
  }

  seek(seconds: number) {
    const el = this.element;
    if (!Number.isFinite(seconds)) return;
    el.currentTime = Math.max(0, Math.min(seconds, Number.isFinite(el.duration) ? el.duration - 0.25 : seconds));
  }

  stop() {
    this.cancelFade();
    this.releaseSlot(0);
    this.releaseSlot(1);
    this.on.time(0, 0, 0);
  }
}
