import * as Dialog from "@radix-ui/react-dialog";
import { useRef, useState } from "react";
import { Link } from "react-router";
import type { Song } from "@needle/shared";
import { Art } from "../components/Art.tsx";
import { Icon } from "../components/Icon.tsx";
import { LyricsView } from "../components/Lyrics.tsx";
import { SearchField } from "../components/SearchField.tsx";
import { SourceMark } from "../components/SpotifyMark.tsx";
import { YouTubeMusicPlaybackError } from "../features/youtube-music/components/YouTubeMusicPlaybackError.tsx";
import {
  isLocalSong,
  matchesTerms,
  queryTerms,
  songSource,
} from "@needle/shared";
import { TrackMoreButton } from "../components/tracks/TrackMenu.tsx";
import { artistName, count, formatLong, plainBio } from "../lib/format.ts";
import { player } from "../player/controller.ts";
import type { QueueItem } from "../player/queue.ts";
import { userItemsAfter } from "../player/queue.ts";
import { usePlayer } from "../player/store.ts";
import { useArtistInfo } from "../queries/hooks.ts";
import { useArtistImage } from "../features/spotify/hooks/useSpotify.ts";
import { useYouTubeMusicArtist } from "../features/youtube-music/hooks/useYouTubeMusic.ts";
import { translate } from "../i18n/index.ts";
import { usePlayback } from "../features/remote/client.ts";
import { useSettings } from "../state/settings.ts";
import type { RightPanel as Panel } from "../state/ui.ts";
import { useUi } from "../state/ui.ts";
import { LikeCurrent } from "./PlayerBar.tsx";
import { albumPath, artistPath } from "../lib/paths.ts";

const panelTabs = (): [Panel, string][] => [
  ["now", translate("panel.nowPlaying")],
  ["queue", translate("panel.queue")],
  ["lyrics", translate("panel.lyrics")],
];

