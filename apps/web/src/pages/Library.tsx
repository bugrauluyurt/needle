import { useState } from "react";
import { Card, CardRow } from "../components/Cards.tsx";
import { Icon } from "../components/Icon.tsx";
import { MobileHeader } from "../layout/Mobile.tsx";
import { useIsMobile, usePageTone } from "../layout/Shell.tsx";
import { LibraryChips, LibraryList, useLibraryEntries, useNewPlaylist } from "../layout/Sidebar.tsx";
import { TopBar } from "../layout/TopBar.tsx";
import { useUi } from "../state/ui.ts";

export default function LibraryPage() {
  const mobile = useIsMobile();
  const filter = useUi((s) => s.libraryFilter);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [grid, setGrid] = useState(!mobile);
  const entries = useLibraryEntries(filter, query);
  const newPlaylist = useNewPlaylist();
  usePageTone(null);
  const actions = (
    <>
      <button type="button" className="icon-btn light" aria-label="Search your library" onClick={() => setSearching(!searching)}><Icon name="search" size={22} /></button>
      <button type="button" className="icon-btn light" aria-label="Create playlist" onClick={newPlaylist}><Icon name="plus" size={24} /></button>
    </>
  );
  return (
    <>
      {mobile ? <MobileHeader title="Your library" actions={actions} /> : <TopBar />}
      <div className="pad library-page">
        {!mobile ? (
          <div className="library-head">
            <h1 className="hello">Your library</h1>
            {actions}
          </div>
        ) : null}
        {searching ? (
          <label className="find wide">
            <Icon name="search" size={17} />
            <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search in your library" aria-label="Search in your library" />
          </label>
        ) : null}
        <LibraryChips />
        <div className="lib-tools">
          <span className="lib-sort"><Icon name="list" size={15} />Recents</span>
          <button type="button" className="icon-btn" aria-label={grid ? "Show as list" : "Show as grid"} onClick={() => setGrid(!grid)}>
            <Icon name={grid ? "list" : "grid"} size={16} />
          </button>
        </div>
        {grid ? (
          <CardRow grid>
            {entries.map((e) => <Card key={e.key} to={e.to} art={e.art} title={e.title} subtitle={e.subtitle} />)}
          </CardRow>
        ) : (
          <LibraryList entries={entries} />
        )}
        {!entries.length ? <p className="muted">{filter === "downloaded" ? "Nothing downloaded yet. Use the download button on an album or playlist." : "Nothing here yet. Like albums and artists, or create a playlist."}</p> : null}
      </div>
    </>
  );
}
