import { create } from "zustand";

export const useUpdate = create<{ apply: (() => void) | null }>(() => ({ apply: null }));
