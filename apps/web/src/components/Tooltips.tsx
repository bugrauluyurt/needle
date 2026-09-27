import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Tip = { text: string; key: string | null; x: number; y: number; below: boolean };

const DELAY = 450;
const EDGE = 8;
const SKIP = ".hover-play, .q-play, .row-play, [data-no-tip]";

function tipFor(el: Element): Tip | null {
  const text = el.getAttribute("aria-label");
  if (!text || el.textContent?.trim() || el.matches(SKIP)) return null;
  const r = el.getBoundingClientRect();
  const below = r.top < 56;
  return { text, key: el.getAttribute("data-key"), x: r.left + r.width / 2, y: below ? r.bottom + 8 : r.top - 8, below };
}

export function Tooltips() {
  const [tip, setTip] = useState<Tip | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    let timer = 0;
    let current: Element | null = null;
    const hide = () => {
      window.clearTimeout(timer);
      current = null;
      setTip(null);
    };
    const over = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const el = (e.target as Element | null)?.closest("button[aria-label], a[aria-label]") ?? null;
      if (el === current) return;
      hide();
      current = el;
      if (el) timer = window.setTimeout(() => setTip(tipFor(el)), DELAY);
    };
    const focus = (e: FocusEvent) => {
      const el = e.target as Element;
      if (el.matches(":focus-visible") && el.matches("button[aria-label], a[aria-label]")) setTip(tipFor(el));
    };
    window.addEventListener("pointerover", over);
    window.addEventListener("pointerdown", hide, true);
    window.addEventListener("keydown", hide, true);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("focusin", focus);
    window.addEventListener("focusout", hide);
    return () => {
      hide();
      window.removeEventListener("pointerover", over);
      window.removeEventListener("pointerdown", hide, true);
      window.removeEventListener("keydown", hide, true);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("focusin", focus);
      window.removeEventListener("focusout", hide);
    };
  }, []);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !tip) return;
    const w = el.offsetWidth;
    const left = Math.min(Math.max(tip.x - w / 2, EDGE), window.innerWidth - w - EDGE);
    el.style.left = `${left}px`;
  }, [tip]);

  if (!tip) return null;
  return createPortal(
    <div ref={box} role="tooltip" className={`tooltip ${tip.below ? "below" : ""}`} style={{ top: tip.y }}>
      {tip.text}
      {tip.key ? <kbd>{tip.key}</kbd> : null}
    </div>,
    document.body,
  );
}
