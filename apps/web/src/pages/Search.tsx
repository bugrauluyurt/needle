import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useIsFetching } from "@tanstack/react-query";
import type { BrowseTile } from "@needle/shared";
import { GetCard, GetSongCard } from "../components/GetCard.tsx";
import { Art } from "../components/Art.tsx";
import { RowHeader } from "../components/Cards.tsx";
import { Icon } from "../components/Icon.tsx";
import { TrackList } from "../components/TrackList.tsx";
import { useScrollContainer } from "../components/ScrollContext.ts";
import { cardBlock, FILTERS, FilterChips, LIBRARY_FILTERS, LibrarySource, Source } from "../components/SearchResults.tsx";
import type { Block, Filter, SearchKind, Top } from "../components/SearchResults.tsx";
import { artistName, releaseDateLabel } from "../lib/format.ts";
import { useDebounced, useDelayed } from "../lib/useDelayed.ts";
import { TILE_COLORS } from "../lib/palette.ts";
import { player } from "../player/controller.ts";
import type { PlayContext } from "../player/store.ts";
import { useBrowse, useCapabilities, useLidarrSearch, useRequests, useSearch, useSongCandidates } from "../queries/hooks.ts";
import { usePageTone } from "../layout/Shell.tsx";
import { SearchHeader } from "../layout/SearchHeader.tsx";
import { albumPath } from "../lib/paths.ts";
import { useSpotifyOn, useSpotifyPlaylists, useSpotifySearch, useSpotifySearchCategory } from "../queries/spotify.ts";
import { uniqueSpotifyItems, useSpotifyStatus } from "../lib/spotify.ts";
import type { SpotifySearchKind } from "../lib/spotify.ts";
import { playSpotifyArtist, spotifyAlbumItem, spotifyArtistItem, spotifyPlaylistItem } from "../components/SpotifyCards.tsx";

const tile = (i: number) => TILE_COLORS[i % TILE_COLORS.length] ?? "#1E3C78";

const RECENT_KEY = "needle.recentSearches";

function loadRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

function saveRecent(list: string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 8)));
  } catch {
    return;
  }
}

function GenreTile({ tile, color }: { tile: BrowseTile; color: string }) {
  return (
    <Link to={tile.to} className="genre" style={{ "--g": color } as React.CSSProperties}>
      <b>{tile.name}</b>
      <small>{tile.subtitle}</small>
      <div className="fan" aria-hidden="true">
        {tile.covers.map((a) => <Art key={a.id} id={a.coverArt} px={84} />)}
      </div>
    </Link>
  );
}

function Browse({ recent, onPick, onRemove, onClear }: { recent: string[]; onPick: (q: string) => void; onRemove: (q: string) => void; onClear: () => void }) {
  const tiles = useBrowse();
  const caps = useCapabilities();
  const pending = tiles.isPending;
  const skeleton = useDelayed(pending);
  const shown = tiles.data ?? [];
  return (
    <>
      {recent.length ? (
        <>
          <RowHeader title="Recent searches" action={<button type="button" className="show-all" onClick={onClear}>Clear</button>} />
          <div className="recent">
            {recent.map((q) => (
              <span key={q} className="pill outline">
                <button type="button" onClick={() => onPick(q)}><Icon name="clock" size={15} />{q}</button>
                <button type="button" aria-label={`Remove ${q}`} onClick={() => onRemove(q)}><Icon name="close" size={14} /></button>
              </span>
            ))}
          </div>
        </>
      ) : null}
      {pending ? (
        skeleton ? <div className="genres" aria-busy="true">{Array.from({ length: 8 }, (_, i) => <div key={i} className="genre skeleton" />)}</div> : null
      ) : shown.length ? (
        <>
          <RowHeader title="Browse your library" subtitle="Genres come from your files’ tags" />
          <div className="genres">
            {shown.map((t, i) => <GenreTile key={t.to} tile={t} color={tile(i)} />)}
          </div>
        </>
      ) : (
        <div className="browse-empty">
          <h2>Nothing to browse yet</h2>
          <p className="muted">{caps.data?.lidarr ? "Search above for an artist or album, and Needle can fetch albums you don’t have through Lidarr." : "Once Navidrome has music, genres and decades show up here."}</p>
        </div>
      )}
    </>
  );
}