export function QueueRow({
  item,
  playing,
  onDragStart,
  onDrop,
}: {
  item: QueueItem;
  playing?: boolean;
  onDragStart?: () => void;
  onDrop?: () => void;
}) {
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
      <button
        type="button"
        className="mini-main"
        onClick={() => !playing && player.playQueueItem(item.uid)}
        aria-label={translate("panel.playSong", { title: item.song.title })}
      >
        <Art id={item.song.coverArt} px={44} />
        <div className="mini-text">
          <div className={`t ${playing ? "playing" : ""}`}>
            {item.song.title}
          </div>
          <div className="s">
            <SourceMark source={songSource(item.song)} compact />
            {artistName(item.song)}
          </div>
        </div>
      </button>
      {!playing ? (
        <>
          <button
            type="button"
            className="icon-btn mini-x"
            aria-label={translate("panel.removeQueue", {
              title: item.song.title,
            })}
            onClick={() => player.removeFromQueue(item.uid)}
          >
            <Icon name="close" size={16} />
          </button>
          {draggable ? (
            <span className="grip" aria-hidden="true">
              <Icon name="grip" size={16} />
            </span>
          ) : null}
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
  const [queueQuery, setQueueQuery] = useState("");
  const now = items[index];
  const userCount = userItemsAfter({ items, index, original: null });
  const user = items.slice(index + 1, index + 1 + userCount);
  const rest = items.slice(
    index + 1 + userCount,
    queueQuery.trim() ? undefined : index + 1 + userCount + 60,
  );
  const queueTerms = queryTerms(queueQuery);
  const matchesQueueItem = (queueItem: QueueItem) =>
    matchesTerms(
      queueTerms,
      queueItem.song.title,
      artistName(queueItem.song),
      queueItem.song.album,
    );
  const drop = (target: number) => {
    if (dragging.current) player.moveInQueue(dragging.current, target);
    dragging.current = null;
  };
  if (!now)
    return <p className="panel-empty">{translate("panel.emptyQueue")}</p>;
  return (
    <>
      <div className="queue-search">
        <SearchField
          variant="inline"
          collapsible
          label={translate("panel.findQueue")}
          value={queueQuery}
          onChange={setQueueQuery}
        />
      </div>
      <h6 className="q-h">{translate("track.nowPlaying")}</h6>
      <QueueRow item={now} playing />
      {user.length ? (
        <>
          <h6 className="q-h">
            {translate("panel.nextQueue")}
            <button
              type="button"
              className="q-clear"
              onClick={player.clearUserQueue}
            >
              {translate("panel.clear")}
            </button>
          </h6>
          {user.map((it, i) =>
            matchesQueueItem(it) ? (
              <QueueRow
                key={it.uid}
                item={it}
                {...(queueQuery.trim()
                  ? {}
                  : {
                      onDragStart: () => (dragging.current = it.uid),
                      onDrop: () => drop(index + 1 + i),
                    })}
              />
            ) : null,
          )}
        </>
      ) : null}
      {rest.length ? (
        <>
          <h6 className="q-h">
            {translate("panel.nextFrom", {
              source: context?.name ?? translate("panel.yourQueue"),
            })}
          </h6>
          {rest.map((it, i) =>
            matchesQueueItem(it) ? (
              <QueueRow
                key={it.uid}
                item={it}
                {...(queueQuery.trim()
                  ? {}
                  : {
                      onDragStart: () => (dragging.current = it.uid),
                      onDrop: () => drop(index + 1 + userCount + i),
                    })}
              />
            ) : null,
          )}
        </>
      ) : null}
      <div className="autoplay">
        <div>
          <b>{translate("panel.autoplayTitle")}</b>
          <span>{translate("panel.autoplayHint")}</span>
        </div>
        <button
          type="button"
          className="toggle"
          role="switch"
          aria-checked={autoplay}
          aria-label={translate("panel.autoplayTitle")}
          onClick={() => setSetting("autoplay", !autoplay)}
        />
      </div>
    </>
  );
}

function AboutArtist({ song }: { song: Song }) {
  const { data } = useArtistInfo(song.artistId);
  const youtubeMusicArtist = useYouTubeMusicArtist(
    songSource(song) === "youtubeMusic" ? (song.artistId ?? "") : "",
  );
  const cover = useArtistImage(
    song.artistId,
    song.artists?.[0]?.name ?? song.artist,
  );
  const bio = plainBio(
    youtubeMusicArtist.data?.artist.description ?? data?.biography,
  );
  if (!song.artistId) return null;
  return (
    <Link to={artistPath(song.artistId)} className="rp-card about-card">
      <div className="about-art">
        <Art
          id={cover ?? song.coverArt}
          px={300}
          fallback="artist"
          className={cover ? "" : "blurred"}
        />
        <span>{translate("panel.aboutArtist")}</span>
      </div>
      <h6>{artistName(song)}</h6>
      {bio ? <p className="about-bio">{bio}</p> : null}
    </Link>
  );
}

function NowView() {
  const { remote, song } = usePlayback();
  const items = usePlayer((s) => s.items);
  const index = usePlayer((s) => s.index);
  if (!song)
    return <p className="panel-empty">{translate("panel.emptyNow")}</p>;
  const next = remote ? undefined : items[index + 1];
  const rows: [string, string][] = [
    [translate("panel.format"), formatLong(song)],
    [
      translate("panel.bitrate"),
      song.bitRate ? `${count(song.bitRate)} kbps` : "",
    ],
    [
      translate("panel.played"),
      song.playCount
        ? translate(
            song.playCount === 1 ? "panel.playedOnce" : "panel.playedMany",
            { count: count(song.playCount) },
          )
        : translate("panel.firstTime"),
    ],
  ];
  return (
    <>
      <Art id={song.coverArt} px={304} className="rp-art" eager />
      <div className="rp-title">
        <div>
          <h5>
            {song.albumId ? (
              <Link to={albumPath(song.albumId)}>{song.title}</Link>
            ) : (
              song.title
            )}
          </h5>
          <p>
            <SourceMark source={songSource(song)} compact />
            {song.artistId ? (
              <Link to={artistPath(song.artistId)}>{artistName(song)}</Link>
            ) : (
              artistName(song)
            )}
          </p>
        </div>
        <TrackMoreButton songs={[song]} />
        <LikeCurrent size={20} />
      </div>
      {!remote ? <YouTubeMusicPlaybackError song={song} /> : null}
      {next ? (
        <div className="rp-card">
          <h6>
            {translate("panel.nextQueue")}
            <button
              type="button"
              className="rp-link"
              onClick={() => useUi.setState({ rightPanel: "queue" })}
            >
              {translate("panel.openQueue")}
            </button>
          </h6>
          <QueueRow item={next} />
        </div>
      ) : null}
      {remote || !isLocalSong(song) ? null : (
        <div className="rp-card">
          <h6>{translate("panel.aboutFile")}</h6>
          <dl className="kv">
            {rows
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
          </dl>
        </div>
      )}
      <AboutArtist song={song} />
    </>
  );
}

function usePanelTitle(): string {
  const panel = useUi((s) => s.rightPanel);
  const { remote, song } = usePlayback();
  const contextName = usePlayer((s) => s.context?.name);
  const nowTitle = remote
    ? translate("player.playingOn", { device: remote.name })
    : (contextName ?? song?.album ?? translate("panel.nowPlaying"));

  switch (panel) {
    case "lyrics":
      return translate("panel.lyrics");
    case "now":
      return nowTitle;
    case "queue":
      return translate("panel.queue");
    case null:
      return nowTitle;
  }
}

export function RightPanel() {
  const panel = useUi((s) => s.rightPanel);
  const { song } = usePlayback();
  const title = usePanelTitle();
  if (!panel) return null;
  return (
    <aside className="right" aria-label={title}>
      <div className="rp-head">
        <h4>{title}</h4>
        <button
          type="button"
          className="icon-btn"
          aria-label={translate("panel.close")}
          onClick={() => useUi.setState({ rightPanel: null })}
        >
          <Icon name="close" size={18} />
        </button>
      </div>
      <div className="rp-tabs" role="tablist">
        {panelTabs().map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            className="pill"
            aria-selected={panel === id}
            onClick={() => useUi.setState({ rightPanel: id })}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="rp-body scroll-thin">
        {panel === "now" ? (
          <NowView />
        ) : panel === "queue" ? (
          <QueueView />
        ) : song ? (
          <LyricsView song={song} variant="panel" />
        ) : (
          <p className="panel-empty">{translate("panel.emptyLyrics")}</p>
        )}
      </div>
    </aside>
  );
}

export function RightPanelOver() {
  const title = usePanelTitle();
  const opener = useRef<HTMLElement | null>(null);
  const close = () => useUi.setState({ rightPanel: null });
  return (
    <Dialog.Root open onOpenChange={(open) => !open && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="scrim as-scrim" onClick={close} />
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
