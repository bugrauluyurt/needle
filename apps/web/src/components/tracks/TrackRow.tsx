import { memo, useRef, useState } from "react";
import type { CSSProperties, DragEvent, KeyboardEvent, MouseEvent } from "react";
import { Link } from "react-router";
import type { Song } from "@needle/shared";
import { songSource } from "@needle/shared";
import { translate } from "../../i18n/index.ts";
import { artistName, clock } from "../../lib/format.ts";
import { albumPath, artistPath } from "../../lib/paths.ts";
import { player } from "../../player/controller.ts";
import { Art } from "../Art.tsx";
import { Eq, Icon } from "../Icon.tsx";
import { SourceMark } from "../SpotifyMark.tsx";
import type { TrackMenuExtra } from "./TrackMenu.tsx";
import { openTrackMenu, TrackMoreButton } from "./TrackMenu.tsx";
import type { TrackColumn } from "./types.ts";

type TrackRowProps = {
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
  onSelect: (songIndex: number) => void;
  onPlay: (songIndex: number) => void;
  onLike: (song: Song, on: boolean) => void;
  onDragStart?: (songIndex: number) => void;
  onDropAt?: (songIndex: number) => void;
};

export const TrackRow = memo(function TrackRow(props: TrackRowProps) {
  const [dragOver, setDragOver] = useState(false);
  const pointerType = useRef("mouse");
  const longPress = useRef<{
    timer: number;
    x: number;
    y: number;
    fired: boolean;
  } | null>(null);
  const openMenu = (x: number, y: number) => openTrackMenu([props.song], { x, y }, props.extra);
  const cancelLongPress = () => {
    if (longPress.current) window.clearTimeout(longPress.current.timer);
  };
  const selectOrPlay = (event: MouseEvent) => {
    if (longPress.current?.fired) {
      longPress.current = null;

      return;
    }

    if ((event.target as HTMLElement).closest("a,button")) return;
    if (pointerType.current === "touch" && props.song.isAvailable !== false) props.onPlay(props.index);
    else props.onSelect(props.index);
  };
  const playFromKeyboard = (event: KeyboardEvent) => {
    if (event.key === "Enter" && props.song.isAvailable !== false) props.onPlay(props.index);
  };
  const drag = props.draggable
    ? {
        draggable: true,
        onDragStart: (event: DragEvent) => {
          event.dataTransfer.effectAllowed = "move";
          props.onDragStart?.(props.index);
        },
        onDragOver: (event: DragEvent) => {
          event.preventDefault();
          setDragOver(true);
        },
        onDragLeave: () => setDragOver(false),
        onDrop: (event: DragEvent) => {
          event.preventDefault();
          setDragOver(false);
          props.onDropAt?.(props.index);
        },
      }
    : {};

  return (
    <div
      className={`tr ${props.song.isAvailable === false ? "unavailable" : ""} ${props.playing ? "playing" : ""} ${props.located ? "located" : ""} ${props.selected ? "sel" : ""} ${dragOver ? "drop" : ""}`}
      style={props.style}
      role="row"
      tabIndex={0}
      aria-selected={props.selected}
      onPointerDown={(event) => {
        pointerType.current = event.pointerType;
        if (event.pointerType !== "touch") return;

        const { clientX: x, clientY: y } = event;
        longPress.current = {
          x,
          y,
          fired: false,
          timer: window.setTimeout(() => {
            if (longPress.current) longPress.current.fired = true;
            navigator.vibrate?.(10);
            openMenu(x, y);
          }, 550),
        };
      }}
      onPointerMove={(event) => {
        const pressState = longPress.current;

        if (pressState && Math.hypot(event.clientX - pressState.x, event.clientY - pressState.y) > 10)
          cancelLongPress();
      }}
      onPointerUp={cancelLongPress}
      onPointerCancel={cancelLongPress}
      onContextMenu={(event) => {
        event.preventDefault();
        if (pointerType.current !== "touch") openMenu(event.clientX, event.clientY);
      }}
      onClick={selectOrPlay}
      onDoubleClick={() => props.song.isAvailable !== false && props.onPlay(props.index)}
      onKeyDown={playFromKeyboard}
      {...drag}
    >
      <span className="n" role="cell">
        {props.playing && !props.elsewhere ? <Eq paused={props.paused} /> : <span className="num">{props.number}</span>}
        <button
          type="button"
          className="row-play"
          disabled={props.song.isAvailable === false}
          aria-label={
            props.song.isAvailable === false
              ? translate("track.unavailableLabel", { title: props.song.title })
              : props.playing && !props.paused
                ? translate("track.pause", { title: props.song.title })
                : translate("track.play", { title: props.song.title })
          }
          onClick={() => (props.playing ? player.toggle() : props.onPlay(props.index))}
        >
          <Icon name={props.playing && !props.paused ? "pause" : "play"} size={14} />
        </button>
      </span>
      <div className="tt" role="cell">
        {props.art ? <Art id={props.song.coverArt} px={40} /> : null}
        <div>
          <div className="name">{props.song.title}</div>
          <div className="by">
            {props.downloaded ? (
              <span className="dlmark" title={translate("track.downloaded")}>
                <Icon name="downloaded" size={13} />
              </span>
            ) : null}
            <SourceMark source={songSource(props.song)} compact />
            {props.song.artistId ? (
              <Link to={artistPath(props.song.artistId)}>{artistName(props.song)}</Link>
            ) : (
              artistName(props.song)
            )}
            {props.song.isAvailable === false ? <span>{translate("track.unavailable")}</span> : null}
          </div>
        </div>
      </div>
      {props.album ? (
        <span className="alb" role="cell">
          {props.song.albumId ? <Link to={albumPath(props.song.albumId)}>{props.song.album}</Link> : props.song.album}
        </span>
      ) : null}
      {props.column ? (
        <span className="col" role="cell">
          {props.column.value(props.song, props.index)}
        </span>
      ) : null}
      <span className="d" role="cell">
        <button
          type="button"
          className={props.liked ? "heart liked" : "heart"}
          aria-label={translate(props.liked ? "track.removeLiked" : "track.addLiked", { title: props.song.title })}
          aria-pressed={props.liked}
          onClick={() => props.onLike(props.song, !props.liked)}
        >
          <Icon name={props.liked ? "heartFill" : "heart"} size={16} />
        </button>
        <span className="tabular">{clock(props.song.duration)}</span>
        <TrackMoreButton
          songs={[props.song]}
          className="row-more"
          size={18}
          label={translate("track.moreOptions", { title: props.song.title })}
          {...(props.extra ? { extra: props.extra } : {})}
        />
      </span>
    </div>
  );
});
