import * as Dialog from "@radix-ui/react-dialog";
import * as DM from "@radix-ui/react-dropdown-menu";
import { useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import type { PlaylistWithSongs, Song } from "@needle/shared";
import { Art } from "../components/Art.tsx";
import { DownloadButton } from "../components/Buttons.tsx";
import { RowHeader } from "../components/Cards.tsx";
import { ActBar, Hero, NotFoundState, PageSkeleton, PlayContextButton, ShuffleButton } from "../components/Hero.tsx";
import { Icon } from "../components/Icon.tsx";
import { TrackMoreButton } from "../components/TrackMenu.tsx";
import { TrackList } from "../components/TrackList.tsx";
import { ago, artistName, longDuration, plural } from "../lib/format.ts";
import { useTone } from "../lib/tone.ts";
import { usePageTone } from "../layout/Shell.tsx";
import { player } from "../player/controller.ts";
import { useAddToPlaylist, useDeletePlaylist, usePlaylist, useReorderPlaylist, useSimilarSongs, useUpdatePlaylist } from "../queries/hooks.ts";
import { useSession } from "../state/session.ts";
import { toast } from "../state/ui.ts";

type Sort = "custom" | "title" | "artist" | "album" | "added";
const SORTS: [Sort, string][] = [["custom", "Custom order"], ["title", "Title"], ["artist", "Artist"], ["album", "Album"], ["added", "Recently added"]];

function sortSongs(songs: Song[], sort: Sort): Song[] {
  if (sort === "custom") return songs;
  const by = (f: (s: Song) => string) => [...songs].sort((a, b) => f(a).localeCompare(f(b)));
  if (sort === "title") return by((s) => s.title);
  if (sort === "artist") return by((s) => artistName(s));
  if (sort === "album") return by((s) => s.album ?? "");
  return [...songs].sort((a, b) => (b.created ?? "").localeCompare(a.created ?? ""));
}

function EditForm({ playlist, onDone }: { playlist: PlaylistWithSongs; onDone: () => void }) {
  const update = useUpdatePlaylist();
  const remove = useDeletePlaylist();
  const navigate = useNavigate();
  const [name, setName] = useState(playlist.name);
  const [comment, setComment] = useState(playlist.comment ?? "");
  const [pub, setPub] = useState(Boolean(playlist.public));
  const save = () => {
    update.mutate({ id: playlist.id, name: name.trim() || playlist.name, comment, public: pub }, {
      onSuccess: () => {
        onDone();
        toast("Playlist saved");
      },
    });
  };
  return (
    <>
      <div className="edit-grid">
        <Art id={playlist.coverArt} px={180} />
        <div className="edit-fields">
          <label className="field">
            <span>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoFocus />
          </label>
          <label className="field">
            <span>Description</span>
            <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} maxLength={300} placeholder="Add an optional description" />
          </label>
        </div>
      </div>
      <div className="set-row">
        <div><b>Visible to other Navidrome users</b></div>
        <button type="button" className="toggle" role="switch" aria-checked={pub} aria-label="Visible to other Navidrome users" onClick={() => setPub(!pub)} />
      </div>
      <div className="dialog-actions">
        <button
          type="button"
          className="btn ghost danger"
          onClick={() => remove.mutate(playlist.id, { onSuccess: () => { onDone(); toast(`Deleted ${playlist.name}`); void navigate("/library"); } })}
        >
          <Icon name="trash" size={16} />Delete playlist
        </button>
        <button type="button" className="btn light" disabled={update.isPending} onClick={save}>Save</button>
      </div>
    </>
  );
}

