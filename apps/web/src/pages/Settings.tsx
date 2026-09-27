import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import type { ImportResult } from "@needle/shared";
import { Icon } from "../components/Icon.tsx";
import { Slider } from "../components/Slider.tsx";
import { api } from "../lib/api.ts";
import { minutesSince, plural } from "../lib/format.ts";
import { MobileHeader } from "../layout/Mobile.tsx";
import { useIsMobile, usePageTone } from "../layout/Shell.tsx";
import { AvatarFace, TopBar } from "../layout/TopBar.tsx";
import { removeAllDownloads, useOffline } from "../offline/store.ts";
import { canCrossfade } from "../player/controller.ts";
import { keys } from "../queries/keys.ts";
import { useCapabilities, useMe } from "../queries/hooks.ts";
import { squarePhoto } from "../lib/photo.ts";
import { useSession } from "../state/session.ts";
import { clearSpotifyCache } from "../queries/spotify.ts";
import type { Quality, Settings as S } from "../state/settings.ts";
import { useSettings } from "../state/settings.ts";
import { toast, useUi } from "../state/ui.ts";
import { sub } from "../lib/subsonic.ts";

function Row({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="set-row">
      <div>
        <b>{title}</b>
        {hint ? <span>{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}

function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map(([v, l]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)}>{l}</button>
      ))}
    </div>
  );
}

function Toggle<K extends keyof S>({ k, label }: { k: K; label: string }) {
  const value = useSettings((s) => s[k]) as boolean;
  const set = useSettings((s) => s.set);
  return <button type="button" className="toggle" role="switch" aria-checked={value} aria-label={label} onClick={() => set(k, !value as S[K])} />;
}

const QUALITY: [Quality, string][] = [["original", "Original"], ["320", "320 kbps"], ["192", "192 kbps"]];

