import { create } from "zustand";
import type { Song } from "@needle/shared";

export const useDetails = create<{ song: Song | null }>(() => ({ song: null }));

export const openSongDetails = (song: Song) => useDetails.setState({ song });
