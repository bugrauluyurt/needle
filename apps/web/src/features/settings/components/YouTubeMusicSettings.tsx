import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Capabilities, ImportResult, YouTubeMusicLogin } from "@needle/shared";
import { Icon } from "../../../components/Icon.tsx";
import { i18next, translate } from "../../../i18n/index.ts";
import { plural } from "../../../lib/format.ts";
import { keys } from "../../../queries/keys.ts";
import { useCapabilities } from "../../../queries/hooks.ts";
import { toast } from "../../../state/ui.ts";
import { useYouTubeMusicStatus, ytm } from "../../youtube-music/api/client.ts";
import {
  clearYouTubeMusicCache,
  useYouTubeMusicAccount,
  useYouTubeMusicPlaylists,
} from "../../youtube-music/hooks/useYouTubeMusic.ts";
import { SettingRow } from "./SettingRow.tsx";

function YouTubeMusicImport() {
  const queryClient = useQueryClient();
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

      await queryClient.invalidateQueries({ queryKey: keys.playlists });
    } catch (importError) {
      toast(importError instanceof Error ? importError.message : translate("settings.copyFailed"));
    } finally {
      setBusySource(null);
    }
  };

  return (
    <>
      <SettingRow title={translate("settings.copyPlaylists")} hint={translate("settings.copyYouTubeHint")}>
        <button type="button" className="btn ghost sm" aria-expanded={open} onClick={() => setOpen(!open)}>
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
              {translate(busySource === "liked" ? "settings.copying" : "settings.copy")}
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
                {translate(busySource === playlist.id ? "settings.copying" : "settings.copy")}
              </button>
            </li>
          ))}
          {playlists.isLoading ? <li className="muted">{translate("settings.loadingPlaylists")}</li> : null}
          {playlists.isError ? <li className="muted">{translate("settings.youtubeListsFailed")}</li> : null}
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

export function YouTubeMusicSettings() {
  const capabilities = useCapabilities();
  const queryClient = useQueryClient();
  const account = useYouTubeMusicAccount();
  const [login, setLogin] = useState<YouTubeMusicLogin | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: keys.capabilities }),
      queryClient.invalidateQueries({ queryKey: keys.status }),
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
          await queryClient.cancelQueries({ queryKey: ["ytm"] });

          clearYouTubeMusicCache();
          setLogin(null);

          await queryClient.invalidateQueries({ queryKey: keys.capabilities });
          await queryClient.invalidateQueries({ queryKey: keys.status });

          toast(translate("settings.youtubeConnectedToast"));

          return;
        }

        if (loginStatus.state === "expired" || loginStatus.state === "denied") {
          setLogin(null);
          setError(
            loginStatus.state === "denied" ? translate("settings.googleCanceled") : translate("settings.codeExpired"),
          );

          return;
        }

        pollTimer = setTimeout(() => void poll(), Math.max(login.interval, loginStatus.retryAfter ?? 0, 1) * 1000);
      } catch (loginError) {
        if (canceled) return;

        setError(loginError instanceof Error ? loginError.message : translate("settings.checkGoogleFailed"));
        setLogin(null);
      }
    };

    pollTimer = setTimeout(() => void poll(), Math.max(login.interval, 1) * 1000);

    return () => {
      canceled = true;

      clearTimeout(pollTimer);
    };
  }, [login, queryClient]);

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
        throw new Error(translate("settings.youtubeLoginAddressError"));

      setLogin(deviceLogin);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : translate("settings.startGoogleFailed"));
    } finally {
      setBusy(false);
    }
  };
  const changeEnabled = async (on: boolean) => {
    const previousCapabilities = queryClient.getQueryData<Capabilities>(keys.capabilities);

    setBusy(true);
    setError(null);

    queryClient.setQueryData<Capabilities>(keys.capabilities, (currentCapabilities) =>
      currentCapabilities ? { ...currentCapabilities, youtubeMusicEnabled: on } : currentCapabilities,
    );

    try {
      await queryClient.cancelQueries({ queryKey: ["ytm"] });
      await ytm.enabled(on);
      await refresh();
    } catch (toggleError) {
      queryClient.setQueryData(keys.capabilities, previousCapabilities);

      setError(toggleError instanceof Error ? toggleError.message : translate("settings.changeYouTubeFailed"));
    } finally {
      setBusy(false);
    }
  };
  const disconnect = async () => {
    setBusy(true);
    setError(null);

    try {
      await queryClient.cancelQueries({ queryKey: ["ytm"] });
      await ytm.disconnect();

      clearYouTubeMusicCache();

      await refresh();
    } catch (disconnectError) {
      setError(
        disconnectError instanceof Error ? disconnectError.message : translate("settings.disconnectYouTubeFailed"),
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
      setError(cancelError instanceof Error ? cancelError.message : translate("settings.cancelSignInFailed"));
    }
  };

  return (
    <>
      <p className="yt-experimental">
        <b>{translate("settings.experimental")}</b> {translate("settings.experimentalHint")}
      </p>
      {!capabilities.data?.youtubeMusic ? (
        <SettingRow title={translate("settings.connectYouTube")} hint={translate("settings.youtubeAdminHint")}>
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
            <a className="btn primary sm" href={login.verificationUrl} target="_blank" rel="noopener noreferrer">
              {translate("settings.openGoogle")}
            </a>
            <button type="button" className="btn ghost sm" onClick={() => void cancelLogin()}>
              {translate("settings.cancel")}
            </button>
          </div>
          <p className="muted">
            <span className="spin" />
            {translate("settings.waitingGoogle", {
              time: new Date(login.expiresAt).toLocaleTimeString(i18next.resolvedLanguage, {
                hour: "numeric",
                minute: "2-digit",
              }),
            })}
          </p>
        </div>
      ) : capabilities.data.youtubeMusicConnected ? (
        <>
          <SettingRow
            title={
              account.data?.name
                ? translate("settings.connectedAs", {
                    name: account.data.name,
                  })
                : translate("settings.youtubeConnected")
            }
            hint={translate("settings.youtubeAccountHint")}
          >
            <button type="button" className="btn ghost sm" disabled={busy} onClick={() => void disconnect()}>
              {translate("settings.disconnect")}
            </button>
          </SettingRow>
          <SettingRow title={translate("settings.youtubeEnabled")} hint={translate("settings.youtubeEnabledHint")}>
            <button
              type="button"
              className="toggle"
              role="switch"
              aria-checked={capabilities.data.youtubeMusicEnabled}
              aria-label={translate("settings.youtubeEnabled")}
              disabled={busy}
              onClick={() => void changeEnabled(!capabilities.data?.youtubeMusicEnabled)}
            />
          </SettingRow>
          {capabilities.data.youtubeMusicReconnect ? (
            <SettingRow
              title={translate("settings.youtubeReconnect")}
              hint={translate("settings.youtubeReconnectHint")}
            >
              <button type="button" className="btn light sm" disabled={busy} onClick={() => void connect()}>
                {translate("settings.reconnect")}
              </button>
            </SettingRow>
          ) : null}
          {capabilities.data.youtubeMusicEnabled && !capabilities.data.youtubeMusicReconnect ? (
            <YouTubeMusicImport />
          ) : null}
        </>
      ) : (
        <SettingRow title={translate("settings.connectYouTube")} hint={translate("settings.youtubeConnectHint")}>
          <button type="button" className="btn light sm" disabled={busy} onClick={() => void connect()}>
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