function gb(bytes: number): string {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`;
}

function Storage() {
  const bytes = useOffline((s) => s.bytes);
  const collections = useOffline((s) => s.collections);
  const supported = useOffline((s) => s.supported);
  const { data: quota } = useQuery({ queryKey: ["quota"], queryFn: () => navigator.storage?.estimate?.() ?? Promise.resolve(null) });
  if (!supported) {
    return <Row title="Downloads aren’t available here" hint="Open Needle at its https:// address to keep music on this device." ><span /></Row>;
  }
  const pct = quota?.quota ? Math.min(100, (bytes / quota.quota) * 100) : 0;
  const albums = collections.filter((c) => c.kind === "album").length;
  const playlists = collections.filter((c) => c.kind === "playlist").length;
  const liked = collections.some((c) => c.kind === "liked");
  const parts = [albums ? plural(albums, "album") : null, playlists ? plural(playlists, "playlist") : null, liked ? "your liked songs" : null].filter(Boolean);
  return (
    <div className="set-row">
      <div>
        <b>{gb(bytes)} used by downloads</b>
        <span>{parts.length ? `${parts.join(", ")}.` : "Nothing downloaded yet."}{quota?.quota ? ` Room for about ${gb(quota.quota - (quota.usage ?? 0))} more.` : ""}</span>
        <div className="storage"><i style={{ width: `${Math.max(pct, bytes ? 2 : 0)}%` }} /></div>
      </div>
      <button type="button" className="btn ghost sm" disabled={!bytes} onClick={() => void removeAllDownloads().then(() => toast("Removed all downloads"))}>Remove all</button>
    </div>
  );
}

function PhotoSetting() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const done = () => qc.invalidateQueries({ queryKey: keys.me });
  const upload = async (file: File) => {
    setBusy(true);
    try {
      await api.setPhoto(await squarePhoto(file));
      await done();
      toast("Photo updated");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn’t save that photo");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Row title="Your photo" hint="Shown on every device. Stored on the Pi with Needle’s data.">
      <div className="photo-set">
        <span className="avatar"><AvatarFace px={44} /></span>
        <input ref={input} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f); }} />
        <button type="button" className="btn ghost sm" disabled={busy} onClick={() => input.current?.click()}>{busy ? "Saving…" : me?.photo ? "Change" : "Choose photo"}</button>
        {me?.photo ? <button type="button" className="btn ghost sm" onClick={() => void api.removePhoto().then(done)}>Remove</button> : null}
      </div>
    </Row>
  );
}

function SpotifyImport() {
  const caps = useCapabilities();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const lists = useQuery({ queryKey: keys.spotifyPlaylists, queryFn: api.spotifyPlaylists, enabled: open });
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [requesting, setRequesting] = useState(false);
  const run = async (source: string) => {
    setBusy(source);
    setResult(null);
    try {
      const r = await api.spotifyImport(source);
      setResult(r);
      await qc.invalidateQueries({ queryKey: keys.playlists });
    } catch (e) {
      toast(e instanceof Error ? e.message : "The copy failed");
    } finally {
      setBusy(null);
    }
  };
  const requestMissing = async () => {
    if (!result) return;
    setRequesting(true);
    try {
      const r = await api.spotifyMissing(result.missing);
      toast(`Lidarr is fetching ${plural(r.requested, "album")}${r.notFound ? `; ${r.notFound} weren’t found` : ""}${r.skipped ? `; ${r.skipped} more next time` : ""}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Lidarr didn’t take the request");
    } finally {
      setRequesting(false);
    }
  };
  return (
    <>
      <Row title="Copy playlists into your own library" hint="Optional. Makes a Navidrome playlist from a Spotify one, using only songs you already have. Lidarr can fetch the rest.">
        <button type="button" className="btn ghost sm" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Hide" : "Choose playlists"}</button>
      </Row>
      {open ? (
        <ul className="sp-list">
          <li>
            <span><Icon name="heartFill" size={16} />Liked songs</span>
            <button type="button" className="btn ghost sm" disabled={Boolean(busy)} onClick={() => void run("liked")}>{busy === "liked" ? "Copying…" : "Copy"}</button>
          </li>
          {(lists.data ?? []).map((p) => (
            <li key={p.id}>
              <span>{p.name}<em>{plural(p.trackCount, "song")}</em></span>
              <button type="button" className="btn ghost sm" disabled={Boolean(busy)} onClick={() => void run(p.id)}>{busy === p.id ? "Copying…" : "Copy"}</button>
            </li>
          ))}
          {lists.isLoading ? <li className="muted">Loading your playlists…</li> : null}
          {lists.isError ? <li className="muted">{lists.error instanceof Error ? lists.error.message : "Couldn’t load your Spotify playlists"}</li> : null}
        </ul>
      ) : null}
      {result ? (
        <div className="sp-result" role="status">
          <b>{result.source}: {result.matched} of {plural(result.total, "song")} are in your library.</b>
          {result.missing.length ? (
            <>
              <span>{plural(result.missing.length, "song")} aren’t, for example {result.missing.slice(0, 3).map((m) => `${m.title} by ${m.artist}`).join("; ")}.</span>
              {caps.data?.lidarr ? (
                <button type="button" className="btn light sm" disabled={requesting} onClick={() => void requestMissing()}>{requesting ? "Asking Lidarr…" : "Get the missing albums through Lidarr"}</button>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function SpotifySettings() {
  const caps = useCapabilities();
  const qc = useQueryClient();
  const connect = () => void api.spotifyLogin().then(({ url }) => { location.href = url; });
  if (!caps.data?.spotify) {
    return (
      <Row title="Connect Spotify" hint="Add SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET to Needle’s settings on the Pi to turn this on.">
        <button type="button" className="btn ghost sm" disabled>Connect Spotify</button>
      </Row>
    );
  }
  if (!caps.data.spotifyConnected) {
    return (
      <Row title="Connect Spotify" hint="Shows your Spotify playlists, liked songs and saved albums next to your own music, and plays them here. Playing needs Spotify Premium.">
        <button type="button" className="btn light sm" onClick={connect}>Connect Spotify</button>
      </Row>
    );
  }
  return (
    <>
      <Row title="Use Spotify in Needle" hint="When off, no device asks Spotify for anything and Spotify stays out of Home, Search and your library. You stay connected.">
        <button type="button" className="toggle" role="switch" aria-checked={caps.data.spotifyEnabled} aria-label="Use Spotify in Needle" onClick={() => void api.spotifyEnabled(!caps.data?.spotifyEnabled).then(() => qc.invalidateQueries({ queryKey: keys.capabilities }))} />
      </Row>
      {!caps.data.spotifyEnabled || !caps.data.spotifyReconnect ? (
        <Row title="Spotify is connected" hint={caps.data.spotifyEnabled ? "Your Spotify library is in Your library, Home and Search. Spotify songs play here through Spotify Premium." : "Switched off above. Disconnect to remove Needle's access to your Spotify account."}>
          <button type="button" className="btn ghost sm" onClick={() => void api.spotifyDisconnect().then(() => { clearSpotifyCache(); return qc.invalidateQueries({ queryKey: keys.capabilities }); })}>Disconnect</button>
        </Row>
      ) : (
        <Row title="Reconnect Spotify" hint="Needle needs a few more Spotify permissions, to play songs, edit playlists and follow artists. Reconnect once to grant them.">
          <button type="button" className="btn light sm" onClick={connect}>Reconnect</button>
        </Row>
      )}
      {caps.data.spotifyEnabled ? <SpotifyImport /> : null}
    </>
  );
}

export default function SettingsPage() {
  const mobile = useIsMobile();
  const s = useSettings();
  const deviceName = useSession((x) => x.deviceName);
  const rename = useSession((x) => x.rename);
  const user = useSession((x) => x.credentials?.user);
  const signOut = useSession((x) => x.signOut);
  const caps = useCapabilities();
  const [params, setParams] = useSearchParams();
  const [name, setName] = useState(deviceName);
  const { data: scan } = useQuery({ queryKey: keys.scan, queryFn: sub.scanStatus, staleTime: 60_000 });
  const { data: ping } = useQuery({ queryKey: ["ping"], queryFn: () => sub.ping(), staleTime: 300_000 });
  usePageTone(null);

  useEffect(() => {
    const sp = params.get("spotify");
    if (!sp) return;
    toast(sp === "connected" ? "Spotify connected" : "Spotify sign-in didn’t finish. Try again.");
    setParams({}, { replace: true });
  }, [params, setParams]);

  const lastScan = scan?.lastScan ? minutesSince(scan.lastScan) : null;
  return (
    <>
      {mobile ? <MobileHeader title="Settings" /> : <TopBar />}
      <div className="set">
        {!mobile ? <h1>Settings</h1> : null}
        <h2>Playback</h2>
        <Row title="Crossfade" hint={canCrossfade ? "Blend the end of one song into the next. Off for albums played in order." : "iPhone and iPad play one song at a time, so crossfade isn’t available here."}>
          <div className="slider-row">
            <span>0 s</span>
            <Slider value={canCrossfade ? s.crossfade : 0} max={12} step={1} label="Crossfade seconds" valueText={(v) => `${Math.round(v)} seconds`} onChange={(v) => s.set("crossfade", Math.round(v))} needle />
            <span>{canCrossfade ? `${s.crossfade} s` : "Off"}</span>
          </div>
        </Row>
        <Row title="Gapless playback" hint="No silence between tracks on live and continuous albums.">
          <Toggle k="gapless" label="Gapless playback" />
        </Row>
        <Row title="Even out volume" hint="Uses the ReplayGain values in your files.">
          <Seg label="Even out volume" value={s.normalize} options={[["off", "Off"], ["track", "Per song"], ["album", "Per album"]]} onChange={(v) => s.set("normalize", v)} />
        </Row>
        <Row title="Keep playing similar songs" hint="When the queue ends, carry on with songs like the last one.">
          <Toggle k="autoplay" label="Keep playing similar songs" />
        </Row>

        <h2>Sound quality</h2>
        <Row title="On Wi-Fi" hint="Original is the file as it is, with no conversion.">
          <Seg label="Quality on Wi-Fi" value={s.wifiQuality} options={QUALITY} onChange={(v) => s.set("wifiQuality", v)} />
        </Row>
        <Row title="On mobile data" hint="Converted on the Pi to Opus, or AAC on iPhone, which sound good at small sizes.">
          <Seg label="Quality on mobile data" value={s.cellularQuality} options={QUALITY} onChange={(v) => s.set("cellularQuality", v)} />
        </Row>
        <Row title="Downloads" hint="Quality of songs kept on this device.">
          <Seg label="Download quality" value={s.downloadQuality} options={QUALITY} onChange={(v) => s.set("downloadQuality", v)} />
        </Row>

        <h2>On this device</h2>
        <Storage />
        <Row title="Download on mobile data" hint="Off: downloads wait for Wi-Fi.">
          <Toggle k="downloadOnCellular" label="Download on mobile data" />
        </Row>
        <Row title="Device name" hint="How this device appears on your other devices.">
          <input className="text-input" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => rename(name)} onKeyDown={(e) => e.key === "Enter" && rename(name)} aria-label="Device name" maxLength={40} />
        </Row>

        <h2>Appearance</h2>
        <Row title="Colour from album art" hint="Tints each page with the colours of what’s on it.">
          <Toggle k="artColor" label="Colour from album art" />
        </Row>

        <h2>Your server</h2>
        <Row title={`Navidrome ${ping?.serverVersion ? ping.serverVersion.split(" ")[0] : ""}`.trim()} hint={`Signed in as ${user ?? ""}.${lastScan !== null ? ` Library last scanned ${lastScan < 1 ? "just now" : lastScan < 60 ? `${lastScan} minutes ago` : `${Math.round(lastScan / 60)} hours ago`}.` : ""}${scan?.count !== undefined ? ` ${plural(scan.count, "song")}.` : ""}`}>
          <span className="ok">Connected</span>
        </Row>
        <PhotoSetting />
        <Row title="Get music through Lidarr" hint={caps.data?.lidarr ? "Search offers albums you don’t have yet, and Lidarr fetches them." : "Needs Lidarr set up on the Needle server, and a Navidrome admin account."}>
          {caps.data?.lidarr ? <span className="ok">On</span> : <span className="muted">Off</span>}
        </Row>
        <h2>Spotify</h2>
        <SpotifySettings />

        <h2>This app</h2>
        <Row title="Keyboard shortcuts">
          <button type="button" className="btn ghost sm" onClick={() => useUi.setState({ shortcutsOpen: true })}><Icon name="keyboard" size={16} />Show shortcuts</button>
        </Row>
        <Row title="Sign out" hint="Downloads stay on this device.">
          <button type="button" className="btn ghost sm" onClick={signOut}>Sign out</button>
        </Row>
      </div>
    </>
  );
}
