import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { useQueries } from "@tanstack/react-query";
import { GetCard } from "../components/GetCard.tsx";
import type { Song } from "@needle/shared";
import { Art } from "../components/Art.tsx";
import { AlbumCard, ArtistCard, Card, CardRow, playArtist, RowHeader } from "../components/Cards.tsx";
import { Icon } from "../components/Icon.tsx";
import { TrackList } from "../components/TrackList.tsx";
import { artistName, clock, plural } from "../lib/format.ts";
import type { AlbumListType } from "../lib/subsonic.ts";
import { useDelayed } from "../lib/useDelayed.ts";
import { TILE_COLORS } from "../lib/palette.ts";

import { player } from "../player/controller.ts";
import type { PlayContext } from "../player/store.ts";
import { tileCoversOptions, useCapabilities, useGenres, useLidarrSearch, usePlaylists, useSearch } from "../queries/hooks.ts";
import { usePageTone, useIsMobile } from "../layout/Shell.tsx";
import { TopBar } from "../layout/TopBar.tsx";
import { MobileHeader } from "../layout/Mobile.tsx";
import { albumPath } from "../lib/paths.ts";
import { image } from "../lib/spotify.ts";
import { useSpotifyOn, useSpotifyPlaylists, useSpotifySearch } from "../queries/spotify.ts";
import { playSpotifyArtist, SpotifyAlbumCard, SpotifyArtistCard, SpotifyPlaylistCard } from "../components/SpotifyCards.tsx";

const tile = (i: number) => TILE_COLORS[i % TILE_COLORS.length] ?? "#1E3C78";

const RECENT_KEY = "needle.recentSearches";
const FILTERS = ["All", "Songs", "Albums", "Artists", "Playlists", "Get albums"] as const;
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

function SearchBox({ value, onChange, onCommit }: { value: string; onChange: (v: string) => void; onCommit: () => void }) {
  const mobile = useIsMobile();
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!mobile) ref.current?.focus();
  }, [mobile]);
  return (
    <label className={mobile ? "psearch" : "searchbox"}>
      <Icon name="search" size={20} />
      <input
        ref={ref}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onCommit()}
        placeholder="What do you want to listen to?"
        aria-label="Search"
        enterKeyHint="search"
      />
      {value ? (
        <button type="button" className="clear" aria-label="Clear search" onClick={() => onChange("")}>
          <Icon name="close" size={18} />
        </button>
      ) : null}
    </label>
  );
}

type Tile = { name: string; subtitle: string; to: string; type: AlbumListType; opts?: { genre?: string; fromYear?: number; toYear?: number } };

function GenreTile({ tile, color, covers }: { tile: Tile; color: string; covers: { id: string; coverArt?: string }[] }) {
  return (
    <Link to={tile.to} className="genre" style={{ "--g": color } as React.CSSProperties}>
      <b>{tile.name}</b>
      <small>{tile.subtitle}</small>
      <div className="fan" aria-hidden="true">
        {covers.map((a) => <Art key={a.id} id={a.coverArt} px={84} />)}
      </div>
    </Link>
  );
}

