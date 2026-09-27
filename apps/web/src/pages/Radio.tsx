import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import type { FormEvent } from "react";
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
import { image, isSpotify, rawId } from "../lib/spotify.ts";
import { useSpotifyArtist } from "../queries/spotify.ts";

function AddStation() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [home, setHome] = useState("");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await sub.addRadio(name.trim(), url.trim(), home.trim() || undefined);
      await qc.invalidateQueries({ queryKey: keys.radios });
      toast(`Added ${name.trim()}`);
      setOpen(false);
      setName("");
      setUrl("");
      setHome("");
    } catch {
      toast("Navidrome didn’t save the station. Only admins can add stations.");
    }
  };
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button type="button" className="btn ghost sm"><Icon name="plus" size={15} />Add station</button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="scrim" />
        <Dialog.Content className="dialog edit" aria-describedby={undefined}>
          <form onSubmit={(e) => void submit(e)}>
            <div className="dialog-head">
              <Dialog.Title className="dialog-title small">Add an internet radio station</Dialog.Title>
              <Dialog.Close className="icon-btn" aria-label="Close" type="button"><Icon name="close" /></Dialog.Close>
            </div>
            <label className="field"><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} required autoFocus /></label>
            <label className="field"><span>Stream address</span><input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://ice.somafm.com/groovesalad-128-mp3" required /></label>
            <label className="field"><span>Website (optional)</span><input type="url" value={home} onChange={(e) => setHome(e.target.value)} /></label>
            <div className="dialog-actions end">
              <button type="submit" className="btn light">Add station</button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Station({ s }: { s: InternetRadioStation }) {
  const active = usePlayer((p) => p.station?.id === s.id);
  const playing = usePlayer((p) => p.playing);
  const on = active && playing;
  return (
    <div className="station">
      <MixArt mix={{ name: s.name.slice(0, 1), palette: hashPalette(s.name) }} className="station-art-mix" label={null} />
      <div className="station-text">
        <div className="t">{s.name}</div>
        <div className="s ellipsis">{s.homePageUrl ? s.homePageUrl.replace(/^https?:\/\//, "").replace(/\/$/, "") : "Internet radio"}</div>
      </div>
      {on ? <span className="live">Playing</span> : null}
      <button type="button" className="icon-btn" aria-label={on ? `Stop ${s.name}` : `Play ${s.name}`} onClick={() => (active ? player.toggle() : player.playStation(s))}>
        <Icon name={on ? "pause" : "play"} size={18} />
      </button>
    </div>
  );
}

function ArtistArt({ id, library }: { id: string; library: Artist[] | undefined }) {
  const { data } = useSpotifyArtist(isSpotify(id) ? rawId(id) : undefined);
  const cover = isSpotify(id) ? image(data?.artist.images, 300) : library?.find((x) => x.id === id)?.coverArt;
  return <Art id={cover} px={180} round fallback="artist" />;
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
          <div className="stations">{stations.map((s) => <Station key={s.id} s={s} />)}</div>
        ) : !isLoading ? (
          <p className="muted">No stations yet.{admin ? " Add one with its stream address." : ""}</p>
        ) : null}
      </div>
    </>
  );
}
