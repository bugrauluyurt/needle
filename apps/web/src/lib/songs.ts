import type { Song } from "@needle/shared";
import { matchesTerms, queryTerms } from "@needle/shared";
import { artistName } from "./format.ts";
import { applyOrder, compareText, naturalOrder } from "./order.ts";
import type { Order } from "./order.ts";

export type SongSort = "custom" | "added" | "title" | "artist" | "album" | "duration" | "plays";
export type SongOrder = Order<SongSort>;

export const AS_GIVEN: SongOrder = { key: "custom", desc: false };
export const RECENT_FIRST: SongOrder = naturalOrder("added");

export const SONG_SORTS: [SongSort, string][] = [["custom", "Custom order"], ["added", "Date added"], ["title", "Title"], ["artist", "Artist"], ["album", "Album"]];
export const LIKED_SORTS = SONG_SORTS.filter(([k]) => k !== "custom");

const added = (s: Song) => s.starred ?? s.created ?? "";
const COMPARE: Record<Exclude<SongSort, "custom">, (a: Song, b: Song) => number> = {
  added: (a, b) => added(a).localeCompare(added(b)),
  title: (a, b) => compareText(a.title, b.title),
  artist: (a, b) => compareText(artistName(a), artistName(b)) || compareText(a.album ?? "", b.album ?? ""),
  album: (a, b) => compareText(a.album ?? "", b.album ?? "") || (a.track ?? 0) - (b.track ?? 0),
  duration: (a, b) => (a.duration ?? 0) - (b.duration ?? 0),
  plays: (a, b) => (a.playCount ?? 0) - (b.playCount ?? 0),
};

export function shownSongs(songs: Song[], order: SongOrder, query: string): Song[] {
  const terms = queryTerms(query);
  const found = terms.length ? songs.filter((s) => matchesTerms(terms, s.title, artistName(s), s.album)) : songs;
  return order.key === "custom" ? found : applyOrder(found, COMPARE[order.key], order.desc);
}
