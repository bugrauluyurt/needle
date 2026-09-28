import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Artist, InternetRadioStation } from "@needle/shared";
import { Art } from "../components/Art.tsx";
import { CardRow, RowHeader } from "../components/Cards.tsx";
import { Icon } from "../components/Icon.tsx";
import { MixArt } from "../components/MixArt.tsx";
import { sub } from "../lib/subsonic.ts";
import { hashPalette } from "../lib/palette.ts";
import { MobileHeader } from "../layout/Mobile.tsx";
import { useIsMobile, usePageTone } from "../layout/Shell.tsx";
import { TopBar } from "../layout/TopBar.tsx";
import { player } from "../player/controller.ts";
import { usePlayer } from "../player/store.ts";
import { keys } from "../queries/keys.ts";
import { useArtists, useIsAdmin, useRadios, useStarred, useStats } from "../queries/hooks.ts";
import { toast } from "../state/ui.ts";
import { isSpotify, rawId } from "../lib/spotify.ts";
import { useSpotifyArtist } from "../queries/spotify.ts";

type StationFields = { name: string; url: string; home: string };

const fieldsOf = (s?: InternetRadioStation): StationFields => ({ name: s?.name ?? "", url: s?.streamUrl ?? "", home: s?.homePageUrl ?? "" });

function StationForm({ station, onDone }: { station?: InternetRadioStation; onDone: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState(fieldsOf(station));
  const set = (k: keyof StationFields) => (e: ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const refresh = () => qc.invalidateQueries({ queryKey: keys.radios });
  const run = async (work: Promise<unknown>, done: string, action?: Parameters<typeof toast>[1]) => {
    try {
      await work;
      await refresh();
      toast(done, action);
      onDone();
    } catch {
      toast("Navidrome didn’t save that. Only admins can change stations.");
    }
  };
  const [name, url, home] = [f.name.trim(), f.url.trim(), f.home.trim() || undefined];
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(station ? sub.updateRadio(station.id, name, url, home) : sub.addRadio(name, url, home), station ? `Saved ${name}` : `Added ${name}`);
  };
  const remove = (s: InternetRadioStation) =>
    void run(sub.deleteRadio(s.id), `Deleted ${s.name}`, {
      label: "Undo",
      run: () => void sub.addRadio(s.name, s.streamUrl, s.homePageUrl).then(refresh),
    });
  return (
    <form onSubmit={submit}>
      <label className="field"><span>Name</span><input value={f.name} onChange={set("name")} required autoFocus /></label>
      <label className="field"><span>Stream address</span><input type="url" value={f.url} onChange={set("url")} placeholder="https://ice.somafm.com/groovesalad-128-mp3" required /></label>
      <label className="field"><span>Website (optional)</span><input type="url" value={f.home} onChange={set("home")} /></label>
      <div className={station ? "dialog-actions" : "dialog-actions end"}>
        {station ? <button type="button" className="btn ghost danger" onClick={() => remove(station)}><Icon name="trash" size={16} />Delete station</button> : null}
        <button type="submit" className="btn light">{station ? "Save" : "Add station"}</button>
      </div>
    </form>
  );
}

function StationDialog({ station, open, onOpenChange }: { station?: InternetRadioStation; open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="scrim" />
        <Dialog.Content className="dialog edit" aria-describedby={undefined}>
          <div className="dialog-head">
            <Dialog.Title className="dialog-title small">{station ? "Edit station" : "Add an internet radio station"}</Dialog.Title>
            <Dialog.Close className="icon-btn" aria-label="Close" type="button"><Icon name="close" /></Dialog.Close>
          </div>
          {open ? <StationForm station={station} onDone={() => onOpenChange(false)} /> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function AddStation() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn ghost sm" onClick={() => setOpen(true)}><Icon name="plus" size={15} />Add station</button>
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
      <MixArt mix={{ name: s.name.slice(0, 1), palette: hashPalette(s.name) }} className="station-art-mix" label={null} />
      <div className="station-text">
        <div className="t">{s.name}</div>
        <div className="s ellipsis">{s.homePageUrl ? s.homePageUrl.replace(/^https?:\/\//, "").replace(/\/$/, "") : "Internet radio"}</div>
      </div>
      {admin ? (
        <>
          <button type="button" className="icon-btn" aria-label={`Edit ${s.name}`} onClick={() => setEditing(true)}><Icon name="pencil" size={16} /></button>
          <StationDialog station={s} open={editing} onOpenChange={setEditing} />
        </>
      ) : null}
      <button type="button" className="icon-btn" aria-label={on ? `Stop ${s.name}` : `Play ${s.name}`} onClick={() => (active ? player.toggle() : player.playStation(s))}>
        <Icon name={on ? "pause" : "play"} size={18} />
      </button>
    </div>
  );
}

function ArtistArt({ id, library }: { id: string; library: Artist[] | undefined }) {
  const { data } = useSpotifyArtist(isSpotify(id) ? rawId(id) : undefined);
  const source = isSpotify(id) ? { images: data?.artist.images } : { id: library?.find((x) => x.id === id)?.coverArt };
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
      {mobile ? <MobileHeader title="Radio" /> : <TopBar />}
      <div className="pad">
        {!mobile ? <h1 className="hello">Radio</h1> : null}
        {artists.length || songs.length ? (
          <>
            <RowHeader title="Start a radio from something you like" subtitle="Plays songs like it, and keeps going" />
            <CardRow>
              {artists.map((a) => (
                <button key={a.id} type="button" className="card radio-card" onClick={() => void player.startRadio({ artistId: a.id, name: a.name })}>
                  <div className="card-art"><ArtistArt id={a.id} library={library} /></div>
                  <div className="t">{a.name} radio</div>
                  <div className="s">{isSpotify(a.id) ? "Shuffles their Spotify albums" : "Artist radio"}</div>
                </button>
              ))}
              {songs.map((s) => (
                <button key={s.id} type="button" className="card radio-card" onClick={() => void player.startRadio({ song: s, name: s.title })}>
                  <div className="card-art"><Art id={s.coverArt} px={180} /></div>
                  <div className="t">{s.title} radio</div>
                  <div className="s">Song radio</div>
                </button>
              ))}
            </CardRow>
          </>
        ) : (
          <p className="muted radio-hint">Right-click any song and choose Start radio, or use Artist radio on an artist’s page.</p>
        )}
        <RowHeader title="Internet radio" subtitle="Stations saved in Navidrome" action={admin ? <AddStation /> : undefined} />
        {stations.length ? (
          <div className="stations">{stations.map((s) => <Station key={s.id} s={s} admin={admin} />)}</div>
        ) : !isLoading ? (
          <p className="muted">No stations yet.{admin ? " Add one with its stream address." : ""}</p>
        ) : null}
      </div>
    </>
  );
}
