import { Fragment, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { useIsFetching } from "@tanstack/react-query";
import { GetArtistCard, GetCard, GetSongCard } from "../components/GetCard.tsx";
import type { BrowseTile, Song } from "@needle/shared";
import { Art } from "../components/Art.tsx";
import { albumItem, artistItem, CardRow, ItemCard, playArtist, RowHeader } from "../components/Cards.tsx";
import { Collection, SORT_LABELS } from "../components/Collection.tsx";
import type { CollectionItem, SortOption } from "../components/Collection.tsx";
import { Icon } from "../components/Icon.tsx";
import { TrackList } from "../components/TrackList.tsx";
import { artistName, clock, plural } from "../lib/format.ts";
import { useDebounced, useDelayed } from "../lib/useDelayed.ts";
import { TILE_COLORS } from "../lib/palette.ts";

import { player } from "../player/controller.ts";
import type { PlayContext } from "../player/store.ts";
import { useBrowse, useCapabilities, useLidarrSearch, usePlaylists, useRequests, useSearch, useSongCandidates } from "../queries/hooks.ts";
import { usePageTone } from "../layout/Shell.tsx";
import { SearchHeader } from "../layout/SearchHeader.tsx";
import { albumPath } from "../lib/paths.ts";
import { useSpotifyOn, useSpotifyPlaylists, useSpotifySearch } from "../queries/spotify.ts";
import { playSpotifyArtist, spotifyAlbumItem, spotifyArtistItem, spotifyPlaylistItem } from "../components/SpotifyCards.tsx";

const tile = (i: number) => TILE_COLORS[i % TILE_COLORS.length] ?? "#1E3C78";

const RECENT_KEY = "needle.recentSearches";
const FILTERS = ["All", "Songs", "Albums", "Artists", "Playlists", "Get music"] as const;
type Filter = (typeof FILTERS)[number];

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

type Top = { to: string; art: ReactNode; title: string; subtitle: string; onPlay: () => void };

function TopResult({ top }: { top: Top }) {
  return (
    <div className="top-card">
      <Link to={top.to} className="top-link">
        {top.art}
        <h2>{top.title}</h2>
        <div className="muted">{top.subtitle}</div>
      </Link>
      <button type="button" className="bigplay" aria-label={`Play ${top.title}`} onClick={top.onPlay}>
        <Icon name="play" size={22} />
      </button>
    </div>
  );
}

function SongsMini({ songs, context }: { songs: Song[]; context: PlayContext }) {
  return (
    <div className="songs-mini">
      {songs.slice(0, 4).map((s, i) => (
        <button key={s.id} type="button" className="song-mini" onClick={() => player.playSongs(songs, i, context)}>
          <Art id={s.coverArt} px={40} />
          <div className="mini-text">
            <div className="t">{s.title}</div>
            <div className="s">{artistName(s)}, {s.album}</div>
          </div>
          <span className="tabular muted">{clock(s.duration)}</span>
        </button>
      ))}
    </div>
  );
}

type Kind = "Songs" | "Albums" | "Artists" | "Playlists";
type Block = { kind: Kind; count: number; row: ReactNode; all: ReactNode };
type SourceProps = {
  title: string;
  subtitle?: string;
  filter: Filter;
  setFilter: (f: Filter) => void;
  blocks: Block[];
  top?: Top | undefined;
  songs?: Song[];
  context: PlayContext;
  status: "loading" | "error" | "ok";
  empty: (kind: string) => string;
};

const SEARCH_SORTS: Record<Exclude<Kind, "Songs">, SortOption[]> = {
  Albums: [["default", "Most relevant"], ["title", SORT_LABELS.title], ["by", "Artist"], ["year", SORT_LABELS.year]],
  Artists: [["default", "Most relevant"], ["title", SORT_LABELS.title]],
  Playlists: [["default", "Most relevant"], ["title", SORT_LABELS.title], ["by", "Creator"]],
};

function cardBlock(kind: Exclude<Kind, "Songs">, items: CollectionItem[]): Block {
  return {
    kind,
    count: items.length,
    row: <CardRow>{items.map((i) => <ItemCard key={i.key} item={i} />)}</CardRow>,
    all: <Collection id={`search-${kind.toLowerCase()}`} title={kind} items={items} sorts={SEARCH_SORTS[kind]} />,
  };
}

function Source({ title, subtitle, filter, setFilter, blocks, top, songs = [], context, status, empty }: SourceProps) {
  const kind = filter === "All" ? null : filter;
  const visible = blocks.filter((b) => b.count && (!kind || b.kind === kind));
  const body = () => {
    if (status === "loading") return <p className="muted source-note"><span className="spin" />Searching…</p>;
    if (status === "error") return <p className="muted source-note">{title} didn’t answer. Try again in a moment.</p>;
    if (!visible.length) return <p className="muted source-note">{empty(kind?.toLowerCase() ?? "")}</p>;
    if (kind) return visible[0]?.all;
    return (
      <>
        {top || songs.length ? (
          <div className="res-top">
            {top ? (
              <section>
                <RowHeader title="Top result" />
                <TopResult top={top} />
              </section>
            ) : null}
            {songs.length ? (
              <section>
                <RowHeader title="Songs" action={<button type="button" className="show-all" onClick={() => setFilter("Songs")}>Show all</button>} />
                <SongsMini songs={songs} context={context} />
              </section>
            ) : null}
          </div>
        ) : null}
        {visible.filter((b) => b.kind !== "Songs").map((b) => (
          <Fragment key={b.kind}>
            <RowHeader title={b.kind} action={<button type="button" className="show-all" onClick={() => setFilter(b.kind)}>Show all</button>} />
            {b.row}
          </Fragment>
        ))}
      </>
    );
  };
  return (
    <section className="res-source" aria-label={title}>
      <div className="source-h">
        <h2>{title}</h2>
        {subtitle ? <p className="sub">{subtitle}</p> : null}
      </div>
      {body()}
    </section>
  );
}

function LibrarySource({ q, filter, setFilter }: { q: string; filter: Filter; setFilter: (f: Filter) => void }) {
  const { data, isError } = useSearch(q);
  const { data: playlists = [] } = usePlaylists();
  const matchingPlaylists = playlists.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()));
  const songs = data?.song ?? [];
  const albums = data?.album ?? [];
  const artists = data?.artist ?? [];
  const context: PlayContext = { kind: "search", name: `Search for “${q}”` };
  const artist = artists.find((a) => a.name.toLowerCase() === q.toLowerCase()) ?? artists[0];
  const song = songs[0];
  const top: Top | undefined = artist
    ? { to: `/artist/${artist.id}`, art: <Art id={artist.coverArt} px={104} round fallback="artist" />, title: artist.name, subtitle: `Artist${artist.albumCount ? `, ${plural(artist.albumCount, "album")} in your library` : ""}`, onPlay: () => void playArtist(artist) }
    : song
      ? { to: song.albumId ? albumPath(song.albumId) : "#", art: <Art id={song.coverArt} px={104} />, title: song.title, subtitle: `Song, ${artistName(song)}`, onPlay: () => player.playSongs([song], 0, context) }
      : undefined;
  const blocks: Block[] = [
    { kind: "Songs", count: songs.length, row: null, all: <TrackList songs={songs} context={context} art album /> },
    cardBlock("Albums", albums.map((a) => albumItem(a))),
    cardBlock("Artists", artists.map((a) => artistItem(a))),
    cardBlock("Playlists", matchingPlaylists.map((p): CollectionItem => ({
      key: p.id, to: `/playlist/${p.id}`, art: (px) => <Art id={p.coverArt} px={px} />, title: p.name, subtitle: `Playlist, ${p.owner ?? ""}`.replace(/, $/, ""), by: p.owner ?? "",
    }))),
  ];
  return (
    <Source
      title="In your library"
      filter={filter}
      setFilter={setFilter}
      blocks={blocks}
      top={top}
      songs={songs}
      context={context}
      status={data ? "ok" : isError ? "error" : "loading"}
      empty={(kind) => (kind ? `No ${kind} in your library match “${q}”.` : `Nothing in your library matches “${q}”.`)}
    />
  );
}

