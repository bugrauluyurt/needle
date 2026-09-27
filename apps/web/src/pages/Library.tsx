import { useState } from "react";
import { CollectionBody, CollectionTools } from "../components/Collection.tsx";
import { Icon } from "../components/Icon.tsx";
import { SearchField } from "../components/SearchField.tsx";
import { MobileHeader } from "../layout/Mobile.tsx";
import { useIsMobile, usePageTone } from "../layout/Shell.tsx";
import { LIBRARY_SORTS, LibraryChips, libraryEmptyText, useLibraryEntries, useLibrarySort, useNewPlaylist } from "../layout/Sidebar.tsx";
import { TopBar } from "../layout/TopBar.tsx";
import { useUi } from "../state/ui.ts";

export default function LibraryPage() {
  const mobile = useIsMobile();
  const filter = useUi((s) => s.libraryFilter);
  const [query, setQuery] = useState("");
  const { sort, setSort, view, setView } = useLibrarySort(mobile ? "list" : "grid");
  const entries = useLibraryEntries(filter, query, sort);
  const newPlaylist = useNewPlaylist();
  usePageTone(null);
  const create = <button type="button" className="icon-btn light" aria-label="Create playlist" onClick={newPlaylist}><Icon name="plus" size={24} /></button>;
  return (
    <>
      {mobile ? <MobileHeader title="Your library" actions={create} /> : <TopBar />}
      <div className="pad library-page">
        {!mobile ? (
          <div className="library-head">
            <h1 className="hello">Your library</h1>
            {create}
          </div>
        ) : null}
        <LibraryChips />
        <div className="lib-tools">
          <SearchField variant="inline" collapsible className="sf-wide" value={query} onChange={setQuery} label="Search in your library" />
          <CollectionTools sorts={LIBRARY_SORTS} sort={sort} onSort={setSort} view={view} onView={setView} />
        </div>
        <CollectionBody items={entries} view={view} empty={libraryEmptyText(filter, query)} />
      </div>
    </>
  );
}
