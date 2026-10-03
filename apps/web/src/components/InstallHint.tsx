import { useState } from "react";
import { Icon } from "./Icon.tsx";
import { translate } from "../i18n/index.ts";

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
      <h3>{translate("install.heading")}</h3>
      <p>{translate("install.hint")}</p>
      <ol>
        <li>
          <Icon name="share" size={18} /> {translate("install.share")}
        </li>
        <li>{translate("install.choose")}</li>
        <li>{translate("install.add")}</li>
      </ol>
    </>
  );
  if (inline) return <div className="install-inline">{body}</div>;
  return (
    <>
      <div className="dim-bg" onClick={close} aria-hidden="true" />
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={translate("install.heading")}
      >
        <div className="grab" />
        {body}
        <button type="button" className="btn light" onClick={close}>
          {translate("install.gotIt")}
        </button>
      </div>
    </>
  );
}