function EditDialog({ playlist, open, onOpenChange }: { playlist: PlaylistWithSongs; open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="scrim" />
        <Dialog.Content className="dialog edit" aria-describedby={undefined}>
          <div className="dialog-head">
            <Dialog.Title className="dialog-title small">Edit details</Dialog.Title>
            <Dialog.Close className="icon-btn" aria-label="Close"><Icon name="close" /></Dialog.Close>
          </div>
          {open ? <EditForm playlist={playlist} onDone={() => onOpenChange(false)} /> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SongsThatFit({ playlist }: { playlist: PlaylistWithSongs }) {
  const entries = playlist.entry ?? [];
  const [seed, setSeed] = useState(0);
  const seedSong = entries.length ? entries[(seed * 7) % entries.length] : undefined;
  const { data = [] } = useSimilarSongs(seedSong?.id);
  const add = useAddToPlaylist();
  const have = new Set(entries.map((s) => s.id));
  const picks = data.filter((s) => !have.has(s.id)).slice(0, 5);
  if (!seedSong || !picks.length) return null;
  return (
    <div className="pad fit">
      <RowHeader title="Songs that fit" subtitle="From your library, based on what’s in this playlist" action={<button type="button" className="show-all" onClick={() => setSeed(seed + 1)}>Refresh</button>} />
      <div className="fit-list">
        {picks.map((s) => (
          <div key={s.id} className="fit-row">
            <Art id={s.coverArt} px={40} />
            <div className="mini-text">
              <div className="t">{s.title}</div>
              <div className="s">{artistName(s)}</div>
            </div>
            <span className="alb muted ellipsis">{s.album}</span>
            <button type="button" className="btn ghost sm" onClick={() => add.mutate({ playlistId: playlist.id, songIds: [s.id] }, { onSuccess: () => toast(`Added ${s.title}`) })}>Add</button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function PlaylistPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const { data: playlist, isLoading, isError, error, refetch } = usePlaylist(id);
  const me = useSession((s) => s.credentials?.user);
  const reorder = useReorderPlaylist();
  const update = useUpdatePlaylist();
  const [sort, setSort] = useState<Sort>("custom");
  const [filter, setFilter] = useState("");
  const [finding, setFinding] = useState(false);
  const editing = params.get("edit") === "1";
  const tone = useTone(playlist?.coverArt);
  usePageTone(tone);
  const songs = useMemo(() => playlist?.entry ?? [], [playlist]);
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const sorted = sortSongs(songs, sort);
    return q ? sorted.filter((s) => `${s.title} ${artistName(s)} ${s.album ?? ""}`.toLowerCase().includes(q)) : sorted;
  }, [songs, sort, filter]);

  if (isLoading) return <PageSkeleton />;
  if (isError || !playlist) return <NotFoundState what="playlist" error={error} retry={() => void refetch()} />;

  const mine = playlist.owner === me && !playlist.readonly;
  const context = { kind: "playlist" as const, id: playlist.id, name: playlist.name };
  const canReorder = mine && sort === "custom" && !filter;
  const setEdit = (o: boolean) => setParams(o ? { edit: "1" } : {}, { replace: true });

  return (
    <div className="tinted">
      <Hero
        art={<Art id={playlist.coverArt} px={232} eager />}
        kind={playlist.public ? "Public playlist" : "Playlist"}
        title={playlist.name}
        description={playlist.comment}
        meta={
          <>
            <b><span className="avatar tiny">{(playlist.owner ?? "?").slice(0, 1).toUpperCase()}</span>{playlist.owner}</b>
            <span>{plural(playlist.songCount, "song")}{playlist.duration ? `, ${longDuration(playlist.duration)}` : ""}</span>
          </>
        }
      />
      <ActBar
        end={
          <>
            {finding ? (
              <label className="find">
                <Icon name="search" size={17} />
                <input autoFocus value={filter} onChange={(e) => setFilter(e.target.value)} onBlur={() => !filter && setFinding(false)} placeholder="Find in playlist" aria-label="Find in playlist" />
              </label>
            ) : (
              <button type="button" className="icon-btn" aria-label="Find in playlist" onClick={() => setFinding(true)}><Icon name="search" size={18} /></button>
            )}
            <DM.Root modal={false}>
              <DM.Trigger asChild>
                <button type="button" className="sort-btn">{SORTS.find(([k]) => k === sort)?.[1]}<Icon name="list" size={18} /></button>
              </DM.Trigger>
              <DM.Portal>
                <DM.Content className="menu" align="end" sideOffset={6}>
                  <DM.Label className="menu-heading">Sort by</DM.Label>
                  {SORTS.map(([k, label]) => (
                    <DM.Item key={k} className="menu-item" onSelect={() => setSort(k)}>
                      <span className="menu-label">{label}</span>
                      {sort === k ? <Icon name="check" size={16} /> : null}
                    </DM.Item>
                  ))}
                </DM.Content>
              </DM.Portal>
            </DM.Root>
          </>
        }
      >
        <PlayContextButton contextId={playlist.id} label={playlist.name} onPlay={() => player.playSongs(songs, 0, context)} />
        <ShuffleButton label={playlist.name} onShuffle={() => player.playSongs(songs, 0, context, { shuffle: true })} />
        <DownloadButton target={{ id: playlist.id, kind: "playlist", name: playlist.name, subtitle: `Playlist, ${playlist.owner ?? ""}`, ...(playlist.coverArt ? { coverArt: playlist.coverArt } : {}) }} songs={songs} />
        {mine ? (
          <button type="button" className="icon-btn big" aria-label="Edit details" onClick={() => setEdit(true)}><Icon name="pencil" size={22} /></button>
        ) : null}
        {songs.length ? <TrackMoreButton songs={songs} className="icon-btn big" size={26} label={`More options for ${playlist.name}`} /> : null}
      </ActBar>
      {songs.length ? (
        <TrackList
          songs={shown}
          context={context}
          art
          album
          column={{ label: "Added", value: (s) => ago(s.created) }}
          onPlay={(i) => player.playSongs(shown, i, context)}
          {...(canReorder ? {
            onReorder: (from: number, to: number) => {
              const ids = songs.map((s) => s.id);
              const [moved] = ids.splice(from, 1);
              if (moved) ids.splice(to, 0, moved);
              reorder.mutate({ id: playlist.id, songIds: ids });
            },
          } : {})}
          {...(mine && sort === "custom" && !filter ? {
            menuExtra: (_s: Song, i: number) => [{ label: "Remove from this playlist", icon: "trash" as const, run: () => update.mutate({ id: playlist.id, removeIndex: [i] }, { onSuccess: () => toast("Removed from playlist") }) }],
          } : {})}
        />
      ) : (
        <div className="pad empty-inline">
          <h2>Let’s find something for your playlist</h2>
          <p className="muted">Right-click any song and choose Add to playlist, or use the suggestions once it has a few songs.</p>
        </div>
      )}
      <SongsThatFit playlist={playlist} />
      {mine ? <EditDialog playlist={playlist} open={editing} onOpenChange={setEdit} /> : null}
    </div>
  );
}
