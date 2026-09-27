import type { Song } from "@needle/shared";
import { matchesTerms, queryTerms } from "@needle/shared";
import { artistName } from "./format.ts";

export type SongSort = "custom" | "added" | "title" | "artist" | "album";

export const SONG_SORTS: [SongSort, string][] = [["custom", "Custom order"], ["added", "Recently added"], ["title", "Title"], ["artist", "Artist"], ["album", "Album"]];
export const LIKED_SORTS = SONG_SORTS.filter(([k]) => k !== "custom");

const compare = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
const added = (s: Song) => s.starred ?? s.created ?? "";
const ORDER: Record<Exclude<SongSort, "custom">, (a: Song, b: Song) => number> = {
  added: (a, b) => added(b).localeCompare(added(a)),
  title: (a, b) => compare(a.title, b.title),
  artist: (a, b) => compare(artistName(a), artistName(b)) || compare(a.album ?? "", b.album ?? ""),
  album: (a, b) => compare(a.album ?? "", b.album ?? "") || (a.track ?? 0) - (b.track ?? 0),
};

export function shownSongs(songs: Song[], sort: SongSort, query: string): Song[] {
  const terms = queryTerms(query);
  const found = terms.length ? songs.filter((s) => matchesTerms(terms, s.title, artistName(s), s.album)) : songs;
  return sort === "custom" ? found : found.toSorted(ORDER[sort]);
}
