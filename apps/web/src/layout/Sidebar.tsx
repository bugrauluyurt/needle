import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router";
import { Art, LikedArt } from "../components/Art.tsx";
import { Eq, Icon, Logo } from "../components/Icon.tsx";
import type { IconName } from "../components/Icon.tsx";
import { useOffline } from "../offline/store.ts";
import { usePlayer } from "../player/store.ts";
import { useCreatePlaylist, usePlaylists, useStarred } from "../queries/hooks.ts";
import type { LibraryFilter } from "../state/ui.ts";
import { useUi } from "../state/ui.ts";

export type LibraryEntry = {
  key: string;
  to: string;
  art: ReactNode;
  title: string;
  subtitle: string;
  kind: Exclude<LibraryFilter, null | "downloaded">;
  contextId: string;
  downloaded: boolean;
  date: string;
  pinned?: boolean;
};

export function useLibraryEntries(filter: LibraryFilter, query = ""): LibraryEntry[] {
  const { data: playlists = [] } = usePlaylists();
  const { data: starred } = useStarred();
  const collections = useOffline((s) => s.collections);
  return useMemo(() => {
    const down = new Set(collections.map((c) => c.id));
    const likedCount = starred?.song?.length ?? 0;
    const entries: LibraryEntry[] = [
      { key: "liked", to: "/liked", art: <LikedArt />, title: "Liked songs", subtitle: `Playlist, ${likedCount} ${likedCount === 1 ? "song" : "songs"}`, kind: "playlists", contextId: "liked", downloaded: down.has("liked"), date: "9999", pinned: true },
      ...playlists.map((p): LibraryEntry => ({
        key: `pl-${p.id}`, to: `/playlist/${p.id}`, art: <Art id={p.coverArt} px={48} />, title: p.name,
        subtitle: `Playlist, ${p.owner ?? ""}`.replace(/, $/, ""), kind: "playlists", contextId: p.id, downloaded: down.has(p.id), date: p.changed ?? p.created ?? "",
      })),
      ...(starred?.album ?? []).map((a): LibraryEntry => ({
        key: `al-${a.id}`, to: `/album/${a.id}`, art: <Art id={a.coverArt} px={48} />, title: a.name,
        subtitle: `Album, ${a.displayArtist ?? a.artist ?? ""}`, kind: "albums", contextId: a.id, downloaded: down.has(a.id), date: a.starred ?? "",
      })),
      ...(starred?.artist ?? []).map((a): LibraryEntry => ({
        key: `ar-${a.id}`, to: `/artist/${a.id}`, art: <Art id={a.coverArt} px={48} round fallback="artist" />, title: a.name,
        subtitle: "Artist", kind: "artists", contextId: a.id, downloaded: false, date: a.starred ?? "",
      })),
    ];
    const q = query.trim().toLowerCase();
    return entries
      .filter((e) => (filter === "downloaded" ? e.downloaded : !filter || e.kind === filter))
      .filter((e) => !q || e.title.toLowerCase().includes(q))
      .sort((a, b) => (a.pinned ? -1 : b.pinned ? 1 : b.date.localeCompare(a.date)));
  }, [playlists, starred, collections, filter, query]);
}

const FILTERS: [Exclude<LibraryFilter, null>, string][] = [["playlists", "Playlists"], ["albums", "Albums"], ["artists", "Artists"], ["downloaded", "Downloaded"]];

export function LibraryChips() {
  const filter = useUi((s) => s.libraryFilter);
  return (
    <div className="chips" role="group" aria-label="Filter your library">
      {FILTERS.map(([id, label]) => (
        <button key={id} type="button" className="pill" aria-pressed={filter === id} onClick={() => useUi.setState({ libraryFilter: filter === id ? null : id })}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function LibraryList({ entries, compact = false }: { entries: LibraryEntry[]; compact?: boolean }) {
  const ctx = usePlayer((s) => s.context);
  const playing = usePlayer((s) => s.playing);
  const { pathname } = useLocation();
  return (
    <ul className={compact ? "lib-list scroll-thin" : "lib-list scroll-thin"}>
      {entries.map((e) => {
        const isPlaying = Boolean(ctx && (ctx.id === e.contextId || (e.contextId === "liked" && ctx.kind === "liked")));
        return (
          <li key={e.key}>
            <Link to={e.to} className={`lib-item ${pathname === e.to ? "on" : ""}`}>
              {e.art}
              <div className="lib-text">
                <div className={`t ${isPlaying ? "playing" : ""}`}>{e.title}</div>
                <div className="s">
                  {e.downloaded ? <span className="dl"><Icon name="downloaded" size={14} /></span> : null}
                  <span className="ellipsis">{e.subtitle}</span>
                </div>
              </div>
              {isPlaying ? <Eq paused={!playing} /> : null}
            </Link>
          </li>
        );
      })}
      {!entries.length ? <li className="lib-empty">Nothing here yet</li> : null}
    </ul>
  );
}

export function useNewPlaylist() {
  const create = useCreatePlaylist();
  const navigate = useNavigate();
  const count = usePlaylists().data?.length ?? 0;
  return () => create.mutate({ name: `My playlist #${count + 1}` }, { onSuccess: (p) => void navigate(`/playlist/${p.id}?edit=1`) });
}

function Nav({ to, icon, label }: { to: string; icon: IconName; label: string }) {
  return (
    <NavLink to={to} end={to === "/"} className={({ isActive }) => (isActive ? "nav-btn on" : "nav-btn")}>
      <Icon name={icon} size={22} />
      <span>{label}</span>
    </NavLink>
  );
}

export function Sidebar() {
  const filter = useUi((s) => s.libraryFilter);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const entries = useLibraryEntries(filter, query);
  const newPlaylist = useNewPlaylist();
  return (
    <nav className="side" aria-label="Main">
      <div className="panel side-top">
        <Link to="/" className="brand" aria-label="Needle home">
          <Logo />
          <span>Needle</span>
        </Link>
        <Nav to="/" icon="home" label="Home" />
        <Nav to="/search" icon="search" label="Search" />
        <Nav to="/stats" icon="chart" label="Your listening" />
        <Nav to="/radio" icon="radio" label="Radio" />
      </div>
      <div className="panel side-lib">
        <div className="lib-head">
          <Link to="/library" className="lib-title">
            <Icon name="library" size={22} />
            <span>Your library</span>
          </Link>
          <button type="button" className="icon-btn" aria-label="Create playlist" onClick={newPlaylist}>
            <Icon name="plus" />
          </button>
        </div>
        <LibraryChips />
        <div className="lib-tools">
          {searching ? (
            <label className="lib-search">
              <Icon name="search" size={16} />
              <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} onBlur={() => !query && setSearching(false)} placeholder="Search in your library" aria-label="Search in your library" />
            </label>
          ) : (
            <button type="button" className="icon-btn" aria-label="Search in your library" onClick={() => setSearching(true)}>
              <Icon name="search" size={17} />
            </button>
          )}
          <span className="lib-sort">
            Recents <Icon name="list" size={16} />
          </span>
        </div>
        <LibraryList entries={entries} />
      </div>
    </nav>
  );
}
