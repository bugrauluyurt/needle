import { useState } from "react";
import { useLocation, useSearchParams } from "react-router";
import { CollectionBody, CollectionTools } from "../components/Collection.tsx";
import { Icon } from "../components/Icon.tsx";
import { FilterChips, LIBRARY_FILTERS, LibrarySource } from "../components/SearchResults.tsx";
import type { Filter } from "../components/SearchResults.tsx";
import { TrackList } from "../components/TrackList.tsx";
import { useDebounced } from "../lib/useDelayed.ts";
import { useIsMobile, usePageTone } from "../layout/Shell.tsx";
import { LIBRARY_SORTS, libraryEmptyText, useLibraryEntries, useLibrarySort, useNewPlaylist } from "../layout/Sidebar.tsx";
import { SearchHeader } from "../layout/SearchHeader.tsx";
import { useLibrarySongs } from "../queries/hooks.ts";
import type { LibraryFilter } from "../state/ui.ts";

const KINDS: Partial<Record<Filter, LibraryFilter>> = { Albums: "albums", Artists: "artists", Playlists: "playlists" };
const CONTEXT = { kind: "search" as const, name: "Your library" };

function AllSongs() {
  const { data, isPending } = useLibrarySongs(true);
  if (isPending) return <p className="muted source-note"><span className="spin" />Loading your songs…</p>;
  if (!data?.length) return <p className="muted">No songs yet. Get music from Search.</p>;
  return <TrackList songs={data} context={CONTEXT} art album />;
}

export default function LibraryPage() {
  const mobile = useIsMobile();
  const [filter, setFilter] = useState<Filter>("All");
  const [query, setQuery] = useState("");
  const q = useDebounced(query.trim(), 250);
  const [params] = useSearchParams();
  const location = useLocation();
  const find = params.has("find");
  const kind = KINDS[filter] ?? null;
  const { sort, setSort, view, setView } = useLibrarySort(mobile ? "list" : "grid");
  const entries = useLibraryEntries(kind, "", sort);
  const newPlaylist = useNewPlaylist();
  usePageTone(null);
  const create = <button type="button" className="icon-btn light" aria-label="Create playlist" onClick={newPlaylist}><Icon name="plus" size={24} /></button>;
  const body = q ? (
    <LibrarySource q={q} filter={filter} setFilter={setFilter} heading={false} />
  ) : filter === "Songs" ? (
    <AllSongs />
  ) : (
    <>
      <div className="lib-tools">
        <CollectionTools sorts={LIBRARY_SORTS} sort={sort} onSort={setSort} view={view} onView={setView} />
      </div>
      <CollectionBody items={entries} view={view} empty={libraryEmptyText(kind, "")} />
    </>
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
        {body}
      </div>
    </>
  );
}
