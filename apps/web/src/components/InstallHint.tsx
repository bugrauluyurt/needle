import { useState } from "react";
import { Icon } from "./Icon.tsx";

const KEY = "needle.installHintSeen";

function seen(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function InstallHint({ inline = false }: { inline?: boolean }) {
  const [open, setOpen] = useState(() => inline || !seen());
  if (!open) return null;
  const close = () => {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      return setOpen(false);
    }
    setOpen(false);
  };
  const body = (
    <>
      <h3>Put Needle on your home screen</h3>
      <p>It opens full screen like an app, keeps playing when the phone locks, and keeps your downloads.</p>
      <ol>
        <li>
          Tap <Icon name="share" size={18} /> Share in Safari’s toolbar
        </li>
        <li>Choose Add to Home Screen</li>
        <li>Tap Add</li>
      </ol>
    </>
  );
  if (inline) return <div className="install-inline">{body}</div>;
  return (
    <>
      <div className="dim-bg" onClick={close} aria-hidden="true" />
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Put Needle on your home screen">
        <div className="grab" />
        {body}
        <button type="button" className="btn light" onClick={close}>
          Got it
        </button>
      </div>
    </>
  );
}
