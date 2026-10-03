import { Link } from "react-router";
import { Icon } from "../components/Icon.tsx";
import type { IconName } from "../components/Icon.tsx";
import { isIOS, isStandalone } from "../lib/device.ts";
import { MobileHeader } from "../layout/Mobile.tsx";
import { usePageTone } from "../layout/pageTone.ts";
import { AvatarFace } from "../layout/TopBar.tsx";
import { useSession } from "../state/session.ts";
import { InstallHint } from "../components/InstallHint.tsx";
import { useCanRequest } from "../queries/hooks.ts";
import { translate } from "../i18n/index.ts";
import type { TranslationKey } from "../i18n/locales/en.ts";

const LINKS: [string, IconName, TranslationKey, TranslationKey][] = [
  ["/stats", "chart", "common.yourListening", "you.listeningHint"],
  ["/downloads", "download", "common.downloads", "you.downloadsHint"],
  ["/requests", "import", "common.requests", "you.requestsHint"],
  ["/radio", "radio", "navigation.radio", "you.radioHint"],
  ["/settings", "settings", "common.settings", "you.settingsHint"],
];

export default function YouPage() {
  const user = useSession((s) => s.credentials?.user ?? "");
  const device = useSession((s) => s.deviceName);
  const signOut = useSession((s) => s.signOut);
  const canRequest = useCanRequest();
  usePageTone(null);
  return (
    <>
      <MobileHeader title={translate("navigation.you")} />
      <div className="pad you">
        <div className="you-card">
          <span className="avatar big">
            <AvatarFace px={64} />
          </span>
          <div>
            <b>{user}</b>
            <span>{translate("you.listeningOn", { device })}</span>
          </div>
        </div>
        {isIOS && !isStandalone ? <InstallHint inline /> : null}
        <ul className="you-links">
          {LINKS.filter(([to]) => to !== "/requests" || canRequest).map(([to, icon, titleKey, subtitleKey]) => (
            <li key={to}>
              <Link to={to}>
                <Icon name={icon} size={22} />
                <div>
                  <b>{translate(titleKey)}</b>
                  <span>{translate(subtitleKey)}</span>
                </div>
                <Icon name="forward" size={18} />
              </Link>
            </li>
          ))}
        </ul>
        <button type="button" className="btn ghost you-out" onClick={signOut}>
          {translate("common.signOut")}
        </button>
      </div>
    </>
  );
}
