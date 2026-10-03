import * as Dialog from "@radix-ui/react-dialog";
import { useMemo, useState } from "react";
import { CollectionTools } from "../../../components/Collection.tsx";
import { SearchField } from "../../../components/SearchField.tsx";
import { AS_GIVEN, librarySongSorts, shownSongs } from "../../../lib/songs.ts";
import type { SongOrder } from "../../../lib/songs.ts";
import { useNavigate, useParams, useSearchParams } from "react-router";
import type { PlaylistWithSongs, Song } from "@needle/shared";
import { Art } from "../../../components/Art.tsx";
import { DownloadButton } from "../../../components/Buttons.tsx";
import { RowHeader } from "../../../components/Cards.tsx";
import {
  ActBar,
  Hero,
  NotFoundState,
  PageSkeleton,
  PlayContextButton,
  ShuffleButton,
} from "../../../components/Hero.tsx";
import { Icon } from "../../../components/Icon.tsx";
import { TrackMoreButton } from "../../../components/tracks/TrackMenu.tsx";
import { TrackList } from "../../../components/tracks/TrackList.tsx";
import { ago, artistName, longDuration, plural } from "../../../lib/format.ts";
import { useTone } from "../../../lib/tone.ts";
import { usePageTone } from "../../../layout/pageTone.ts";
import { player } from "../../../player/controller.ts";
import {
  useAddToPlaylist,
  useDeletePlaylist,
  usePlaylist,
  useReorderPlaylist,
  useSimilarSongs,
  useUpdatePlaylist,
} from "../../../queries/hooks.ts";
import { useSession } from "../../../state/session.ts";
import { toast } from "../../../state/ui.ts";
import { translate } from "../../../i18n/index.ts";

function EditForm({ playlist, onDone }: { playlist: PlaylistWithSongs; onDone: () => void }) {
  const update = useUpdatePlaylist();
  const remove = useDeletePlaylist();
  const navigate = useNavigate();
  const [name, setName] = useState(playlist.name);
  const [comment, setComment] = useState(playlist.comment ?? "");
  const [pub, setPub] = useState(Boolean(playlist.public));
  const save = () => {
    update.mutate(
      {
        id: playlist.id,
        name: name.trim() || playlist.name,
        comment,
        public: pub,
      },
      {
        onSuccess: () => {
          onDone();
          toast(translate("playlist.saved"));
        },
      },
    );
  };
  return (
    <>
      <div className="edit-grid">
        <Art id={playlist.coverArt} version={playlist.changed} px={180} />
        <div className="edit-fields">
          <label className="field">
            <span>{translate("playlist.name")}</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoFocus />
          </label>
          <label className="field">
            <span>{translate("playlist.description")}</span>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
              maxLength={300}
              placeholder={translate("playlist.descriptionHint")}
            />
          </label>
        </div>
      </div>
      <div className="set-row">
        <div>
          <b>{translate("playlist.visible")}</b>
        </div>
        <button
          type="button"
          className="toggle"
          role="switch"
          aria-checked={pub}
          aria-label={translate("playlist.visible")}
          onClick={() => setPub(!pub)}
        />
      </div>
      <div className="dialog-actions">
        <button
          type="button"
          className="btn ghost danger"
          onClick={() =>
            remove.mutate(playlist.id, {
              onSuccess: () => {
                onDone();
                toast(translate("playlist.deleted", { name: playlist.name }));
                void navigate("/library");
              },
            })
          }
        >
          <Icon name="trash" size={16} />
          {translate("playlist.delete")}
        </button>
        <button type="button" className="btn light" disabled={update.isPending} onClick={save}>
          {translate("common.save")}
        </button>
      </div>
    </>
  );
}

