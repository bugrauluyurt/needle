import { useVirtualizer } from "@tanstack/react-virtual";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, DragEvent, KeyboardEvent, MouseEvent, ReactNode } from "react";
import { Link } from "react-router";
import type { Song } from "@needle/shared";
import { songSource } from "@needle/shared";
import { artistName, clock } from "../lib/format.ts";
import { useOffline } from "../offline/store.ts";
import { player } from "../player/controller.ts";
import type { PlayContext } from "../player/store.ts";
import { useLocate, usePlayer } from "../player/store.ts";
import { useIsMobile } from "../layout/Shell.tsx";
import { useActiveRemote } from "../remote/client.ts";
import { useSongLikes } from "../queries/likes.ts";
import { Art } from "./Art.tsx";
import { Eq, Icon } from "./Icon.tsx";
import { SourceMark } from "./SpotifyMark.tsx";
import { useScrollContainer } from "./ScrollContext.ts";
import type { TrackMenuExtra } from "./TrackMenu.tsx";
import { openTrackMenu, TrackMoreButton } from "./TrackMenu.tsx";
import { albumPath, artistPath } from "../lib/paths.ts";
import { nextOrder } from "../lib/order.ts";
import { AS_GIVEN, shownSongs } from "../lib/songs.ts";
import type { SongOrder, SongSort } from "../lib/songs.ts";
import { SortArrow } from "./Collection.tsx";

export type TrackColumn = {
  label: string;
  value: (song: Song, index: number) => string;
  width?: string;
  sort?: SongSort;
};

type TrackListProps = {
  songs: Song[];
  context: PlayContext;
  art?: boolean;
  album?: boolean;
  column?: TrackColumn;
  numbers?: "index" | "track";
  header?: boolean;
  onReorder?: (from: number, to: number) => void;
  menuExtra?: (song: Song, index: number) => TrackMenuExtra[];
  className?: string;
  limit?: number;
  onPlay?: (index: number) => void;
  order?: SongOrder;
  onOrder?: (order: SongOrder) => void;
  fallback?: SongOrder;
  canSort?: boolean;
};

const ROW = 56;
const VIRTUALIZE_AFTER = 80;
const PULSE_MS = 1_000;
const SCROLL_SETTLE_MS = 900;
const CHROME = { desktop: { top: 100, bottom: 0 }, phone: { top: 56, bottom: 136 } };

type Side = "up" | "down";

let locateHandled = 0;

const scrollBehavior = (): ScrollBehavior =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";

type RowProps = {
  song: Song;
  index: number;
  number: number;
  art: boolean;
  album: boolean;
  column: TrackColumn | undefined;
  playing: boolean;
  paused: boolean;
  elsewhere: boolean;
  located: boolean;
  liked: boolean;
  downloaded: boolean;
  selected: boolean;
  draggable: boolean;
  extra: TrackMenuExtra[] | undefined;
  style?: CSSProperties;
  onSelect: (i: number) => void;
  onPlay: (i: number) => void;
  onLike: (song: Song, on: boolean) => void;
  onDragStart?: (i: number) => void;
  onDropAt?: (i: number) => void;
};

