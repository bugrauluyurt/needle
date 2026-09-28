import * as DM from "@radix-ui/react-dropdown-menu";
import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import { Icon } from "../components/Icon.tsx";
import { useSession } from "../state/session.ts";
import { useUpdate } from "../state/update.ts";
import { image } from "../lib/spotify.ts";
import { useSpotifyMe } from "../queries/spotify.ts";
import { useCanRequest, useMe } from "../queries/hooks.ts";
import { useUi } from "../state/ui.ts";

let maxIdx = 0;

function historyIdx(): number {
  const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
  maxIdx = Math.max(maxIdx, idx);
  return idx;
}

export function AvatarFace({ px }: { px: number }) {
  const user = useSession((s) => s.credentials?.user ?? "");
  const { data: profile } = useMe();
  const { data: me } = useSpotifyMe();
  const photo = profile?.photo ?? image(me?.images, px * 2);
  return photo ? <img src={photo} alt="" draggable={false} /> : <>{(me?.display_name ?? user).slice(0, 1).toUpperCase()}</>;
}

export function AccountMenu({ size = 32 }: { size?: number }) {
  const user = useSession((s) => s.credentials?.user ?? "");
  const signOut = useSession((s) => s.signOut);
  const navigate = useNavigate();
  const update = useUpdate((s) => s.apply);
  const canRequest = useCanRequest();

  return (
    <DM.Root modal={false}>
      <DM.Trigger asChild>
        <button type="button" className="avatar" style={{ width: size, height: size }} aria-label={update ? `Account, signed in as ${user}, update ready` : `Account, signed in as ${user}`}>
          <AvatarFace px={size} />
          {update ? <span className="update-dot" aria-hidden="true" /> : null}
        </button>
      </DM.Trigger>
      <DM.Portal>
        <DM.Content className="menu" align="end" sideOffset={8} collisionPadding={12}>
          <DM.Label className="menu-heading">Signed in as {user}</DM.Label>
          {update ? (
            <>
              <DM.Item className="menu-item update-item" onSelect={update}>
                <Icon name="refresh" size={18} />
                <span className="menu-label">Update Needle<small>A new version is ready. Reloads the page.</small></span>
              </DM.Item>
              <DM.Separator className="menu-sep" />
            </>
          ) : null}
          <DM.Item className="menu-item" onSelect={() => void navigate("/stats")}>
            <Icon name="chart" size={18} />
            <span className="menu-label">Your listening</span>
          </DM.Item>
          {canRequest ? (
            <DM.Item className="menu-item" onSelect={() => void navigate("/requests")}>
              <Icon name="import" size={18} />
              <span className="menu-label">Requests</span>
            </DM.Item>
          ) : null}
          <DM.Item className="menu-item" onSelect={() => void navigate("/downloads")}>
            <Icon name="download" size={18} />
            <span className="menu-label">Downloads</span>
          </DM.Item>
          <DM.Item className="menu-item" onSelect={() => void navigate("/settings")}>
            <Icon name="settings" size={18} />
            <span className="menu-label">Settings</span>
          </DM.Item>
          <DM.Item className="menu-item" onSelect={() => useUi.setState({ shortcutsOpen: true })}>
            <Icon name="keyboard" size={18} />
            <span className="menu-label">Keyboard shortcuts</span>
          </DM.Item>
          <DM.Item className="menu-item" onSelect={() => location.reload()}>
            <Icon name="refresh" size={18} />
            <span className="menu-label">Refresh page</span>
          </DM.Item>
          <DM.Separator className="menu-sep" />
          <DM.Item className="menu-item" onSelect={signOut}>
            <Icon name="logout" size={18} />
            <span className="menu-label">Sign out</span>
          </DM.Item>
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

export function TopBar({ children, extra }: { children?: ReactNode; extra?: ReactNode }) {
  const navigate = useNavigate();
  const idx = historyIdx();
  return (
    <header className="topbar">
      <div className="hist">
        <button type="button" className="circle" aria-label="Go back" disabled={idx === 0} onClick={() => void navigate(-1)}>
          <Icon name="back" />
        </button>
        <button type="button" className="circle" aria-label="Go forward" disabled={idx >= maxIdx} onClick={() => void navigate(1)}>
          <Icon name="forward" />
        </button>
      </div>
      {children}
      <div className="top-right">
        {extra}
        <AccountMenu />
      </div>
    </header>
  );
}
