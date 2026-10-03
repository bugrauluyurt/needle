import * as Dialog from "@radix-ui/react-dialog";
import { useRef } from "react";
import type { CSSProperties, ReactNode, TouchEvent } from "react";

const FLICK_PX_PER_MS = 0.6;
const CLOSE_SHARE = 0.25;
const CLOSE_PX = 110;

export function useDragToClose(
  onClose: () => void,
  { follow = false }: { follow?: boolean } = {},
) {
  const ref = useRef<HTMLDivElement>(null);
  const start = useRef<{ y: number; t: number } | null>(null);
  const place = (dy: number | null) => {
    const el = follow ? ref.current : null;
    if (!el) return;
    el.style.transition = dy === null ? "" : "none";
    el.style.transform = dy === null ? "" : `translateY(${Math.max(0, dy)}px)`;
    el.style.setProperty("--drag-y", `${Math.max(0, dy ?? 0)}px`);
  };
  const handlers = {
    onTouchStart: (e: TouchEvent) => {
      const scroller = (e.target as HTMLElement).closest(".as-scroll");
      const y = e.touches[0]?.clientY;
      start.current =
        y === undefined || (scroller && scroller.scrollTop > 0)
          ? null
          : { y, t: e.timeStamp };
    },
    onTouchMove: (e: TouchEvent) => {
      const s = start.current;
      const y = e.touches[0]?.clientY;
      if (s && y !== undefined) place(y - s.y);
    },
    onTouchEnd: (e: TouchEvent) => {
      const s = start.current;
      start.current = null;
      if (!s) return;
      const dy = (e.changedTouches[0]?.clientY ?? s.y) - s.y;
      const far =
        dy >
        (follow && ref.current
          ? ref.current.offsetHeight * CLOSE_SHARE
          : CLOSE_PX);
      const flick = dy / Math.max(1, e.timeStamp - s.t) > FLICK_PX_PER_MS;
      if (dy > 0 && (far || flick)) onClose();
      else place(null);
    },
    onTouchCancel: () => {
      start.current = null;

      place(null);
    },
  };
  return { ref, handlers };
}

type Props = {
  open: boolean;
  onClose: () => void;
  label: string;
  tone?: string;
  children: ReactNode;
};

export function ActionSheet({ open, onClose, label, tone, children }: Props) {
  const { ref, handlers } = useDragToClose(onClose, { follow: true });
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="scrim as-scrim" />
        <Dialog.Content
          ref={ref}
          className="action-sheet"
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          style={tone ? ({ "--tone": tone } as CSSProperties) : undefined}
          {...handlers}
        >
          <Dialog.Title className="sr-only">{label}</Dialog.Title>
          <div className="as-handle" aria-hidden="true" />
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
