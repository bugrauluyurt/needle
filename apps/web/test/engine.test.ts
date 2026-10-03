import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { EngineEvents } from "../src/player/engine.ts";

type RegisteredListener = {
  listener: EventListener;
  once: boolean;
};

class FakeAudioElement {
  static instances: FakeAudioElement[] = [];

  readonly buffered = {
    length: 0,
    start: () => 0,
    end: () => 0,
  };
  readonly listeners = new Map<string, RegisteredListener[]>();
  crossOrigin = "";
  currentTime = 0;
  duration = Number.NaN;
  ended = false;
  error: MediaError | null = null;
  preload = "";
  readyState = 0;
  src = "";
  volume = 1;

  constructor() {
    FakeAudioElement.instances.push(this);
  }

  addEventListener(eventName: string, listener: EventListener, options?: AddEventListenerOptions | boolean): void {
    const eventListeners = this.listeners.get(eventName) ?? [];
    const once = typeof options === "object" && options.once === true;

    eventListeners.push({ listener, once });
    this.listeners.set(eventName, eventListeners);
  }

  removeEventListener(eventName: string, listener: EventListener): void {
    const eventListeners = this.listeners.get(eventName) ?? [];

    this.listeners.set(
      eventName,
      eventListeners.filter((registeredListener) => registeredListener.listener !== listener),
    );
  }

  emit(eventName: string): void {
    const eventListeners = [...(this.listeners.get(eventName) ?? [])];

    for (const registeredListener of eventListeners) {
      registeredListener.listener(new Event(eventName));

      if (registeredListener.once) this.removeEventListener(eventName, registeredListener.listener);
    }
  }

  getAttribute(attributeName: string): string | null {
    return attributeName === "src" && this.src ? this.src : null;
  }

  load(): void {}

  pause(): void {}

  play(): Promise<void> {
    return Promise.resolve();
  }

  removeAttribute(attributeName: string): void {
    if (attributeName === "src") this.src = "";
  }
}

const events: EngineEvents = {
  time: vi.fn(),
  ended: vi.fn(),
  playing: vi.fn(),
  waiting: vi.fn(),
  error: vi.fn(),
};

beforeEach(() => {
  FakeAudioElement.instances = [];
  vi.clearAllMocks();
  vi.stubGlobal("Audio", FakeAudioElement);
});

afterEach(() => vi.unstubAllGlobals());

it("does not apply a released song's pending metadata seek to a reused audio element", async () => {
  const { AudioEngine } = await import("../src/player/engine.ts");
  const engine = new AudioEngine(events, false);
  const firstAudioElement = FakeAudioElement.instances[0] as FakeAudioElement;

  engine.load("/alice.flac", { autoplay: false, startAt: 42 });
  engine.stop();
  engine.load("/bob.flac", { autoplay: false });
  firstAudioElement.emit("loadedmetadata");

  expect(firstAudioElement.currentTime).toBe(0);
});
