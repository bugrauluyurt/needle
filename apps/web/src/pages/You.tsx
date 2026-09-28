import { Link } from "react-router";
import { Icon } from "../components/Icon.tsx";
import type { IconName } from "../components/Icon.tsx";
import { isIOS, isStandalone } from "../lib/device.ts";
import { MobileHeader } from "../layout/Mobile.tsx";
import { usePageTone } from "../layout/Shell.tsx";
import { AvatarFace } from "../layout/TopBar.tsx";
import { useSession } from "../state/session.ts";
import { InstallHint } from "../components/InstallHint.tsx";
import { useCanRequest } from "../queries/hooks.ts";

const LINKS: [string, IconName, string, string][] = [
  ["/stats", "chart", "Your listening", "Hours, top artists and when you listen"],
  ["/downloads", "download", "Downloads", "Music kept on this phone"],
  ["/requests", "import", "Requests", "Albums and songs you asked for, with progress"],
  ["/radio", "radio", "Radio", "Song, artist and internet radio"],
  ["/settings", "settings", "Settings", "Playback, quality and your server"],
];

export default function YouPage() {
  const user = useSession((s) => s.credentials?.user ?? "");
  const device = useSession((s) => s.deviceName);
  const signOut = useSession((s) => s.signOut);
  const canRequest = useCanRequest();
  usePageTone(null);
  return (
    <>
      <MobileHeader title="You" />
      <div className="pad you">
        <div className="you-card">
          <span className="avatar big"><AvatarFace px={64} /></span>
          <div>
            <b>{user}</b>
            <span>Listening on {device}</span>
          </div>
        </div>
        {isIOS && !isStandalone ? <InstallHint inline /> : null}
        <ul className="you-links">
          {LINKS.filter(([to]) => to !== "/requests" || canRequest).map(([to, icon, title, sub]) => (
            <li key={to}>
              <Link to={to}>
                <Icon name={icon} size={22} />
                <div>
                  <b>{title}</b>
                  <span>{sub}</span>
                </div>
                <Icon name="forward" size={18} />
              </Link>
            </li>
          ))}
        </ul>
        <button type="button" className="btn ghost you-out" onClick={signOut}>Sign out</button>
      </div>
    </>
  );
}
