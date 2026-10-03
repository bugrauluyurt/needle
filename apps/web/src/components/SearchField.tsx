import { useEffect, useRef, useState } from "react";
import { useIsMobile } from "../lib/media.ts";
import { Icon } from "./Icon.tsx";
import { translate } from "../i18n/index.ts";

type Props = {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  variant: "top" | "page" | "inline";
  collapsible?: boolean;
  autoFocus?: boolean;
  focusKey?: string | undefined;
  busy?: boolean;
  onCommit?: () => void;
  onFocusChange?: (focused: boolean) => void;
  className?: string;
};

export function SearchField({
  value,
  onChange,
  label,
  placeholder = label,
  variant,
  collapsible = false,
  autoFocus = false,
  focusKey,
  busy = false,
  onCommit,
  onFocusChange,
  className,
}: Props) {
  const mobile = useIsMobile();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (focusKey) input.current?.focus();
  }, [focusKey]);
  const expanded = !collapsible || open || Boolean(value);
  const cls = [
    "sf",
    `sf-${variant}`,
    collapsible ? "collapsible" : "",
    expanded ? "open" : "",
    value ? "has-value" : "",
    busy ? "busy" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={cls}>
      {collapsible ? (
        <button
          type="button"
          className="sf-icon"
          aria-label={label}
          aria-hidden={expanded}
          tabIndex={expanded ? -1 : 0}
          onClick={() => {
            setOpen(true);
            input.current?.focus();
          }}
        >
          <Icon name="search" size={17} />
        </button>
      ) : (
        <span className="sf-icon">
          <Icon name="search" size={variant === "inline" ? 17 : 20} />
        </span>
      )}
      <input
        ref={input}
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={label}
        enterKeyHint="search"
        autoComplete="off"
        spellCheck={false}
        tabIndex={expanded ? 0 : -1}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => onFocusChange?.(true)}
        onBlur={() => {
          onFocusChange?.(false);
          if (!value) setOpen(false);
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
          if (e.key === "Enter") {
            e.preventDefault();
            onCommit?.();
            if (mobile) input.current?.blur();
            return;
          }
          if (e.key !== "Escape") return;
          e.stopPropagation();
          if (value) onChange("");
          else input.current?.blur();
        }}
      />
      <button
        type="button"
        className="sf-clear"
        aria-label={translate("search.clear")}
        aria-hidden={!value}
        tabIndex={value ? 0 : -1}
        onClick={() => {
          onChange("");
          input.current?.focus();
        }}
      >
        <Icon name="close" size={variant === "inline" ? 15 : 18} />
      </button>
      <span className="sf-busy" aria-hidden="true" />
    </div>
  );
}