function SpotifySource({ q, filter, setFilter }: { q: string; filter: Filter; setFilter: (f: Filter) => void }) {
  const { data, isError } = useSpotifySearch(useDebounced(q));
  const { data: own = [] } = useSpotifyPlaylists();
  const songs = data?.songs ?? [];
  const albums = data?.albums ?? [];
  const artists = data?.artists ?? [];
  const playlists = useMemo(() => {
    const mine = own.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()));
    const ids = new Set(mine.map((p) => p.id));
    return [...mine, ...(data?.playlists ?? []).filter((p) => !ids.has(p.id))];
  }, [own, data?.playlists, q]);
  const context: PlayContext = { kind: "search", name: `Spotify search for “${q}”` };
  const artist = artists.find((a) => a.name.toLowerCase() === q.toLowerCase());
  const song = songs[0];
  const top: Top | undefined = artist
    ? { to: `/spotify/artist/${artist.id}`, art: <Art images={artist.images} px={104} round fallback="artist" />, title: artist.name, subtitle: "Artist on Spotify", onPlay: () => void playSpotifyArtist(artist.id) }
    : song
      ? { to: song.albumId ? albumPath(song.albumId) : "#", art: <Art id={song.coverArt} px={104} />, title: song.title, subtitle: `Song, ${artistName(song)}`, onPlay: () => player.playSongs(songs, 0, context) }
      : undefined;
  const blocks: Block[] = [
    { kind: "Songs", count: songs.length, row: null, all: <TrackList songs={songs} context={context} art album /> },
    cardBlock("Albums", albums.map((a) => spotifyAlbumItem(a))),
    cardBlock("Artists", artists.map(spotifyArtistItem)),
    cardBlock("Playlists", playlists.map(spotifyPlaylistItem)),
  ];
  if (isError) return null;
  return (
    <Source
      title="On Spotify"
      filter={filter}
      setFilter={setFilter}
      blocks={blocks}
      top={top}
      songs={songs}
      context={context}
      status={data ? "ok" : isError ? "error" : "loading"}
      empty={(kind) => `Spotify found no ${kind || "results"} for “${q}”.`}
    />
  );
}

