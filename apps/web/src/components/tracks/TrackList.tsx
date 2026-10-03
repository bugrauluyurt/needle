import { useVirtualizer } from "@tanstack/react-virtual";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties, ReactNode } from "react";
import type { Song } from "@needle/shared";
import { useOffline } from "../../offline/store.ts";
import { player } from "../../player/controller.ts";
import type { PlayContext } from "../../player/store.ts";
import { useLocate, usePlayer } from "../../player/store.ts";
import { useIsMobile } from "../../lib/media.ts";
import { useActiveRemote } from "../../features/remote/client.ts";
import { useSongLikes } from "../../queries/likes.ts";
import { Art } from "../Art.tsx";
import { Icon } from "../Icon.tsx";
import { useScrollContainer } from "../ScrollContext.ts";
import type { TrackMenuExtra } from "./TrackMenu.tsx";
import { nextOrder } from "../../lib/order.ts";
import { AS_GIVEN, shownSongs } from "../../lib/songs.ts";
import type { SongOrder, SongSort } from "../../lib/songs.ts";
import { SortArrow } from "../Collection.tsx";
import { translate } from "../../i18n/index.ts";
import { TrackRow } from "./TrackRow.tsx";
import type { TrackColumn } from "./types.ts";

export type { TrackColumn } from "./types.ts";

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
const CHROME = {
  desktop: { top: 100, bottom: 0 },
  phone: { top: 56, bottom: 136 },
};

type Side = "up" | "down";

let locateHandled = 0;

const scrollBehavior = (): ScrollBehavior =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth";

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
      className={["sortable", active ? "on" : "", className ?? ""]
        .filter(Boolean)
        .join(" ")}
      role="columnheader"
      aria-sort={state}
    >
      {canSort ? (
        <button
          type="button"
          aria-label={translate("track.sortBy", {
            label: label.toLocaleLowerCase(),
          })}
          onClick={() => onSort(sort)}
          data-no-tip
        >
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
  const list = useMemo(
    () => (order ? songs : shownSongs(songs, own, "")),
    [order, songs, own],
  );
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
  const select = useCallback(
    (i: number) => setSelected(list[i]?.id ?? null),
    [list],
  );
  const like = likes.setLiked;

  const scroller = useScrollContainer();
  const listRef = useRef<HTMLDivElement>(null);
  const [margin, setMargin] = useState(0);
  const [rowH, setRowH] = useState(ROW);
  const virtual = shown.length > VIRTUALIZE_AFTER && Boolean(scroller);
  const chrome = useIsMobile() ? CHROME.phone : CHROME.desktop;
  const at = useMemo(
    () => (currentId ? shown.findIndex((s) => s.id === currentId) : -1),
    [shown, currentId],
  );
  useLayoutEffect(() => {
    if (!virtual || !listRef.current || !scroller?.current) return;
    const measure = () => {
      const el = listRef.current;
      const sc = scroller.current;
      if (el && sc)
        setMargin(
          el.getBoundingClientRect().top -
            sc.getBoundingClientRect().top +
            sc.scrollTop,
        );
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
    const h = rendered
      ? listRef.current?.querySelector<HTMLElement>(".tr")?.offsetHeight
      : undefined;
    if (h) setRowH(h);
  }, [rendered, chrome]);
  useLayoutEffect(() => v.measure(), [v, rowH]);

  const [ioSide, setIoSide] = useState<Side | null>(null);
  useEffect(() => {
    const root = scroller?.current;
    const target =
      !virtual && at >= 0 ? listRef.current?.children[at] : undefined;
    if (!root || !target) return;
    const io = new IntersectionObserver(
      (entries) => {
        const e = entries.at(-1);
        if (e)
          setIoSide(
            e.intersectionRatio >= 0.5
              ? null
              : e.boundingClientRect.top < (e.rootBounds?.top ?? 0)
                ? "up"
                : "down",
          );
      },
      {
        root,
        rootMargin: `-${chrome.top}px 0px -${chrome.bottom}px 0px`,
        threshold: [0, 0.5, 1],
      },
    );
    io.observe(target);
    return () => io.disconnect();
  }, [scroller, virtual, at, chrome]);
  const virtualSide = (): Side | null => {
    const top = (v.scrollOffset ?? 0) + chrome.top;
    const bottom =
      (v.scrollOffset ?? 0) + (v.scrollRect?.height ?? 0) - chrome.bottom;
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
    listRef.current
      ?.querySelector<HTMLElement>(".tr.located")
      ?.focus({ preventScroll: true });
    const timer = window.setTimeout(() => setLocated(null), PULSE_MS);
    return () => window.clearTimeout(timer);
  }, [located]);
  const locate = useCallback(() => {
    const sc = scroller?.current;
    if (at < 0 || !sc) return;
    if (virtual)
      v.scrollToIndex(at, { align: "center", behavior: scrollBehavior() });
    else
      listRef.current?.children[at]?.scrollIntoView({
        block: "center",
        behavior: scrollBehavior(),
      });
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
        if (dragFrom.current !== null && dragFrom.current !== to)
          onReorder?.(dragFrom.current, to);
        dragFrom.current = null;
      }}
      {...(style ? { style } : {})}
    />
  );

  const cols = [
    "tracks",
    art ? "with-art" : "",
    album ? "with-album" : "",
    column ? "with-col" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  const playingSong = at >= 0 ? shown[at] : undefined;
  return (
    <div
      className={cols}
      style={
        column?.width ? ({ "--col": column.width } as CSSProperties) : undefined
      }
    >
      <div role="table" aria-label={context.name}>
        {header ? (
          <div className="th" role="row">
            <span className="r" role="columnheader">
              <button
                type="button"
                className="th-reset"
                aria-label={translate("track.originalOrder")}
                disabled={
                  !canSort ||
                  (current.key === fallback.key &&
                    current.desc === fallback.desc)
                }
                onClick={() => (onOrder ?? setOwn)(fallback)}
                data-no-tip
              >
                #
              </button>
            </span>
            <SortHeader
              label={translate("track.title")}
              sort="title"
              order={current}
              onSort={sortBy}
              canSort={canSort}
            />
            {album ? (
              <SortHeader
                label={translate("track.album")}
                sort="album"
                order={current}
                onSort={sortBy}
                canSort={canSort}
              />
            ) : null}
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
              label={translate("track.duration")}
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
          style={
            virtual
              ? { height: v.getTotalSize(), position: "relative" }
              : undefined
          }
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
              <b>{translate("track.nowPlaying")}</b> · {playingSong.title}
            </span>
            <Icon name="arrow" size={16} className={side} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
