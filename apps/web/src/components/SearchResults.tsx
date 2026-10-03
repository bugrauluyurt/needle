import { Fragment, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import type { Song } from "@needle/shared";
import { artistName, clock, plural, releaseDateLabel } from "../lib/format.ts";
import { AS_GIVEN, SEARCH_SONG_SORTS, shownSongs } from "../lib/songs.ts";
import type { SongOrder } from "../lib/songs.ts";
import { albumPath } from "../lib/paths.ts";
import { player } from "../player/controller.ts";
import type { PlayContext } from "../player/store.ts";
import { usePlaylists, useSearch } from "../queries/hooks.ts";
import { Art } from "./Art.tsx";
import { albumItem, artistItem, CardRow, ItemCard, playArtist, RowHeader } from "./Cards.tsx";
import { Collection, CollectionTools, SORT_LABELS } from "./Collection.tsx";
import type { CollectionItem, SortOption } from "./Collection.tsx";
import { Icon } from "./Icon.tsx";
import { TrackList } from "./TrackList.tsx";
import type { TrackColumn } from "./TrackList.tsx";
import { SearchField } from "./SearchField.tsx";
import { SourceMark } from "./SpotifyMark.tsx";

export const FILTERS = ["All", "Songs", "Albums", "Artists", "Playlists", "Get music"] as const;
export type Filter = (typeof FILTERS)[number];
export const LIBRARY_FILTERS = FILTERS.filter((f) => f !== "Get music");

export function FilterChips({
  filters,
  value,
  onChange,
  label,
}: {
  filters: readonly Filter[];
  value: Filter;
  onChange: (f: Filter) => void;
  label: string;
}) {
  return (
    <div className="chips filter-chips" role="group" aria-label={label}>
      {filters.map((f) => (
        <button
          key={f}
          type="button"
          className={f === "Get music" ? "pill get-pill" : "pill"}
          aria-pressed={value === f}
          onClick={() => onChange(f)}
        >
          {f === "Get music" ? <Icon name="download" size={14} /> : null}
          {f}
        </button>
      ))}
    </div>
  );
}

export type Top = { to: string; art: ReactNode; title: string; subtitle: string; onPlay: () => void };

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
            <div className="s">
              <SourceMark source={s.source} compact />
              {artistName(s)}, {s.album}
            </div>
          </div>
          <span className="tabular muted">{clock(s.duration)}</span>
        </button>
      ))}
    </div>
  );
}

export type SearchKind = "Songs" | "Albums" | "Artists" | "Playlists";
export type Block = { kind: SearchKind; count: number; row: ReactNode; all: ReactNode };
type SourceProps = {
  title: string;
  heading?: boolean;
  subtitle?: string;
  filter: Filter;
  setFilter: (f: Filter) => void;
  onShowAll?: ((kind: SearchKind) => void) | undefined;
  blocks: Block[];
  top?: Top | undefined;
  songs?: Song[];
  context: PlayContext;
  status: "loading" | "error" | "ok" | "paused";
  empty: (kind: string) => string;
};

const SEARCH_SORTS: Record<Exclude<SearchKind, "Songs">, SortOption[]> = {
  Albums: [
    ["default", "Most relevant"],
    ["title", SORT_LABELS.title],
    ["by", "Artist"],
    ["year", SORT_LABELS.year],
    ["plays", "Most played"],
  ],
  Artists: [
    ["default", "Most relevant"],
    ["title", SORT_LABELS.title],
  ],
  Playlists: [
    ["default", "Most relevant"],
    ["title", SORT_LABELS.title],
    ["by", "Creator"],
  ],
};

export function cardBlock(
  kind: Exclude<SearchKind, "Songs">,
  items: CollectionItem[],
  { source = "library" }: { source?: "library" | "spotify" | "youtubeMusic" } = {},
): Block {
  return {
    kind,
    count: items.length,
    row: (
      <CardRow>
        {items.slice(0, 6).map((item) => (
          <ItemCard key={item.key} item={item} />
        ))}
      </CardRow>
    ),
    all: (
      <Collection
        id={`search-${source}-${kind.toLowerCase()}`}
        title={kind}
        items={items}
        sorts={source !== "library" ? [["default", "Most relevant"]] : SEARCH_SORTS[kind]}
      />
    ),
  };
}

