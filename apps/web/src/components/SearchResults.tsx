import { Fragment, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import type { Song } from "@needle/shared";
import { artistName, clock, plural, releaseDateLabel } from "../lib/format.ts";
import { AS_GIVEN, searchSongSorts, shownSongs } from "../lib/songs.ts";
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
import { TrackList } from "./tracks/TrackList.tsx";
import type { TrackColumn } from "./tracks/TrackList.tsx";
import { SearchField } from "./SearchField.tsx";
import { SourceMark } from "./SpotifyMark.tsx";
import { translate } from "../i18n/index.ts";

export const FILTERS = ["All", "Songs", "Albums", "Artists", "Playlists", "Get music"] as const;
export type Filter = (typeof FILTERS)[number];
export const LIBRARY_FILTERS = FILTERS.filter((f) => f !== "Get music");

function filterLabel(filter: Filter): string {
  switch (filter) {
    case "All":
      return translate("search.filterAll");
    case "Songs":
      return translate("search.filterSongs");
    case "Albums":
      return translate("search.albums");
    case "Artists":
      return translate("search.artists");
    case "Playlists":
      return translate("search.filterPlaylists");
    case "Get music":
      return translate("search.filterGetMusic");
  }
}

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
          {filterLabel(f)}
        </button>
      ))}
    </div>
  );
}

export type Top = {
  to: string;
  art: ReactNode;
  title: string;
  subtitle: string;
  onPlay: () => void;
};

function TopResult({ top }: { top: Top }) {
  return (
    <div className="top-card">
      <Link to={top.to} className="top-link">
        {top.art}
        <h2>{top.title}</h2>
        <div className="muted">{top.subtitle}</div>
      </Link>
      <button
        type="button"
        className="bigplay"
        aria-label={translate("track.play", { title: top.title })}
        onClick={top.onPlay}
      >
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
export type Block = {
  kind: SearchKind;
  count: number;
  row: ReactNode;
  all: ReactNode;
};

export function searchKindLabel(searchKind: SearchKind): string {
  switch (searchKind) {
    case "Songs":
      return translate("search.filterSongs");
    case "Albums":
      return translate("search.albums");
    case "Artists":
      return translate("search.artists");
    case "Playlists":
      return translate("search.filterPlaylists");
  }
}
type SourceProps = {
  title: string;
  sourceName?: string;
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
  empty: (kind: SearchKind | null) => string;
};

const searchSorts = (): Record<Exclude<SearchKind, "Songs">, SortOption[]> => ({
  Albums: [
    ["default", translate("collection.mostRelevant")],
    ["title", SORT_LABELS.title],
    ["by", translate("search.artists")],
    ["year", SORT_LABELS.year],
    ["plays", translate("sort.mostPlayed")],
  ],
  Artists: [
    ["default", translate("collection.mostRelevant")],
    ["title", SORT_LABELS.title],
  ],
  Playlists: [
    ["default", translate("collection.mostRelevant")],
    ["title", SORT_LABELS.title],
    ["by", translate("collection.creator")],
  ],
});

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
        title={searchKindLabel(kind)}
        items={items}
        sorts={source !== "library" ? [["default", translate("collection.mostRelevant")]] : searchSorts()[kind]}
      />
    ),
  };
}