function EditDialog({
  playlist,
  open,
  onOpenChange,
}: {
  playlist: PlaylistWithSongs;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="scrim" />
        <Dialog.Content className="dialog edit" aria-describedby={undefined}>
          <div className="dialog-head">
            <Dialog.Title className="dialog-title small">{translate("playlist.edit")}</Dialog.Title>
            <Dialog.Close className="icon-btn" aria-label={translate("common.close")}>
              <Icon name="close" />
            </Dialog.Close>
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
      <RowHeader
        title={translate("playlist.fit")}
        subtitle={translate("playlist.fitHint")}
        action={
          <button type="button" className="show-all" onClick={() => setSeed(seed + 1)}>
            {translate("playlist.refresh")}
          </button>
        }
      />
      <div className="fit-list">
        {picks.map((s) => (
          <div key={s.id} className="fit-row">
            <Art id={s.coverArt} px={40} />
            <div className="mini-text">
              <div className="t">{s.title}</div>
              <div className="s">{artistName(s)}</div>
            </div>
            <span className="alb muted ellipsis">{s.album}</span>
            <button
              type="button"
              className="btn ghost sm"
              onClick={() =>
                add.mutate(
                  { playlistId: playlist.id, songIds: [s.id] },
                  {
                    onSuccess: () => toast(translate("playlist.added", { name: s.title })),
                  },
                )
              }
            >
              {translate("common.add")}
            </button>
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
  const [order, setOrder] = useState<SongOrder>(AS_GIVEN);
  const [filter, setFilter] = useState("");
  const editing = params.get("edit") === "1";
  const tone = useTone(playlist?.coverArt);
  usePageTone(tone);
  const songs = useMemo(() => playlist?.entry ?? [], [playlist]);
  const shown = useMemo(() => shownSongs(songs, order, filter), [songs, order, filter]);

  if (isLoading) return <PageSkeleton />;
  if (isError || !playlist) return <NotFoundState what="playlist" error={error} retry={() => void refetch()} />;

  const mine = playlist.owner === me && !playlist.readonly;
  const context = {
    kind: "playlist" as const,
    id: playlist.id,
    name: playlist.name,
  };
  const canReorder = mine && order.key === "custom" && !filter;
  const setEdit = (o: boolean) => setParams(o ? { edit: "1" } : {}, { replace: true });

  return (
    <div className="tinted">
      <Hero
        art={<Art id={playlist.coverArt} version={playlist.changed} px={232} eager />}
        kind={translate(playlist.public ? "playlist.publicKind" : "playlist.kind")}
        title={playlist.name}
        description={playlist.comment}
        meta={
          <>
            <b>
              <span className="avatar tiny">{(playlist.owner ?? "?").slice(0, 1).toUpperCase()}</span>
              {playlist.owner}
            </b>
            <span>
              {plural(playlist.songCount, "song")}
              {playlist.duration ? `, ${longDuration(playlist.duration)}` : ""}
            </span>
          </>
        }
      />
      <ActBar
        end={
          <>
            <SearchField
              variant="inline"
              collapsible
              value={filter}
              onChange={setFilter}
              label={translate("playlist.find")}
            />
            <CollectionTools
              sorts={[["custom", translate("playlist.customOrder")], ...librarySongSorts()]}
              order={order}
              onOrder={setOrder}
            />
          </>
        }
      >
        <PlayContextButton
          contextId={playlist.id}
          label={playlist.name}
          onPlay={() => player.playSongs(songs, 0, context)}
        />
        <ShuffleButton label={playlist.name} onShuffle={() => player.playSongs(songs, 0, context, { shuffle: true })} />
        <DownloadButton
          target={{
            id: playlist.id,
            kind: "playlist",
            name: playlist.name,
            subtitle: playlist.owner
              ? translate("search.playlistOwner", { owner: playlist.owner })
              : translate("playlist.kind"),
            ...(playlist.coverArt ? { coverArt: playlist.coverArt } : {}),
          }}
          songs={songs}
        />
        {mine ? (
          <button
            type="button"
            className="icon-btn big"
            aria-label={translate("playlist.edit")}
            onClick={() => setEdit(true)}
          >
            <Icon name="pencil" size={22} />
          </button>
        ) : null}
        {songs.length ? (
          <TrackMoreButton
            songs={songs}
            className="icon-btn big"
            size={26}
            label={translate("playlist.moreOptions", { name: playlist.name })}
          />
        ) : null}
      </ActBar>
      {songs.length ? (
        <TrackList
          songs={shown}
          context={context}
          art
          album
          column={{
            label: translate("sort.dateAdded"),
            value: (s) => ago(s.created),
            sort: "added",
          }}
          order={order}
          onOrder={setOrder}
          {...(canReorder
            ? {
                onReorder: (from: number, to: number) => {
                  const ids = songs.map((s) => s.id);
                  const [moved] = ids.splice(from, 1);
                  if (moved) ids.splice(to, 0, moved);
                  reorder.mutate({ id: playlist.id, songIds: ids });
                },
              }
            : {})}
          {...(canReorder
            ? {
                menuExtra: (_song: Song, songIndex: number) => [
                  {
                    label: translate("playlist.remove"),
                    icon: "trash" as const,
                    run: () =>
                      update.mutate(
                        { id: playlist.id, removeIndex: [songIndex] },
                        {
                          onSuccess: () => toast(translate("playlist.removed")),
                        },
                      ),
                  },
                ],
              }
            : {})}
        />
      ) : (
        <div className="pad empty-inline">
          <h2>{translate("playlist.empty")}</h2>
          <p className="muted">{translate("playlist.emptyHint")}</p>
        </div>
      )}
      <SongsThatFit playlist={playlist} />
      {mine ? <EditDialog playlist={playlist} open={editing} onOpenChange={setEdit} /> : null}
    </div>
  );
}
