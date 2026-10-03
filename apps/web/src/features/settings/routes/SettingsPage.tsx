import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { Icon } from "../../../components/Icon.tsx";
import { Seg } from "../../../components/Seg.tsx";
import { Slider } from "../../../components/Slider.tsx";
import { changeLanguage, translate } from "../../../i18n/index.ts";
import { MobileHeader } from "../../../layout/Mobile.tsx";
import { TopBar } from "../../../layout/TopBar.tsx";
import { usePageTone } from "../../../layout/pageTone.ts";
import { api } from "../../../lib/api.ts";
import { minutesSince, plural } from "../../../lib/format.ts";
import { useIsMobile } from "../../../lib/media.ts";
import { VERSION } from "../../../lib/version.ts";
import { canCrossfade } from "../../../player/controller.ts";
import { useCanRequest, useCapabilities, useIsAdmin } from "../../../queries/hooks.ts";
import { keys } from "../../../queries/keys.ts";
import { useSession } from "../../../state/session.ts";
import type { Language } from "../../../state/settings.ts";
import { useSettings } from "../../../state/settings.ts";
import { toast, useUi } from "../../../state/ui.ts";
import { sub } from "../../../lib/subsonic.ts";
import { ConnectionsSettings } from "../components/ConnectionsSettings.tsx";
import { ListenBrainzSettings } from "../components/ListenBrainzSettings.tsx";
import { PeopleSettings } from "../components/PeopleSettings.tsx";
import { PhotoSetting } from "../components/PhotoSetting.tsx";
import { SettingRow, SettingToggle } from "../components/SettingRow.tsx";
import { SpotifySettings } from "../components/SpotifySettings.tsx";
import { StorageSettings } from "../components/StorageSettings.tsx";
import { YouTubeMusicSettings } from "../components/YouTubeMusicSettings.tsx";
import { LANGUAGES, qualityOptions } from "../constants/options.ts";

