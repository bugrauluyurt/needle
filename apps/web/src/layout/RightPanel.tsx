import * as Dialog from "@radix-ui/react-dialog";
import { useRef, useState } from "react";
import { Link } from "react-router";
import type { Song } from "@needle/shared";
import { Art } from "../components/Art.tsx";
import { Icon } from "../components/Icon.tsx";
import { LyricsView } from "../components/Lyrics.tsx";
import { TrackMoreButton } from "../components/TrackMenu.tsx";
import { artistName, count, formatLong, plainBio } from "../lib/format.ts";
import { player } from "../player/controller.ts";
import type { QueueItem } from "../player/queue.ts";
import { userItemsAfter } from "../player/queue.ts";
import { useCurrentSong, usePlayer } from "../player/store.ts";
import { useArtistInfo } from "../queries/hooks.ts";
import { useArtistImage } from "../queries/spotify.ts";
import { useSettings } from "../state/settings.ts";
import type { RightPanel as Panel } from "../state/ui.ts";
import { useUi } from "../state/ui.ts";
import { LikeCurrent } from "./PlayerBar.tsx";
import { albumPath, artistPath } from "../lib/paths.ts";

const TABS: [Panel, string][] = [["now", "Now playing"], ["queue", "Queue"], ["lyrics", "Lyrics"]];

export function QueueRow({ item, playing, onDragStart, onDrop }: { item: QueueItem; playing?: boolean; onDragStart?: () => void; onDrop?: () => void }) {
  const [over, setOver] = useState(false);
  const draggable = Boolean(onDragStart);
  return (
    <div
      className={`mini ${over ? "drop" : ""}`}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        onDragStart?.();
      }}
      onDragOver={(e) => {
        if (!draggable) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onDrop?.();
      }}
    >
      <button type="button" className="mini-main" onClick={() => !playing && player.playQueueItem(item.uid)} aria-label={`Play ${item.song.title}`}>
        <Art id={item.song.coverArt} px={44} />
        <div className="mini-text">
          <div className={`t ${playing ? "playing" : ""}`}>{item.song.title}</div>
          <div className="s">{artistName(item.song)}</div>
        </div>
      </button>
      {!playing ? (
        <>
          <button type="button" className="icon-btn mini-x" aria-label={`Remove ${item.song.title} from queue`} onClick={() => player.removeFromQueue(item.uid)}>
            <Icon name="close" size={16} />
          </button>
          {draggable ? <span className="grip" aria-hidden="true"><Icon name="grip" size={16} /></span> : null}
        </>
      ) : null}
    </div>
  );
}

export function QueueView() {
  const items = usePlayer((s) => s.items);
  const index = usePlayer((s) => s.index);
  const context = usePlayer((s) => s.context);
  const autoplay = useSettings((s) => s.autoplay);
  const setSetting = useSettings((s) => s.set);
  const dragging = useRef<string | null>(null);
  const now = items[index];
  const userCount = userItemsAfter({ items, index, original: null });
  const user = items.slice(index + 1, index + 1 + userCount);
  const rest = items.slice(index + 1 + userCount, index + 1 + userCount + 60);
  const drop = (target: number) => {
    if (dragging.current) player.moveInQueue(dragging.current, target);
    dragging.current = null;
  };
  if (!now) return <p className="panel-empty">The queue is empty. Play something and what’s next shows up here.</p>;
  return (
    <>
      <h6 className="q-h">Now playing</h6>
      <QueueRow item={now} playing />
      {user.length ? (
        <>
          <h6 className="q-h">
            Next in queue
            <button type="button" className="q-clear" onClick={player.clearUserQueue}>Clear</button>
          </h6>
          {user.map((it, i) => (
            <QueueRow key={it.uid} item={it} onDragStart={() => (dragging.current = it.uid)} onDrop={() => drop(index + 1 + i)} />
          ))}
        </>
      ) : null}
      {rest.length ? (
        <>
          <h6 className="q-h">Next from {context?.name ?? "your queue"}</h6>
          {rest.map((it, i) => (
            <QueueRow key={it.uid} item={it} onDragStart={() => (dragging.current = it.uid)} onDrop={() => drop(index + 1 + userCount + i)} />
          ))}
        </>
      ) : null}
      <div className="autoplay">
        <div>
          <b>Keep playing similar songs</b>
          <span>When the queue ends, play songs like it from your library</span>
        </div>
        <button type="button" className="toggle" role="switch" aria-checked={autoplay} aria-label="Keep playing similar songs" onClick={() => setSetting("autoplay", !autoplay)} />
      </div>
    </>
  );
}

