import * as DM from "@radix-ui/react-dropdown-menu";
import { Fragment, useState } from "react";
import type { MouseEvent, ReactNode } from "react";
import { create } from "zustand";
import type { Song } from "@needle/shared";
import { artistName } from "../../lib/format.ts";
import { useTone } from "../../lib/tone.ts";
import { ActionSheet } from "../ActionSheet.tsx";
import { Art } from "../Art.tsx";
import { Icon } from "../Icon.tsx";
import type { IconName } from "../Icon.tsx";
import { translate } from "../../i18n/index.ts";
import {
  usePlaylistTargets,
  useTrackActions,
} from "./hooks/useTrackActions.ts";
import type { TrackMenuAction, TrackMenuExtra } from "./types.ts";

export type { TrackMenuExtra } from "./types.ts";
type MenuRequest = {
  songs: Song[];
  extra?: TrackMenuExtra[] | undefined;
  x: number;
  y: number;
  align: "start" | "end";
  key: number;
};

const useTrackMenu = create<{ req: MenuRequest | null; open: boolean }>(() => ({
  req: null,
  open: false,
}));
let opened = 0;

export function openTrackMenu(
  songs: Song[],
  at: { x: number; y: number; align?: "start" | "end" },
  extra?: TrackMenuExtra[],
) {
  if (!songs.length) return;
  useTrackMenu.setState({
    req: {
      songs,
      extra,
      x: at.x,
      y: at.y,
      align: at.align ?? "start",
      key: ++opened,
    },
    open: true,
  });
}

export const closeTrackMenu = () => useTrackMenu.setState({ open: false });

function Row({
  icon,
  children,
  end,
}: {
  icon: IconName;
  children: ReactNode;
  end?: ReactNode;
}) {
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
        <Row icon="plus" end={<Icon name="forward" size={16} />}>
          {translate("menu.addToPlaylist")}
        </Row>
      </DM.SubTrigger>
      <DM.Portal>
        <DM.SubContent
          className="menu sub"
          sideOffset={4}
          collisionPadding={12}
        >
          <label className="menu-search" onKeyDown={(e) => e.stopPropagation()}>
            <Icon name="search" size={15} />
            <input
              value={t.filter}
              onChange={(e) => t.setFilter(e.target.value)}
              placeholder={translate("menu.findPlaylist")}
              aria-label={translate("menu.findPlaylist")}
            />
          </label>
          <DM.Item className="menu-item" onSelect={t.createNew}>
            <Row icon="plus">
              {translate(
                t.spotify ? "menu.newSpotifyPlaylist" : "menu.newPlaylist",
              )}
            </Row>
          </DM.Item>
          <DM.Separator className="menu-sep" />
          <div className="menu-scroll">
            {t.shown.map((p) => (
              <DM.Item
                key={p.id}
                className="menu-item"
                onSelect={() => t.addTo(p)}
              >
                <span className="menu-label">{p.name}</span>
              </DM.Item>
            ))}
            {!t.shown.length ? (
              <p className="menu-empty">
                {translate("menu.noPlaylistMatches")}
              </p>
            ) : null}
          </div>
        </DM.SubContent>
      </DM.Portal>
    </DM.Sub>
  );
}

function DropdownItems({
  songs,
  extra,
}: {
  songs: Song[];
  extra?: TrackMenuExtra[] | undefined;
}) {
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
        {songs.slice(0, 3).map((s) => (
          <Art key={s.id} id={s.coverArt} px={52} />
        ))}
      </div>
      <div className="as-title">
        <b>
          {single
            ? first.title
            : translate("menu.songs", { count: songs.length })}
        </b>
        <span>
          {artists.slice(0, 3).join(", ")}
          {artists.length > 3 ? ` ${translate("menu.andMore")}` : ""}
        </span>
      </div>
    </div>
  );
}