const GETS: Record<"albums" | "artists" | "songs", Filter[]> = { albums: ["All", "Albums", "Get music"], artists: ["All", "Artists", "Get music"], songs: ["All", "Songs", "Get music"] };

function GetSource({ q, filter, albumsOn, songsOn }: { q: string; filter: Filter; albumsOn: boolean; songsOn: boolean }) {
  const showAlbums = albumsOn && GETS.albums.includes(filter);
  const showArtists = albumsOn && GETS.artists.includes(filter);
  const showSongs = songsOn && GETS.songs.includes(filter);
  const lidarr = useLidarrSearch(q, showAlbums || showArtists);
  const songs = useSongCandidates(q, showSongs);
  const { data: requests = [] } = useRequests();
  const byRef = new Map(requests.map((r) => [`${r.kind}:${r.ref}`, r]));
  const few = filter === "All";
  const albums = lidarr.data?.albums ?? [];
  const artists = lidarr.data?.artists ?? [];
  const asking = lidarr.isPending || lidarr.isFetching;
  const heading = [showArtists, showAlbums, showSongs].filter(Boolean).length > 1;
  return (
    <section className="res-source" aria-label="Not in your library yet">
      <div className="source-h">
        <h2>Not in your library yet</h2>
        <p className="sub">Found on MusicBrainz. {albumsOn && songsOn ? "Albums come through Lidarr and single songs from Soulseek." : albumsOn ? "Lidarr downloads the albums you pick." : "Soulseek provides the songs you pick."} They show up in your library when they’re ready.</p>
      </div>
      {showArtists && artists.length ? (
        <>
          {heading ? <RowHeader title="Artists" /> : null}
          <div className="get">{(few ? artists.slice(0, 3) : artists).map((a) => <GetArtistCard key={a.foreignArtistId} artist={a} />)}</div>
        </>
      ) : null}
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
  const { isFetching } = useSearch(q);
  const caps = useCapabilities().data;
  const albumsOn = Boolean(caps?.lidarr);
  const songsOn = Boolean(caps?.songs);
  const spotifyOn = useSpotifyOn();
  const local = filter !== "Get music";
  return (
    <div className={isFetching ? "results fetching" : "results"}>
      <div className="chips filter-chips" role="group" aria-label="Filter results">
        {FILTERS.filter((f) => f !== "Get music" || albumsOn || songsOn).map((f) => (
          <button key={f} type="button" className="pill" aria-pressed={filter === f} onClick={() => setFilter(f)}>{f}</button>
        ))}
      </div>
      {local ? <LibrarySource q={q} filter={filter} setFilter={setFilter} /> : null}
      {local && spotifyOn ? <SpotifySource q={q} filter={filter} setFilter={setFilter} /> : null}
      {(albumsOn || songsOn) && filter !== "Playlists" ? <GetSource q={q} filter={filter} albumsOn={albumsOn} songsOn={songsOn} /> : null}
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
