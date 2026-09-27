import { createContext, useContext } from "react";
import type { RefObject } from "react";

export const ScrollContext = createContext<RefObject<HTMLElement | null> | null>(null);

export const useScrollContainer = () => useContext(ScrollContext);
