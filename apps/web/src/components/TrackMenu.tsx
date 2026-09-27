import * as DM from "@radix-ui/react-dropdown-menu";
import { useMemo, useState } from "react";
import type { MouseEvent, ReactNode } from "react";
import { useNavigate } from "react-router";
import { create } from "zustand";
import type { Song } from "@needle/shared";
import { player } from "../player/controller.ts";
import { useAddToPlaylist, useCreatePlaylist, usePlaylists, useStarredIds, useToggleStar } from "../queries/hooks.ts";
import { toast } from "../state/ui.ts";
import { openSongDetails } from "./songDetailsStore.ts";
import { Icon } from "./Icon.tsx";
import type { IconName } from "./Icon.tsx";

export type TrackMenuExtra = { label: string; icon: IconName; run: () => void };
type MenuRequest = { songs: Song[]; extra?: TrackMenuExtra[] | undefined; x: number; y: number; align: "start" | "end"; key: number };

const useTrackMenu = create<{ req: MenuRequest | null }>(() => ({ req: null }));
let opened = 0;

export function openTrackMenu(songs: Song[], at: { x: number; y: number; align?: "start" | "end" }, extra?: TrackMenuExtra[]) {
  if (!songs.length) return;
  useTrackMenu.setState({ req: { songs, extra, x: at.x, y: at.y, align: at.align ?? "start", key: ++opened } });
}

function Row({ icon, children, end }: { icon: IconName; children: ReactNode; end?: ReactNode }) {
  return (
    <>
      <Icon name={icon} size={18} />
      <span className="menu-label">{children}</span>
      {end ? <span className="menu-end">{end}</span> : null}
    </>
  );
}

function PlaylistSub({ songs }: { songs: Song[] }) {
  const { data: playlists = [] } = usePlaylists();
  const add = useAddToPlaylist();
  const create = useCreatePlaylist();
  const [filter, setFilter] = useState("");
  const ids = songs.map((s) => s.id);
  const shown = useMemo(() => playlists.filter((p) => !p.readonly && p.name.toLowerCase().includes(filter.toLowerCase())), [playlists, filter]);
  return (
    <DM.Sub>
      <DM.SubTrigger className="menu-item">
        <Row icon="plus" end={<Icon name="forward" size={16} />}>Add to playlist</Row>
      </DM.SubTrigger>
      <DM.Portal>
        <DM.SubContent className="menu sub" sideOffset={4} collisionPadding={12}>
          <label className="menu-search" onKeyDown={(e) => e.stopPropagation()}>
            <Icon name="search" size={15} />
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find a playlist" aria-label="Find a playlist" />
          </label>
          <DM.Item
            className="menu-item"
            onSelect={() => {
              const name = songs.length === 1 && songs[0] ? songs[0].title : "New playlist";
              void create.mutateAsync({ name, songIds: ids }).then((p) => toast(`Added to ${p.name}`), () => toast("Couldn’t create the playlist"));
            }}
          >
            <Row icon="plus">New playlist</Row>
          </DM.Item>
          <DM.Separator className="menu-sep" />
          <div className="menu-scroll">
            {shown.map((p) => (
              <DM.Item
                key={p.id}
                className="menu-item"
                onSelect={() => void add.mutateAsync({ playlistId: p.id, songIds: ids }).then(() => toast(`Added to ${p.name}`), () => toast(`Couldn’t add to ${p.name}`))}
              >
                <span className="menu-label">{p.name}</span>
              </DM.Item>
            ))}
            {!shown.length ? <p className="menu-empty">No playlists match</p> : null}
          </div>
        </DM.SubContent>
      </DM.Portal>
    </DM.Sub>
  );
}

function Items({ songs, extra }: { songs: Song[]; extra?: TrackMenuExtra[] | undefined }) {
  const navigate = useNavigate();
  const starred = useStarredIds();
  const star = useToggleStar();
  const song = songs[0];
  if (!song) return null;
  const liked = songs.every((s) => starred.songs.has(s.id));
  const single = songs.length === 1;
  return (
    <>
      <DM.Item className="menu-item" onSelect={() => { player.addToQueue(songs); toast(single ? "Added to queue" : `${songs.length} songs added to queue`); }}>
        <Row icon="addToQueue">Add to queue</Row>
      </DM.Item>
      <DM.Item className="menu-item" onSelect={() => { player.playNext(songs); toast(single ? "Plays next" : `${songs.length} songs play next`); }}>
        <Row icon="playNext">Play next</Row>
      </DM.Item>
      {single ? (
        <DM.Item className="menu-item" onSelect={() => void player.startRadio({ song, name: song.title })}>
          <Row icon="radio">Start radio from this song</Row>
        </DM.Item>
      ) : null}
      <DM.Separator className="menu-sep" />
      <PlaylistSub songs={songs} />
      <DM.Item className="menu-item" onSelect={() => songs.forEach((s) => star.mutate({ kind: "song", item: s, on: !liked }))}>
        <Row icon={liked ? "heartFill" : "heart"}>{liked ? "Remove from liked songs" : "Add to liked songs"}</Row>
      </DM.Item>
      {extra?.map((x) => (
        <DM.Item key={x.label} className="menu-item" onSelect={x.run}>
          <Row icon={x.icon}>{x.label}</Row>
        </DM.Item>
      ))}
      {single ? (
        <>
          <DM.Separator className="menu-sep" />
          {song.artistId ? (
            <DM.Item className="menu-item" onSelect={() => void navigate(`/artist/${song.artistId}`)}>
              <Row icon="user">Go to artist</Row>
            </DM.Item>
          ) : null}
          {song.albumId ? (
            <DM.Item className="menu-item" onSelect={() => void navigate(`/album/${song.albumId}`)}>
              <Row icon="album">Go to album</Row>
            </DM.Item>
          ) : null}
          <DM.Item className="menu-item" onSelect={() => openSongDetails(song)}>
            <Row icon="info">Song details</Row>
          </DM.Item>
        </>
      ) : null}
    </>
  );
}

export function TrackMenuHost() {
  const req = useTrackMenu((s) => s.req);
  return (
    <DM.Root key={req?.key ?? 0} open={Boolean(req)} onOpenChange={(o) => !o && useTrackMenu.setState({ req: null })} modal={false}>
      <DM.Trigger asChild>
        <span aria-hidden="true" className="menu-anchor" style={{ left: req?.x ?? 0, top: req?.y ?? 0 }} />
      </DM.Trigger>
      <DM.Portal>
        <DM.Content className="menu" align={req?.align ?? "start"} sideOffset={4} collisionPadding={12} onCloseAutoFocus={(e) => e.preventDefault()}>
          {req ? <Items songs={req.songs} extra={req.extra} /> : null}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

export function TrackMoreButton({ songs, extra, className, size = 20, label = "More options" }: { songs: Song[]; extra?: TrackMenuExtra[]; className?: string; size?: number; label?: string }) {
  const open = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    openTrackMenu(songs, { x: r.right, y: r.bottom, align: "end" }, extra);
  };
  return (
    <button type="button" className={className ?? "icon-btn"} aria-label={label} aria-haspopup="menu" onClick={open}>
      <Icon name="more" size={size} />
    </button>
  );
}
