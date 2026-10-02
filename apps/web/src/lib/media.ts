import { useSyncExternalStore } from "react";

const MOBILE = "(max-width: 767px)";
const WIDE = "(min-width: 1180px)";

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export const useIsMobile = () => useMediaQuery(MOBILE);

export const useIsWide = () => useMediaQuery(WIDE);
