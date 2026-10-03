import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { translate } from "../../../i18n/index.ts";
import { api } from "../../../lib/api.ts";
import { keys } from "../../../queries/keys.ts";
import { useCapabilities } from "../../../queries/hooks.ts";
import { toast } from "../../../state/ui.ts";
import { SettingRow } from "./SettingRow.tsx";

const LISTENBRAINZ_QUERY_KEYS = [keys.capabilities, keys.discoveries, keys.discoveryAll, keys.status];

export function ListenBrainzSettings() {
  const capabilities = useCapabilities();
  const queryClient = useQueryClient();
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = () =>
    Promise.all(LISTENBRAINZ_QUERY_KEYS.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
  const connect = async (formEvent: React.FormEvent) => {
    formEvent.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const connection = await api.listenbrainzConnect(token.trim(), password);

      setToken("");

      await refresh();

      toast(
        connection.navidrome
          ? translate("settings.listenBrainzConnected")
          : `${translate("settings.listenBrainzConnectedAs", {
              user: connection.user,
            })}${connection.navidromeError ? ` ${connection.navidromeError}.` : ""}`,
      );
    } catch (connectionError) {
      setError(
        connectionError instanceof Error ? connectionError.message : translate("settings.listenBrainzConnectFailed"),
      );
    } finally {
      setPassword("");
      setBusy(false);
    }
  };
  const disconnect = () =>
    void api
      .listenbrainzDisconnect("")
      .then(refresh, (disconnectError: unknown) =>
        toast(disconnectError instanceof Error ? disconnectError.message : translate("settings.disconnectFailed")),
      );
  const user = capabilities.data?.listenbrainzUser;

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
            capabilities.data?.listenbrainzNavidrome
              ? translate("settings.listenBrainzSendingHint")
              : translate("settings.listenBrainzSetupHint")
          }
        >
          {capabilities.data?.listenbrainzNavidrome ? (
            <span className="ok">{translate("settings.listenBrainzSending")}</span>
          ) : (
            <span className="muted">{translate("settings.listenBrainzNotSending")}</span>
          )}
        </SettingRow>
      </>
    );
  }

  return (
    <form className="lb-form" onSubmit={(formEvent) => void connect(formEvent)}>
      <p className="lb-lede">{translate("settings.listenBrainzIntro")}</p>
      <label className="field">
        <span>{translate("settings.listenBrainzToken")}</span>
        <input
          type="password"
          value={token}
          onChange={(tokenEvent) => setToken(tokenEvent.target.value)}
          autoComplete="off"
          spellCheck={false}
          required
        />
        <small>
          <a href="https://listenbrainz.org/settings/" target="_blank" rel="noopener noreferrer">
            {translate("settings.copyListenBrainz")}
          </a>
        </small>
      </label>
      <label className="field">
        <span>{translate("settings.navidromePassword")}</span>
        <input
          type="password"
          value={password}
          onChange={(passwordEvent) => setPassword(passwordEvent.target.value)}
          autoComplete="current-password"
        />
        <small>{translate("settings.navidromePasswordHint")}</small>
      </label>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit" className="btn light sm" disabled={busy || !token.trim()}>
        {translate(busy ? "settings.connecting" : "settings.connectListenBrainz")}
      </button>
    </form>
  );
}
