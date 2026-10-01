import { useMemo, useState } from "react";
import { useLocation, useSearchParams } from "react-router";
import type { Song } from "@needle/shared";
import { RowHeader } from "../components/Cards.tsx";
import { CollectionBody, CollectionTools } from "../components/Collection.tsx";
import { Icon } from "../components/Icon.tsx";
import { FilterChips, LIBRARY_FILTERS, LibrarySource } from "../components/SearchResults.tsx";
import type { Filter } from "../components/SearchResults.tsx";
import { TrackList } from "../components/TrackList.tsx";
import { AS_GIVEN, LIBRARY_SONG_SORTS, LIKED_SORTS, RECENT_FIRST, shownSongs } from "../lib/songs.ts";
import type { SongOrder } from "../lib/songs.ts";
import { useDebounced } from "../lib/useDelayed.ts";
import { useIsMobile, usePageTone } from "../layout/Shell.tsx";
import { LIBRARY_SORTS, libraryEmptyText, useLibraryEntries, useLibraryOrigin, useLibrarySort, useNewPlaylist } from "../layout/Sidebar.tsx";
import { SearchHeader } from "../layout/SearchHeader.tsx";
import { useLibrarySongs } from "../queries/hooks.ts";
import { useSpotifyLiked } from "../queries/spotify.ts";
import type { CollectionOrder } from "../components/Collection.tsx";
import type { CollectionView, LibraryFilter, LibraryOrigin } from "../state/ui.ts";

const KINDS: Partial<Record<Filter, LibraryFilter>> = { Albums: "albums", Artists: "artists", Playlists: "playlists" };
const CONTEXT = { kind: "search" as const, name: "Your library" };

function useSongs(origin: LibraryOrigin, query: string, order: SongOrder): { songs: Song[]; pending: boolean } {
  const server = useLibrarySongs(origin !== "spotify");
  const spotify = useSpotifyLiked();
  return useMemo(() => {
    const mine = origin === "spotify" ? [] : (server.data ?? []);
    const liked = origin === "server" ? [] : (spotify.data ?? []);
    return { songs: shownSongs([...mine, ...liked], order, query), pending: origin !== "spotify" && server.isPending };
  }, [origin, query, order, server.data, server.isPending, spotify.data]);
}

function AllSongs({ origin, order, onOrder }: { origin: LibraryOrigin; order: SongOrder; onOrder: (o: SongOrder) => void }) {
  const { songs, pending } = useSongs(origin, "", order);
  if (pending) return <p className="muted source-note"><span className="spin" />Loading your songs…</p>;
  if (!songs.length) return <p className="muted">{origin === "spotify" ? "No liked songs on Spotify yet." : "No songs yet. Get music from Search."}</p>;
  return <TrackList songs={songs} context={CONTEXT} art album order={order} onOrder={onOrder} fallback={RECENT_FIRST} />;
}

function SpotifyMatches({ q, filter, kind, order, view }: { q: string; filter: Filter; kind: LibraryFilter; order: CollectionOrder; view: CollectionView }) {
  const entries = useLibraryEntries(kind, q, order, "spotify");
  const { songs } = useSongs("spotify", q, AS_GIVEN);
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
  const [songOrder, setSongOrder] = useState<SongOrder>(RECENT_FIRST);
  const [query, setQuery] = useState("");
  const q = useDebounced(query.trim(), 250);
  const [params] = useSearchParams();
  const location = useLocation();
  const find = params.has("find");
  const { origin, show } = useLibraryOrigin();
  const visibleSongOrder = origin !== "server" && !LIKED_SORTS.some(([songSort]) => songSort === songOrder.key) ? RECENT_FIRST : songOrder;
  const kind = KINDS[filter] ?? null;
  const { order, setOrder, view, setView } = useLibrarySort(mobile ? "list" : "grid");
  const entries = useLibraryEntries(kind, "", order, origin);
  const newPlaylist = useNewPlaylist();
  usePageTone(null);
  const create = <button type="button" className="icon-btn light" aria-label="Create playlist" onClick={newPlaylist}><Icon name="plus" size={24} /></button>;
  const tools = q ? (
    <CollectionTools sorts={[]} show={show} />
  ) : filter === "Songs" ? (
    <CollectionTools sorts={origin === "server" ? LIBRARY_SONG_SORTS : LIKED_SORTS} order={visibleSongOrder} onOrder={setSongOrder} show={show} />
  ) : (
    <CollectionTools sorts={LIBRARY_SORTS} order={order} onOrder={setOrder} view={view} onView={setView} show={show} />
  );
  const body = q ? (
    <>
      {origin !== "spotify" ? <LibrarySource q={q} filter={filter} setFilter={setFilter} heading={false} /> : null}
      {origin !== "server" ? <SpotifyMatches q={q} filter={filter} kind={kind} order={order} view={view} /> : null}
    </>
  ) : filter === "Songs" ? (
    <AllSongs origin={origin} order={visibleSongOrder} onOrder={setSongOrder} />
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
        <div className="lib-tools">{tools}</div>
        {body}
      </div>
    </>
  );
}
