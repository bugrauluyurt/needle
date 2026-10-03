import { useEffect, useState } from "react";
import { coverUrl } from "./subsonic.ts";
import { useSettings } from "../state/settings.ts";

export const DEFAULT_TONE = "#3a2a5a";
const SAMPLE = 24;
const cache = new Map<string, string>();
const pending = new Map<string, Promise<string>>();

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

export function toneFromPixels(data: Uint8ClampedArray): string {
  const buckets = new Map<number, { w: number; h: number; s: number; l: number }>();
  let grey = { w: 0, l: 0 };
  for (let i = 0; i < data.length; i += 4) {
    if ((data[i + 3] ?? 0) < 128) continue;
    const [h, s, l] = rgbToHsl(data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0);
    if (s < 0.12 || l < 0.08 || l > 0.94) {
      grey = { w: grey.w + 1, l: grey.l + l };
      continue;
    }
    const bucket = Math.round(h / 20) % 18;
    const weight = s * (1 - Math.abs(l - 0.5));
    const b = buckets.get(bucket) ?? { w: 0, h: 0, s: 0, l: 0 };
    buckets.set(bucket, { w: b.w + weight, h: b.h + h * weight, s: b.s + s * weight, l: b.l + l * weight });
  }
  const best = [...buckets.values()].sort((a, b) => b.w - a.w)[0];
  if (!best || best.w < 0.6)
    return hslToHex(260, 0.12, grey.w ? Math.min(0.32, Math.max(0.2, (grey.l / grey.w) * 0.5)) : 0.26);
  const h = best.h / best.w;
  const s = Math.min(0.62, Math.max(0.28, best.s / best.w));
  const l = Math.min(0.4, Math.max(0.26, (best.l / best.w) * 0.72));
  return hslToHex(h, s, l);
}

function extract(id: string): Promise<string> {
  const hit = cache.get(id);
  if (hit) return Promise.resolve(hit);
  const inflight = pending.get(id);
  if (inflight) return inflight;
  const url = coverUrl(id, SAMPLE * 2);
  if (!url) return Promise.resolve(DEFAULT_TONE);
  const p = new Promise<string>((resolve) => {
    const img = new Image();
    img.decoding = "async";
    if (url.startsWith("https://")) img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = SAMPLE;
        canvas.height = SAMPLE;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return resolve(DEFAULT_TONE);
        ctx.drawImage(img, 0, 0, SAMPLE, SAMPLE);
        resolve(toneFromPixels(ctx.getImageData(0, 0, SAMPLE, SAMPLE).data));
      } catch {
        resolve(DEFAULT_TONE);
      }
    };
    img.onerror = () => resolve(DEFAULT_TONE);
    img.src = url;
  }).then((tone) => {
    cache.set(id, tone);
    pending.delete(id);
    return tone;
  });
  pending.set(id, p);
  return p;
}

export function useTone(coverArt: string | undefined, fallback = DEFAULT_TONE): string {
  const enabled = useSettings((s) => s.artColor);
  const [resolved, setResolved] = useState<string | null>(null);
  useEffect(() => {
    if (!coverArt || !enabled) return;
    let live = true;
    void extract(coverArt).then((t) => live && setResolved(t));
    return () => {
      live = false;
    };
  }, [coverArt, enabled]);
  if (!enabled || !coverArt) return fallback;
  return cache.get(coverArt) ?? resolved ?? fallback;
}
