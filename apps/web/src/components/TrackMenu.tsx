import * as DM from "@radix-ui/react-dropdown-menu";
import { Fragment, useMemo, useState } from "react";
import type { MouseEvent, ReactNode } from "react";
import { useNavigate } from "react-router";
import { create } from "zustand";
import type { Song } from "@needle/shared";
import { fold, isLocalSong, songSource, youtubeMusicLink } from "@needle/shared";
import { player } from "../player/controller.ts";
import { useAddToPlaylist, useCapabilities, useCreatePlaylist, useGetSong, usePlaylists } from "../queries/hooks.ts";
import { useSpotifyPlaylistEdits, useSpotifyPlaylists } from "../queries/spotify.ts";
import { useSongLikes } from "../queries/likes.ts";
import { api } from "../lib/api.ts";
import { artistName } from "../lib/format.ts";
import { spotifyLink } from "../lib/spotify.ts";
import type { SpImage } from "../lib/spotify.ts";
import { useTone } from "../lib/tone.ts";
import { toast } from "../state/ui.ts";
import { openSongDetails } from "./songDetailsStore.ts";
import { ActionSheet } from "./ActionSheet.tsx";
import { Art } from "./Art.tsx";
import { Icon } from "./Icon.tsx";
import type { IconName } from "./Icon.tsx";
import { albumPath, artistPath } from "../lib/paths.ts";

export type TrackMenuExtra = { label: string; icon: IconName; run: () => void };
type MenuRequest = { songs: Song[]; extra?: TrackMenuExtra[] | undefined; x: number; y: number; align: "start" | "end"; key: number };
type Action = { id: string; icon: IconName; label: string; run: () => void; quick?: string; on?: boolean; playlists?: boolean; go?: boolean };

const useTrackMenu = create<{ req: MenuRequest | null; open: boolean }>(() => ({ req: null, open: false }));
let opened = 0;

export function openTrackMenu(songs: Song[], at: { x: number; y: number; align?: "start" | "end" }, extra?: TrackMenuExtra[]) {
  if (!songs.length) return;
  useTrackMenu.setState({ req: { songs, extra, x: at.x, y: at.y, align: at.align ?? "start", key: ++opened }, open: true });
}

export const closeTrackMenu = () => useTrackMenu.setState({ open: false });

const isAction = (a: Action | false | undefined): a is Action => Boolean(a);

function useTrackActions(songs: Song[], extra?: TrackMenuExtra[]): Action[][] {
  const navigate = useNavigate();
  const songLikes = useSongLikes();
  const caps = useCapabilities().data;
  const getSong = useGetSong();
  const song = songs[0];
  if (!song) return [];
  const spotify = songs.every((song) => songSource(song) === "spotify");
  const youtubeMusic = songs.every((song) => songSource(song) === "youtubeMusic");
  const local = songs.every(isLocalSong);
  const liked = songs.every(songLikes.isLiked);
  const playableSongs = songs.filter((song) => song.isAvailable !== false);
  const single = songs.length === 1;
  const { artistId, albumId } = song;
  const where = youtubeMusic ? "YouTube Music " : spotify ? "Spotify " : "";
  const getAlbum = async () => {
    const { albums: [hit] } = await api.lidarrSearch(`${song.artist ?? ""} ${song.album ?? ""}`).catch(() => ({ albums: [] }));
    if (!hit) {
      toast("Lidarr couldn’t find that album");
      return;
    }
    await api.lidarrGet(hit.foreignAlbumId).then(() => toast(`Lidarr is looking for ${hit.title}`), () => toast("Lidarr didn’t take the request"));
  };
  const groups: (Action | false | undefined)[][] = [
    [
      playableSongs.length > 0 && { id: "queue", icon: "addToQueue", label: "Add to queue", quick: "Add to queue", run: () => { player.addToQueue(playableSongs); toast(single ? "Added to queue" : `${playableSongs.length} songs added to queue`); } },
      playableSongs.length > 0 && { id: "next", icon: "playNext", label: "Play next", quick: "Play next", run: () => { player.playNext(playableSongs); toast(single ? "Plays next" : `${playableSongs.length} songs play next`); } },
      single && song.isAvailable !== false && { id: "radio", icon: "radio", label: "Start radio from this song", run: () => void player.startRadio({ song, name: song.title }) },
    ],
    [
      (spotify || local) && { id: "playlist", icon: "plus", label: "Add to playlist", playlists: true, run: () => undefined },
      {
        id: "like",
        icon: liked ? "heartFill" : "heart",
        label: liked ? `Remove from ${where}liked songs` : `Add to ${where}liked songs`,
        quick: liked ? "Liked" : "Like",
        on: liked,
        run: () => songs.forEach((song) => songLikes.setLiked(song, !liked)),
      },
      single && (spotify || youtubeMusic) && caps?.songs && {
        id: "get-song",
        icon: "download",
        label: "Get this song",
        run: () => void getSong({ id: song.id, title: song.title, artist: song.artists?.[0]?.name ?? song.artist ?? "", album: song.album ?? null, duration: song.duration ?? null, year: song.year ?? null, coverUrl: song.coverArt ?? null }),
      },
      single && (spotify || youtubeMusic) && caps?.lidarr && { id: "get-album", icon: "download", label: "Get this album through Lidarr", run: () => void getAlbum() },
      ...(extra ?? []).map((x) => ({ id: x.label, ...x })),
    ],
    single
      ? [
          artistId ? { id: "artist", icon: "user", label: "Go to artist", go: true, run: () => void navigate(artistPath(artistId)) } : false,
          albumId ? { id: "album", icon: "album", label: "Go to album", go: true, run: () => void navigate(albumPath(albumId)) } : false,
          youtubeMusic
            ? { id: "open", icon: "link", label: "Open in YouTube Music", go: true, run: () => void window.open(youtubeMusicLink("song", song.id), "_blank", "noopener") }
            : spotify
            ? { id: "open", icon: "link", label: "Open in Spotify", go: true, run: () => void window.open(spotifyLink("track", song.id), "_blank", "noopener") }
            : { id: "details", icon: "info", label: "Song details", go: true, run: () => openSongDetails(song) },
        ]
      : [],
  ];
  return groups.map((g) => g.filter(isAction)).filter((g) => g.length);
}

