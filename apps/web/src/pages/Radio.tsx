import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Artist, InternetRadioStation } from "@needle/shared";
import { isYouTubeMusic } from "@needle/shared";
import { Art } from "../components/Art.tsx";
import { CardRow, RowHeader } from "../components/Cards.tsx";
import { Icon } from "../components/Icon.tsx";
import { MixArt } from "../components/MixArt.tsx";
import { sub } from "../lib/subsonic.ts";
import { hashPalette } from "../lib/palette.ts";
import { MobileHeader } from "../layout/Mobile.tsx";
import { useIsMobile } from "../lib/media.ts";
import { usePageTone } from "../layout/pageTone.ts";
import { TopBar } from "../layout/TopBar.tsx";
import { player } from "../player/controller.ts";
import { usePlayer } from "../player/store.ts";
import { keys } from "../queries/keys.ts";
import {
  useArtists,
  useIsAdmin,
  useRadios,
  useStarred,
  useStats,
} from "../queries/hooks.ts";
import { toast } from "../state/ui.ts";
import { isSpotify, rawId } from "../features/spotify/api/client.ts";
import { useSpotifyArtistProfile } from "../features/spotify/hooks/useSpotify.ts";
import { useYouTubeMusicArtistImage } from "../features/youtube-music/hooks/useYouTubeMusic.ts";
import { translate } from "../i18n/index.ts";

type StationFields = { name: string; url: string; home: string };

const fieldsOf = (s?: InternetRadioStation): StationFields => ({
  name: s?.name ?? "",
  url: s?.streamUrl ?? "",
  home: s?.homePageUrl ?? "",
});

function StationForm({
  station,
  onDone,
}: {
  station?: InternetRadioStation;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [f, setF] = useState(fieldsOf(station));
  const set = (k: keyof StationFields) => (e: ChangeEvent<HTMLInputElement>) =>
    setF({ ...f, [k]: e.target.value });
  const refresh = () => qc.invalidateQueries({ queryKey: keys.radios });
  const run = async (
    work: Promise<unknown>,
    done: string,
    action?: Parameters<typeof toast>[1],
  ) => {
    try {
      await work;
      await refresh();
      toast(done, action);
      onDone();
    } catch {
      toast(translate("radio.adminFailed"));
    }
  };
  const [name, url, home] = [
    f.name.trim(),
    f.url.trim(),
    f.home.trim() || undefined,
  ];
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(
      station
        ? sub.updateRadio(station.id, name, url, home)
        : sub.addRadio(name, url, home),
      translate(station ? "radio.savedStation" : "radio.addedStation", {
        name,
      }),
    );
  };
  const remove = (s: InternetRadioStation) =>
    void run(
      sub.deleteRadio(s.id),
      translate("radio.deletedStation", { name: s.name }),
      {
        label: translate("radio.undo"),
        run: () =>
          void sub.addRadio(s.name, s.streamUrl, s.homePageUrl).then(refresh),
      },
    );
  return (
    <form onSubmit={submit}>
      <label className="field">
        <span>{translate("radio.name")}</span>
        <input value={f.name} onChange={set("name")} required autoFocus />
      </label>
      <label className="field">
        <span>{translate("radio.stream")}</span>
        <input
          type="url"
          value={f.url}
          onChange={set("url")}
          placeholder="https://radio.example.com/stream.mp3"
          required
        />
      </label>
      <label className="field">
        <span>{translate("radio.homepage")}</span>
        <input type="url" value={f.home} onChange={set("home")} />
      </label>
      <div className={station ? "dialog-actions" : "dialog-actions end"}>
        {station ? (
          <button
            type="button"
            className="btn ghost danger"
            onClick={() => remove(station)}
          >
            <Icon name="trash" size={16} />
            {translate("radio.delete")}
          </button>
        ) : null}
        <button type="submit" className="btn light">
          {translate(station ? "common.save" : "radio.add")}
        </button>
      </div>
    </form>
  );
}