const SPOTIFY_KINDS: Record<SearchKind, SpotifySearchKind> = { Songs: "songs", Albums: "albums", Artists: "artists", Playlists: "playlists" };

function SpotifySource({ q, filter, setFilter, onShowAll }: { q: string; filter: Filter; setFilter: (f: Filter) => void; onShowAll: (kind: SearchKind) => void }) {
  const blocked = useSpotifyStatus((s) => s.blocked);
  const debouncedQuery = useDebounced(q);
  const search = useSpotifySearch(debouncedQuery);
  const { isError } = search;
  const data = blocked && search.isPlaceholderData ? undefined : search.data;
  const category = filter !== "All" && filter !== "Get music" ? SPOTIFY_KINDS[filter] : undefined;
  const pagination = useSpotifySearchCategory(debouncedQuery, category, search.isPlaceholderData ? undefined : data);
  const { data: own = [] } = useSpotifyPlaylists();
  const resultPages = pagination.data?.pages;
  const songs = uniqueSpotifyItems(resultPages?.flatMap((searchPage) => searchPage.songs) ?? data?.songs ?? []);
  const albums = uniqueSpotifyItems(resultPages?.flatMap((searchPage) => searchPage.albums) ?? data?.albums ?? []);
  const artists = uniqueSpotifyItems(resultPages?.flatMap((searchPage) => searchPage.artists) ?? data?.artists ?? []);
  const playlists = useMemo(() => {
    const matchingPlaylists = own.filter((playlist) => playlist.name.toLowerCase().includes(q.toLowerCase()));
    const searchPlaylists = resultPages?.flatMap((searchPage) => searchPage.playlists) ?? data?.playlists ?? [];

    return uniqueSpotifyItems([...matchingPlaylists, ...searchPlaylists]);
  }, [own, data?.playlists, resultPages, q]);
  const context: PlayContext = { kind: "search", name: `Spotify search for “${q}”` };
  const artist = artists.find((a) => a.name.toLowerCase() === q.toLowerCase());
  const song = songs[0];
  const top: Top | undefined = artist
    ? { to: `/spotify/artist/${artist.id}`, art: <Art images={artist.images} px={104} round fallback="artist" />, title: artist.name, subtitle: "Artist on Spotify", onPlay: () => void playSpotifyArtist(artist.id) }
    : song
      ? { to: song.albumId ? albumPath(song.albumId) : "#", art: <Art id={song.coverArt} px={104} />, title: song.title, subtitle: `Song, ${artistName(song)}`, onPlay: () => player.playSongs(songs, 0, context) }
      : undefined;
  const blocks: Block[] = [
    { kind: "Songs", count: songs.length, row: null, all: <TrackList songs={songs} context={context} art album canSort={false} column={{ label: "Released", value: releaseDateLabel }} /> },
    cardBlock("Albums", albums.map((album) => spotifyAlbumItem(album)), { source: "spotify" }),
    cardBlock("Artists", artists.map(spotifyArtistItem), { source: "spotify" }),
    cardBlock("Playlists", playlists.map(spotifyPlaylistItem), { source: "spotify" }),
  ];
  const page = category ? (resultPages?.at(-1)?.pagination[category] ?? data?.pagination[category]) : undefined;

  return (
    <>
      <Source
        title="On Spotify"
        filter={filter}
        setFilter={setFilter}
        onShowAll={onShowAll}
        blocks={blocks}
        top={top}
        songs={songs}
        context={context}
        status={data || resultPages ? "ok" : blocked ? "paused" : isError ? "error" : "loading"}
        empty={(kind) => `Spotify found no ${kind || "results"} for “${q}”.`}
      />
      {category && page && !search.isPlaceholderData ? (
        <div className="search-pagination">
          {pagination.isFetchNextPageError ? <p className="muted source-note">Spotify didn’t load the next page. Try again.</p> : null}
          {pagination.hasNextPage ? (
            <button type="button" className="btn ghost sm" disabled={blocked || pagination.isFetchingNextPage} onClick={() => void pagination.fetchNextPage()}>
              {pagination.isFetchingNextPage ? "Loading…" : "Load more"}
            </button>
          ) : !pagination.isPending && page.total > 0 ? (
            <p className="muted source-note">{page.next ? "Spotify’s search limit has been reached." : "All available Spotify results are loaded."}</p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

const GETS: Record<"albums" | "songs", Filter[]> = { albums: ["All", "Albums", "Get music"], songs: ["All", "Songs", "Get music"] };

function GetSource({ q, filter, albumsOn, songsOn }: { q: string; filter: Filter; albumsOn: boolean; songsOn: boolean }) {
  const showAlbums = albumsOn && GETS.albums.includes(filter);
  const showSongs = songsOn && GETS.songs.includes(filter);
  const lidarr = useLidarrSearch(q, showAlbums);
  const songs = useSongCandidates(q, showSongs);
  const { data: requests = [] } = useRequests();
  const byRef = new Map(requests.map((r) => [`${r.kind}:${r.ref}`, r]));
  const few = filter === "All";
  const albums = lidarr.data?.albums ?? [];
  const asking = lidarr.isPending || lidarr.isFetching;
  const heading = showAlbums && showSongs;
  return (
    <section className="res-source" aria-label="Not in your library yet">
      <div className="source-h">
        <h2>Not in your library yet</h2>
        <p className="sub">Found on MusicBrainz. {albumsOn && songsOn ? "Albums come through Lidarr and single songs from Soulseek." : albumsOn ? "Lidarr downloads the albums you pick." : "Soulseek provides the songs you pick."} They show up in your library when they’re ready.</p>
      </div>
      {showAlbums ? (
        <>
          {heading ? <RowHeader title="Albums" /> : null}
          {albums.length ? (
            <div className="get">{(few ? albums.slice(0, 6) : albums).map((a) => <GetCard key={a.foreignAlbumId} album={a} request={byRef.get(`album:${a.foreignAlbumId}`)} />)}</div>
          ) : asking ? (
            <p className="muted source-note"><span className="spin" />Asking Lidarr about “{q}”…</p>
          ) : (
            <p className="muted source-note">Lidarr found no other albums for “{q}”.</p>
          )}
        </>
      ) : null}
      {showSongs ? (
        <>
          {heading ? <RowHeader title="Songs" /> : null}
          {songs.data?.length ? (
            <div className="get">{(few ? songs.data.slice(0, 4) : songs.data).map((s) => <GetSongCard key={s.id} song={s} request={byRef.get(`song:${s.id}`)} />)}</div>
          ) : songs.isPending || songs.isFetching ? (
            <p className="muted source-note"><span className="spin" />Looking up songs for “{q}”…</p>
          ) : (
            <p className="muted source-note">{songs.isError ? "MusicBrainz didn’t answer. Try again in a moment." : `No other songs found for “${q}”.`}</p>
          )}
        </>
      ) : null}
    </section>
  );
}

function Results({ q }: { q: string }) {
  const [filter, setFilter] = useState<Filter>("All");
  const [params, setParams] = useSearchParams();
  const { isFetching } = useSearch(q);
  const caps = useCapabilities().data;
  const albumsOn = Boolean(caps?.lidarr);
  const songsOn = Boolean(caps?.songs);
  const spotifyOn = useSpotifyOn();
  const local = filter !== "Get music";
  const requestedSource = params.get("source");
  const requestedCategory = params.get("category");
  const focusedCategory = LIBRARY_FILTERS.find((category): category is SearchKind => category !== "All" && category === requestedCategory);
  const focusedSource = focusedCategory && (requestedSource === "library" || requestedSource === "spotify") ? requestedSource : null;
  const scrollContainer = useScrollContainer();
  const overviewScrollTop = useRef(0);

  useLayoutEffect(() => {
    scrollContainer?.current?.scrollTo(0, focusedSource ? 0 : overviewScrollTop.current);
  }, [focusedSource, focusedCategory, scrollContainer]);

  const showAll = (source: "library" | "spotify", category: SearchKind) => {
    overviewScrollTop.current = scrollContainer?.current?.scrollTop ?? 0;

    setParams({ q, source, category });
  };
  const back = () => setParams({ q }, { replace: true });

  return (
    <div className={isFetching ? "results fetching" : "results"}>
      {focusedSource && focusedCategory ? (
        <>
          <button type="button" className="btn ghost sm search-focus-back" aria-label="Back to all search results" onClick={back}><Icon name="back" size={16} />All search results</button>
          {focusedSource === "library" ? <LibrarySource q={q} filter={focusedCategory} setFilter={setFilter} /> : spotifyOn ? <SpotifySource q={q} filter={focusedCategory} setFilter={setFilter} onShowAll={(category) => showAll("spotify", category)} /> : <p className="muted source-note">Spotify is unavailable. Connect Spotify in Settings to search its catalogue.</p>}
        </>
      ) : (
        <>
          <FilterChips filters={albumsOn || songsOn ? FILTERS : LIBRARY_FILTERS} value={filter} onChange={setFilter} label="Filter results" />
          {local ? <LibrarySource q={q} filter={filter} setFilter={setFilter} onShowAll={(category) => showAll("library", category)} /> : null}
          {local && spotifyOn ? <SpotifySource q={q} filter={filter} setFilter={setFilter} onShowAll={(category) => showAll("spotify", category)} /> : null}
          {(albumsOn || songsOn) && filter !== "Playlists" && filter !== "Artists" ? <GetSource q={q} filter={filter} albumsOn={albumsOn} songsOn={songsOn} /> : null}
        </>
      )}
    </div>
  );
}

export default function Search() {
  const [params, setParams] = useSearchParams();
  const urlQ = params.get("q") ?? "";
  const [text, setText] = useState(urlQ);
  const [recent, setRecent] = useState(loadRecent);
  usePageTone(null);

  useEffect(() => {
    const t = window.setTimeout(() => {
      if (text.trim() === urlQ) return;
      setParams(text.trim() ? { q: text.trim() } : {}, { replace: true });
    }, 220);
    return () => window.clearTimeout(t);
  }, [text, urlQ, setParams]);

  const remember = (q: string) => {
    const next = [q, ...recent.filter((r) => r.toLowerCase() !== q.toLowerCase())].slice(0, 8);
    setRecent(next);
    saveRecent(next);
  };
  const q = urlQ.trim();
  const busy = useIsFetching({ predicate: (query) => query.queryKey.includes("search") }) > 0 && Boolean(text.trim());


  return (
    <>
      <SearchHeader title="Search" label="Search" placeholder="What do you want to listen to?" value={text} onChange={setText} onCommit={() => text.trim() && remember(text.trim())} busy={busy} autoFocus />
      <div className="pad">
        {q ? (
          <Results q={q} />
        ) : (
          <Browse
            recent={recent}
            onPick={(r) => setText(r)}
            onRemove={(r) => {
              const next = recent.filter((x) => x !== r);
              setRecent(next);
              saveRecent(next);
            }}
            onClear={() => {
              setRecent([]);
              saveRecent([]);
            }}
          />
        )}
      </div>
    </>
  );
}
