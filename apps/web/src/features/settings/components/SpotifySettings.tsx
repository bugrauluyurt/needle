import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ImportResult } from "@needle/shared";
import { Icon } from "../../../components/Icon.tsx";
import { translate } from "../../../i18n/index.ts";
import { api } from "../../../lib/api.ts";
import { plural } from "../../../lib/format.ts";
import { keys } from "../../../queries/keys.ts";
import { useCapabilities } from "../../../queries/hooks.ts";
import { toast } from "../../../state/ui.ts";
import { clearSpotifyCache } from "../../spotify/hooks/useSpotify.ts";
import { SettingRow } from "./SettingRow.tsx";

function SpotifyImport() {
  const capabilities = useCapabilities();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const playlists = useQuery({
    queryKey: keys.spotifyPlaylists,
    queryFn: api.spotifyPlaylists,
    enabled: open,
  });
  const [busySource, setBusySource] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [requesting, setRequesting] = useState(false);
  const copyPlaylist = async (source: string) => {
    setBusySource(source);
    setResult(null);

    try {
      const importResult = await api.spotifyImport(source);

      setResult(importResult);

      await queryClient.invalidateQueries({ queryKey: keys.playlists });
    } catch (importError) {
      toast(importError instanceof Error ? importError.message : translate("settings.copyFailed"));
    } finally {
      setBusySource(null);
    }
  };
  const requestMissing = async () => {
    if (!result) return;

    setRequesting(true);

    try {
      const requestResult = await api.spotifyMissing(result.missing);
      const details = [
        requestResult.notFound
          ? translate("settings.lidarrNotFoundDetail", {
              count: requestResult.notFound,
            })
          : "",
        requestResult.skipped
          ? translate("settings.lidarrSkippedDetail", {
              count: requestResult.skipped,
            })
          : "",
      ].join("");

      toast(
        translate("settings.lidarrFetchResult", {
          albums: plural(requestResult.requested, "album"),
          details,
        }),
      );
    } catch (requestError) {
      toast(requestError instanceof Error ? requestError.message : translate("settings.lidarrRequestFailed"));
    } finally {
      setRequesting(false);
    }
  };

  return (
    <>
      <SettingRow title={translate("settings.copyPlaylists")} hint={translate("settings.copySpotifyHint")}>
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
              disabled={Boolean(busySource)}
              onClick={() => void copyPlaylist("liked")}
            >
              {translate(busySource === "liked" ? "settings.copying" : "settings.copy")}
            </button>
          </li>
          {(playlists.data ?? []).map((playlist) => (
            <li key={playlist.id}>
              <span>
                {playlist.name}
                <em>{plural(playlist.trackCount, "song")}</em>
              </span>
              <button
                type="button"
                className="btn ghost sm"
                disabled={Boolean(busySource)}
                onClick={() => void copyPlaylist(playlist.id)}
              >
                {translate(busySource === playlist.id ? "settings.copying" : "settings.copy")}
              </button>
            </li>
          ))}
          {playlists.isLoading ? <li className="muted">{translate("settings.loadingPlaylists")}</li> : null}
          {playlists.isError ? (
            <li className="muted">
              {playlists.error instanceof Error
                ? playlists.error.message
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
              {capabilities.data?.lidarr ? (
                <button
                  type="button"
                  className="btn light sm"
                  disabled={requesting}
                  onClick={() => void requestMissing()}
                >
                  {translate(requesting ? "settings.askingLidarr" : "settings.getMissingAlbums")}
                </button>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

export function SpotifySettings() {
  const capabilities = useCapabilities();
  const queryClient = useQueryClient();
  const connect = () =>
    void api.spotifyLogin().then(({ url }) => {
      location.href = url;
    });

  if (!capabilities.data?.spotify) {
    return (
      <SettingRow title={translate("settings.connectSpotify")} hint={translate("settings.spotifyConfigHint")}>
        <button type="button" className="btn ghost sm" disabled>
          {translate("settings.connectSpotify")}
        </button>
      </SettingRow>
    );
  }

  if (!capabilities.data.spotifyConnected) {
    return (
      <SettingRow title={translate("settings.connectSpotify")} hint={translate("settings.spotifyConnectHint")}>
        <button type="button" className="btn light sm" onClick={connect}>
          {translate("settings.connectSpotify")}
        </button>
      </SettingRow>
    );
  }

  return (
    <>
      <SettingRow title={translate("settings.spotifyEnabled")} hint={translate("settings.spotifyEnabledHint")}>
        <button
          type="button"
          className="toggle"
          role="switch"
          aria-checked={capabilities.data.spotifyEnabled}
          aria-label={translate("settings.spotifyEnabled")}
          onClick={() =>
            void api.spotifyEnabled(!capabilities.data?.spotifyEnabled).then(() =>
              queryClient.invalidateQueries({
                queryKey: keys.capabilities,
              }),
            )
          }
        />
      </SettingRow>
      {!capabilities.data.spotifyEnabled || !capabilities.data.spotifyReconnect ? (
        <SettingRow
          title={translate("settings.spotifyConnected")}
          hint={translate(
            capabilities.data.spotifyEnabled ? "settings.spotifyConnectedHint" : "settings.spotifyDisabledHint",
          )}
        >
          <button
            type="button"
            className="btn ghost sm"
            onClick={() =>
              void api.spotifyDisconnect().then(() => {
                clearSpotifyCache();

                return queryClient.invalidateQueries({
                  queryKey: keys.capabilities,
                });
              })
            }
          >
            {translate("settings.disconnect")}
          </button>
        </SettingRow>
      ) : (
        <SettingRow title={translate("settings.spotifyReconnect")} hint={translate("settings.spotifyReconnectHint")}>
          <button type="button" className="btn light sm" onClick={connect}>
            {translate("settings.reconnect")}
          </button>
        </SettingRow>
      )}
      {capabilities.data.spotifyEnabled ? <SpotifyImport /> : null}
    </>
  );
}