const TrackRow = memo(function TrackRow(p: RowProps) {
  const [over, setOver] = useState(false);
  const pointer = useRef("mouse");
  const press = useRef<{ timer: number; x: number; y: number; fired: boolean } | null>(null);
  const menu = (x: number, y: number) => openTrackMenu([p.song], { x, y }, p.extra);
  const cancelPress = () => {
    if (press.current) window.clearTimeout(press.current.timer);
  };
  const click = (e: MouseEvent) => {
    if (press.current?.fired) {
      press.current = null;
      return;
    }
    if ((e.target as HTMLElement).closest("a,button")) return;
    if (pointer.current === "touch" && p.song.isAvailable !== false) p.onPlay(p.index);
    else p.onSelect(p.index);
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === "Enter" && p.song.isAvailable !== false) p.onPlay(p.index);
  };
  const drag = p.draggable
    ? {
        draggable: true,
        onDragStart: (e: DragEvent) => {
          e.dataTransfer.effectAllowed = "move";
          p.onDragStart?.(p.index);
        },
        onDragOver: (e: DragEvent) => {
          e.preventDefault();
          setOver(true);
        },
        onDragLeave: () => setOver(false),
        onDrop: (e: DragEvent) => {
          e.preventDefault();
          setOver(false);
          p.onDropAt?.(p.index);
        },
      }
    : {};
  return (
    <div
      className={`tr ${p.song.isAvailable === false ? "unavailable" : ""} ${p.playing ? "playing" : ""} ${p.located ? "located" : ""} ${p.selected ? "sel" : ""} ${over ? "drop" : ""}`}
      style={p.style}
      role="row"
      tabIndex={0}
      aria-selected={p.selected}
      onPointerDown={(e) => {
        pointer.current = e.pointerType;
        if (e.pointerType !== "touch") return;
        const { clientX: x, clientY: y } = e;
        press.current = {
          x,
          y,
          fired: false,
          timer: window.setTimeout(() => {
            if (press.current) press.current.fired = true;
            navigator.vibrate?.(10);
            menu(x, y);
          }, 550),
        };
      }}
      onPointerMove={(e) => {
        const s = press.current;
        if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 10) cancelPress();
      }}
      onPointerUp={cancelPress}
      onPointerCancel={cancelPress}
      onContextMenu={(e) => {
        e.preventDefault();
        if (pointer.current !== "touch") menu(e.clientX, e.clientY);
      }}
      onClick={click}
      onDoubleClick={() => p.song.isAvailable !== false && p.onPlay(p.index)}
      onKeyDown={key}
      {...drag}
    >
      <span className="n" role="cell">
        {p.playing && !p.elsewhere ? <Eq paused={p.paused} /> : <span className="num">{p.number}</span>}
        <button
          type="button"
          className="row-play"
          disabled={p.song.isAvailable === false}
          aria-label={
            p.song.isAvailable === false
              ? `${p.song.title} is unavailable`
              : p.playing && !p.paused
                ? `Pause ${p.song.title}`
                : `Play ${p.song.title}`
          }
          onClick={() => (p.playing ? player.toggle() : p.onPlay(p.index))}
        >
          <Icon name={p.playing && !p.paused ? "pause" : "play"} size={14} />
        </button>
      </span>
      <div className="tt" role="cell">
        {p.art ? <Art id={p.song.coverArt} px={40} /> : null}
        <div>
          <div className="name">{p.song.title}</div>
          <div className="by">
            {p.downloaded ? (
              <span className="dlmark" title="Downloaded">
                <Icon name="downloaded" size={13} />
              </span>
            ) : null}
            <SourceMark source={songSource(p.song)} compact />
            {p.song.artistId ? <Link to={artistPath(p.song.artistId)}>{artistName(p.song)}</Link> : artistName(p.song)}
            {p.song.isAvailable === false ? <span>Unavailable</span> : null}
          </div>
        </div>
      </div>
      {p.album ? (
        <span className="alb" role="cell">
          {p.song.albumId ? <Link to={albumPath(p.song.albumId)}>{p.song.album}</Link> : p.song.album}
        </span>
      ) : null}
      {p.column ? (
        <span className="col" role="cell">
          {p.column.value(p.song, p.index)}
        </span>
      ) : null}
      <span className="d" role="cell">
        <button
          type="button"
          className={p.liked ? "heart liked" : "heart"}
          aria-label={p.liked ? `Remove ${p.song.title} from liked songs` : `Add ${p.song.title} to liked songs`}
          aria-pressed={p.liked}
          onClick={() => p.onLike(p.song, !p.liked)}
        >
          <Icon name={p.liked ? "heartFill" : "heart"} size={16} />
        </button>
        <span className="tabular">{clock(p.song.duration)}</span>
        <TrackMoreButton
          songs={[p.song]}
          className="row-more"
          size={18}
          label={`More options for ${p.song.title}`}
          {...(p.extra ? { extra: p.extra } : {})}
        />
      </span>
    </div>
  );
});

function SortHeader({
  label,
  sort,
  order,
  onSort,
  className,
  children,
  canSort = true,
}: {
  label: string;
  sort: SongSort;
  order: SongOrder;
  onSort: (sort: SongSort) => void;
  className?: string;
  children?: ReactNode;
  canSort?: boolean;
}) {
  const active = order.key === sort;
  const state = active ? (order.desc ? "descending" : "ascending") : "none";
  return (
    <span
      className={["sortable", active ? "on" : "", className ?? ""].filter(Boolean).join(" ")}
      role="columnheader"
      aria-sort={state}
    >
      {canSort ? (
        <button type="button" aria-label={`Sort by ${label.toLowerCase()}`} onClick={() => onSort(sort)} data-no-tip>
          {children ?? label}
          <SortArrow desc={active && order.desc} />
        </button>
      ) : (
        (children ?? label)
      )}
    </span>
  );
}

