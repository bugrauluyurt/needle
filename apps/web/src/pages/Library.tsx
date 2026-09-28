import { useMemo, useState } from "react";
import { useLocation, useSearchParams } from "react-router";
import type { Song } from "@needle/shared";
import { matchesTerms, queryTerms } from "@needle/shared";
import { RowHeader } from "../components/Cards.tsx";
import { CollectionBody, CollectionTools } from "../components/Collection.tsx";
import { Icon } from "../components/Icon.tsx";
import { FilterChips, LIBRARY_FILTERS, LibrarySource } from "../components/SearchResults.tsx";
import type { Filter } from "../components/SearchResults.tsx";
import { TrackList } from "../components/TrackList.tsx";
import { artistName } from "../lib/format.ts";
import { useDebounced } from "../lib/useDelayed.ts";
import { useIsMobile, usePageTone } from "../layout/Shell.tsx";
import { LIBRARY_SORTS, libraryEmptyText, ORIGINS, useLibraryEntries, useLibrarySort, useNewPlaylist } from "../layout/Sidebar.tsx";
import type { Origin } from "../layout/Sidebar.tsx";
import { SearchHeader } from "../layout/SearchHeader.tsx";
import { useLibrarySongs } from "../queries/hooks.ts";
import { useSpotifyLiked, useSpotifyOn } from "../queries/spotify.ts";
import type { CollectionView, LibraryFilter, SortKey } from "../state/ui.ts";

const KINDS: Partial<Record<Filter, LibraryFilter>> = { Albums: "albums", Artists: "artists", Playlists: "playlists" };
const CONTEXT = { kind: "search" as const, name: "Your library" };

function useSongs(origin: Origin, query: string): { songs: Song[]; pending: boolean } {
  const server = useLibrarySongs(origin !== "spotify");
  const spotify = useSpotifyLiked();
  return useMemo(() => {
    const terms = queryTerms(query);
    const mine = origin === "spotify" ? [] : (server.data ?? []);
    const liked = origin === "server" ? [] : (spotify.data ?? []);
    const songs = [...mine, ...liked].filter((s) => matchesTerms(terms, s.title, artistName(s), s.album));
    return { songs, pending: origin !== "spotify" && server.isPending };
  }, [origin, query, server.data, server.isPending, spotify.data]);
}

function AllSongs({ origin }: { origin: Origin }) {
  const { songs, pending } = useSongs(origin, "");
  if (pending) return <p className="muted source-note"><span className="spin" />Loading your songs…</p>;
  if (!songs.length) return <p className="muted">{origin === "spotify" ? "No liked songs on Spotify yet." : "No songs yet. Get music from Search."}</p>;
  return <TrackList songs={songs} context={CONTEXT} art album />;
}

function SpotifyMatches({ q, filter, kind, sort, view }: { q: string; filter: Filter; kind: LibraryFilter; sort: SortKey; view: CollectionView }) {
  const entries = useLibraryEntries(kind, q, sort, "spotify");
  const { songs } = useSongs("spotify", q);
  const shownSongs = filter === "All" || filter === "Songs" ? songs : [];
  const shownEntries = filter === "Songs" ? [] : entries;
  if (!shownSongs.length && !shownEntries.length) return <p className="muted source-note">Nothing in your Spotify library matches “{q}”.</p>;
  return (
    <section className="res-source bare" aria-label="In your Spotify library">
      {shownSongs.length ? (
        <>
          <RowHeader title="Liked songs on Spotify" />
          <TrackList songs={shownSongs} context={{ kind: "search", name: `Spotify library, “${q}”` }} art album />
        </>
      ) : null}
      {shownEntries.length ? (
        <>
          <RowHeader title="Saved on Spotify" />
          <CollectionBody items={shownEntries} view={view} empty="" />
        </>
      ) : null}
    </section>
  );
}

export default function LibraryPage() {
  const mobile = useIsMobile();
  const [filter, setFilter] = useState<Filter>("All");
  const [picked, setOrigin] = useState<Origin>("all");
  const [query, setQuery] = useState("");
  const q = useDebounced(query.trim(), 250);
  const [params] = useSearchParams();
  const location = useLocation();
  const find = params.has("find");
  const spotifyOn = useSpotifyOn();
  const origin: Origin = spotifyOn ? picked : "server";
  const kind = KINDS[filter] ?? null;
  const { sort, setSort, view, setView } = useLibrarySort(mobile ? "list" : "grid");
  const entries = useLibraryEntries(kind, "", sort, origin);
  const newPlaylist = useNewPlaylist();
  usePageTone(null);
  const create = <button type="button" className="icon-btn light" aria-label="Create playlist" onClick={newPlaylist}><Icon name="plus" size={24} /></button>;
  const show = spotifyOn ? { value: origin, options: ORIGINS, onChange: setOrigin } : undefined;
  const tools = (sorted: boolean) => (
    <div className="lib-tools">
      {sorted ? <CollectionTools sorts={LIBRARY_SORTS} sort={sort} onSort={setSort} view={view} onView={setView} show={show} /> : <CollectionTools sorts={[]} show={show} />}
    </div>
  );
  const body = q ? (
    <>
      {origin !== "spotify" ? <LibrarySource q={q} filter={filter} setFilter={setFilter} heading={false} /> : null}
      {origin !== "server" ? <SpotifyMatches q={q} filter={filter} kind={kind} sort={sort} view={view} /> : null}
    </>
  ) : filter === "Songs" ? (
    <AllSongs origin={origin} />
  ) : (
    <CollectionBody items={entries} view={view} empty={libraryEmptyText(kind, "")} />
  );
  return (
    <>
      <SearchHeader key={find ? location.key : "library"} autoFocus={find} title="Your library" label="Search in your library" placeholder="Search in your library" value={query} onChange={setQuery} actions={create} />
      <div className="pad library-page">
        {!mobile ? (
          <div className="library-head">
            <h1 className="hello">Your library</h1>
            {create}
          </div>
        ) : null}
        <FilterChips filters={LIBRARY_FILTERS} value={filter} onChange={setFilter} label="Filter your library" />
        {tools(!q && filter !== "Songs")}
        {body}
      </div>
    </>
  );
}