function Browse({ recent, onPick, onRemove, onClear }: { recent: string[]; onPick: (q: string) => void; onRemove: (q: string) => void; onClear: () => void }) {
  const genres = useGenres();
  const caps = useCapabilities();
  const tiles = useMemo((): Tile[] => {
    const year = new Date().getFullYear();
    const decade = year - (year % 10);
    const top = (genres.data ?? []).filter((g) => g.songCount > 0).sort((a, b) => b.albumCount - a.albumCount).slice(0, 12);
    return [
      ...top.map((g): Tile => ({ name: g.value, subtitle: `${g.albumCount} ${g.albumCount === 1 ? "album" : "albums"}`, to: `/genre/${encodeURIComponent(g.value)}`, type: "byGenre", opts: { genre: g.value } })),
      ...[0, 10, 20, 30, 40, 50].map((back): Tile => ({ name: `${decade - back}s`, subtitle: "Decade", to: `/albums/byYear?from=${decade - back}&to=${decade - back + 9}`, type: "byYear", opts: { fromYear: decade - back, toYear: decade - back + 9 } })),
      { name: "Recently added", subtitle: "Newest first", to: "/albums/newest", type: "newest" },
      { name: "Surprise me", subtitle: "Random albums", to: "/albums/random", type: "random" },
    ];
  }, [genres.data]);
  const covers = useQueries({ queries: tiles.map((t) => tileCoversOptions(t.to, t.type, t.opts)) });
  const pending = genres.isPending || covers.some((q) => q.isPending);
  const skeleton = useDelayed(pending);
  const shown = tiles.map((t, i) => ({ t, covers: covers[i]?.data ?? [] })).filter((x) => x.covers.length);
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
            {shown.map((x, i) => <GenreTile key={x.t.to} tile={x.t} color={tile(i)} covers={x.covers} />)}
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
  const playlistCards = matchingPlaylists.map((p) => <Card key={p.id} to={`/playlist/${p.id}`} art={<Art id={p.coverArt} px={180} />} title={p.name} subtitle={`Playlist, ${p.owner ?? ""}`.replace(/, $/, "")} />);
  const blocks: Block[] = [
    { kind: "Songs", count: songs.length, row: null, all: <TrackList songs={songs} context={context} art album /> },
    { kind: "Albums", count: albums.length, row: <CardRow>{albums.map((a) => <AlbumCard key={a.id} album={a} />)}</CardRow>, all: <CardRow grid>{albums.map((a) => <AlbumCard key={a.id} album={a} />)}</CardRow> },
    { kind: "Artists", count: artists.length, row: <CardRow>{artists.map((a) => <ArtistCard key={a.id} artist={a} />)}</CardRow>, all: <CardRow grid>{artists.map((a) => <ArtistCard key={a.id} artist={a} />)}</CardRow> },
    { kind: "Playlists", count: matchingPlaylists.length, row: <CardRow>{playlistCards}</CardRow>, all: <CardRow grid>{playlistCards}</CardRow> },
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
  const { data, isError } = useSpotifySearch(q);
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
    ? { to: `/spotify/artist/${artist.id}`, art: <Art id={image(artist.images, 300)} px={104} round fallback="artist" />, title: artist.name, subtitle: "Artist on Spotify", onPlay: () => void playSpotifyArtist(artist.id) }
    : song
      ? { to: song.albumId ? albumPath(song.albumId) : "#", art: <Art id={song.coverArt} px={104} />, title: song.title, subtitle: `Song, ${artistName(song)}`, onPlay: () => player.playSongs(songs, 0, context) }
      : undefined;
  const playlistCards = playlists.map((p) => <SpotifyPlaylistCard key={p.id} playlist={p} />);
  const blocks: Block[] = [
    { kind: "Songs", count: songs.length, row: null, all: <TrackList songs={songs} context={context} art album /> },
    { kind: "Albums", count: albums.length, row: <CardRow>{albums.map((a) => <SpotifyAlbumCard key={a.id} album={a} />)}</CardRow>, all: <CardRow grid>{albums.map((a) => <SpotifyAlbumCard key={a.id} album={a} />)}</CardRow> },
    { kind: "Artists", count: artists.length, row: <CardRow>{artists.map((a) => <SpotifyArtistCard key={a.id} artist={a} />)}</CardRow>, all: <CardRow grid>{artists.map((a) => <SpotifyArtistCard key={a.id} artist={a} />)}</CardRow> },
    { kind: "Playlists", count: playlists.length, row: <CardRow>{playlistCards}</CardRow>, all: <CardRow grid>{playlistCards}</CardRow> },
  ];
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

function LidarrSource({ q, filter }: { q: string; filter: Filter }) {
  const missing = useLidarrSearch(q, true);
  return (
    <section className="res-source" aria-label="Not in your library yet">
      <div className="source-h">
        <h2>Not in your library yet</h2>
        <p className="sub">Found on MusicBrainz. Lidarr downloads what you pick, and it shows up in your library when it’s ready.</p>
      </div>
      {missing.data?.length ? (
        <div className="get">{(filter === "All" ? missing.data.slice(0, 6) : missing.data).map((a) => <GetCard key={a.foreignAlbumId} album={a} />)}</div>
      ) : missing.isPending || missing.isFetching ? (
        <p className="muted source-note"><span className="spin" />Asking Lidarr about “{q}”…</p>
      ) : (
        <p className="muted source-note">Lidarr found no other albums for “{q}”.</p>
      )}
    </section>
  );
}

function Results({ q }: { q: string }) {
  const [filter, setFilter] = useState<Filter>("All");
  const { isFetching } = useSearch(q);
  const lidarrOn = Boolean(useCapabilities().data?.lidarr);
  const spotifyOn = useSpotifyOn();
  const local = filter !== "Get albums";
  return (
    <div className={isFetching ? "results fetching" : "results"}>
      <div className="chips filter-chips" role="group" aria-label="Filter results">
        {FILTERS.filter((f) => f !== "Get albums" || lidarrOn).map((f) => (
          <button key={f} type="button" className="pill" aria-pressed={filter === f} onClick={() => setFilter(f)}>{f}</button>
        ))}
      </div>
      {local ? <LibrarySource q={q} filter={filter} setFilter={setFilter} /> : null}
      {local && spotifyOn ? <SpotifySource q={q} filter={filter} setFilter={setFilter} /> : null}
      {lidarrOn && (filter === "All" || filter === "Albums" || filter === "Get albums") ? <LidarrSource q={q} filter={filter} /> : null}
    </div>
  );
}

export default function Search() {
  const mobile = useIsMobile();
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
  const box = <SearchBox value={text} onChange={setText} onCommit={() => text.trim() && remember(text.trim())} />;
  const q = urlQ.trim();


  return (
    <>
      {mobile ? (
        <>
          <MobileHeader title="Search" />
          <div className="psearch-wrap">{box}</div>
        </>
      ) : (
        <TopBar>{box}</TopBar>
      )}
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