export function TrackList({
  songs,
  context,
  art = false,
  album = false,
  column,
  numbers = "index",
  header = true,
  onReorder,
  menuExtra,
  className,
  limit,
  onPlay,
  order,
  onOrder,
  fallback = AS_GIVEN,
  canSort = true,
}: TrackListProps) {
  const currentId = usePlayer((s) => s.items[s.index]?.song.id);
  const paused = usePlayer((s) => !s.playing);
  const elsewhere = Boolean(useActiveRemote());
  const likes = useSongLikes();
  const downloaded = useOffline((s) => s.songs);
  const [selected, setSelected] = useState<string | null>(null);
  const [own, setOwn] = useState(fallback);
  const current = order ?? own;
  const sortBy = useCallback(
    (sort: SongSort) => (onOrder ?? setOwn)(nextOrder(current, sort, fallback)),
    [onOrder, current, fallback],
  );
  const list = useMemo(() => (order ? songs : shownSongs(songs, own, "")), [order, songs, own]);
  const dragFrom = useRef<number | null>(null);
  const shown = limit ? list.slice(0, limit) : list;

  const resorted = !order && own !== fallback;
  const play = useCallback(
    (songIndex: number) => {
      if (list[songIndex]?.isAvailable === false) return;

      if (onPlay && !resorted) onPlay(songIndex);
      else player.playSongs(list, songIndex, context);
    },
    [list, context, onPlay, resorted],
  );
  const select = useCallback((i: number) => setSelected(list[i]?.id ?? null), [list]);
  const like = likes.setLiked;

  const scroller = useScrollContainer();
  const listRef = useRef<HTMLDivElement>(null);
  const [margin, setMargin] = useState(0);
  const [rowH, setRowH] = useState(ROW);
  const virtual = shown.length > VIRTUALIZE_AFTER && Boolean(scroller);
  const chrome = useIsMobile() ? CHROME.phone : CHROME.desktop;
  const at = useMemo(() => (currentId ? shown.findIndex((s) => s.id === currentId) : -1), [shown, currentId]);
  useLayoutEffect(() => {
    if (!virtual || !listRef.current || !scroller?.current) return;
    const measure = () => {
      const el = listRef.current;
      const sc = scroller.current;
      if (el && sc) setMargin(el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(scroller.current);
    return () => ro.disconnect();
  }, [virtual, scroller]);
  const v = useVirtualizer({
    count: virtual ? shown.length : 0,
    getScrollElement: () => scroller?.current ?? null,
    estimateSize: () => rowH,
    overscan: 12,
    scrollMargin: margin,
  });
  const rendered = virtual && v.getVirtualItems().length > 0;
  useLayoutEffect(() => {
    const h = rendered ? listRef.current?.querySelector<HTMLElement>(".tr")?.offsetHeight : undefined;
    if (h) setRowH(h);
  }, [rendered, chrome]);
  useLayoutEffect(() => v.measure(), [v, rowH]);

  const [ioSide, setIoSide] = useState<Side | null>(null);
  useEffect(() => {
    const root = scroller?.current;
    const target = !virtual && at >= 0 ? listRef.current?.children[at] : undefined;
    if (!root || !target) return;
    const io = new IntersectionObserver(
      (entries) => {
        const e = entries.at(-1);
        if (e)
          setIoSide(
            e.intersectionRatio >= 0.5 ? null : e.boundingClientRect.top < (e.rootBounds?.top ?? 0) ? "up" : "down",
          );
      },
      { root, rootMargin: `-${chrome.top}px 0px -${chrome.bottom}px 0px`, threshold: [0, 0.5, 1] },
    );
    io.observe(target);
    return () => io.disconnect();
  }, [scroller, virtual, at, chrome]);
  const virtualSide = (): Side | null => {
    const top = (v.scrollOffset ?? 0) + chrome.top;
    const bottom = (v.scrollOffset ?? 0) + (v.scrollRect?.height ?? 0) - chrome.bottom;
    const middle = margin + (at + 0.5) * rowH;
    return middle < top ? "up" : middle > bottom ? "down" : null;
  };
  const side = at < 0 ? null : virtual ? virtualSide() : ioSide;
  const sideRef = useRef(side);
  useEffect(() => {
    sideRef.current = side;
  });

  const [located, setLocated] = useState<number | null>(null);
  useEffect(() => {
    if (located === null) return;
    listRef.current?.querySelector<HTMLElement>(".tr.located")?.focus({ preventScroll: true });
    const timer = window.setTimeout(() => setLocated(null), PULSE_MS);
    return () => window.clearTimeout(timer);
  }, [located]);
  const locate = useCallback(() => {
    const sc = scroller?.current;
    if (at < 0 || !sc) return;
    if (virtual) v.scrollToIndex(at, { align: "center", behavior: scrollBehavior() });
    else listRef.current?.children[at]?.scrollIntoView({ block: "center", behavior: scrollBehavior() });
    let done = false;
    const pulse = () => {
      if (done) return;
      done = true;
      sc.removeEventListener("scrollend", pulse);
      setLocated(at);
    };
    if (!sideRef.current) {
      pulse();
      return;
    }
    sc.addEventListener("scrollend", pulse);
    window.setTimeout(pulse, SCROLL_SETTLE_MS);
  }, [scroller, virtual, v, at]);
  useEffect(() => {
    if (at < 0) return;
    useLocate.setState((s) => ({ lists: s.lists + 1 }));
    const off = useLocate.subscribe((s, prev) => {
      if (s.request === prev.request || s.request <= locateHandled) return;
      locateHandled = s.request;
      locate();
    });
    return () => {
      off();
      useLocate.setState((s) => ({ lists: s.lists - 1 }));
    };
  }, [at, locate]);

  const row = (song: Song, i: number, style?: CSSProperties) => (
    <TrackRow
      key={`${song.id}-${i}`}
      song={song}
      index={i}
      number={numbers === "track" ? (song.track ?? i + 1) : i + 1}
      art={art}
      album={album}
      column={column}
      playing={song.id === currentId}
      paused={paused}
      elsewhere={elsewhere}
      located={located === i}
      liked={likes.isLiked(song)}
      downloaded={downloaded.has(song.id)}
      selected={selected === song.id}
      draggable={Boolean(onReorder)}
      extra={menuExtra?.(song, i)}
      onSelect={select}
      onPlay={play}
      onLike={like}
      onDragStart={(from) => (dragFrom.current = from)}
      onDropAt={(to) => {
        if (dragFrom.current !== null && dragFrom.current !== to) onReorder?.(dragFrom.current, to);
        dragFrom.current = null;
      }}
      {...(style ? { style } : {})}
    />
  );

  const cols = ["tracks", art ? "with-art" : "", album ? "with-album" : "", column ? "with-col" : "", className ?? ""]
    .filter(Boolean)
    .join(" ");
  const playingSong = at >= 0 ? shown[at] : undefined;
  return (
    <div className={cols} style={column?.width ? ({ "--col": column.width } as CSSProperties) : undefined}>
      <div role="table" aria-label={context.name}>
        {header ? (
          <div className="th" role="row">
            <span className="r" role="columnheader">
              <button
                type="button"
                className="th-reset"
                aria-label="Original order"
                disabled={!canSort || (current.key === fallback.key && current.desc === fallback.desc)}
                onClick={() => (onOrder ?? setOwn)(fallback)}
                data-no-tip
              >
                #
              </button>
            </span>
            <SortHeader label="Title" sort="title" order={current} onSort={sortBy} canSort={canSort} />
            {album ? <SortHeader label="Album" sort="album" order={current} onSort={sortBy} canSort={canSort} /> : null}
            {column ? (
              column.sort ? (
                <SortHeader
                  label={column.label}
                  sort={column.sort}
                  order={current}
                  onSort={sortBy}
                  className="col"
                  canSort={canSort}
                />
              ) : (
                <span className="col" role="columnheader">
                  {column.label}
                </span>
              )
            ) : null}
            <SortHeader
              label="Duration"
              sort="duration"
              order={current}
              onSort={sortBy}
              className="r"
              canSort={canSort}
            >
              <Icon name="clock" size={16} />
            </SortHeader>
          </div>
        ) : null}
        <div
          ref={listRef}
          className="tbody"
          role="rowgroup"
          style={virtual ? { height: v.getTotalSize(), position: "relative" } : undefined}
        >
          {virtual
            ? v.getVirtualItems().map((item) => {
                const song = shown[item.index];
                return song
                  ? row(song, item.index, {
                      position: "absolute",
                      top: 0,
                      left: 0,
                      right: 0,
                      transform: `translateY(${item.start - v.options.scrollMargin}px)`,
                    })
                  : null;
              })
            : shown.map((s, i) => row(s, i))}
        </div>
      </div>
      {side && playingSong ? (
        <div className="np-pill-dock">
          <button type="button" className="np-pill" onClick={locate}>
            <Art id={playingSong.coverArt} px={28} />
            <span className="ellipsis">
              <b>Now playing</b> · {playingSong.title}
            </span>
            <Icon name="arrow" size={16} className={side} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
