import { useCallback, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";

type SliderProps = {
  value: number;
  max: number;
  onChange: (value: number) => void;
  onCommit?: (value: number) => void;
  label: string;
  valueText?: (value: number) => string;
  step?: number;
  needle?: boolean;
  buffered?: number;
  className?: string;
};

export function Slider({
  value,
  max,
  onChange,
  onCommit,
  label,
  valueText,
  step,
  needle = false,
  buffered,
  className,
}: SliderProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const shown = drag ?? value;
  const pct = max > 0 ? Math.min(100, Math.max(0, (shown / max) * 100)) : 0;

  const at = useCallback(
    (clientX: number) => {
      const r = ref.current?.getBoundingClientRect();
      if (!r || r.width === 0) return 0;
      return Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * max;
    },
    [max],
  );

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (max <= 0 || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const v = at(e.clientX);
    setDrag(v);
    onChange(v);
  };
  const moveTo = (e: PointerEvent<HTMLDivElement>) => {
    if (drag === null) return;
    const v = at(e.clientX);
    setDrag(v);
    onChange(v);
  };
  const up = (e: PointerEvent<HTMLDivElement>) => {
    if (drag === null) return;
    const v = at(e.clientX);
    setDrag(null);
    (onCommit ?? onChange)(v);
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const s = step ?? max / 20;
    const map: Record<string, number> = {
      ArrowRight: s,
      ArrowUp: s,
      ArrowLeft: -s,
      ArrowDown: -s,
      PageUp: s * 3,
      PageDown: -s * 3,
    };
    let v: number | null = null;
    if (e.key in map) v = value + (map[e.key] ?? 0);
    if (e.key === "Home") v = 0;
    if (e.key === "End") v = max;
    if (v === null) return;
    e.preventDefault();
    e.stopPropagation();
    const clamped = Math.min(max, Math.max(0, v));
    (onCommit ?? onChange)(clamped);
  };

  return (
    <div
      ref={ref}
      className={`slider ${drag !== null ? "dragging" : ""} ${className ?? ""}`}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Math.round(max)}
      aria-valuenow={Math.round(shown)}
      aria-valuetext={valueText?.(shown)}
      onPointerDown={down}
      onPointerMove={moveTo}
      onPointerUp={up}
      onPointerCancel={() => setDrag(null)}
      onKeyDown={key}
    >
      <div
        className="line"
        style={
          {
            "--p": `${pct}%`,
            "--b": `${buffered && max ? Math.min(100, (buffered / max) * 100) : 0}%`,
          } as React.CSSProperties
        }
      >
        {buffered !== undefined ? <s /> : null}
        <i />
        {needle ? max > 0 ? <b /> : null : <u />}
      </div>
    </div>
  );
}
