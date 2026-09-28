import { useState } from "react";
import { useLocation, useSearchParams } from "react-router";
import { CollectionBody, CollectionTools } from "../components/Collection.tsx";
import { Icon } from "../components/Icon.tsx";
import { useIsMobile, usePageTone } from "../layout/Shell.tsx";
import { LIBRARY_SORTS, LibraryChips, libraryEmptyText, useLibraryEntries, useLibrarySort, useNewPlaylist } from "../layout/Sidebar.tsx";
import { SearchHeader } from "../layout/SearchHeader.tsx";
import { useUi } from "../state/ui.ts";

export default function LibraryPage() {
  const mobile = useIsMobile();
  const filter = useUi((s) => s.libraryFilter);
  const [query, setQuery] = useState("");
  const [params] = useSearchParams();
  const location = useLocation();
  const find = params.has("find");
  const { sort, setSort, view, setView } = useLibrarySort(mobile ? "list" : "grid");
  const entries = useLibraryEntries(filter, query, sort);
  const newPlaylist = useNewPlaylist();
  usePageTone(null);
  const create = <button type="button" className="icon-btn light" aria-label="Create playlist" onClick={newPlaylist}><Icon name="plus" size={24} /></button>;
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
        <LibraryChips />
        <div className="lib-tools">
          <CollectionTools sorts={LIBRARY_SORTS} sort={sort} onSort={setSort} view={view} onView={setView} />
        </div>
        <CollectionBody items={entries} view={view} empty={libraryEmptyText(filter, query)} />
      </div>
    </>
  );
}
