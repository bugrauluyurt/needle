import { createContext, useContext, useEffect } from "react";
import { DEFAULT_TONE } from "../lib/tone.ts";

const PageToneContext = createContext<(tone: string) => void>(() => undefined);

export const PageToneProvider = PageToneContext.Provider;

export function usePageTone(tone: string | null) {
  const setPageTone = useContext(PageToneContext);

  useEffect(() => setPageTone(tone ?? DEFAULT_TONE), [tone, setPageTone]);
}