function StationDialog({
  station,
  open,
  onOpenChange,
}: {
  station?: InternetRadioStation;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="scrim" />
        <Dialog.Content className="dialog edit" aria-describedby={undefined}>
          <div className="dialog-head">
            <Dialog.Title className="dialog-title small">
              {translate(station ? "radio.editHeading" : "radio.addHeading")}
            </Dialog.Title>
            <Dialog.Close
              className="icon-btn"
              aria-label={translate("common.close")}
              type="button"
            >
              <Icon name="close" />
            </Dialog.Close>
          </div>
          {open ? (
            <StationForm station={station} onDone={() => onOpenChange(false)} />
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function AddStation() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="btn ghost sm"
        onClick={() => setOpen(true)}
      >
        <Icon name="plus" size={15} />
        {translate("radio.add")}
      </button>
      <StationDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

function Station({ s, admin }: { s: InternetRadioStation; admin: boolean }) {
  const active = usePlayer((p) => p.station?.id === s.id);
  const playing = usePlayer((p) => p.playing);
  const [editing, setEditing] = useState(false);
  const on = active && playing;
  return (
    <div className={active ? "station on" : "station"}>
      <MixArt
        mix={{ name: s.name.slice(0, 1), palette: hashPalette(s.name) }}
        className="station-art-mix"
        label={null}
      />
      <div className="station-text">
        <div className="t">{s.name}</div>
        <div className="s ellipsis">
          {s.homePageUrl
            ? s.homePageUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")
            : translate("radio.internet")}
        </div>
      </div>
      {admin ? (
        <>
          <button
            type="button"
            className="icon-btn"
            aria-label={translate("radio.edit", { name: s.name })}
            onClick={() => setEditing(true)}
          >
            <Icon name="pencil" size={16} />
          </button>
          <StationDialog station={s} open={editing} onOpenChange={setEditing} />
        </>
      ) : null}
      <button
        type="button"
        className="icon-btn"
        aria-label={translate(on ? "radio.stopStation" : "radio.playStation", {
          name: s.name,
        })}
        onClick={() => (active ? player.toggle() : player.playStation(s))}
      >
        <Icon name={on ? "pause" : "play"} size={18} />
      </button>
    </div>
  );
}

function ArtistArt({
  id,
  library,
}: {
  id: string;
  library: Artist[] | undefined;
}) {
  const { data } = useSpotifyArtistProfile(
    isSpotify(id) ? rawId(id) : undefined,
  );
  const youtubeMusicImage = useYouTubeMusicArtistImage(
    isYouTubeMusic(id) ? id : "",
  );
  const source = isYouTubeMusic(id)
    ? { id: youtubeMusicImage }
    : isSpotify(id)
      ? { images: data?.images }
      : { id: library?.find((x) => x.id === id)?.coverArt };
  return <Art {...source} px={180} round fallback="artist" />;
}

export default function RadioPage() {
  const mobile = useIsMobile();
  const { data: stations = [], isLoading } = useRadios();
  const { data: stats } = useStats("quarter");
  const { data: starred } = useStarred();
  const admin = useIsAdmin();
  const { data: library } = useArtists();
  usePageTone(null);
  const artists = (stats?.topArtists ?? []).slice(0, 3);
  const songs = (starred?.song ?? []).slice(0, 3);
  return (
    <>
      {mobile ? <MobileHeader title={translate("radio.title")} /> : <TopBar />}
      <div className="pad">
        {!mobile ? <h1 className="hello">{translate("radio.title")}</h1> : null}
        {artists.length || songs.length ? (
          <>
            <RowHeader
              title={translate("radio.startHeading")}
              subtitle={translate("radio.startHint")}
            />
            <CardRow>
              {artists.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className="card radio-card"
                  onClick={() =>
                    void player.startRadio({ artistId: a.id, name: a.name })
                  }
                >
                  <div className="card-art">
                    <ArtistArt id={a.id} library={library} />
                  </div>
                  <div className="t">
                    {translate("radio.named", { name: a.name })}
                  </div>
                  <div className="s">
                    {isYouTubeMusic(a.id)
                      ? "YouTube Music"
                      : isSpotify(a.id)
                        ? "Spotify"
                        : translate("radio.artist")}
                  </div>
                </button>
              ))}
              {songs.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="card radio-card"
                  onClick={() =>
                    void player.startRadio({ song: s, name: s.title })
                  }
                >
                  <div className="card-art">
                    <Art id={s.coverArt} px={180} />
                  </div>
                  <div className="t">
                    {translate("radio.named", { name: s.title })}
                  </div>
                  <div className="s">{translate("radio.song")}</div>
                </button>
              ))}
            </CardRow>
          </>
        ) : (
          <p className="muted radio-hint">{translate("radio.hint")}</p>
        )}
        <RowHeader
          title={translate("radio.internet")}
          subtitle={translate("radio.savedStations")}
          action={admin ? <AddStation /> : undefined}
        />
        {stations.length ? (
          <div className="stations">
            {stations.map((s) => (
              <Station key={s.id} s={s} admin={admin} />
            ))}
          </div>
        ) : !isLoading ? (
          <p className="muted">
            {translate(admin ? "radio.noStationsAdmin" : "radio.noStations")}
          </p>
        ) : null}
      </div>
    </>
  );
}
