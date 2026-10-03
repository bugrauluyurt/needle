import * as DM from "@radix-ui/react-dropdown-menu";
import * as Popover from "@radix-ui/react-popover";
import { useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import type { Device, Song } from "@needle/shared";
import { translate } from "../i18n/index.ts";
import { Art } from "../components/Art.tsx";
import { Icon } from "../components/Icon.tsx";
import type { IconName } from "../components/Icon.tsx";
import { Slider } from "../components/Slider.tsx";
import { artistName, clock, formatLabel } from "../lib/format.ts";
import { player } from "../player/controller.ts";
import { locatePlaying, useLocate, usePlayer } from "../player/store.ts";
import { useSongLikes } from "../queries/likes.ts";
import { setFullScreen, toggleRightPanel, useUi } from "../state/ui.ts";
import { usePlayback, useShownProgress } from "../features/remote/client.ts";
import {
  DevicesButton,
  kindIcon,
} from "../features/remote/components/DevicesButton.tsx";
import { albumPath, artistPath } from "../lib/paths.ts";
import { useIsWide } from "../lib/media.ts";

export const LiveLabel = () => (
  <span className="live">{translate("player.liveRadio")}</span>
);

export function SeekBar({
  className = "seek",
  times = "side",
}: {
  className?: string;
  times?: "side" | "below" | "remaining";
}) {
  const { remote, station, controls } = usePlayback();
  const position = useShownProgress(
    remote,
    (p) => Math.floor(p.position * 4) / 4,
  );
  const duration = useShownProgress(remote, (p) => p.duration);
  const buffered = useShownProgress(remote, (p) => Math.floor(p.buffered));
  const [preview, setPreview] = useState<number | null>(null);
  const shown = preview ?? position;
  if (station) return <div className={className} aria-hidden="true" />;
  const slider = (
    <Slider
      value={shown}
      max={duration}
      buffered={buffered}
      needle
      label={translate("player.seek")}
      step={5}
      valueText={(v) =>
        translate("player.seekValue", {
          position: clock(v),
          duration: clock(duration),
        })
      }
      onChange={setPreview}
      onCommit={(v) => {
        setPreview(null);
        controls.seek(v);
      }}
    />
  );
  if (times === "below") {
    return (
      <div className={`${className} below`}>
        {slider}
        <div className="times">
          <span>{clock(shown)}</span>
          <span>{clock(duration)}</span>
        </div>
      </div>
    );
  }
  return (
    <div className={className}>
      <span className="time">{clock(shown)}</span>
      {slider}
      <span className="time">
        {times === "remaining"
          ? `-${clock(Math.max(0, duration - shown))}`
          : clock(duration)}
      </span>
    </div>
  );
}

export function Transport({ big = false }: { big?: boolean }) {
  const { remote, station, playing, buffering, controls } = usePlayback();
  const shuffle = usePlayer((s) => s.shuffle);
  const repeat = usePlayer((s) => s.repeat);
  const nothing = usePlayer((s) => !s.items.length && !s.station);
  const empty = nothing && !remote;
  const size = big ? 26 : 18;
  if (station) {
    return (
      <div className="ctl-btns">
        <button
          type="button"
          className="pp"
          aria-label={translate(playing ? "player.stop" : "player.play")}
          onClick={controls.toggle}
        >
          <Icon name={playing ? "pause" : "play"} size={big ? 26 : 16} />
        </button>
      </div>
    );
  }
  return (
    <div className="ctl-btns">
      <button
        type="button"
        className="icon-btn"
        data-key="S"
        aria-pressed={shuffle}
        aria-label={translate(
          shuffle ? "player.turnOffShuffle" : "player.shuffle",
        )}
        disabled={empty || Boolean(remote)}
        onClick={() => player.setShuffle(!shuffle)}
      >
        <Icon name="shuffle" size={big ? 22 : size} />
      </button>
      <button
        type="button"
        className="icon-btn"
        data-key="Shift ←"
        aria-label={translate("player.previous")}
        disabled={empty}
        onClick={controls.previous}
      >
        <Icon name="prev" size={big ? 30 : size} />
      </button>
      <button
        type="button"
        className={`pp ${buffering && playing ? "buffering" : ""}`}
        data-key="Space"
        aria-label={translate(playing ? "player.pause" : "player.play")}
        disabled={empty}
        onClick={controls.toggle}
      >
        <Icon name={playing ? "pause" : "play"} size={big ? 26 : 16} />
      </button>
      <button
        type="button"
        className="icon-btn"
        data-key="Shift →"
        aria-label={translate("player.next")}
        disabled={empty}
        onClick={controls.next}
      >
        <Icon name="next" size={big ? 30 : size} />
      </button>
      <button
        type="button"
        className="icon-btn"
        data-key="R"
        aria-pressed={repeat !== "off"}
        aria-label={repeatLabel(repeat)}
        disabled={empty || Boolean(remote)}
        onClick={player.cycleRepeat}
      >
        <Icon
          name={repeat === "one" ? "repeatOne" : "repeat"}
          size={big ? 22 : size}
        />
      </button>
    </div>
  );
}

const volumeIcon = (volume: number): IconName =>
  volume === 0 ? "mute" : volume < 0.5 ? "volumeLow" : "volume";

export function Volume() {
  const { volume, controls } = usePlayback();
  return (
    <>
      <button
        type="button"
        className="icon-btn"
        aria-label={translate(volume === 0 ? "player.unmute" : "player.mute")}
        onClick={controls.toggleMute}
      >
        <Icon name={volumeIcon(volume)} size={18} />
      </button>
      <Slider
        className="vol"
        value={volume}
        max={1}
        step={0.05}
        label={translate("player.volume")}
        valueText={(v) => `${Math.round(v * 100)}%`}
        onChange={controls.setVolume}
      />
    </>
  );
}

export function LikeCurrent({
  size = 18,
  className = "icon-btn",
}: {
  size?: number;
  className?: string;
}) {
  const { song } = usePlayback();
  const likes = useSongLikes();
  if (!song) return null;
  const on = likes.isLiked(song);
  return (
    <button
      type="button"
      className={className}
      aria-pressed={on}
      aria-label={translate(on ? "player.removeLiked" : "player.addLiked")}
      onClick={() => likes.setLiked(song, !on)}
    >
      <Icon name={on ? "heartFill" : "heart"} size={size} />
    </button>
  );
}

type BarAction = {
  label: string;
  icon: IconName;
  size: number;
  keyHint?: string;
  pressed?: boolean;
  disabled?: boolean;
  run: () => void;
};

function BarButton({ action: a }: { action: BarAction }) {
  return (
    <button
      type="button"
      className="icon-btn"
      aria-pressed={a.pressed}
      data-key={a.keyHint}
      aria-label={a.label}
      disabled={a.disabled}
      onClick={a.run}
    >
      <Icon name={a.icon} size={a.size} />
    </button>
  );
}

function MoreMenu({ actions }: { actions: BarAction[] }) {
  const picked = useRef<BarAction | null>(null);
  return (
    <DM.Root modal={false}>
      <DM.Trigger asChild>
        <button
          type="button"
          className="icon-btn"
          aria-label={translate("player.moreOptions")}
        >
          <Icon name="more" size={18} />
        </button>
      </DM.Trigger>
      <DM.Portal>
        <DM.Content
          className="menu"
          side="top"
          align="end"
          sideOffset={12}
          collisionPadding={12}
          onCloseAutoFocus={() => {
            picked.current?.run();
            picked.current = null;
          }}
        >
          {actions.map((a) => (
            <DM.Item
              key={a.label}
              className="menu-item"
              disabled={a.disabled}
              onSelect={() => (picked.current = a)}
            >
              <Icon name={a.icon} size={18} />
              <span className="menu-label">{a.label}</span>
              {a.pressed ? (
                <Icon name="check" size={16} className="menu-end" />
              ) : null}
            </DM.Item>
          ))}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

function VolumeButton() {
  const { volume } = usePlayback();
  const box = useRef<HTMLDivElement>(null);
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="icon-btn"
          aria-label={translate("player.volume")}
        >
          <Icon name={volumeIcon(volume)} size={18} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          ref={box}
          className="popover vol-pop"
          side="top"
          sideOffset={12}
          collisionPadding={12}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            box.current?.querySelector<HTMLElement>("[role=slider]")?.focus();
          }}
        >
          <Volume />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function SongTitle({ song, locatable }: { song: Song; locatable: boolean }) {
  if (locatable) {
    return (
      <button
        type="button"
        className="np-locate"
        aria-label={translate("player.showInList", { title: song.title })}
        onClick={locatePlaying}
      >
        {song.title}
      </button>
    );
  }
  return song.albumId ? (
    <Link to={albumPath(song.albumId)}>{song.title}</Link>
  ) : (
    <>{song.title}</>
  );
}

function RemoteStrip({ remote }: { remote: Device }) {
  return (
    <DevicesButton
      trigger={
        <button type="button" className="remote-strip">
          <Icon name={kindIcon(remote.kind)} size={14} />
          {translate("player.playingOn", { device: remote.name })}
        </button>
      }
    />
  );
}

export function PlayerBar() {
  const { remote } = usePlayback();
  return (
    <>
      <Bar />
      {remote ? <RemoteStrip remote={remote} /> : null}
    </>
  );
}

function Bar() {
  const { remote, song, station } = usePlayback();
  const locatable = useLocate((s) => s.lists > 0) && !remote;
  const panel = useUi((s) => s.rightPanel);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const wide = useIsWide();
  const fmt = station ? null : formatLabel(song);
  const nowPanel: BarAction = {
    label: translate("player.nowPlayingPanel"),
    icon: "album",
    size: 18,
    pressed: panel === "now",
    run: () => toggleRightPanel("now"),
  };
  const queue: BarAction = {
    label: translate("player.queue"),
    icon: "queue",
    size: 18,
    keyHint: "Q",
    pressed: panel === "queue",
    run: () => toggleRightPanel("queue"),
  };
  const lyrics: BarAction = {
    label: translate("player.lyrics"),
    icon: "mic",
    size: 18,
    keyHint: "Y",
    pressed: pathname === "/lyrics",
    run: () =>
      void (pathname === "/lyrics" ? navigate(-1) : navigate("/lyrics")),
  };
  const full: BarAction = {
    label: translate("player.fullScreen"),
    icon: "expand",
    size: 17,
    keyHint: "F",
    disabled: !song && !station,
    run: () => setFullScreen(true),
  };
  return (
    <footer className="bar" aria-label={translate("player.label")}>
      <div className="np">
        {station ? (
          <>
            <div className="art station-art">
              <Icon name="radio" size={24} />
            </div>
            <div className="np-text">
              <div className="np-t">{station.name}</div>
              <div className="np-a">
                <LiveLabel />
              </div>
            </div>
          </>
        ) : song ? (
          <>
            <Link
              to={song.albumId ? albumPath(song.albumId) : "#"}
              aria-label={translate("player.goToAlbum", {
                album: song.album ?? "album",
              })}
            >
              <Art id={song.coverArt} px={56} />
            </Link>
            <div className="np-text">
              <div className="np-t">
                <SongTitle song={song} locatable={locatable} />
              </div>
              <div className="np-a">
                {song.artistId ? (
                  <Link to={artistPath(song.artistId)}>{artistName(song)}</Link>
                ) : (
                  artistName(song)
                )}
              </div>
            </div>
            <LikeCurrent />
          </>
        ) : (
          <>
            <div className="art station-art">
              <Icon name="album" size={24} />
            </div>
            <div className="np-text">
              <div className="np-t muted">
                {translate("player.nothingPlaying")}
              </div>
            </div>
          </>
        )}
      </div>
      <div className="ctl">
        <Transport />
        <SeekBar />
      </div>
      <div className="bar-r">
        {wide ? (
          <>
            {fmt ? <span className="fmt">{fmt}</span> : null}
            <BarButton action={nowPanel} />
            <BarButton action={lyrics} />
          </>
        ) : null}
        <BarButton action={queue} />
        <DevicesButton />
        {wide ? (
          <>
            <Volume />
            <BarButton action={full} />
          </>
        ) : (
          <>
            <VolumeButton />
            <MoreMenu actions={[nowPanel, lyrics, full]} />
          </>
        )}
      </div>
    </footer>
  );
}

function repeatLabel(repeat: "off" | "all" | "one"): string {
  switch (repeat) {
    case "off":
      return translate("player.repeat");
    case "all":
      return translate("player.repeatOne");
    case "one":
      return translate("player.turnOffRepeat");
  }
}
