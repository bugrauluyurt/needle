import * as DM from "@radix-ui/react-dropdown-menu";
import { useCallback, useRef } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import { Icon } from "../components/Icon.tsx";
import { SearchField } from "../components/SearchField.tsx";
import { translate } from "../i18n/index.ts";
import { useSession } from "../state/session.ts";
import { useUpdate } from "../state/update.ts";
import { image } from "../features/spotify/api/client.ts";
import { useIsMobile } from "../lib/media.ts";
import { useSpotifyMe } from "../features/spotify/hooks/useSpotify.ts";
import { useCanRequest, useMe } from "../queries/hooks.ts";
import { useUi } from "../state/ui.ts";
import { useScrolledTitle } from "./useScrolledTitle.ts";

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
  return photo ? (
    <img src={photo} alt="" draggable={false} />
  ) : (
    <>{(me?.display_name ?? user).slice(0, 1).toUpperCase()}</>
  );
}

export function AccountMenu({ size = 32 }: { size?: number }) {
  const user = useSession((s) => s.credentials?.user ?? "");
  const signOut = useSession((s) => s.signOut);
  const navigate = useNavigate();
  const update = useUpdate((s) => s.apply);
  const canRequest = useCanRequest();
  const mobile = useIsMobile();

  return (
    <DM.Root modal={false}>
      <DM.Trigger asChild>
        <button
          type="button"
          className="avatar"
          style={{ width: size, height: size }}
          aria-label={translate(
            update ? "account.labelUpdate" : "account.label",
            { user },
          )}
        >
          <AvatarFace px={size} />
          {update ? <span className="update-dot" aria-hidden="true" /> : null}
        </button>
      </DM.Trigger>
      <DM.Portal>
        <DM.Content
          className="menu"
          align="end"
          sideOffset={8}
          collisionPadding={12}
        >
          <DM.Label className="menu-heading">
            {translate("account.signedInAs", { user })}
          </DM.Label>
          {update ? (
            <>
              <DM.Item className="menu-item update-item" onSelect={update}>
                <Icon name="refresh" size={18} />
                <span className="menu-label">
                  {translate("account.update")}
                  <small>{translate("account.updateHint")}</small>
                </span>
              </DM.Item>
              <DM.Separator className="menu-sep" />
            </>
          ) : null}
          <DM.Item
            className="menu-item"
            onSelect={() => void navigate("/stats")}
          >
            <Icon name="chart" size={18} />
            <span className="menu-label">
              {translate("common.yourListening")}
            </span>
          </DM.Item>
          {canRequest ? (
            <DM.Item
              className="menu-item"
              onSelect={() => void navigate("/requests")}
            >
              <Icon name="import" size={18} />
              <span className="menu-label">{translate("common.requests")}</span>
            </DM.Item>
          ) : null}
          <DM.Item
            className="menu-item"
            onSelect={() => void navigate("/downloads")}
          >
            <Icon name="download" size={18} />
            <span className="menu-label">{translate("common.downloads")}</span>
          </DM.Item>
          <DM.Item
            className="menu-item"
            onSelect={() => void navigate("/settings")}
          >
            <Icon name="settings" size={18} />
            <span className="menu-label">{translate("common.settings")}</span>
          </DM.Item>
          {!mobile ? (
            <DM.Item
              className="menu-item"
              onSelect={() => useUi.setState({ shortcutsOpen: true })}
            >
              <Icon name="keyboard" size={18} />
              <span className="menu-label">
                {translate("common.keyboardShortcuts")}
              </span>
            </DM.Item>
          ) : null}
          <DM.Item className="menu-item" onSelect={() => location.reload()}>
            <Icon name="refresh" size={18} />
            <span className="menu-label">
              {translate("common.refreshPage")}
            </span>
          </DM.Item>
          <DM.Separator className="menu-sep" />
          <DM.Item className="menu-item" onSelect={signOut}>
            <Icon name="logout" size={18} />
            <span className="menu-label">{translate("common.signOut")}</span>
          </DM.Item>
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

const SEARCH_PROXY = "search-focus-proxy";

export function SearchFocusProxy() {
  return (
    <input
      id={SEARCH_PROXY}
      className="search-proxy"
      type="text"
      tabIndex={-1}
      aria-hidden="true"
      autoComplete="off"
    />
  );
}

export function useOpenSearch() {
  const navigate = useNavigate();
  return useCallback(() => {
    document.getElementById(SEARCH_PROXY)?.focus({ preventScroll: true });
    void navigate("/search?focus=1");
  }, [navigate]);
}

function OpenSearchField() {
  const openSearch = useOpenSearch();
  return (
    <SearchField
      variant="top"
      value=""
      onChange={openSearch}
      onFocusChange={(focused) => focused && openSearch()}
      label={translate("navigation.search")}
      placeholder={translate("search.placeholder")}
    />
  );
}

export function TopBar({
  children,
  extra,
}: {
  children?: ReactNode;
  extra?: ReactNode;
}) {
  const navigate = useNavigate();
  const idx = historyIdx();
  const bar = useRef<HTMLElement>(null);
  const title = useRef<HTMLSpanElement>(null);
  const cover = useRef<HTMLSpanElement>(null);
  useScrolledTitle(bar, title, cover);
  return (
    <header ref={bar} className="topbar">
      <div className="top-left">
        <div className="hist">
          <button
            type="button"
            className="circle"
            aria-label={translate("common.goBack")}
            disabled={idx === 0}
            onClick={() => void navigate(-1)}
          >
            <Icon name="back" />
          </button>
          <button
            type="button"
            className="circle"
            aria-label={translate("common.goForward")}
            disabled={idx >= maxIdx}
            onClick={() => void navigate(1)}
          >
            <Icon name="forward" />
          </button>
        </div>
        <div className="top-title">
          <span ref={cover} className="top-cover" aria-hidden="true" hidden />
          <span ref={title} className="top-name" aria-hidden="true" />
        </div>
      </div>
      <div className="top-search">{children ?? <OpenSearchField />}</div>
      <div className="top-right">
        {extra}
        <AccountMenu />
      </div>
    </header>
  );
}
