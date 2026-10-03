import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import type {
  Capabilities,
  CheckState,
  ImportResult,
  Person,
  YouTubeMusicLogin,
} from "@needle/shared";
import { Icon } from "../../../components/Icon.tsx";
import { Seg } from "../../../components/Seg.tsx";
import { Slider } from "../../../components/Slider.tsx";
import { api } from "../../../lib/api.ts";
import {
  ago,
  localeCode,
  minutesSince,
  plural,
  sizeLabel,
} from "../../../lib/format.ts";
import { MobileHeader } from "../../../layout/Mobile.tsx";
import { useIsMobile } from "../../../lib/media.ts";
import { usePageTone } from "../../../layout/pageTone.ts";
import { AvatarFace, TopBar } from "../../../layout/TopBar.tsx";
import {
  bytesOf,
  removeAllDownloads,
  useOffline,
} from "../../../offline/store.ts";
import { canCrossfade } from "../../../player/controller.ts";
import { keys } from "../../../queries/keys.ts";
import {
  useCanRequest,
  useCapabilities,
  useIsAdmin,
  useMe,
  usePeople,
  useStorageEstimate,
} from "../../../queries/hooks.ts";
import { browserChecks } from "../../../lib/connections.ts";
import { VERSION } from "../../../lib/version.ts";
import { squarePhoto } from "../../../lib/photo.ts";
import { useSession } from "../../../state/session.ts";
import { clearSpotifyCache } from "../../spotify/hooks/useSpotify.ts";
import {
  clearYouTubeMusicCache,
  useYouTubeMusicAccount,
  useYouTubeMusicPlaylists,
} from "../../youtube-music/hooks/useYouTubeMusic.ts";
import { useYouTubeMusicStatus, ytm } from "../../youtube-music/api/client.ts";
import type { Quality } from "../../../state/settings.ts";
import { useSettings } from "../../../state/settings.ts";
import { toast, useUi } from "../../../state/ui.ts";
import { sub } from "../../../lib/subsonic.ts";
import { changeLanguage, i18next, translate } from "../../../i18n/index.ts";
import type { TranslationKey } from "../../../i18n/locales/en.ts";
import type { Language } from "../../../state/settings.ts";
import { SettingRow, SettingToggle } from "../components/SettingRow.tsx";

const qualityOptions = (): [Quality, string][] => [
  ["original", translate("settings.original")],
  ["320", "320 kbps"],
  ["192", "192 kbps"],
];
const LANGUAGES = [
  ["en", "language.english"],
  ["tr", "language.turkish"],
] as const satisfies readonly (readonly [Language, TranslationKey])[];

function Storage() {
  const bytes = useOffline((s) => bytesOf(s.songs));
  const collections = useOffline((s) => s.collections);
  const supported = useOffline((s) => s.supported);
  const { data: quota } = useStorageEstimate();
  if (!supported) {
    return (
      <SettingRow
        title={translate("settings.downloadUnavailable")}
        hint={translate("settings.downloadUnavailableHint")}
      >
        <span />
      </SettingRow>
    );
  }
  const pct = quota?.quota ? Math.min(100, (bytes / quota.quota) * 100) : 0;
  const albums = collections.filter((c) => c.kind === "album").length;
  const playlists = collections.filter((c) => c.kind === "playlist").length;
  const liked = collections.some((c) => c.kind === "liked");
  const parts = [
    albums ? plural(albums, "album") : null,
    playlists ? plural(playlists, "playlist") : null,
    liked ? translate("settings.downloadStorageLiked") : null,
  ].filter(Boolean);
  return (
    <div className="set-row">
      <div>
        <b>
          {translate("settings.downloadStorageUsed", {
            size: sizeLabel(bytes),
          })}
        </b>
        <span>
          {parts.length
            ? `${parts.join(", ")}.`
            : translate("settings.downloadStorageEmpty")}
          {quota?.quota
            ? ` ${translate("settings.downloadStorageRoom", {
                size: sizeLabel(quota.quota - (quota.usage ?? 0)),
              })}`
            : ""}
        </span>
        <div className="storage">
          <i style={{ width: `${Math.max(pct, bytes ? 2 : 0)}%` }} />
        </div>
      </div>
      <button
        type="button"
        className="btn ghost sm"
        disabled={!bytes}
        onClick={() =>
          void removeAllDownloads().then(() =>
            toast(translate("settings.removeAll")),
          )
        }
      >
        {translate("settings.removeAll")}
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
      toast(translate("settings.photoUpdated"));
    } catch (e) {
      toast(
        e instanceof Error ? e.message : translate("settings.photoSaveFailed"),
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <SettingRow
      title={translate("settings.photo")}
      hint={translate("settings.photoHint")}
    >
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
        <button
          type="button"
          className="btn ghost sm"
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          {busy
            ? translate("settings.saving")
            : me?.photo
              ? translate("common.edit")
              : translate("settings.choosePhoto")}
        </button>
        {me?.photo ? (
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => void api.removePhoto().then(done)}
          >
            {translate("settings.remove")}
          </button>
        ) : null}
      </div>
    </SettingRow>
  );
}

