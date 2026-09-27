import { useEffect, useState } from "react";

export function useDelayed(active: boolean, ms = 350): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!active) return;
    const t = window.setTimeout(() => setShown(true), ms);
    return () => {
      window.clearTimeout(t);
      setShown(false);
    };
  }, [active, ms]);
  return active && shown;
}

export function useDebounced<T>(value: T, ms = 450): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setSettled(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return settled;
}