type Target = { id: string; name: string; art: { id?: string | undefined; images?: SpImage[] | null | undefined; version?: string | undefined } };

function usePlaylistTargets(songs: Song[]) {
  const spotify = songs.every((song) => songSource(song) === "spotify");
  const { data: local = [] } = usePlaylists();
  const { data: remote = [] } = useSpotifyPlaylists();
  const edits = useSpotifyPlaylistEdits();
  const add = useAddToPlaylist();
  const create = useCreatePlaylist();
  const [filter, setFilter] = useState("");
  const targets = useMemo<Target[]>(
    () => (spotify
      ? remote.filter((p) => p.mine).map((p) => ({ id: p.id, name: p.name, art: { images: p.images } }))
      : local.filter((p) => !p.readonly).map((p) => ({ id: p.id, name: p.name, art: { id: p.coverArt, version: p.changed } }))),
    [spotify, remote, local],
  );
  const shown = useMemo(() => targets.filter((p) => fold(p.name).includes(fold(filter))), [targets, filter]);
  const name = songs.length === 1 && songs[0] ? songs[0].title : "New playlist";
  const ids = songs.map((s) => s.id);
  return {
    spotify,
    shown,
    filter,
    setFilter,
    addTo: (p: Target) => {
      if (spotify) void edits.add(p, songs);
      else void add.mutateAsync({ playlistId: p.id, songIds: ids }).then(() => toast(`Added to ${p.name}`), () => toast(`Couldn’t add to ${p.name}`));
    },
    createNew: () => {
      if (spotify) void edits.create(name, songs);
      else void create.mutateAsync({ name, songIds: ids }).then((p) => toast(`Added to ${p.name}`), () => toast("Couldn’t create the playlist"));
    },
  };
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
  const t = usePlaylistTargets(songs);
  return (
    <DM.Sub>
      <DM.SubTrigger className="menu-item">
        <Row icon="plus" end={<Icon name="forward" size={16} />}>Add to playlist</Row>
      </DM.SubTrigger>
      <DM.Portal>
        <DM.SubContent className="menu sub" sideOffset={4} collisionPadding={12}>
          <label className="menu-search" onKeyDown={(e) => e.stopPropagation()}>
            <Icon name="search" size={15} />
            <input value={t.filter} onChange={(e) => t.setFilter(e.target.value)} placeholder="Find a playlist" aria-label="Find a playlist" />
          </label>
          <DM.Item className="menu-item" onSelect={t.createNew}>
            <Row icon="plus">{t.spotify ? "New Spotify playlist" : "New playlist"}</Row>
          </DM.Item>
          <DM.Separator className="menu-sep" />
          <div className="menu-scroll">
            {t.shown.map((p) => (
              <DM.Item key={p.id} className="menu-item" onSelect={() => t.addTo(p)}>
                <span className="menu-label">{p.name}</span>
              </DM.Item>
            ))}
            {!t.shown.length ? <p className="menu-empty">No playlists match</p> : null}
          </div>
        </DM.SubContent>
      </DM.Portal>
    </DM.Sub>
  );
}

function DropdownItems({ songs, extra }: { songs: Song[]; extra?: TrackMenuExtra[] | undefined }) {
  const groups = useTrackActions(songs, extra);
  return groups.map((group, i) => (
    <Fragment key={group[0]?.id ?? i}>
      {i ? <DM.Separator className="menu-sep" /> : null}
      {group.map((a) =>
        a.playlists ? (
          <PlaylistSub key={a.id} songs={songs} />
        ) : (
          <DM.Item key={a.id} className="menu-item" onSelect={a.run}>
            <Row icon={a.icon}>{a.label}</Row>
          </DM.Item>
        ),
      )}
    </Fragment>
  ));
}