function AboutArtist({ song }: { song: Song }) {
  const { data } = useArtistInfo(song.artistId);
  const cover = useArtistImage(song.artistId, song.artists?.[0]?.name ?? song.artist);
  const bio = plainBio(data?.biography);
  if (!song.artistId) return null;
  return (
    <Link to={artistPath(song.artistId)} className="rp-card about-card">
      <div className="about-art">
        <Art id={cover ?? song.coverArt} px={300} fallback="artist" className={cover ? "" : "blurred"} />
        <span>About the artist</span>
      </div>
      <h6>{artistName(song)}</h6>
      {bio ? <p className="about-bio">{bio}</p> : null}
    </Link>
  );
}

function NowView() {
  const song = useCurrentSong();
  const items = usePlayer((s) => s.items);
  const index = usePlayer((s) => s.index);
  if (!song) return <p className="panel-empty">Nothing is playing. Pick an album or a playlist to start.</p>;
  const next = items[index + 1];
  const rows: [string, string][] = [
    ["Format", formatLong(song)],
    ["Bitrate", song.bitRate ? `${count(song.bitRate)} kbps` : ""],
    ["Played", song.playCount ? `${count(song.playCount)} ${song.playCount === 1 ? "time" : "times"}` : "First time"],
  ];
  return (
    <>
      <Art id={song.coverArt} px={304} className="rp-art" eager />
      <div className="rp-title">
        <div>
          <h5>{song.albumId ? <Link to={albumPath(song.albumId)}>{song.title}</Link> : song.title}</h5>
          <p>{song.artistId ? <Link to={artistPath(song.artistId)}>{artistName(song)}</Link> : artistName(song)}</p>
        </div>
        <TrackMoreButton songs={[song]} />
        <LikeCurrent size={20} />
      </div>
      {next ? (
        <div className="rp-card">
          <h6>
            Next in queue
            <button type="button" className="rp-link" onClick={() => useUi.setState({ rightPanel: "queue" })}>Open queue</button>
          </h6>
          <QueueRow item={next} />
        </div>
      ) : null}
      <div className="rp-card">
        <h6>About the file</h6>
        <dl className="kv">
          {rows.filter(([, v]) => v).map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </div>
      <AboutArtist song={song} />
    </>
  );
}

function usePanelTitle(): string {
  const panel = useUi((s) => s.rightPanel);
  const song = useCurrentSong();
  const contextName = usePlayer((s) => s.context?.name);
  return panel === "queue" ? "Queue" : panel === "lyrics" ? "Lyrics" : (contextName ?? song?.album ?? "Now playing");
}

export function RightPanel() {
  const panel = useUi((s) => s.rightPanel);
  const song = useCurrentSong();
  const title = usePanelTitle();
  if (!panel) return null;
  return (
    <aside className="right" aria-label={title}>
      <div className="rp-head">
        <h4>{title}</h4>
        <button type="button" className="icon-btn" aria-label="Close panel" onClick={() => useUi.setState({ rightPanel: null })}>
          <Icon name="close" size={18} />
        </button>
      </div>
      <div className="rp-tabs" role="tablist">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" role="tab" className="pill" aria-selected={panel === id} onClick={() => useUi.setState({ rightPanel: id })}>
            {label}
          </button>
        ))}
      </div>
      <div className="rp-body scroll-thin">
        {panel === "now" ? <NowView /> : panel === "queue" ? <QueueView /> : song ? <LyricsView song={song} variant="panel" /> : <p className="panel-empty">Play a song to see its lyrics.</p>}
      </div>
    </aside>
  );
}

export function RightPanelOver() {
  const title = usePanelTitle();
  const opener = useRef<HTMLElement | null>(null);
  return (
    <Dialog.Root open onOpenChange={(open) => !open && useUi.setState({ rightPanel: null })}>
      <Dialog.Portal>
        <Dialog.Overlay className="scrim as-scrim" />
        <Dialog.Content
          className="right-over"
          aria-describedby={undefined}
          onOpenAutoFocus={() => {
            const el = document.activeElement;
            opener.current = el instanceof HTMLElement ? el : null;
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            opener.current?.focus();
          }}
        >
          <Dialog.Title className="sr-only">{title}</Dialog.Title>
          <RightPanel />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
