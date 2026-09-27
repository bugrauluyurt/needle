import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { GetCard } from "../components/GetCard.tsx";
import type { Artist, Song } from "@needle/shared";
import { Art } from "../components/Art.tsx";
import { AlbumCard, ArtistCard, Card, CardRow, playArtist, RowHeader } from "../components/Cards.tsx";
import { Icon } from "../components/Icon.tsx";
import { TrackList } from "../components/TrackList.tsx";
import { artistName, clock } from "../lib/format.ts";
import { sub } from "../lib/subsonic.ts";
import type { AlbumListType } from "../lib/subsonic.ts";
import { useDelayed } from "../lib/useDelayed.ts";
import { TILE_COLORS } from "../lib/palette.ts";

const tile = (i: number) => TILE_COLORS[i % TILE_COLORS.length] ?? "#1E3C78";
import { player } from "../player/controller.ts";
import { tileCoversOptions, useCapabilities, useGenres, useLidarrSearch, usePlaylists, useSearch } from "../queries/hooks.ts";
import { keys } from "../queries/keys.ts";
import { usePageTone, useIsMobile } from "../layout/Shell.tsx";
import { TopBar } from "../layout/TopBar.tsx";
import { MobileHeader } from "../layout/Mobile.tsx";

const RECENT_KEY = "needle.recentSearches";
const FILTERS = ["All", "Songs", "Albums", "Artists", "Playlists", "Not in library"] as const;
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

function TopResult({ artist, song }: { artist: Artist | undefined; song: Song | undefined }) {
  if (artist) {
    return (
      <div className="top-card">
        <Link to={`/artist/${artist.id}`} className="top-link">
          <Art id={artist.coverArt} px={104} round fallback="artist" />
          <h2>{artist.name}</h2>
          <div className="muted">Artist{artist.albumCount ? `, ${artist.albumCount} ${artist.albumCount === 1 ? "album" : "albums"} in your library` : ""}</div>
        </Link>
        <button type="button" className="bigplay" aria-label={`Play ${artist.name}`} onClick={() => void playArtist(artist)}>
          <Icon name="play" size={22} />
        </button>
      </div>
    );
  }
  if (!song) return null;
  return (
    <div className="top-card">
      <Link to={song.albumId ? `/album/${song.albumId}` : "#"} className="top-link">
        <Art id={song.coverArt} px={104} />
        <h2>{song.title}</h2>
        <div className="muted">Song, {artistName(song)}</div>
      </Link>
      <button type="button" className="bigplay" aria-label={`Play ${song.title}`} onClick={() => player.playSongs([song], 0, { kind: "search", name: song.title })}>
        <Icon name="play" size={22} />
      </button>
    </div>
  );
}

function Results({ q }: { q: string }) {
  const [filter, setFilter] = useState<Filter>("All");
  const { data, isFetching } = useSearch(q);
  const caps = useCapabilities();
  const lidarrOn = Boolean(caps.data?.lidarr);
  const missing = useLidarrSearch(q, lidarrOn && (filter === "All" || filter === "Not in library"));
  const { data: playlists = [] } = usePlaylists();
  const matchingPlaylists = playlists.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()));
  const songs = data?.song ?? [];
  const albums = data?.album ?? [];
  const artists = data?.artist ?? [];
  const exactArtist = artists.find((a) => a.name.toLowerCase() === q.trim().toLowerCase()) ?? (artists[0] && !songs.length ? artists[0] : undefined) ?? artists[0];
  const context = { kind: "search" as const, name: `Search for “${q}”` };
  const nothing = data && !songs.length && !albums.length && !artists.length && !matchingPlaylists.length;
  const shown = FILTERS.filter((f) => f !== "Not in library" || lidarrOn);

  return (
    <div className={isFetching ? "results fetching" : "results"}>
      <div className="chips filter-chips" role="group" aria-label="Filter results">
        {shown.map((f) => (
          <button key={f} type="button" className="pill" aria-pressed={filter === f} onClick={() => setFilter(f)}>{f}</button>
        ))}
      </div>
      {nothing && filter !== "Not in library" ? (
        <div className="no-results">
          <h2>Nothing in your library matches “{q}”</h2>
          <p className="muted">{lidarrOn ? "Albums you don’t have yet are listed below." : "Check the spelling, or try fewer words."}</p>
        </div>
      ) : null}
      {filter === "All" && !nothing ? (
        <>
          <div className="res-top">
            <section>
              <RowHeader title="Top result" />
              <TopResult artist={exactArtist} song={songs[0]} />
            </section>
            {songs.length ? (
              <section>
                <RowHeader title="Songs" action={<button type="button" className="show-all" onClick={() => setFilter("Songs")}>Show all</button>} />
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
              </section>
            ) : null}
          </div>
          {albums.length ? (
            <>
              <RowHeader title="Albums in your library" action={<button type="button" className="show-all" onClick={() => setFilter("Albums")}>Show all</button>} />
              <CardRow>{albums.map((a) => <AlbumCard key={a.id} album={a} />)}</CardRow>
            </>
          ) : null}
          {artists.length ? (
            <>
              <RowHeader title="Artists" action={<button type="button" className="show-all" onClick={() => setFilter("Artists")}>Show all</button>} />
              <CardRow>{artists.map((a) => <ArtistCard key={a.id} artist={a} />)}</CardRow>
            </>
          ) : null}
          {matchingPlaylists.length ? (
            <>
              <RowHeader title="Playlists" />
              <CardRow>{matchingPlaylists.map((p) => <Card key={p.id} to={`/playlist/${p.id}`} art={<Art id={p.coverArt} px={180} />} title={p.name} subtitle={`Playlist, ${p.owner ?? ""}`} />)}</CardRow>
            </>
          ) : null}
        </>
      ) : null}
      {filter === "Songs" ? <TrackList songs={songs} context={context} art album /> : null}
      {filter === "Albums" ? <CardRow grid>{albums.map((a) => <AlbumCard key={a.id} album={a} />)}</CardRow> : null}
      {filter === "Artists" ? <CardRow grid>{artists.map((a) => <ArtistCard key={a.id} artist={a} />)}</CardRow> : null}
      {filter === "Playlists" ? <CardRow grid>{matchingPlaylists.map((p) => <Card key={p.id} to={`/playlist/${p.id}`} art={<Art id={p.coverArt} px={180} />} title={p.name} subtitle="Playlist" />)}</CardRow> : null}
      {lidarrOn && (filter === "All" || filter === "Not in library") ? (
        missing.data?.length ? (
          <>
            <RowHeader title="Not in your library yet" subtitle="Found on MusicBrainz. Lidarr downloads what you pick, and it shows up here when it’s ready." />
            <div className="get">{missing.data.map((a) => <GetCard key={a.foreignAlbumId} album={a} />)}</div>
          </>
        ) : missing.isFetching ? (
          <p className="muted source-note"><span className="spin" />Asking Lidarr about “{q}”…</p>
        ) : filter === "Not in library" ? (
          <p className="muted source-note">Lidarr found nothing new for “{q}”.</p>
        ) : null
      ) : null}
    </div>
  );
}

export default function Search() {
  const mobile = useIsMobile();
  const [params, setParams] = useSearchParams();
  const urlQ = params.get("q") ?? "";
  const [text, setText] = useState(urlQ);
  const [recent, setRecent] = useState(loadRecent);
  const qc = useQueryClient();
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

  useEffect(() => {
    if (q) void qc.prefetchQuery({ queryKey: keys.search(q), queryFn: () => sub.search(q) });
  }, [q, qc]);

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