function SheetHead({ songs }: { songs: Song[] }) {
  const [first] = songs;
  if (!first) return null;
  const single = songs.length === 1;
  const artists = [...new Set(songs.map(artistName))];
  return (
    <div className="as-head">
      <div className={single ? "as-covers" : "as-covers stack"}>
        {songs.slice(0, 3).map((s) => <Art key={s.id} id={s.coverArt} px={52} />)}
      </div>
      <div className="as-title">
        <b>{single ? first.title : `${songs.length} songs`}</b>
        <span>{artists.slice(0, 3).join(", ")}{artists.length > 3 ? " and more" : ""}</span>
      </div>
    </div>
  );
}

function PlaylistPane({ songs, onBack, onDone }: { songs: Song[]; onBack: () => void; onDone: () => void }) {
  const t = usePlaylistTargets(songs);
  const pick = (run: () => void) => {
    onDone();
    run();
  };
  return (
    <div className="as-pane as-scroll in-right">
      <div className="as-pane-head">
        <button type="button" className="icon-btn light" aria-label="Back" onClick={onBack}><Icon name="back" size={22} /></button>
        <b>Add to playlist</b>
      </div>
      <label className="as-search">
        <Icon name="search" size={16} />
        <input value={t.filter} onChange={(e) => t.setFilter(e.target.value)} placeholder="Find a playlist" aria-label="Find a playlist" />
      </label>
      <button type="button" className="as-row" onClick={() => pick(t.createNew)}>
        <span className="as-new"><Icon name="plus" size={20} /></span>
        <span>{t.spotify ? "New Spotify playlist" : "New playlist"}</span>
      </button>
      {t.shown.map((p) => (
        <button key={p.id} type="button" className="as-row" onClick={() => pick(() => t.addTo(p))}>
          <Art {...p.art} px={40} />
          <span>{p.name}</span>
        </button>
      ))}
      {!t.shown.length ? <p className="as-empty">No playlists match</p> : null}
    </div>
  );
}

function TrackSheet({ req, open }: { req: MenuRequest; open: boolean }) {
  const groups = useTrackActions(req.songs, req.extra);
  const [pane, setPane] = useState<"main" | "playlists" | "back">("main");
  const single = req.songs.length === 1;
  const tone = useTone(single ? req.songs[0]?.coverArt : undefined);
  const run = (a: Action) => {
    if (a.playlists) {
      setPane("playlists");
      return;
    }
    closeTrackMenu();
    a.run();
  };
  const all = groups.flat();
  const quick = all.filter((a) => a.quick);
  const rest = [all.filter((a) => !a.quick && !a.go), all.filter((a) => a.go)].filter((g) => g.length);
  return (
    <ActionSheet open={open} onClose={closeTrackMenu} label={single ? (req.songs[0]?.title ?? "Song") : `${req.songs.length} songs`} tone={tone}>
      <SheetHead songs={req.songs} />
      {pane === "playlists" ? (
        <PlaylistPane songs={req.songs} onBack={() => setPane("back")} onDone={closeTrackMenu} />
      ) : (
        <div className={pane === "back" ? "as-pane as-scroll in-left" : "as-pane as-scroll"}>
          <div className="as-quick">
            {quick.map((a) => (
              <button key={a.id} type="button" className={a.on ? "on" : ""} aria-pressed={a.on ?? undefined} onClick={() => run(a)}>
                <Icon name={a.icon} size={24} />
                <span>{a.quick}</span>
              </button>
            ))}
          </div>
          {rest.map((g) => (
            <div key={g[0]?.id} className="as-group">
              {g.map((a) => (
                <button key={a.id} type="button" className="as-row" onClick={() => run(a)}>
                  <Icon name={a.icon} size={22} />
                  <span>{a.label}</span>
                  {a.playlists ? <Icon name="forward" size={18} /> : null}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </ActionSheet>
  );
}

export function TrackMenuHost({ mobile }: { mobile: boolean }) {
  const req = useTrackMenu((s) => s.req);
  const open = useTrackMenu((s) => s.open);
  if (mobile) return req ? <TrackSheet key={req.key} req={req} open={open} /> : null;
  return (
    <DM.Root key={req?.key ?? 0} open={open && Boolean(req)} onOpenChange={(o) => !o && closeTrackMenu()} modal={false}>
      <DM.Trigger asChild>
        <span aria-hidden="true" className="menu-anchor" style={{ left: req?.x ?? 0, top: req?.y ?? 0 }} />
      </DM.Trigger>
      <DM.Portal>
        <DM.Content className="menu" align={req?.align ?? "start"} sideOffset={4} collisionPadding={12} onCloseAutoFocus={(e) => e.preventDefault()}>
          {req ? <DropdownItems songs={req.songs} extra={req.extra} /> : null}
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
