import type { ReactNode } from "react";
import type { Settings } from "../../../state/settings.ts";
import { useSettings } from "../../../state/settings.ts";

export function SettingRow({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="set-row">
      <div>
        <b>{title}</b>
        {hint ? <span>{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}

export function SettingToggle<SettingKey extends keyof Settings>({
  settingKey,
  label,
}: {
  settingKey: SettingKey;
  label: string;
}) {
  const value = useSettings(
    (settingsState) => settingsState[settingKey],
  ) as boolean;
  const setSetting = useSettings((settingsState) => settingsState.set);

  return (
    <button
      type="button"
      className="toggle"
      role="switch"
      aria-checked={value}
      aria-label={label}
      onClick={() => setSetting(settingKey, !value as Settings[SettingKey])}
    />
  );
}
