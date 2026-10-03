import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import type { Capabilities, CheckState, ImportResult, Person, YouTubeMusicLogin } from "@needle/shared";
import { Icon } from "../components/Icon.tsx";
import { Seg } from "../components/Seg.tsx";
import { Slider } from "../components/Slider.tsx";
import { api } from "../lib/api.ts";
import { ago, minutesSince, plural, sizeLabel } from "../lib/format.ts";
import { MobileHeader } from "../layout/Mobile.tsx";
import { useIsMobile, usePageTone } from "../layout/Shell.tsx";
import { AvatarFace, TopBar } from "../layout/TopBar.tsx";
import { bytesOf, removeAllDownloads, useOffline } from "../offline/store.ts";
import { canCrossfade } from "../player/controller.ts";
import { keys } from "../queries/keys.ts";
import { useCanRequest, useCapabilities, useIsAdmin, useMe, usePeople, useStorageEstimate } from "../queries/hooks.ts";
import { browserChecks } from "../lib/connections.ts";
import { VERSION } from "../lib/version.ts";
import { squarePhoto } from "../lib/photo.ts";
import { useSession } from "../state/session.ts";
import { clearSpotifyCache } from "../queries/spotify.ts";
import { clearYouTubeMusicCache, useYouTubeMusicAccount, useYouTubeMusicPlaylists } from "../queries/youtube-music.ts";
import { useYouTubeMusicStatus, ytm } from "../lib/youtube-music.ts";
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

function Toggle<K extends keyof S>({ k, label }: { k: K; label: string }) {
  const value = useSettings((s) => s[k]) as boolean;
  const set = useSettings((s) => s.set);
  return (
    <button
      type="button"
      className="toggle"
      role="switch"
      aria-checked={value}
      aria-label={label}
      onClick={() => set(k, !value as S[K])}
    />
  );
}

const QUALITY: [Quality, string][] = [
  ["original", "Original"],
  ["320", "320 kbps"],
  ["192", "192 kbps"],
];