export default function SettingsPage() {
  const mobile = useIsMobile();
  const settings = useSettings();
  const deviceName = useSession((sessionState) => sessionState.deviceName);
  const renameDevice = useSession((sessionState) => sessionState.rename);
  const user = useSession((sessionState) => sessionState.credentials?.user);
  const signOut = useSession((sessionState) => sessionState.signOut);
  const capabilities = useCapabilities();
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
    const spotifyStatus = params.get("spotify");

    if (!spotifyStatus) return;

    toast(
      spotifyStatus === "connected"
        ? translate("settings.spotifyConnectedToast")
        : translate("settings.spotifyConnectFailed"),
    );
    setParams({}, { replace: true });
  }, [params, setParams]);

  const lastScan = scan?.lastScan ? minutesSince(scan.lastScan) : null;

  return (
    <>
      {mobile ? <MobileHeader title={translate("settings.title")} /> : <TopBar />}
      <div className="set">
        {!mobile ? <h1>{translate("settings.title")}</h1> : null}
        <h2>{translate("settings.playback")}</h2>
        <SettingRow
          title={translate("settings.crossfade")}
          hint={translate(canCrossfade ? "settings.crossfadeHint" : "settings.crossfadeIosHint")}
        >
          <div className="slider-row">
            <span>{plural(0, "second")}</span>
            <Slider
              value={canCrossfade ? settings.crossfade : 0}
              max={12}
              step={1}
              label={translate("settings.crossfadeSeconds")}
              valueText={(value) => plural(Math.round(value), "second")}
              onChange={(value) => settings.set("crossfade", Math.round(value))}
              needle
            />
            <span>{canCrossfade ? plural(settings.crossfade, "second") : translate("settings.statusOff")}</span>
          </div>
        </SettingRow>
        <SettingRow title={translate("settings.gapless")} hint={translate("settings.gaplessHint")}>
          <SettingToggle settingKey="gapless" label={translate("settings.gapless")} />
        </SettingRow>
        <SettingRow title={translate("settings.normalize")} hint={translate("settings.normalizeHint")}>
          <Seg
            label={translate("settings.normalize")}
            value={settings.normalize}
            options={[
              ["off", translate("settings.normalizeOff")],
              ["track", translate("settings.normalizeTrack")],
              ["album", translate("settings.normalizeAlbum")],
            ]}
            onChange={(normalize) => settings.set("normalize", normalize)}
          />
        </SettingRow>
        <SettingRow title={translate("settings.autoplay")} hint={translate("settings.autoplayHint")}>
          <SettingToggle settingKey="autoplay" label={translate("settings.autoplay")} />
        </SettingRow>

        <h2>{translate("settings.soundQuality")}</h2>
        <SettingRow title={translate("settings.wifi")} hint={translate("settings.originalHint")}>
          <Seg
            label={translate("settings.wifi")}
            value={settings.wifiQuality}
            options={qualityOptions()}
            onChange={(quality) => settings.set("wifiQuality", quality)}
          />
        </SettingRow>
        <SettingRow title={translate("settings.cellular")} hint={translate("settings.cellularHint")}>
          <Seg
            label={translate("settings.cellular")}
            value={settings.cellularQuality}
            options={qualityOptions()}
            onChange={(quality) => settings.set("cellularQuality", quality)}
          />
        </SettingRow>
        <SettingRow title={translate("settings.downloadQuality")} hint={translate("settings.downloadQualityHint")}>
          <Seg
            label={translate("settings.downloadQuality")}
            value={settings.downloadQuality}
            options={qualityOptions()}
            onChange={(quality) => settings.set("downloadQuality", quality)}
          />
        </SettingRow>

        <h2>{translate("settings.onDevice")}</h2>
        <StorageSettings />
        <SettingRow title={translate("settings.downloadCellular")} hint={translate("settings.downloadCellularHint")}>
          <SettingToggle settingKey="downloadOnCellular" label={translate("settings.downloadCellular")} />
        </SettingRow>
        <SettingRow title={translate("settings.deviceName")} hint={translate("settings.deviceNameHint")}>
          <input
            className="text-input"
            value={name}
            onChange={(nameEvent) => setName(nameEvent.target.value)}
            onBlur={() => renameDevice(name)}
            onKeyDown={(keyEvent) => keyEvent.key === "Enter" && renameDevice(name)}
            aria-label={translate("settings.deviceName")}
            maxLength={40}
          />
        </SettingRow>

        <h2>{translate("settings.appearance")}</h2>
        <SettingRow title={translate("language.label")} hint={translate("settings.languageHint")}>
          <Seg
            label={translate("language.label")}
            value={settings.language}
            options={LANGUAGES.map(([language, label]) => [language, translate(label)] as [Language, string])}
            onChange={(language) => {
              settings.set("language", language);
              void changeLanguage(language);
            }}
          />
        </SettingRow>
        <SettingRow title={translate("settings.artColor")} hint={translate("settings.artColorHint")}>
          <SettingToggle settingKey="artColor" label={translate("settings.artColor")} />
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
            songSummary: scan?.count === undefined ? "" : plural(scan.count, "song"),
          })}
        >
          <span className="ok">{translate("settings.connected")}</span>
        </SettingRow>
        <PhotoSetting />
        {admin ? (
          <>
            <ConnectionsSettings publicUrl={capabilities.data?.publicUrl ?? null} />
            <PeopleSettings />
          </>
        ) : (
          <SettingRow
            title={translate("settings.requestMusic")}
            hint={translate(canRequest ? "settings.requestMusicOn" : "settings.requestMusicOff")}
          >
            {canRequest ? (
              <span className="ok">{translate("settings.connectedOn")}</span>
            ) : (
              <span className="muted">{translate("settings.connectedOff")}</span>
            )}
          </SettingRow>
        )}

        <h2>{translate("settings.listenBrainz")}</h2>
        <ListenBrainzSettings />
        {capabilities.data?.spotify || admin ? (
          <>
            <h2>{translate("settings.spotify")}</h2>
            <SpotifySettings />
          </>
        ) : null}
        {capabilities.data?.youtubeMusic || admin ? (
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
            <button type="button" className="btn ghost sm" onClick={() => useUi.setState({ shortcutsOpen: true })}>
              <Icon name="keyboard" size={16} />
              {translate("common.keyboardShortcuts")}
            </button>
          </SettingRow>
        ) : null}
        <SettingRow title={translate("common.signOut")} hint={translate("settings.downloadsStay")}>
          <button type="button" className="btn ghost sm" onClick={signOut}>
            {translate("common.signOut")}
          </button>
        </SettingRow>
      </div>
    </>
  );
}
