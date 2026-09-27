import { useMemo, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router";
import { Art, LikedArt } from "../components/Art.tsx";
import { Icon, Logo } from "../components/Icon.tsx";
import { CollectionTools, ItemList, SORT_LABELS, sortItems, useCollectionView } from "../components/Collection.tsx";
import { SearchField } from "../components/SearchField.tsx";
import type { CollectionItem, SortOption } from "../components/Collection.tsx";
import type { IconName } from "../components/Icon.tsx";
import { useOffline } from "../offline/store.ts";
import { useAllAlbums, useArtists, useCreatePlaylist, usePlaylists, useStarred } from "../queries/hooks.ts";
import { useSpotifyAlbums, useSpotifyFollowed, useSpotifyLiked, useSpotifyOn, useSpotifyPlaylists } from "../queries/spotify.ts";
import { matchesTerms, queryTerms } from "@needle/shared";
import { spId } from "../lib/spotify.ts";
import { plural } from "../lib/format.ts";
import type { CollectionView, LibraryFilter, SortKey } from "../state/ui.ts";
import { useUi } from "../state/ui.ts";

export type LibraryEntry = CollectionItem & {
  kind: Exclude<LibraryFilter, null | "spotify" | "downloaded">;
  spotify?: boolean;
  contextId: string;
  downloaded: boolean;
  added: string;
};

export const LIBRARY_SORTS: SortOption[] = [["default", "Recents"], ["title", SORT_LABELS.title], ["by", "Creator"]];

export const useLibrarySort = (fallback: CollectionView = "list") => useCollectionView("library", LIBRARY_SORTS, fallback);

export function useLibraryEntries(filter: LibraryFilter, query: string, sort: SortKey): LibraryEntry[] {
  const { data: playlists = [] } = usePlaylists();
  const { data: starred } = useStarred();
  const { data: albums = [] } = useAllAlbums();
  const { data: artists = [] } = useArtists();
  const collections = useOffline((s) => s.collections);
  const { data: spLiked } = useSpotifyLiked();
  const { data: spPlaylists = [] } = useSpotifyPlaylists();
  const { data: spAlbums = [] } = useSpotifyAlbums();
  const { data: spArtists = [] } = useSpotifyFollowed();
  return useMemo(() => {
    const down = new Set(collections.map((c) => c.id));
    const entries: LibraryEntry[] = [
      { key: "liked", to: "/liked", art: () => <LikedArt />, title: "Liked songs", subtitle: `Playlist, ${plural(starred?.song?.length ?? 0, "song")}`, kind: "playlists", contextId: "liked", downloaded: down.has("liked"), added: "9999", pinned: true },
      ...(starred?.album?.length ? [{ key: "liked-albums", to: "/albums/starred", art: () => <LikedArt className="albums" />, title: "Liked albums", subtitle: `Albums, ${plural(starred.album.length, "album")}`, kind: "albums", contextId: "liked-albums", downloaded: false, added: "9997", pinned: true } satisfies LibraryEntry] : []),
      ...(spLiked ? [{ key: "sp-liked", to: "/spotify/liked", art: () => <LikedArt className="sp-liked" />, title: "Liked on Spotify", subtitle: `Spotify, ${plural(spLiked.length, "song")}`, kind: "playlists", spotify: true, contextId: "sp:liked", downloaded: false, added: "9998", pinned: true } satisfies LibraryEntry] : []),
      ...playlists.map((p): LibraryEntry => ({
        key: `pl-${p.id}`, to: `/playlist/${p.id}`, art: (px) => <Art id={p.coverArt} px={px} />, title: p.name,
        subtitle: `Playlist, ${p.owner ?? ""}`.replace(/, $/, ""), by: p.owner ?? "", kind: "playlists", contextId: p.id, downloaded: down.has(p.id), added: p.changed ?? p.created ?? "",
      })),
      ...albums.map((a): LibraryEntry => ({
        key: `al-${a.id}`, to: `/album/${a.id}`, art: (px) => <Art id={a.coverArt} px={px} />, title: a.name,
        subtitle: `Album, ${a.displayArtist ?? a.artist ?? ""}`, by: a.displayArtist ?? a.artist ?? "", kind: "albums", contextId: a.id, downloaded: down.has(a.id), added: a.created ?? "",
      })),
      ...artists.map((a): LibraryEntry => ({
        key: `ar-${a.id}`, to: `/artist/${a.id}`, art: (px) => <Art id={a.coverArt} px={px} round fallback="artist" />, title: a.name,
        subtitle: "Artist", by: a.name, kind: "artists", contextId: a.id, downloaded: false, added: "",
      })),
      ...spPlaylists.map((p): LibraryEntry => ({
        key: `sp-pl-${p.id}`, to: `/spotify/playlist/${p.id}`, art: (px) => <Art images={p.images} px={px} />, title: p.name,
        subtitle: `Spotify playlist, ${p.owner.display_name ?? p.owner.id}`, by: p.owner.display_name ?? p.owner.id, kind: "playlists", spotify: true, contextId: spId(p.id), downloaded: false, added: "",
      })),
      ...spAlbums.map((a): LibraryEntry => ({
        key: `sp-al-${a.id}`, to: `/spotify/album/${a.id}`, art: (px) => <Art images={a.images} px={px} />, title: a.name,
        subtitle: `Spotify album, ${a.artists?.map((x) => x.name).join(", ") ?? ""}`, by: a.artists?.[0]?.name ?? "", kind: "albums", spotify: true, contextId: spId(a.id), downloaded: false, added: a.added_at ?? "",
      })),
      ...spArtists.map((a): LibraryEntry => ({
        key: `sp-ar-${a.id}`, to: `/spotify/artist/${a.id}`, art: (px) => <Art images={a.images} px={px} round fallback="artist" />, title: a.name,
        subtitle: "Artist you follow on Spotify", by: a.name, kind: "artists", spotify: true, contextId: spId(a.id), downloaded: false, added: "",
      })),
    ];
    const terms = queryTerms(query);
    const matches = (e: LibraryEntry) => {
      if (filter === "downloaded") return e.downloaded;
      if (filter === "spotify") return Boolean(e.spotify);
      return !filter || e.kind === filter;
    };
    const rank = (e: LibraryEntry) => (e.pinned ? 0 : e.spotify ? 2 : 1);
    const shown = entries
      .filter(matches)
      .filter((e) => matchesTerms(terms, e.title, e.subtitle))
      .sort((a, b) => rank(a) - rank(b) || b.added.localeCompare(a.added));
    return sortItems(shown, sort);
  }, [playlists, starred, albums, artists, collections, spLiked, spPlaylists, spAlbums, spArtists, filter, query, sort]);
}

const FILTERS: [Exclude<LibraryFilter, null>, string][] = [["playlists", "Playlists"], ["albums", "Albums"], ["artists", "Artists"], ["spotify", "Spotify"], ["downloaded", "On this device"]];

export function LibraryChips() {
  const filter = useUi((s) => s.libraryFilter);
  const spotifyOn = useSpotifyOn();
  return (
    <div className="chips" role="group" aria-label="Filter your library">
      {FILTERS.filter(([id]) => id !== "spotify" || spotifyOn).map(([id, label]) => (
        <button key={id} type="button" className="pill" aria-pressed={filter === id} onClick={() => useUi.setState({ libraryFilter: filter === id ? null : id })}>
          {label}
        </button>
      ))}
    </div>
  );
}

const EMPTY: Record<Exclude<LibraryFilter, null>, string> = {
  playlists: "Your playlists show up here. Create one with the + button.",
  albums: "Albums in your library, and ones you save on Spotify, show up here. Get more from Search.",
  artists: "Artists in your library, and ones you follow on Spotify, show up here.",
  spotify: "Nothing from Spotify yet.",
  downloaded: "Nothing kept on this device yet. Use the download button on an album or playlist to listen offline.",
};

export function libraryEmptyText(filter: LibraryFilter, query: string): string {
  if (query.trim()) return `Nothing in your library matches “${query.trim()}”.`;
  return filter ? EMPTY[filter] : "Your albums, artists and playlists show up here. Get music from Search.";
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
  const [focused, setFocused] = useState(false);
  const { sort, setSort } = useLibrarySort();
  const entries = useLibraryEntries(filter, query, sort);
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
        <div className={focused || query ? "lib-tools searching" : "lib-tools"}>
          <SearchField variant="inline" collapsible className="sf-wide" value={query} onChange={setQuery} onFocusChange={setFocused} label="Search in your library" />
          <CollectionTools sorts={LIBRARY_SORTS} sort={sort} onSort={setSort} />
        </div>
        <ItemList items={entries} empty={libraryEmptyText(filter, query)} />
      </div>
    </nav>
  );
}
