import { memo, useState } from "react";
import { coverUrl } from "../lib/subsonic.ts";
import { hashPalette } from "../lib/palette.ts";
import { image } from "../lib/spotify.ts";
import type { SpImage } from "../lib/spotify.ts";
import { Icon } from "./Icon.tsx";

const dpr = typeof window === "undefined" ? 1 : Math.min(3, window.devicePixelRatio || 1);
const LARGEST = 900;
const STEPS = [64, 128, 256, 384, 600, LARGEST];

export function artSize(cssPx: number): number {
  const want = cssPx * dpr;
  return STEPS.find((s) => s >= want) ?? LARGEST;
}

type ArtProps = {
  id?: string | undefined;
  images?: SpImage[] | null | undefined;
  version?: string | undefined;
  px: number;
  round?: boolean;
  className?: string;
  alt?: string;
  eager?: boolean;
  fallback?: "album" | "artist";
};

export function RecordArt({ seed }: { seed: string }) {
  const [, label] = hashPalette(seed);
  return (
    <svg className="art-record" viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r="40" fill="#0f0e13" />
      {[34, 28, 22].map((r) => <circle key={r} cx="50" cy="50" r={r} className="groove" />)}
      <path d="M22.3 34A32 32 0 0 1 39.1 19.9" className="sheen" />
      <circle cx="50" cy="50" r="13" fill={label} />
      <circle cx="50" cy="50" r="2.2" fill="#0f0e13" />
    </svg>
  );
}

function ArtImpl({ id, images, version, px, round = false, className, alt = "", eager = false, fallback = "album" }: ArtProps) {
  const url = images ? (image(images, artSize(px)) ?? null) : coverUrl(id, artSize(px), version);
  const [state, setState] = useState<"loading" | "done" | "failed">("loading");
  const cls = ["art", round ? "round" : "", state === "done" ? "loaded" : "", className ?? ""].filter(Boolean).join(" ");
  return (
    <div className={cls}>
      {url && state !== "failed" ? (
        <img
          key={url}
          src={url}
          alt={alt}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          draggable={false}
          onLoad={() => setState("done")}
          onError={() => setState("failed")}
        />
      ) : null}
      {state === "failed" || !url ? (
        <span className="art-fallback">
          {fallback === "artist" ? <Icon name="user" size={Math.max(18, Math.min(48, px / 3))} /> : <RecordArt seed={id ?? alt} />}
        </span>
      ) : null}
    </div>
  );
}

export const Art = memo(ArtImpl);

type Tile = { key: string; id?: string; images?: SpImage[] };

export function Collage({ ids = [], urls = [], px, className, eager = false }: { ids?: (string | undefined)[]; urls?: string[]; px: number; className?: string; eager?: boolean }) {
  const tiles: Tile[] = [
    ...urls.map((url) => ({ key: url, images: [{ url }] })),
    ...ids.filter((id): id is string => Boolean(id)).map((id) => ({ key: id, id })),
  ].slice(0, 4);
  if (tiles.length < 4) {
    const first = tiles[0];
    return <Art id={first?.id} images={first?.images} px={px} eager={eager} {...(className ? { className } : {})} />;
  }
  return (
    <div className={`art collage ${className ?? ""}`}>
      {tiles.map(({ key, ...tile }) => (
        <Art key={key} {...tile} px={px / 2} eager={eager} />
      ))}
    </div>
  );
}

export function LikedArt({ className }: { className?: string }) {
  return (
    <div className={`art liked-art ${className ?? ""}`}>
      <Icon name="heartFill" size={44} />
    </div>
  );
}
