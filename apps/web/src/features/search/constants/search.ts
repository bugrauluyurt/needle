import type { YouTubeMusicSearchKind } from "@needle/shared";
import type { SpotifySearchKind } from "../../spotify/api/client.ts";
import type { Filter, SearchKind } from "../../../components/SearchResults.tsx";

export const GET_MUSIC_FILTERS: Record<"albums" | "songs", Filter[]> = {
  albums: ["All", "Albums", "Get music"],
  songs: ["All", "Songs", "Get music"],
};

export const SEARCH_KINDS = {
  Songs: "songs",
  Albums: "albums",
  Artists: "artists",
  Playlists: "playlists",
} as const satisfies Record<SearchKind, SpotifySearchKind & YouTubeMusicSearchKind>;