export function Source({
  title,
  heading = true,
  subtitle,
  filter,
  setFilter,
  onShowAll,
  blocks,
  top,
  songs = [],
  context,
  status,
  empty,
}: SourceProps) {
  const kind = filter === "All" ? null : filter;
  const sourceLabel = title.charAt(0).toLowerCase() + title.slice(1);
  const visible = blocks.filter((b) => b.count && (!kind || b.kind === kind));
  const body = () => {
    if (status === "paused")
      return <p className="muted source-note">Search will resume after {title.replace(/^On /, "")}’s cooldown.</p>;
    if (status === "loading")
      return (
        <p className="muted source-note">
          <span className="spin" />
          Searching…
        </p>
      );
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
                <RowHeader
                  title="Songs"
                  action={
                    <button
                      type="button"
                      className="show-all"
                      aria-label={`Show all Songs ${sourceLabel}`}
                      onClick={() => (onShowAll ? onShowAll("Songs") : setFilter("Songs"))}
                    >
                      Show all
                    </button>
                  }
                />
                <SongsMini songs={songs} context={context} />
              </section>
            ) : null}
          </div>
        ) : null}
        {visible
          .filter((b) => b.kind !== "Songs")
          .map((b) => (
            <Fragment key={b.kind}>
              <RowHeader
                title={b.kind}
                action={
                  <button
                    type="button"
                    className="show-all"
                    aria-label={`Show all ${b.kind} ${sourceLabel}`}
                    onClick={() => (onShowAll ? onShowAll(b.kind) : setFilter(b.kind))}
                  >
                    Show all
                  </button>
                }
              />
              {b.row}
            </Fragment>
          ))}
      </>
    );
  };
  return (
    <section className={heading ? "res-source" : "res-source bare"} aria-label={title}>
      {heading ? (
        <div className="source-h">
          <h2>{title}</h2>
          {subtitle ? <p className="sub">{subtitle}</p> : null}
        </div>
      ) : null}
      {body()}
    </section>
  );
}

const RELEASED: TrackColumn = { label: "Released", value: releaseDateLabel, sort: "year" };

function LibrarySearchSongs({ songs, context }: { songs: Song[]; context: PlayContext }) {
  const [query, setQuery] = useState("");
  const [order, setOrder] = useState<SongOrder>(AS_GIVEN);
  const matchingSongs = useMemo(() => shownSongs(songs, order, query), [songs, order, query]);

  return (
    <>
      <RowHeader
        title="Songs"
        action={
          <div className="coll-tools">
            <SearchField variant="inline" collapsible value={query} onChange={setQuery} label="Find in results" />
            <CollectionTools sorts={SEARCH_SONG_SORTS} order={order} onOrder={setOrder} />
          </div>
        }
      />
      <TrackList songs={matchingSongs} context={context} art album column={RELEASED} order={order} onOrder={setOrder} />
      {!matchingSongs.length ? <p className="muted source-note">No songs match “{query}”.</p> : null}
    </>
  );
}

export function LibrarySource({
  q,
  filter,
  setFilter,
  onShowAll,
  heading = true,
}: {
  q: string;
  filter: Filter;
  setFilter: (f: Filter) => void;
  onShowAll?: ((kind: SearchKind) => void) | undefined;
  heading?: boolean;
}) {
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
    ? {
        to: `/artist/${artist.id}`,
        art: <Art id={artist.coverArt} px={104} round fallback="artist" />,
        title: artist.name,
        subtitle: `Artist${artist.albumCount ? `, ${plural(artist.albumCount, "album")} in your library` : ""}`,
        onPlay: () => void playArtist(artist),
      }
    : song
      ? {
          to: song.albumId ? albumPath(song.albumId) : "#",
          art: <Art id={song.coverArt} px={104} />,
          title: song.title,
          subtitle: `Song, ${artistName(song)}`,
          onPlay: () => player.playSongs([song], 0, context),
        }
      : undefined;
  const blocks: Block[] = [
    { kind: "Songs", count: songs.length, row: null, all: <LibrarySearchSongs songs={songs} context={context} /> },
    cardBlock(
      "Albums",
      albums.map((a) => albumItem(a)),
    ),
    cardBlock(
      "Artists",
      artists.map((a) => artistItem(a)),
    ),
    cardBlock(
      "Playlists",
      matchingPlaylists.map((p): CollectionItem => ({
        key: p.id,
        to: `/playlist/${p.id}`,
        art: (px) => <Art id={p.coverArt} version={p.changed} px={px} />,
        title: p.name,
        subtitle: `Playlist, ${p.owner ?? ""}`.replace(/, $/, ""),
        by: p.owner ?? "",
      })),
    ),
  ];
  return (
    <Source
      title="In your library"
      heading={heading}
      filter={filter}
      setFilter={setFilter}
      onShowAll={onShowAll}
      blocks={blocks}
      top={top}
      songs={songs}
      context={context}
      status={data ? "ok" : isError ? "error" : "loading"}
      empty={(kind) => (kind ? `No ${kind} in your library match “${q}”.` : `Nothing in your library matches “${q}”.`)}
    />
  );
}