function Storage() {
  const bytes = useOffline((s) => bytesOf(s.songs));
  const collections = useOffline((s) => s.collections);
  const supported = useOffline((s) => s.supported);
  const { data: quota } = useStorageEstimate();
  if (!supported) {
    return (
      <Row
        title="Downloads aren’t available here"
        hint="Open Needle at its https:// address to keep music on this device."
      >
        <span />
      </Row>
    );
  }
  const pct = quota?.quota ? Math.min(100, (bytes / quota.quota) * 100) : 0;
  const albums = collections.filter((c) => c.kind === "album").length;
  const playlists = collections.filter((c) => c.kind === "playlist").length;
  const liked = collections.some((c) => c.kind === "liked");
  const parts = [
    albums ? plural(albums, "album") : null,
    playlists ? plural(playlists, "playlist") : null,
    liked ? "your liked songs" : null,
  ].filter(Boolean);
  return (
    <div className="set-row">
      <div>
        <b>{sizeLabel(bytes)} used by downloads</b>
        <span>
          {parts.length ? `${parts.join(", ")}.` : "Nothing downloaded yet."}
          {quota?.quota ? ` Room for about ${sizeLabel(quota.quota - (quota.usage ?? 0))} more.` : ""}
        </span>
        <div className="storage">
          <i style={{ width: `${Math.max(pct, bytes ? 2 : 0)}%` }} />
        </div>
      </div>
      <button
        type="button"
        className="btn ghost sm"
        disabled={!bytes}
        onClick={() => void removeAllDownloads().then(() => toast("Removed all downloads"))}
      >
        Remove all
      </button>
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
    <Row title="Your photo" hint="Shown on every device. Stored on the server with Needle’s data.">
      <div className="photo-set">
        <span className="avatar">
          <AvatarFace px={44} />
        </span>
        <input
          ref={input}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void upload(f);
          }}
        />
        <button type="button" className="btn ghost sm" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? "Saving…" : me?.photo ? "Change" : "Choose photo"}
        </button>
        {me?.photo ? (
          <button type="button" className="btn ghost sm" onClick={() => void api.removePhoto().then(done)}>
            Remove
          </button>
        ) : null}
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
      toast(
        `Lidarr is fetching ${plural(r.requested, "album")}${r.notFound ? `; ${r.notFound} weren’t found` : ""}${r.skipped ? `; ${r.skipped} more next time` : ""}`,
      );
    } catch (e) {
      toast(e instanceof Error ? e.message : "Lidarr didn’t take the request");
    } finally {
      setRequesting(false);
    }
  };
  return (
    <>
      <Row
        title="Copy playlists into your own library"
        hint="Optional. Makes a Navidrome playlist from a Spotify one, using only songs you already have. Lidarr can fetch the rest."
      >
        <button type="button" className="btn ghost sm" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "Hide" : "Choose playlists"}
        </button>
      </Row>
      {open ? (
        <ul className="sp-list">
          <li>
            <span>
              <Icon name="heartFill" size={16} />
              Liked songs
            </span>
            <button type="button" className="btn ghost sm" disabled={Boolean(busy)} onClick={() => void run("liked")}>
              {busy === "liked" ? "Copying…" : "Copy"}
            </button>
          </li>
          {(lists.data ?? []).map((p) => (
            <li key={p.id}>
              <span>
                {p.name}
                <em>{plural(p.trackCount, "song")}</em>
              </span>
              <button type="button" className="btn ghost sm" disabled={Boolean(busy)} onClick={() => void run(p.id)}>
                {busy === p.id ? "Copying…" : "Copy"}
              </button>
            </li>
          ))}
          {lists.isLoading ? <li className="muted">Loading your playlists…</li> : null}
          {lists.isError ? (
            <li className="muted">
              {lists.error instanceof Error ? lists.error.message : "Couldn’t load your Spotify playlists"}
            </li>
          ) : null}
        </ul>
      ) : null}
      {result ? (
        <div className="sp-result" role="status">
          <b>
            {result.source}: {result.matched} of {plural(result.total, "song")} are in your library.
          </b>
          {result.missing.length ? (
            <>
              <span>
                {plural(result.missing.length, "song")} aren’t, for example{" "}
                {result.missing
                  .slice(0, 3)
                  .map((m) => `${m.title} by ${m.artist}`)
                  .join("; ")}
                .
              </span>
              {caps.data?.lidarr ? (
                <button
                  type="button"
                  className="btn light sm"
                  disabled={requesting}
                  onClick={() => void requestMissing()}
                >
                  {requesting ? "Asking Lidarr…" : "Get the missing albums through Lidarr"}
                </button>
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
  const connect = () =>
    void api.spotifyLogin().then(({ url }) => {
      location.href = url;
    });
  if (!caps.data?.spotify) {
    return (
      <Row
        title="Connect Spotify"
        hint="Add SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET to Needle’s server settings to turn this on."
      >
        <button type="button" className="btn ghost sm" disabled>
          Connect Spotify
        </button>
      </Row>
    );
  }
  if (!caps.data.spotifyConnected) {
    return (
      <Row
        title="Connect Spotify"
        hint="Shows your Spotify playlists, liked songs and saved albums next to your own music, and plays them here. Playing needs Spotify Premium."
      >
        <button type="button" className="btn light sm" onClick={connect}>
          Connect Spotify
        </button>
      </Row>
    );
  }
  return (
    <>
      <Row
        title="Use Spotify in Needle"
        hint="When off, no device asks Spotify for anything and Spotify stays out of Home, Search and your library. You stay connected."
      >
        <button
          type="button"
          className="toggle"
          role="switch"
          aria-checked={caps.data.spotifyEnabled}
          aria-label="Use Spotify in Needle"
          onClick={() =>
            void api
              .spotifyEnabled(!caps.data?.spotifyEnabled)
              .then(() => qc.invalidateQueries({ queryKey: keys.capabilities }))
          }
        />
      </Row>
      {!caps.data.spotifyEnabled || !caps.data.spotifyReconnect ? (
        <Row
          title="Spotify is connected"
          hint={
            caps.data.spotifyEnabled
              ? "Your Spotify library is in Your library, Home and Search. Spotify songs play here through Spotify Premium."
              : "Switched off above. Disconnect to remove Needle's access to your Spotify account."
          }
        >
          <button
            type="button"
            className="btn ghost sm"
            onClick={() =>
              void api.spotifyDisconnect().then(() => {
                clearSpotifyCache();
                return qc.invalidateQueries({ queryKey: keys.capabilities });
              })
            }
          >
            Disconnect
          </button>
        </Row>
      ) : (
        <Row
          title="Reconnect Spotify"
          hint="Needle needs a few more Spotify permissions, to play songs, edit playlists and follow artists. Reconnect once to grant them."
        >
          <button type="button" className="btn light sm" onClick={connect}>
            Reconnect
          </button>
        </Row>
      )}
      {caps.data.spotifyEnabled ? <SpotifyImport /> : null}
    </>
  );
}

function YouTubeMusicImport() {
  const client = useQueryClient();
  const playlists = useYouTubeMusicPlaylists();
  const blocked = useYouTubeMusicStatus((status) => status.blocked);
  const [open, setOpen] = useState(false);
  const [busySource, setBusySource] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const copyPlaylist = async (source: string) => {
    setBusySource(source);
    setResult(null);

    try {
      const importResult = await ytm.importPlaylist(source);

      setResult(importResult);

      await client.invalidateQueries({ queryKey: keys.playlists });
    } catch (importError) {
      toast(importError instanceof Error ? importError.message : "The copy failed");
    } finally {
      setBusySource(null);
    }
  };

  return (
    <>
      <Row
        title="Copy playlists into your own library"
        hint="Makes a Navidrome playlist using songs you already have. Your YouTube Music playlist stays as it is."
      >
        <button type="button" className="btn ghost sm" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "Hide" : "Choose playlists"}
        </button>
      </Row>
      {open ? (
        <ul className="sp-list">
          <li>
            <span>
              <Icon name="heartFill" size={16} />
              Liked songs
            </span>
            <button
              type="button"
              className="btn ghost sm"
              disabled={blocked || Boolean(busySource)}
              onClick={() => void copyPlaylist("liked")}
            >
              {busySource === "liked" ? "Copying…" : "Copy"}
            </button>
          </li>
          {playlists.data?.map((playlist) => (
            <li key={playlist.id}>
              <span>
                {playlist.title}
                {playlist.songCount !== undefined ? <em>{plural(playlist.songCount, "song")}</em> : null}
              </span>
              <button
                type="button"
                className="btn ghost sm"
                disabled={blocked || Boolean(busySource)}
                onClick={() => void copyPlaylist(playlist.id)}
              >
                {busySource === playlist.id ? "Copying…" : "Copy"}
              </button>
            </li>
          ))}
          {playlists.isLoading ? <li className="muted">Loading your playlists…</li> : null}
          {playlists.isError ? <li className="muted">Couldn’t load your YouTube Music playlists.</li> : null}
        </ul>
      ) : null}
      {result ? (
        <div className="sp-result" role="status">
          <b>
            {result.source}: {result.matched} of {plural(result.total, "song")} are in your library.
          </b>
          {result.missing.length ? (
            <span>
              {plural(result.missing.length, "song")} could not be matched. Find them in Search to add them to your own
              library.
            </span>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function YouTubeMusicSettings() {
  const capabilities = useCapabilities();
  const client = useQueryClient();
  const account = useYouTubeMusicAccount();
  const [login, setLogin] = useState<YouTubeMusicLogin | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: keys.capabilities }),
      client.invalidateQueries({ queryKey: keys.status }),
    ]);

  useEffect(() => {
    if (!login) return;

    let canceled = false;
    let pollTimer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (Date.now() >= login.expiresAt) {
        setLogin(null);
        setError("The code expired. Connect again to get a new one.");

        return;
      }

      try {
        const loginStatus = await ytm.pollLogin();

        if (canceled) return;

        if (loginStatus.state === "connected") {
          await client.cancelQueries({ queryKey: ["ytm"] });

          clearYouTubeMusicCache();

          setLogin(null);

          await client.invalidateQueries({ queryKey: keys.capabilities });
          await client.invalidateQueries({ queryKey: keys.status });

          toast("YouTube Music connected");

          return;
        }

        if (loginStatus.state === "expired" || loginStatus.state === "denied") {
          setLogin(null);
          setError(
            loginStatus.state === "denied"
              ? "Google sign-in was canceled. Connect again when you’re ready."
              : "The code expired. Connect again to get a new one.",
          );

          return;
        }

        pollTimer = setTimeout(() => void poll(), Math.max(login.interval, loginStatus.retryAfter ?? 0, 1) * 1000);
      } catch (loginError) {
        if (canceled) return;

        setError(
          loginError instanceof Error ? loginError.message : "Couldn’t check Google sign-in. Try connecting again.",
        );
        setLogin(null);
      }
    };

    pollTimer = setTimeout(() => void poll(), Math.max(login.interval, 1) * 1000);

    return () => {
      canceled = true;

      clearTimeout(pollTimer);
    };
  }, [login, client]);

  const connect = async () => {
    setBusy(true);
    setError(null);

    try {
      const deviceLogin = await ytm.startLogin();
      const verificationUrl = new URL(deviceLogin.verificationUrl);

      if (
        verificationUrl.protocol !== "https:" ||
        verificationUrl.username ||
        verificationUrl.password ||
        verificationUrl.port ||
        !["www.youtube.com", "youtube.com", "accounts.google.com", "www.google.com", "google.com"].includes(
          verificationUrl.hostname,
        )
      )
        throw new Error("Google sign-in returned an unexpected address. Try again.");

      setLogin(deviceLogin);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Couldn’t start Google sign-in. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const changeEnabled = async (on: boolean) => {
    const previousCapabilities = client.getQueryData<Capabilities>(keys.capabilities);

    setBusy(true);
    setError(null);

    client.setQueryData<Capabilities>(keys.capabilities, (currentCapabilities) =>
      currentCapabilities ? { ...currentCapabilities, youtubeMusicEnabled: on } : currentCapabilities,
    );

    try {
      await client.cancelQueries({ queryKey: ["ytm"] });
      await ytm.enabled(on);
      await refresh();
    } catch (toggleError) {
      client.setQueryData(keys.capabilities, previousCapabilities);

      setError(toggleError instanceof Error ? toggleError.message : "Couldn’t change YouTube Music. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const disconnect = async () => {
    setBusy(true);
    setError(null);

    try {
      await client.cancelQueries({ queryKey: ["ytm"] });
      await ytm.disconnect();

      clearYouTubeMusicCache();

      await refresh();
    } catch (disconnectError) {
      setError(
        disconnectError instanceof Error ? disconnectError.message : "Couldn’t disconnect YouTube Music. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  const cancelLogin = async () => {
    setLogin(null);

    try {
      await ytm.cancelLogin();
    } catch (cancelError) {
      setError(
        cancelError instanceof Error ? cancelError.message : "Couldn’t cancel sign-in. The code will expire shortly.",
      );
    }
  };

  return (
    <>
      <p className="yt-experimental">
        <b>Experimental.</b> YouTube Music can stop working when YouTube changes. Your own library and Spotify keep
        working.
      </p>
      {!capabilities.data?.youtubeMusic ? (
        <Row title="Connect YouTube Music" hint="Ask your server admin to enable YouTube Music in Needle.">
          <button type="button" className="btn ghost sm" disabled>
            Connect
          </button>
        </Row>
      ) : login ? (
        <div className="yt-device-login" role="status">
          <h3>Connect with Google</h3>
          <p>Open Google’s device page and enter this code.</p>
          <div className="yt-device-code">
            <code>{login.userCode}</code>
            <button
              type="button"
              className="btn ghost sm"
              onClick={() =>
                void navigator.clipboard.writeText(login.userCode).then(
                  () => toast("Code copied"),
                  () => toast("Couldn’t copy the code. Select it and copy it yourself."),
                )
              }
            >
              Copy code
            </button>
          </div>
          <div className="yt-device-actions">
            <a className="btn primary sm" href={login.verificationUrl} target="_blank" rel="noopener noreferrer">
              Open Google
            </a>
            <button type="button" className="btn ghost sm" onClick={() => void cancelLogin()}>
              Cancel
            </button>
          </div>
          <p className="muted">
            <span className="spin" />
            Waiting for Google. This code expires at{" "}
            {new Date(login.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.
          </p>
        </div>
      ) : capabilities.data.youtubeMusicConnected ? (
        <>
          <Row
            title={account.data?.name ? `Connected as ${account.data.name}` : "YouTube Music is connected"}
            hint="Your YouTube Music account is connected to this Needle user."
          >
            <button type="button" className="btn ghost sm" disabled={busy} onClick={() => void disconnect()}>
              Disconnect
            </button>
          </Row>
          <Row
            title="Use YouTube Music in Needle"
            hint="When off, YouTube Music stays out of Home, Search and your library. You stay connected."
          >
            <button
              type="button"
              className="toggle"
              role="switch"
              aria-checked={capabilities.data.youtubeMusicEnabled}
              aria-label="Use YouTube Music in Needle"
              disabled={busy}
              onClick={() => void changeEnabled(!capabilities.data?.youtubeMusicEnabled)}
            />
          </Row>
          {capabilities.data.youtubeMusicReconnect ? (
            <Row
              title="Reconnect YouTube Music"
              hint="Google sign-in expired. Connect again to refresh Needle’s access."
            >
              <button type="button" className="btn light sm" disabled={busy} onClick={() => void connect()}>
                Reconnect
              </button>
            </Row>
          ) : null}
          {capabilities.data.youtubeMusicEnabled && !capabilities.data.youtubeMusicReconnect ? (
            <YouTubeMusicImport />
          ) : null}
        </>
      ) : (
        <Row
          title="Connect YouTube Music"
          hint="Shows your liked songs, saved albums, followed artists and playlists beside your own music."
        >
          <button type="button" className="btn light sm" disabled={busy} onClick={() => void connect()}>
            {busy ? "Connecting…" : "Connect"}
          </button>
        </Row>
      )}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}

const LB_KEYS = [keys.capabilities, keys.discoveries, keys.discoveryAll, keys.status];

function ListenBrainzSettings() {
  const caps = useCapabilities();
  const qc = useQueryClient();
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => Promise.all(LB_KEYS.map((queryKey) => qc.invalidateQueries({ queryKey })));
  const connect = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.listenbrainzConnect(token.trim(), password);
      setToken("");
      await refresh();
      toast(
        r.navidrome
          ? "ListenBrainz connected. Navidrome now sends your listens."
          : `ListenBrainz connected as ${r.user}.${r.navidromeError ? ` ${r.navidromeError}.` : ""}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "ListenBrainz didn’t answer. Try again in a moment.");
    } finally {
      setPassword("");
      setBusy(false);
    }
  };
  const disconnect = () =>
    void api
      .listenbrainzDisconnect("")
      .then(refresh, (err: unknown) => toast(err instanceof Error ? err.message : "Couldn’t disconnect"));
  const user = caps.data?.listenbrainzUser;
  if (user) {
    return (
      <>
        <Row
          title={`Connected as ${user}`}
          hint="Home shows the playlists ListenBrainz makes for you. Needle never sends listens itself."
        >
          <button type="button" className="btn ghost sm" onClick={disconnect}>
            Disconnect
          </button>
        </Row>
        <Row
          title="Your listens"
          hint={
            caps.data?.listenbrainzNavidrome
              ? "Navidrome sends what you play to ListenBrainz, so the playlists follow your listening. Disconnecting here doesn’t stop that; remove the token in Navidrome to stop it."
              : "To send what you play, open Navidrome, go to Settings → Personal → ListenBrainz and paste the same token. Skip this if you already have."
          }
        >
          {caps.data?.listenbrainzNavidrome ? (
            <span className="ok">Navidrome sends them</span>
          ) : (
            <span className="muted">Not from Navidrome yet</span>
          )}
        </Row>
      </>
    );
  }
  return (
    <form className="lb-form" onSubmit={(e) => void connect(e)}>
      <p className="lb-lede">
        ListenBrainz makes playlists from what you play: new songs to discover every week and the ones you keep coming
        back to. Needle shows them on Home and fetches the songs you don’t have.
      </p>
      <label className="field">
        <span>ListenBrainz user token</span>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          required
        />
        <small>
          Copy it from{" "}
          <a href="https://listenbrainz.org/settings/" target="_blank" rel="noopener noreferrer">
            listenbrainz.org/settings
          </a>
          .
        </small>
      </label>
      <label className="field">
        <span>Navidrome password (optional)</span>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
        <small>
          Used once to turn on scrobbling in Navidrome, never stored. Leave it empty to paste the token in Navidrome
          yourself.
        </small>
      </label>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit" className="btn light sm" disabled={busy || !token.trim()}>
        {busy ? "Connecting…" : "Connect ListenBrainz"}
      </button>
    </form>
  );
}

const CHECK_WORDS: Record<CheckState, string> = {
  ok: "Working",
  warn: "Needs a look",
  off: "Off",
  fail: "Not working",
};

function Connections({ publicUrl }: { publicUrl: string | null }) {
  const qc = useQueryClient();
  const { data, isFetching, dataUpdatedAt } = useQuery({
    queryKey: keys.status,
    queryFn: () => api.status(false),
    staleTime: 30_000,
  });
  const local = browserChecks(publicUrl, location.origin, window.isSecureContext);
  const checks = [...local, ...(data?.checks ?? [])];
  const again = async () => {
    const fresh = await qc
      .fetchQuery({ queryKey: keys.status, queryFn: () => api.status(true), staleTime: 0 })
      .catch(() => null);
    if (!fresh) {
      toast("Needle’s server didn’t answer. Try again in a moment.");
      return;
    }
    const bad = [...local, ...fresh.checks].filter((c) => c.state === "warn" || c.state === "fail").length;
    toast(bad ? `${plural(bad, "connection")} need${bad === 1 ? "s" : ""} a look` : "Everything is working");
  };
  return (
    <>
      <div className="conn-head">
        <h2>Connections</h2>
        <button type="button" className="btn ghost sm" disabled={isFetching} onClick={() => void again()}>
          {isFetching ? (
            <>
              <span className="spin" />
              Checking…
            </>
          ) : (
            <>
              <Icon name="refresh" size={15} />
              Check again
            </>
          )}
        </button>
      </div>
      <p className="conn-lede">
        What Needle and its server can reach. Only admins see this.
        {dataUpdatedAt
          ? ` Checked at ${new Date(dataUpdatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}.`
          : ""}
      </p>
      {checks.map((c) => (
        <Row
          key={c.id}
          title={c.label}
          hint={
            <>
              {c.detail}
              {c.fix && c.state !== "ok" ? <em className="conn-fix">{c.fix}</em> : null}
            </>
          }
        >
          <span className={`conn-state ${c.state}`}>{CHECK_WORDS[c.state]}</span>
        </Row>
      ))}
    </>
  );
}

function PersonRow({ p }: { p: Person }) {
  const qc = useQueryClient();
  const set = (patch: Partial<Pick<Person, "canRequest" | "canSpotify" | "canYouTubeMusic">>) =>
    void api.setPerson(p.user, patch).then(
      () => void qc.invalidateQueries({ queryKey: keys.people }),
      (e: unknown) => toast(e instanceof Error ? e.message : "Couldn’t change that"),
    );
  return (
    <div className="set-row person-row">
      <div>
        <b>
          {p.user}
          {p.admin ? <span className="person-badge">Admin</span> : null}
        </b>
        <span>
          {p.admin
            ? "Manages Navidrome, and can always request music."
            : p.lastSeen
              ? `Last here ${ago(new Date(p.lastSeen).toISOString())}.`
              : "Hasn’t opened Needle yet."}
        </span>
      </div>
      <label className="person-switch">
        <span>Request music</span>
        <button
          type="button"
          className="toggle"
          role="switch"
          aria-checked={p.canRequest}
          aria-label={`${p.user} can request music`}
          disabled={p.admin}
          onClick={() => set({ canRequest: !p.canRequest })}
        />
      </label>
      <label className="person-switch">
        <span>Spotify</span>
        <button
          type="button"
          className="toggle"
          role="switch"
          aria-checked={p.canSpotify}
          aria-label={`${p.user} can use Spotify`}
          onClick={() => set({ canSpotify: !p.canSpotify })}
        />
      </label>
      <label className="person-switch">
        <span>YouTube Music</span>
        <button
          type="button"
          className="toggle"
          role="switch"
          aria-checked={p.canYouTubeMusic ?? p.admin}
          aria-label={`${p.user} can use YouTube Music`}
          onClick={() => set({ canYouTubeMusic: !(p.canYouTubeMusic ?? p.admin) })}
        />
      </label>
    </div>
  );
}

function People() {
  const { data: people = [], isPending } = usePeople(true);
  return (
    <>
      <h2>People</h2>
      <p className="conn-lede">
        Everyone with a Navidrome account can sign in to Needle, and shows up here once they have. Create accounts in
        Navidrome (or with add-viewer.py); switch on what each person may do here.
      </p>
      {isPending ? (
        <p className="muted source-note">
          <span className="spin" />
          Loading people…
        </p>
      ) : (
        people.map((p) => <PersonRow key={p.user} p={p} />)
      )}
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
  const admin = useIsAdmin();
  const canRequest = useCanRequest();
  const [params, setParams] = useSearchParams();
  const [name, setName] = useState(deviceName);
  const { data: scan } = useQuery({ queryKey: keys.scan, queryFn: sub.scanStatus, staleTime: 60_000 });
  const { data: ping } = useQuery({ queryKey: ["ping"], queryFn: () => sub.ping(), staleTime: 300_000 });
  const { data: health } = useQuery({ queryKey: ["health"], queryFn: api.health, staleTime: 300_000 });
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
        <Row
          title="Crossfade"
          hint={
            canCrossfade
              ? "Blend the end of one song into the next. Off for albums played in order."
              : "iPhone and iPad play one song at a time, so crossfade isn’t available here."
          }
        >
          <div className="slider-row">
            <span>0 s</span>
            <Slider
              value={canCrossfade ? s.crossfade : 0}
              max={12}
              step={1}
              label="Crossfade seconds"
              valueText={(v) => `${Math.round(v)} seconds`}
              onChange={(v) => s.set("crossfade", Math.round(v))}
              needle
            />
            <span>{canCrossfade ? `${s.crossfade} s` : "Off"}</span>
          </div>
        </Row>
        <Row title="Gapless playback" hint="No silence between tracks on live and continuous albums.">
          <Toggle k="gapless" label="Gapless playback" />
        </Row>
        <Row title="Even out volume" hint="Uses the ReplayGain values in your files.">
          <Seg
            label="Even out volume"
            value={s.normalize}
            options={[
              ["off", "Off"],
              ["track", "Per song"],
              ["album", "Per album"],
            ]}
            onChange={(v) => s.set("normalize", v)}
          />
        </Row>
        <Row title="Keep playing similar songs" hint="When the queue ends, carry on with songs like the last one.">
          <Toggle k="autoplay" label="Keep playing similar songs" />
        </Row>

        <h2>Sound quality</h2>
        <Row title="On Wi-Fi" hint="Original is the file as it is, with no conversion.">
          <Seg
            label="Quality on Wi-Fi"
            value={s.wifiQuality}
            options={QUALITY}
            onChange={(v) => s.set("wifiQuality", v)}
          />
        </Row>
        <Row
          title="On mobile data"
          hint="Converted by Navidrome to Opus, or AAC on iPhone, which sound good at small sizes."
        >
          <Seg
            label="Quality on mobile data"
            value={s.cellularQuality}
            options={QUALITY}
            onChange={(v) => s.set("cellularQuality", v)}
          />
        </Row>
        <Row title="Downloads" hint="Quality of songs kept on this device.">
          <Seg
            label="Download quality"
            value={s.downloadQuality}
            options={QUALITY}
            onChange={(v) => s.set("downloadQuality", v)}
          />
        </Row>

        <h2>On this device</h2>
        <Storage />
        <Row title="Download on mobile data" hint="Off: downloads wait for Wi-Fi.">
          <Toggle k="downloadOnCellular" label="Download on mobile data" />
        </Row>
        <Row title="Device name" hint="How this device appears on your other devices.">
          <input
            className="text-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => rename(name)}
            onKeyDown={(e) => e.key === "Enter" && rename(name)}
            aria-label="Device name"
            maxLength={40}
          />
        </Row>

        <h2>Appearance</h2>
        <Row title="Colour from album art" hint="Tints each page with the colours of what’s on it.">
          <Toggle k="artColor" label="Colour from album art" />
        </Row>

        <h2>Your server</h2>
        <Row
          title={`Navidrome ${ping?.serverVersion ? ping.serverVersion.split(" ")[0] : ""}`.trim()}
          hint={`Signed in as ${user ?? ""}.${lastScan !== null ? ` Library last scanned ${lastScan < 1 ? "just now" : lastScan < 60 ? `${lastScan} minutes ago` : `${Math.round(lastScan / 60)} hours ago`}.` : ""}${scan?.count !== undefined ? ` ${plural(scan.count, "song")}.` : ""}`}
        >
          <span className="ok">Connected</span>
        </Row>
        <PhotoSetting />
        {admin ? (
          <>
            <Connections publicUrl={caps.data?.publicUrl ?? null} />
            <People />
          </>
        ) : (
          <Row
            title="Request music"
            hint={
              canRequest
                ? "Search offers albums and songs you don’t have, and gets them for you."
                : "Ask an admin to let you request albums and songs."
            }
          >
            {canRequest ? <span className="ok">On</span> : <span className="muted">Off</span>}
          </Row>
        )}
        <h2>ListenBrainz</h2>
        <ListenBrainzSettings />
        {caps.data?.spotify || admin ? (
          <>
            <h2>Spotify</h2>
            <SpotifySettings />
          </>
        ) : null}
        {caps.data?.youtubeMusic || admin ? (
          <>
            <h2>YouTube Music</h2>
            <YouTubeMusicSettings />
          </>
        ) : null}

        <h2>This app</h2>
        <Row
          title="Version"
          hint={
            health?.version && health.version !== VERSION
              ? `The server runs ${health.version}. Choose Update Needle in the account menu to load it.`
              : undefined
          }
        >
          <span className="muted tabular">Needle {VERSION}</span>
        </Row>
        {!mobile ? (
          <Row title="Keyboard shortcuts">
            <button type="button" className="btn ghost sm" onClick={() => useUi.setState({ shortcutsOpen: true })}>
              <Icon name="keyboard" size={16} />
              Show shortcuts
            </button>
          </Row>
        ) : null}
        <Row title="Sign out" hint="Downloads stay on this device.">
          <button type="button" className="btn ghost sm" onClick={signOut}>
            Sign out
          </button>
        </Row>
      </div>
    </>
  );
}
