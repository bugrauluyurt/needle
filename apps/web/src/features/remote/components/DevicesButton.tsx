import * as Popover from "@radix-ui/react-popover";
import type { ReactNode } from "react";
import type { Device } from "@needle/shared";
import { Art } from "../../../components/Art.tsx";
import { Eq, Icon } from "../../../components/Icon.tsx";
import type { IconName } from "../../../components/Icon.tsx";
import { deviceKind } from "../../../lib/device.ts";
import { useCurrentSong, usePlayer } from "../../../player/store.ts";
import { useSession } from "../../../state/session.ts";
import { command, pullFrom, transferTo, useRemote } from "../client.ts";
import { translate } from "../../../i18n/index.ts";

export const kindIcon = (kind: Device["kind"]): IconName => (kind === "desktop" ? "devices" : "signal");

function RemoteDevice({ d, canSend, active }: { d: Device; canSend: boolean; active: boolean }) {
  const s = d.state;
  return (
    <li className="dev">
      <div className="dev-head">
        <Icon name={kindIcon(d.kind)} size={20} />
        <div className="dev-text">
          <b>{d.name}</b>
          <span className="ellipsis">
            {s
              ? `${translate(s.playing ? "devices.playing" : "devices.paused")}: ${s.title}, ${s.artist}`
              : translate("devices.notPlaying")}
          </span>
        </div>
        {active && s ? <Eq paused={!s.playing} /> : null}
      </div>
      <div className="dev-actions">
        {s ? (
          <>
            <button
              type="button"
              className="icon-btn"
              aria-label={translate("devices.previousOn", { device: d.name })}
              onClick={() => command(d.id, { action: "previous" })}
            >
              <Icon name="prev" size={16} />
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label={translate(s.playing ? "devices.pauseOn" : "devices.playOn", { device: d.name })}
              onClick={() => command(d.id, { action: s.playing ? "pause" : "play" })}
            >
              <Icon name={s.playing ? "pause" : "play"} size={16} />
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label={translate("devices.nextOn", { device: d.name })}
              onClick={() => command(d.id, { action: "next" })}
            >
              <Icon name="next" size={16} />
            </button>
          </>
        ) : null}
      </div>
      <div className="dev-transfer">
        {s ? (
          <button type="button" className="btn ghost sm" onClick={() => pullFrom(d)}>
            {translate("common.continueHere")}
          </button>
        ) : null}
        {canSend ? (
          <button
            type="button"
            className="btn light sm"
            aria-label={translate("devices.movePlaybackTo", { device: d.name })}
            onClick={() => transferTo(d.id)}
          >
            <Icon name="devices" size={15} />
            {translate("devices.movePlayback")}
          </button>
        ) : null}
      </div>
    </li>
  );
}

export function DevicesPanel() {
  const devices = useRemote((s) => s.devices);
  const connected = useRemote((s) => s.connected);
  const activeId = useRemote((s) => s.activeId);
  const me = useSession((s) => s.deviceId);
  const name = useSession((s) => s.deviceName);
  const song = useCurrentSong();
  const playing = usePlayer((s) => s.playing);
  const others = devices.filter((d) => d.id !== me);
  return (
    <div className="devices">
      <h3>{translate("devices.listeningOn")}</h3>
      <div className="dev this">
        <div className="dev-head">
          <Icon name={kindIcon(deviceKind())} size={20} />
          <div className="dev-text">
            <b>{translate(deviceKind() === "phone" ? "devices.thisPhone" : "devices.thisDevice")}</b>
            <span className="ellipsis">{name}</span>
          </div>
          {song && playing ? <Eq /> : null}
        </div>
        {song ? (
          <div className="dev-now">
            <Art id={song.coverArt} px={40} />
            <span className="ellipsis">{song.title}</span>
          </div>
        ) : null}
      </div>
      {others.length ? (
        <>
          <h4>{translate("devices.other")}</h4>
          <ul>
            {others.map((d) => (
              <RemoteDevice key={d.id} d={d} canSend={Boolean(song)} active={d.id === activeId} />
            ))}
          </ul>
        </>
      ) : (
        <p className="dev-empty">{connected ? translate("devices.openAnother") : translate("devices.connecting")}</p>
      )}
    </div>
  );
}

export function DevicesButton({ trigger }: { trigger?: ReactNode }) {
  const others = useRemote((s) => s.devices.length > 1);
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        {trigger ?? (
          <button
            type="button"
            className={`icon-btn ${others ? "has-devices" : ""}`}
            aria-label={translate("devices.devices")}
          >
            <Icon name="devices" size={18} />
          </button>
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="popover" side="top" align="end" sideOffset={12} collisionPadding={12}>
          <DevicesPanel />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
