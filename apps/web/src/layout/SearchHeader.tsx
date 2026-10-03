import { useState } from "react";
import type { ReactNode } from "react";
import { useLocation, useSearchParams } from "react-router";
import { SearchField } from "../components/SearchField.tsx";
import { MobileHeader } from "./Mobile.tsx";
import { useIsMobile } from "./Shell.tsx";
import { TopBar } from "./TopBar.tsx";

type Props = {
  title: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  onCommit?: () => void;
  busy?: boolean;
  autoFocus?: boolean;
  actions?: ReactNode;
};

export function SearchHeader({
  title,
  label,
  placeholder,
  value,
  onChange,
  onCommit,
  busy = false,
  autoFocus = false,
  actions,
}: Props) {
  const mobile = useIsMobile();
  const [focused, setFocused] = useState(false);
  const [params] = useSearchParams();
  const { key } = useLocation();
  const wanted = autoFocus && params.has("focus");
  const field = (
    <SearchField
      variant={mobile ? "page" : "top"}
      value={value}
      onChange={onChange}
      onFocusChange={setFocused}
      autoFocus={autoFocus && (!mobile || wanted)}
      focusKey={wanted ? key : undefined}
      busy={busy}
      label={label}
      placeholder={placeholder}
      {...(onCommit ? { onCommit } : {})}
    />
  );
  if (!mobile) return <TopBar>{field}</TopBar>;
  return (
    <>
      <MobileHeader title={title} {...(actions ? { actions } : {})} />
      <div className="psearch-wrap">
        <div className={focused ? "psearch-row focused" : "psearch-row"}>
          {field}
          <button
            type="button"
            className="psearch-cancel"
            tabIndex={focused ? 0 : -1}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => {
              onChange("");
              (document.activeElement as HTMLElement | null)?.blur();
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </>
  );
}