function SpotifyImport() {
  const caps = useCapabilities();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const lists = useQuery({
    queryKey: keys.spotifyPlaylists,
    queryFn: api.spotifyPlaylists,
    enabled: open,
  });
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
      toast(e instanceof Error ? e.message : translate("settings.copyFailed"));
    } finally {
      setBusy(null);
    }
  };
  const requestMissing = async () => {
    if (!result) return;
    setRequesting(true);
    try {
      const r = await api.spotifyMissing(result.missing);
      const details = [
        r.notFound
          ? translate("settings.lidarrNotFoundDetail", { count: r.notFound })
          : "",
        r.skipped
          ? translate("settings.lidarrSkippedDetail", { count: r.skipped })
          : "",
      ].join("");

      toast(
        translate("settings.lidarrFetchResult", {
          albums: plural(r.requested, "album"),
          details,
        }),
      );
    } catch (e) {
      toast(
        e instanceof Error
          ? e.message
          : translate("settings.lidarrRequestFailed"),
      );
    } finally {
      setRequesting(false);
    }
  };
  return (
    <>
      <SettingRow
        title={translate("settings.copyPlaylists")}
        hint={translate("settings.copySpotifyHint")}
      >
        <button
          type="button"
          className="btn ghost sm"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {translate(open ? "settings.hide" : "settings.choosePlaylists")}
        </button>
      </SettingRow>
      {open ? (
        <ul className="sp-list">
          <li>
            <span>
              <Icon name="heartFill" size={16} />
              {translate("settings.likedSongs")}
            </span>
            <button
              type="button"
              className="btn ghost sm"
              disabled={Boolean(busy)}
              onClick={() => void run("liked")}
            >
              {translate(
                busy === "liked" ? "settings.copying" : "settings.copy",
              )}
            </button>
          </li>
          {(lists.data ?? []).map((p) => (
            <li key={p.id}>
              <span>
                {p.name}
                <em>{plural(p.trackCount, "song")}</em>
              </span>
              <button
                type="button"
                className="btn ghost sm"
                disabled={Boolean(busy)}
                onClick={() => void run(p.id)}
              >
                {translate(
                  busy === p.id ? "settings.copying" : "settings.copy",
                )}
              </button>
            </li>
          ))}
          {lists.isLoading ? (
            <li className="muted">{translate("settings.loadingPlaylists")}</li>
          ) : null}
          {lists.isError ? (
            <li className="muted">
              {lists.error instanceof Error
                ? lists.error.message
                : translate("settings.spotifyPlaylistsFailed")}
            </li>
          ) : null}
        </ul>
      ) : null}
      {result ? (
        <div className="sp-result" role="status">
          <b>
            {translate("settings.importResult", {
              source: result.source,
              matched: result.matched,
              total: plural(result.total, "song"),
            })}
          </b>
          {result.missing.length ? (
            <>
              <span>
                {translate("settings.importMissingExamples", {
                  missing: plural(result.missing.length, "song"),
                  examples: result.missing
                    .slice(0, 3)
                    .map((missingSong) =>
                      translate("settings.songByArtist", {
                        title: missingSong.title,
                        artist: missingSong.artist,
                      }),
                    )
                    .join("; "),
                })}
              </span>
              {caps.data?.lidarr ? (
                <button
                  type="button"
                  className="btn light sm"
                  disabled={requesting}
                  onClick={() => void requestMissing()}
                >
                  {translate(
                    requesting
                      ? "settings.askingLidarr"
                      : "settings.getMissingAlbums",
                  )}
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
      <SettingRow
        title={translate("settings.connectSpotify")}
        hint={translate("settings.spotifyConfigHint")}
      >
        <button type="button" className="btn ghost sm" disabled>
          {translate("settings.connectSpotify")}
        </button>
      </SettingRow>
    );
  }
  if (!caps.data.spotifyConnected) {
    return (
      <SettingRow
        title={translate("settings.connectSpotify")}
        hint={translate("settings.spotifyConnectHint")}
      >
        <button type="button" className="btn light sm" onClick={connect}>
          {translate("settings.connectSpotify")}
        </button>
      </SettingRow>
    );
  }
  return (
    <>
      <SettingRow
        title={translate("settings.spotifyEnabled")}
        hint={translate("settings.spotifyEnabledHint")}
      >
        <button
          type="button"
          className="toggle"
          role="switch"
          aria-checked={caps.data.spotifyEnabled}
          aria-label={translate("settings.spotifyEnabled")}
          onClick={() =>
            void api
              .spotifyEnabled(!caps.data?.spotifyEnabled)
              .then(() => qc.invalidateQueries({ queryKey: keys.capabilities }))
          }
        />
      </SettingRow>
      {!caps.data.spotifyEnabled || !caps.data.spotifyReconnect ? (
        <SettingRow
          title={translate("settings.spotifyConnected")}
          hint={translate(
            caps.data.spotifyEnabled
              ? "settings.spotifyConnectedHint"
              : "settings.spotifyDisabledHint",
          )}
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
            {translate("settings.disconnect")}
          </button>
        </SettingRow>
      ) : (
        <SettingRow
          title={translate("settings.spotifyReconnect")}
          hint={translate("settings.spotifyReconnectHint")}
        >
          <button type="button" className="btn light sm" onClick={connect}>
            {translate("settings.reconnect")}
          </button>
        </SettingRow>
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
      toast(
        importError instanceof Error
          ? importError.message
          : translate("settings.copyFailed"),
      );
    } finally {
      setBusySource(null);
    }
  };

  return (
    <>
      <SettingRow
        title={translate("settings.copyPlaylists")}
        hint={translate("settings.copyYouTubeHint")}
      >
        <button
          type="button"
          className="btn ghost sm"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {translate(open ? "settings.hide" : "settings.choosePlaylists")}
        </button>
      </SettingRow>
      {open ? (
        <ul className="sp-list">
          <li>
            <span>
              <Icon name="heartFill" size={16} />
              {translate("settings.likedSongs")}
            </span>
            <button
              type="button"
              className="btn ghost sm"
              disabled={blocked || Boolean(busySource)}
              onClick={() => void copyPlaylist("liked")}
            >
              {translate(
                busySource === "liked" ? "settings.copying" : "settings.copy",
              )}
            </button>
          </li>
          {playlists.data?.map((playlist) => (
            <li key={playlist.id}>
              <span>
                {playlist.title}
                {playlist.songCount !== undefined ? (
                  <em>{plural(playlist.songCount, "song")}</em>
                ) : null}
              </span>
              <button
                type="button"
                className="btn ghost sm"
                disabled={blocked || Boolean(busySource)}
                onClick={() => void copyPlaylist(playlist.id)}
              >
                {translate(
                  busySource === playlist.id
                    ? "settings.copying"
                    : "settings.copy",
                )}
              </button>
            </li>
          ))}
          {playlists.isLoading ? (
            <li className="muted">{translate("settings.loadingPlaylists")}</li>
          ) : null}
          {playlists.isError ? (
            <li className="muted">
              {translate("settings.youtubeListsFailed")}
            </li>
          ) : null}
        </ul>
      ) : null}
      {result ? (
        <div className="sp-result" role="status">
          <b>
            {translate("settings.importResult", {
              source: result.source,
              matched: result.matched,
              total: plural(result.total, "song"),
            })}
          </b>
          {result.missing.length ? (
            <span>
              {translate("settings.importMissing", {
                missing: plural(result.missing.length, "song"),
              })}
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
        setError(translate("settings.codeExpired"));

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

          toast(translate("settings.youtubeConnectedToast"));

          return;
        }

        if (loginStatus.state === "expired" || loginStatus.state === "denied") {
          setLogin(null);
          setError(
            loginStatus.state === "denied"
              ? translate("settings.googleCanceled")
              : translate("settings.codeExpired"),
          );

          return;
        }

        pollTimer = setTimeout(
          () => void poll(),
          Math.max(login.interval, loginStatus.retryAfter ?? 0, 1) * 1000,
        );
      } catch (loginError) {
        if (canceled) return;

        setError(
          loginError instanceof Error
            ? loginError.message
            : translate("settings.checkGoogleFailed"),
        );
        setLogin(null);
      }
    };

    pollTimer = setTimeout(
      () => void poll(),
      Math.max(login.interval, 1) * 1000,
    );

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
        ![
          "www.youtube.com",
          "youtube.com",
          "accounts.google.com",
          "www.google.com",
          "google.com",
        ].includes(verificationUrl.hostname)
      )
        throw new Error(translate("settings.youtubeLoginAddressError"));

      setLogin(deviceLogin);
    } catch (loginError) {
      setError(
        loginError instanceof Error
          ? loginError.message
          : translate("settings.startGoogleFailed"),
      );
    } finally {
      setBusy(false);
    }
  };
  const changeEnabled = async (on: boolean) => {
    const previousCapabilities = client.getQueryData<Capabilities>(
      keys.capabilities,
    );

    setBusy(true);
    setError(null);

    client.setQueryData<Capabilities>(
      keys.capabilities,
      (currentCapabilities) =>
        currentCapabilities
          ? { ...currentCapabilities, youtubeMusicEnabled: on }
          : currentCapabilities,
    );

    try {
      await client.cancelQueries({ queryKey: ["ytm"] });
      await ytm.enabled(on);
      await refresh();
    } catch (toggleError) {
      client.setQueryData(keys.capabilities, previousCapabilities);

      setError(
        toggleError instanceof Error
          ? toggleError.message
          : translate("settings.changeYouTubeFailed"),
      );
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
        disconnectError instanceof Error
          ? disconnectError.message
          : translate("settings.disconnectYouTubeFailed"),
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
        cancelError instanceof Error
          ? cancelError.message
          : translate("settings.cancelSignInFailed"),
      );
    }
  };

  return (
    <>
      <p className="yt-experimental">
        <b>{translate("settings.experimental")}</b>{" "}
        {translate("settings.experimentalHint")}
      </p>
      {!capabilities.data?.youtubeMusic ? (
        <SettingRow
          title={translate("settings.connectYouTube")}
          hint={translate("settings.youtubeAdminHint")}
        >
          <button type="button" className="btn ghost sm" disabled>
            {translate("common.connect")}
          </button>
        </SettingRow>
      ) : login ? (
        <div className="yt-device-login" role="status">
          <h3>{translate("settings.connectGoogle")}</h3>
          <p>{translate("settings.googleCodeHint")}</p>
          <div className="yt-device-code">
            <code>{login.userCode}</code>
            <button
              type="button"
              className="btn ghost sm"
              onClick={() =>
                void navigator.clipboard.writeText(login.userCode).then(
                  () => toast(translate("settings.codeCopied")),
                  () => toast(translate("settings.codeCopyFailed")),
                )
              }
            >
              {translate("settings.codeCopy")}
            </button>
          </div>
          <div className="yt-device-actions">
            <a
              className="btn primary sm"
              href={login.verificationUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {translate("settings.openGoogle")}
            </a>
            <button
              type="button"
              className="btn ghost sm"
              onClick={() => void cancelLogin()}
            >
              {translate("settings.cancel")}
            </button>
          </div>
          <p className="muted">
            <span className="spin" />
            {translate("settings.waitingGoogle", {
              time: new Date(login.expiresAt).toLocaleTimeString(
                i18next.resolvedLanguage,
                { hour: "numeric", minute: "2-digit" },
              ),
            })}
          </p>
        </div>
      ) : capabilities.data.youtubeMusicConnected ? (
        <>
          <SettingRow
            title={
              account.data?.name
                ? translate("settings.connectedAs", { name: account.data.name })
                : translate("settings.youtubeConnected")
            }
            hint={translate("settings.youtubeAccountHint")}
          >
            <button
              type="button"
              className="btn ghost sm"
              disabled={busy}
              onClick={() => void disconnect()}
            >
              {translate("settings.disconnect")}
            </button>
          </SettingRow>
          <SettingRow
            title={translate("settings.youtubeEnabled")}
            hint={translate("settings.youtubeEnabledHint")}
          >
            <button
              type="button"
              className="toggle"
              role="switch"
              aria-checked={capabilities.data.youtubeMusicEnabled}
              aria-label={translate("settings.youtubeEnabled")}
              disabled={busy}
              onClick={() =>
                void changeEnabled(!capabilities.data?.youtubeMusicEnabled)
              }
            />
          </SettingRow>
          {capabilities.data.youtubeMusicReconnect ? (
            <SettingRow
              title={translate("settings.youtubeReconnect")}
              hint={translate("settings.youtubeReconnectHint")}
            >
              <button
                type="button"
                className="btn light sm"
                disabled={busy}
                onClick={() => void connect()}
              >
                {translate("settings.reconnect")}
              </button>
            </SettingRow>
          ) : null}
          {capabilities.data.youtubeMusicEnabled &&
          !capabilities.data.youtubeMusicReconnect ? (
            <YouTubeMusicImport />
          ) : null}
        </>
      ) : (
        <SettingRow
          title={translate("settings.connectYouTube")}
          hint={translate("settings.youtubeConnectHint")}
        >
          <button
            type="button"
            className="btn light sm"
            disabled={busy}
            onClick={() => void connect()}
          >
            {translate(busy ? "settings.connecting" : "common.connect")}
          </button>
        </SettingRow>
      )}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}

const LB_KEYS = [
  keys.capabilities,
  keys.discoveries,
  keys.discoveryAll,
  keys.status,
];

function ListenBrainzSettings() {
  const caps = useCapabilities();
  const qc = useQueryClient();
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = () =>
    Promise.all(LB_KEYS.map((queryKey) => qc.invalidateQueries({ queryKey })));
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
          ? translate("settings.listenBrainzConnected")
          : `${translate("settings.listenBrainzConnectedAs", {
              user: r.user,
            })}${r.navidromeError ? ` ${r.navidromeError}.` : ""}`,
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : translate("settings.listenBrainzConnectFailed"),
      );
    } finally {
      setPassword("");
      setBusy(false);
    }
  };
  const disconnect = () =>
    void api
      .listenbrainzDisconnect("")
      .then(refresh, (err: unknown) =>
        toast(
          err instanceof Error
            ? err.message
            : translate("settings.disconnectFailed"),
        ),
      );
  const user = caps.data?.listenbrainzUser;
  if (user) {
    return (
      <>
        <SettingRow
          title={translate("settings.connectedAs", { name: user })}
          hint={translate("settings.listenBrainzConnectedHint")}
        >
          <button type="button" className="btn ghost sm" onClick={disconnect}>
            {translate("settings.disconnect")}
          </button>
        </SettingRow>
        <SettingRow
          title={translate("settings.yourListens")}
          hint={
            caps.data?.listenbrainzNavidrome
              ? translate("settings.listenBrainzSendingHint")
              : translate("settings.listenBrainzSetupHint")
          }
        >
          {caps.data?.listenbrainzNavidrome ? (
            <span className="ok">
              {translate("settings.listenBrainzSending")}
            </span>
          ) : (
            <span className="muted">
              {translate("settings.listenBrainzNotSending")}
            </span>
          )}
        </SettingRow>
      </>
    );
  }
  return (
    <form className="lb-form" onSubmit={(e) => void connect(e)}>
      <p className="lb-lede">{translate("settings.listenBrainzIntro")}</p>
      <label className="field">
        <span>{translate("settings.listenBrainzToken")}</span>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          required
        />
        <small>
          <a
            href="https://listenbrainz.org/settings/"
            target="_blank"
            rel="noopener noreferrer"
          >
            {translate("settings.copyListenBrainz")}
          </a>
        </small>
      </label>
      <label className="field">
        <span>{translate("settings.navidromePassword")}</span>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
        <small>{translate("settings.navidromePasswordHint")}</small>
      </label>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        className="btn light sm"
        disabled={busy || !token.trim()}
      >
        {translate(
          busy ? "settings.connecting" : "settings.connectListenBrainz",
        )}
      </button>
    </form>
  );
}

function checkWord(state: CheckState): string {
  switch (state) {
    case "fail":
      return translate("settings.statusFailed");
    case "off":
      return translate("settings.statusOff");
    case "ok":
      return translate("settings.statusWorking");
    case "warn":
      return translate("settings.statusNeedsLook");
  }
}

function Connections({ publicUrl }: { publicUrl: string | null }) {
  const qc = useQueryClient();
  const { data, isFetching, dataUpdatedAt } = useQuery({
    queryKey: keys.status,
    queryFn: () => api.status(false),
    staleTime: 30_000,
  });
  const local = browserChecks(
    publicUrl,
    location.origin,
    window.isSecureContext,
  );
  const checks = [...local, ...(data?.checks ?? [])];
  const again = async () => {
    const fresh = await qc
      .fetchQuery({
        queryKey: keys.status,
        queryFn: () => api.status(true),
        staleTime: 0,
      })
      .catch(() => null);
    if (!fresh) {
      toast(translate("settings.serverFailed"));
      return;
    }
    const bad = [...local, ...fresh.checks].filter(
      (c) => c.state === "warn" || c.state === "fail",
    ).length;
    toast(
      bad
        ? translate("settings.connectionsNeedAttention", {
            connections: plural(bad, "connection"),
          })
        : translate("settings.connectionsAllWorking"),
    );
  };
  return (
    <>
      <div className="conn-head">
        <h2>{translate("settings.connections")}</h2>
        <button
          type="button"
          className="btn ghost sm"
          disabled={isFetching}
          onClick={() => void again()}
        >
          {isFetching ? (
            <>
              <span className="spin" />
              {translate("settings.checking")}
            </>
          ) : (
            <>
              <Icon name="refresh" size={15} />
              {translate("settings.checkAgain")}
            </>
          )}
        </button>
      </div>
      <p className="conn-lede">
        {translate("settings.connectionsSummary")}
        {dataUpdatedAt
          ? ` ${translate("settings.checkedAt", {
              time: new Intl.DateTimeFormat(localeCode(), {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              }).format(dataUpdatedAt),
            })}`
          : ""}
      </p>
      {checks.map((c) => (
        <SettingRow
          key={c.id}
          title={c.label}
          hint={
            <>
              {c.detail}
              {c.fix && c.state !== "ok" ? (
                <em className="conn-fix">{c.fix}</em>
              ) : null}
            </>
          }
        >
          <span className={`conn-state ${c.state}`}>{checkWord(c.state)}</span>
        </SettingRow>
      ))}
    </>
  );
}

function PersonRow({ p }: { p: Person }) {
  const qc = useQueryClient();
  const set = (
    patch: Partial<
      Pick<Person, "canRequest" | "canSpotify" | "canYouTubeMusic">
    >,
  ) =>
    void api.setPerson(p.user, patch).then(
      () => void qc.invalidateQueries({ queryKey: keys.people }),
      (e: unknown) =>
        toast(
          e instanceof Error ? e.message : translate("settings.changeFailed"),
        ),
    );
  return (
    <div className="set-row person-row">
      <div>
        <b>
          {p.user}
          {p.admin ? (
            <span className="person-badge">{translate("settings.admin")}</span>
          ) : null}
        </b>
        <span>
          {p.admin
            ? translate("settings.adminPersonHint")
            : p.lastSeen
              ? translate("settings.lastHere", {
                  time: ago(new Date(p.lastSeen).toISOString()),
                })
              : translate("settings.neverOpened")}
        </span>
      </div>
      <label className="person-switch">
        <span>{translate("settings.requestMusic")}</span>
        <button
          type="button"
          className="toggle"
          role="switch"
          aria-checked={p.canRequest}
          aria-label={translate("settings.personCanRequest", { user: p.user })}
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
          aria-label={translate("settings.personCanSpotify", { user: p.user })}
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
          aria-label={translate("settings.personCanYouTube", { user: p.user })}
          onClick={() =>
            set({ canYouTubeMusic: !(p.canYouTubeMusic ?? p.admin) })
          }
        />
      </label>
    </div>
  );
}

function People() {
  const { data: people = [], isPending } = usePeople(true);
  return (
    <>
      <h2>{translate("settings.people")}</h2>
      <p className="conn-lede">{translate("settings.peopleHint")}</p>
      {isPending ? (
        <p className="muted source-note">
          <span className="spin" />
          {translate("settings.loadingPeople")}
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
  const { data: scan } = useQuery({
    queryKey: keys.scan,
    queryFn: sub.scanStatus,
    staleTime: 60_000,
  });
  const { data: ping } = useQuery({
    queryKey: ["ping"],
    queryFn: () => sub.ping(),
    staleTime: 300_000,
  });
  const { data: health } = useQuery({
    queryKey: ["health"],
    queryFn: api.health,
    staleTime: 300_000,
  });
  usePageTone(null);

  useEffect(() => {
    const sp = params.get("spotify");
    if (!sp) return;
    toast(
      sp === "connected"
        ? translate("settings.spotifyConnectedToast")
        : translate("settings.spotifyConnectFailed"),
    );
    setParams({}, { replace: true });
  }, [params, setParams]);

  const lastScan = scan?.lastScan ? minutesSince(scan.lastScan) : null;
  return (
    <>
      {mobile ? (
        <MobileHeader title={translate("settings.title")} />
      ) : (
        <TopBar />
      )}
      <div className="set">
        {!mobile ? <h1>{translate("settings.title")}</h1> : null}
        <h2>{translate("settings.playback")}</h2>
        <SettingRow
          title={translate("settings.crossfade")}
          hint={translate(
            canCrossfade
              ? "settings.crossfadeHint"
              : "settings.crossfadeIosHint",
          )}
        >
          <div className="slider-row">
            <span>{plural(0, "second")}</span>
            <Slider
              value={canCrossfade ? s.crossfade : 0}
              max={12}
              step={1}
              label={translate("settings.crossfadeSeconds")}
              valueText={(value) => plural(Math.round(value), "second")}
              onChange={(value) => s.set("crossfade", Math.round(value))}
              needle
            />
            <span>
              {canCrossfade
                ? plural(s.crossfade, "second")
                : translate("settings.statusOff")}
            </span>
          </div>
        </SettingRow>
        <SettingRow
          title={translate("settings.gapless")}
          hint={translate("settings.gaplessHint")}
        >
          <SettingToggle
            settingKey="gapless"
            label={translate("settings.gapless")}
          />
        </SettingRow>
        <SettingRow
          title={translate("settings.normalize")}
          hint={translate("settings.normalizeHint")}
        >
          <Seg
            label={translate("settings.normalize")}
            value={s.normalize}
            options={[
              ["off", translate("settings.normalizeOff")],
              ["track", translate("settings.normalizeTrack")],
              ["album", translate("settings.normalizeAlbum")],
            ]}
            onChange={(normalize) => s.set("normalize", normalize)}
          />
        </SettingRow>
        <SettingRow
          title={translate("settings.autoplay")}
          hint={translate("settings.autoplayHint")}
        >
          <SettingToggle
            settingKey="autoplay"
            label={translate("settings.autoplay")}
          />
        </SettingRow>

        <h2>{translate("settings.soundQuality")}</h2>
        <SettingRow
          title={translate("settings.wifi")}
          hint={translate("settings.originalHint")}
        >
          <Seg
            label={translate("settings.wifi")}
            value={s.wifiQuality}
            options={qualityOptions()}
            onChange={(quality) => s.set("wifiQuality", quality)}
          />
        </SettingRow>
        <SettingRow
          title={translate("settings.cellular")}
          hint={translate("settings.cellularHint")}
        >
          <Seg
            label={translate("settings.cellular")}
            value={s.cellularQuality}
            options={qualityOptions()}
            onChange={(quality) => s.set("cellularQuality", quality)}
          />
        </SettingRow>
        <SettingRow
          title={translate("settings.downloadQuality")}
          hint={translate("settings.downloadQualityHint")}
        >
          <Seg
            label={translate("settings.downloadQuality")}
            value={s.downloadQuality}
            options={qualityOptions()}
            onChange={(quality) => s.set("downloadQuality", quality)}
          />
        </SettingRow>

        <h2>{translate("settings.onDevice")}</h2>
        <Storage />
        <SettingRow
          title={translate("settings.downloadCellular")}
          hint={translate("settings.downloadCellularHint")}
        >
          <SettingToggle
            settingKey="downloadOnCellular"
            label={translate("settings.downloadCellular")}
          />
        </SettingRow>
        <SettingRow
          title={translate("settings.deviceName")}
          hint={translate("settings.deviceNameHint")}
        >
          <input
            className="text-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => rename(name)}
            onKeyDown={(e) => e.key === "Enter" && rename(name)}
            aria-label={translate("settings.deviceName")}
            maxLength={40}
          />
        </SettingRow>

        <h2>{translate("settings.appearance")}</h2>
        <SettingRow
          title={translate("language.label")}
          hint={translate("settings.languageHint")}
        >
          <Seg
            label={translate("language.label")}
            value={s.language}
            options={LANGUAGES.map(
              ([language, label]) =>
                [language, translate(label)] as [Language, string],
            )}
            onChange={(language) => {
              s.set("language", language);
              void changeLanguage(language);
            }}
          />
        </SettingRow>
        <SettingRow
          title={translate("settings.artColor")}
          hint={translate("settings.artColorHint")}
        >
          <SettingToggle
            settingKey="artColor"
            label={translate("settings.artColor")}
          />
        </SettingRow>

        <h2>{translate("settings.server")}</h2>
        <SettingRow
          title={`Navidrome ${ping?.serverVersion ? ping.serverVersion.split(" ")[0] : ""}`.trim()}
          hint={translate("settings.serverHint", {
            user: user ?? "",
            scanSummary:
              lastScan === null
                ? ""
                : lastScan < 1
                  ? translate("settings.serverScanJustNow")
                  : lastScan < 60
                    ? translate("settings.serverScanMinutes", {
                        count: lastScan,
                      })
                    : translate("settings.serverScanHours", {
                        count: Math.round(lastScan / 60),
                      }),
            songSummary:
              scan?.count === undefined ? "" : plural(scan.count, "song"),
          })}
        >
          <span className="ok">{translate("settings.connected")}</span>
        </SettingRow>
        <PhotoSetting />
        {admin ? (
          <>
            <Connections publicUrl={caps.data?.publicUrl ?? null} />
            <People />
          </>
        ) : (
          <SettingRow
            title={translate("settings.requestMusic")}
            hint={translate(
              canRequest
                ? "settings.requestMusicOn"
                : "settings.requestMusicOff",
            )}
          >
            {canRequest ? (
              <span className="ok">{translate("settings.connectedOn")}</span>
            ) : (
              <span className="muted">
                {translate("settings.connectedOff")}
              </span>
            )}
          </SettingRow>
        )}
        <h2>{translate("settings.listenBrainz")}</h2>
        <ListenBrainzSettings />
        {caps.data?.spotify || admin ? (
          <>
            <h2>{translate("settings.spotify")}</h2>
            <SpotifySettings />
          </>
        ) : null}
        {caps.data?.youtubeMusic || admin ? (
          <>
            <h2>{translate("settings.youtubeMusic")}</h2>
            <YouTubeMusicSettings />
          </>
        ) : null}

        <h2>{translate("settings.app")}</h2>
        <SettingRow
          title={translate("settings.version")}
          hint={
            health?.version && health.version !== VERSION
              ? translate("settings.serverVersionMismatch", {
                  version: health.version,
                })
              : undefined
          }
        >
          <span className="muted tabular">Needle {VERSION}</span>
        </SettingRow>
        {!mobile ? (
          <SettingRow title={translate("common.keyboardShortcuts")}>
            <button
              type="button"
              className="btn ghost sm"
              onClick={() => useUi.setState({ shortcutsOpen: true })}
            >
              <Icon name="keyboard" size={16} />
              {translate("common.keyboardShortcuts")}
            </button>
          </SettingRow>
        ) : null}
        <SettingRow
          title={translate("common.signOut")}
          hint={translate("settings.downloadsStay")}
        >
          <button type="button" className="btn ghost sm" onClick={signOut}>
            {translate("common.signOut")}
          </button>
        </SettingRow>
      </div>
    </>
  );
}