export function Source({
  title,
  sourceName = title,
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
  const kind = filter === "All" || filter === "Get music" ? null : filter;
  const sourceLabel = title.charAt(0).toLowerCase() + title.slice(1);
  const visible = blocks.filter((b) => b.count && (!kind || b.kind === kind));
  const body = () => {
    if (status === "paused")
      return (
        <p className="muted source-note">
          {translate("search.sourcePaused", {
            source: sourceName,
          })}
        </p>
      );
    if (status === "loading")
      return (
        <p className="muted source-note">
          <span className="spin" />
          {translate("search.searching")}
        </p>
      );
    if (status === "error")
      return <p className="muted source-note">{translate("search.sourceError", { source: sourceName })}</p>;
    if (!visible.length) return <p className="muted source-note">{empty(kind)}</p>;
    if (kind) return visible[0]?.all;
    return (
      <>
        {top || songs.length ? (
          <div className="res-top">
            {top ? (
              <section>
                <RowHeader title={translate("search.topResult")} />
                <TopResult top={top} />
              </section>
            ) : null}
            {songs.length ? (
              <section>
                <RowHeader
                  title={translate("catalog.songs")}
                  action={
                    <button
                      type="button"
                      className="show-all"
                      aria-label={`${translate("common.showAll")} ${translate("catalog.songs")} ${sourceLabel}`}
                      onClick={() => (onShowAll ? onShowAll("Songs") : setFilter("Songs"))}
                    >
                      {translate("common.showAll")}
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
                title={searchKindLabel(b.kind)}
                action={
                  <button
                    type="button"
                    className="show-all"
                    aria-label={`${translate("common.showAll")} ${searchKindLabel(b.kind)} ${sourceLabel}`}
                    onClick={() => (onShowAll ? onShowAll(b.kind) : setFilter(b.kind))}
                  >
                    {translate("common.showAll")}
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

const releasedColumn = (): TrackColumn => ({
  label: translate("search.released"),
  value: releaseDateLabel,
  sort: "year",
});

function LibrarySearchSongs({ songs, context }: { songs: Song[]; context: PlayContext }) {
  const [query, setQuery] = useState("");
  const [order, setOrder] = useState<SongOrder>(AS_GIVEN);
  const matchingSongs = useMemo(() => shownSongs(songs, order, query), [songs, order, query]);

  return (
    <>
      <RowHeader
        title={translate("catalog.songs")}
        action={
          <div className="coll-tools">
            <SearchField
              variant="inline"
              collapsible
              value={query}
              onChange={setQuery}
              label={translate("search.findResults")}
            />
            <CollectionTools sorts={searchSongSorts()} order={order} onOrder={setOrder} />
          </div>
        }
      />
      <TrackList
        songs={matchingSongs}
        context={context}
        art
        album
        column={releasedColumn()}
        order={order}
        onOrder={setOrder}
      />
      {!matchingSongs.length ? (
        <p className="muted source-note">{translate("search.noMatchingSongs", { query })}</p>
      ) : null}
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
  const context: PlayContext = {
    kind: "search",
    name: translate("search.context", { query: q }),
  };
  const artist = artists.find((a) => a.name.toLowerCase() === q.toLowerCase()) ?? artists[0];
  const song = songs[0];
  const top: Top | undefined = artist
    ? {
        to: `/artist/${artist.id}`,
        art: <Art id={artist.coverArt} px={104} round fallback="artist" />,
        title: artist.name,
        subtitle: translate("search.libraryArtist", {
          albums: artist.albumCount
            ? translate("search.libraryArtistAlbums", {
                albums: plural(artist.albumCount, "album"),
              })
            : "",
        }),
        onPlay: () => void playArtist(artist),
      }
    : song
      ? {
          to: song.albumId ? albumPath(song.albumId) : "#",
          art: <Art id={song.coverArt} px={104} />,
          title: song.title,
          subtitle: translate("search.songArtist", {
            artist: artistName(song),
          }),
          onPlay: () => player.playSongs([song], 0, context),
        }
      : undefined;
  const blocks: Block[] = [
    {
      kind: "Songs",
      count: songs.length,
      row: null,
      all: <LibrarySearchSongs songs={songs} context={context} />,
    },
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
        subtitle: p.owner ? translate("search.playlistOwner", { owner: p.owner }) : translate("playlist.kind"),
        by: p.owner ?? "",
      })),
    ),
  ];
  return (
    <Source
      title={translate("search.inLibrary")}
      heading={heading}
      filter={filter}
      setFilter={setFilter}
      onShowAll={onShowAll}
      blocks={blocks}
      top={top}
      songs={songs}
      context={context}
      status={data ? "ok" : isError ? "error" : "loading"}
      empty={(kind) =>
        kind
          ? translate("search.libraryKindNoMatch", {
              kind: searchKindLabel(kind),
              query: q,
            })
          : translate("search.libraryNoMatch", { query: q })
      }
    />
  );
}