function PlaylistPane({
  songs,
  onBack,
  onDone,
}: {
  songs: Song[];
  onBack: () => void;
  onDone: () => void;
}) {
  const t = usePlaylistTargets(songs);
  const pick = (run: () => void) => {
    onDone();
    run();
  };
  return (
    <div className="as-pane as-scroll in-right">
      <div className="as-pane-head">
        <button
          type="button"
          className="icon-btn light"
          aria-label={translate("menu.back")}
          onClick={onBack}
        >
          <Icon name="back" size={22} />
        </button>
        <b>{translate("menu.addToPlaylist")}</b>
      </div>
      <label className="as-search">
        <Icon name="search" size={16} />
        <input
          value={t.filter}
          onChange={(e) => t.setFilter(e.target.value)}
          placeholder={translate("menu.findPlaylist")}
          aria-label={translate("menu.findPlaylist")}
        />
      </label>
      <button
        type="button"
        className="as-row"
        onClick={() => pick(t.createNew)}
      >
        <span className="as-new">
          <Icon name="plus" size={20} />
        </span>
        <span>
          {translate(
            t.spotify ? "menu.newSpotifyPlaylist" : "menu.newPlaylist",
          )}
        </span>
      </button>
      {t.shown.map((p) => (
        <button
          key={p.id}
          type="button"
          className="as-row"
          onClick={() => pick(() => t.addTo(p))}
        >
          <Art {...p.art} px={40} />
          <span>{p.name}</span>
        </button>
      ))}
      {!t.shown.length ? (
        <p className="as-empty">{translate("menu.noPlaylistMatches")}</p>
      ) : null}
    </div>
  );
}

function TrackSheet({ req, open }: { req: MenuRequest; open: boolean }) {
  const groups = useTrackActions(req.songs, req.extra);
  const [pane, setPane] = useState<"main" | "playlists" | "back">("main");
  const single = req.songs.length === 1;
  const tone = useTone(single ? req.songs[0]?.coverArt : undefined);
  const run = (a: TrackMenuAction) => {
    if (a.playlists) {
      setPane("playlists");
      return;
    }
    closeTrackMenu();
    a.run();
  };
  const all = groups.flat();
  const quick = all.filter((a) => a.quick);
  const rest = [
    all.filter((a) => !a.quick && !a.go),
    all.filter((a) => a.go),
  ].filter((g) => g.length);
  return (
    <ActionSheet
      open={open}
      onClose={closeTrackMenu}
      label={
        single
          ? (req.songs[0]?.title ??
            translate("count.song", { count: 1, formattedCount: "1" }))
          : translate("menu.songs", { count: req.songs.length })
      }
      tone={tone}
    >
      <SheetHead songs={req.songs} />
      {pane === "playlists" ? (
        <PlaylistPane
          songs={req.songs}
          onBack={() => setPane("back")}
          onDone={closeTrackMenu}
        />
      ) : (
        <div
          className={
            pane === "back" ? "as-pane as-scroll in-left" : "as-pane as-scroll"
          }
        >
          <div className="as-quick">
            {quick.map((a) => (
              <button
                key={a.id}
                type="button"
                className={a.on ? "on" : ""}
                aria-pressed={a.on ?? undefined}
                onClick={() => run(a)}
              >
                <Icon name={a.icon} size={24} />
                <span>{a.quick}</span>
              </button>
            ))}
          </div>
          {rest.map((g) => (
            <div key={g[0]?.id} className="as-group">
              {g.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className="as-row"
                  onClick={() => run(a)}
                >
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
  if (mobile)
    return req ? <TrackSheet key={req.key} req={req} open={open} /> : null;
  return (
    <DM.Root
      key={req?.key ?? 0}
      open={open && Boolean(req)}
      onOpenChange={(o) => !o && closeTrackMenu()}
      modal={false}
    >
      <DM.Trigger asChild>
        <span
          aria-hidden="true"
          className="menu-anchor"
          style={{ left: req?.x ?? 0, top: req?.y ?? 0 }}
        />
      </DM.Trigger>
      <DM.Portal>
        <DM.Content
          className="menu"
          align={req?.align ?? "start"}
          sideOffset={4}
          collisionPadding={12}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          {req ? <DropdownItems songs={req.songs} extra={req.extra} /> : null}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

export function TrackMoreButton({
  songs,
  extra,
  className,
  size = 20,
  label = translate("player.moreOptions"),
}: {
  songs: Song[];
  extra?: TrackMenuExtra[];
  className?: string;
  size?: number;
  label?: string;
}) {
  const open = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    openTrackMenu(songs, { x: r.right, y: r.bottom, align: "end" }, extra);
  };
  return (
    <button
      type="button"
      className={className ?? "icon-btn"}
      aria-label={label}
      aria-haspopup="menu"
      onClick={open}
    >
      <Icon name="more" size={size} />
    </button>
  );
}
