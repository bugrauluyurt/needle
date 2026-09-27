import { useVirtualizer } from "@tanstack/react-virtual";
import { memo, useCallback, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, DragEvent, KeyboardEvent, MouseEvent } from "react";
import { Link } from "react-router";
import type { Song } from "@needle/shared";
import { artistName, clock } from "../lib/format.ts";
import { useOffline } from "../offline/store.ts";
import { player } from "../player/controller.ts";
import type { PlayContext } from "../player/store.ts";
import { usePlayer } from "../player/store.ts";
import { useStarredIds, useToggleStar } from "../queries/hooks.ts";
import { Art } from "./Art.tsx";
import { Eq, Icon } from "./Icon.tsx";
import { useScrollContainer } from "./ScrollContext.ts";
import type { TrackMenuExtra } from "./TrackMenu.tsx";
import { openTrackMenu, TrackMoreButton } from "./TrackMenu.tsx";

export type TrackColumn = { label: string; value: (song: Song, index: number) => string; width?: string };

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
};

const ROW = 56;
const VIRTUALIZE_AFTER = 80;

type RowProps = {
  song: Song;
  index: number;
  number: number;
  art: boolean;
  album: boolean;
  column: TrackColumn | undefined;
  playing: boolean;
  paused: boolean;
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
    if (pointer.current === "touch") p.onPlay(p.index);
    else p.onSelect(p.index);
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === "Enter") p.onPlay(p.index);
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
      className={`tr ${p.playing ? "playing" : ""} ${p.selected ? "sel" : ""} ${over ? "drop" : ""}`}
      style={p.style}
      role="row"
      tabIndex={0}
      aria-selected={p.selected}
      onPointerDown={(e) => {
        pointer.current = e.pointerType;
        if (e.pointerType !== "touch") return;
        const { clientX: x, clientY: y } = e;
        press.current = { x, y, fired: false, timer: window.setTimeout(() => {
          if (press.current) press.current.fired = true;
          navigator.vibrate?.(10);
          menu(x, y);
        }, 550) };
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
      onDoubleClick={() => p.onPlay(p.index)}
      onKeyDown={key}
      {...drag}
    >
      <span className="n" role="cell">
        {p.playing ? <Eq paused={p.paused} /> : <span className="num">{p.number}</span>}
        <button type="button" className="row-play" aria-label={p.playing && !p.paused ? `Pause ${p.song.title}` : `Play ${p.song.title}`} onClick={() => (p.playing ? player.toggle() : p.onPlay(p.index))}>
          <Icon name={p.playing && !p.paused ? "pause" : "play"} size={14} />
        </button>
      </span>
      <div className="tt" role="cell">
        {p.art ? <Art id={p.song.coverArt} px={40} /> : null}
        <div>
          <div className="name">{p.song.title}</div>
          <div className="by">
            {p.downloaded ? <span className="dlmark" title="Downloaded"><Icon name="downloaded" size={13} /></span> : null}
            {p.song.artistId ? <Link to={`/artist/${p.song.artistId}`}>{artistName(p.song)}</Link> : artistName(p.song)}
          </div>
        </div>
      </div>
      {p.album ? (
        <span className="alb" role="cell">
          {p.song.albumId ? <Link to={`/album/${p.song.albumId}`}>{p.song.album}</Link> : p.song.album}
        </span>
      ) : null}
      {p.column ? <span className="col" role="cell">{p.column.value(p.song, p.index)}</span> : null}
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
        <TrackMoreButton songs={[p.song]} className="row-more" size={18} label={`More options for ${p.song.title}`} {...(p.extra ? { extra: p.extra } : {})} />
      </span>
    </div>
  );
});

export function TrackList({ songs, context, art = false, album = false, column, numbers = "index", header = true, onReorder, menuExtra, className, limit, onPlay }: TrackListProps) {
  const currentId = usePlayer((s) => s.items[s.index]?.song.id);
  const paused = usePlayer((s) => !s.playing);
  const starred = useStarredIds();
  const star = useToggleStar();
  const downloaded = useOffline((s) => s.songs);
  const [selected, setSelected] = useState<number | null>(null);
  const dragFrom = useRef<number | null>(null);
  const shown = limit ? songs.slice(0, limit) : songs;

  const play = useCallback((i: number) => (onPlay ? onPlay(i) : player.playSongs(songs, i, context)), [songs, context, onPlay]);
  const like = useCallback((song: Song, on: boolean) => star.mutate({ kind: "song", item: song, on }), [star]);

  const scroller = useScrollContainer();
  const listRef = useRef<HTMLDivElement>(null);
  const [margin, setMargin] = useState(0);
  const virtual = shown.length > VIRTUALIZE_AFTER && Boolean(scroller);
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
    estimateSize: () => ROW,
    overscan: 12,
    scrollMargin: margin,
  });

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
      liked={starred.songs.has(song.id)}
      downloaded={downloaded.has(song.id)}
      selected={selected === i}
      draggable={Boolean(onReorder)}
      extra={menuExtra?.(song, i)}
      onSelect={setSelected}
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

  const cols = ["tracks", art ? "with-art" : "", album ? "with-album" : "", column ? "with-col" : "", className ?? ""].filter(Boolean).join(" ");
  return (
    <div className={cols} role="table" aria-label={context.name} style={column?.width ? ({ "--col": column.width } as CSSProperties) : undefined}>
      {header ? (
        <div className="th" role="row">
          <span className="r" role="columnheader">#</span>
          <span role="columnheader">Title</span>
          {album ? <span role="columnheader">Album</span> : null}
          {column ? <span role="columnheader">{column.label}</span> : null}
          <span className="r" role="columnheader" aria-label="Duration">
            <Icon name="clock" size={16} />
          </span>
        </div>
      ) : null}
      <div ref={listRef} className="tbody" role="rowgroup" style={virtual ? { height: v.getTotalSize(), position: "relative" } : undefined}>
        {virtual
          ? v.getVirtualItems().map((item) => {
              const song = shown[item.index];
              return song ? row(song, item.index, { position: "absolute", top: 0, left: 0, right: 0, transform: `translateY(${item.start - v.options.scrollMargin}px)` }) : null;
            })
          : shown.map((s, i) => row(s, i))}
      </div>
    </div>
  );
}
