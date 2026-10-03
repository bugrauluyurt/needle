import { translate } from "../i18n/index.ts";

const PATHS = {
  home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm10 17-5.2-5.2",
  library: "M4 4v16M9 4v16M14 5l5.5 15",
  music: "M9 18V5l11-2v13M9 5v5l11-2M9 18a3 3 0 1 1-3-3h3M20 16a3 3 0 1 1-3-3h3",
  play: "M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z",
  pause: "M6 4h4v16H6zM14 4h4v16h-4z",
  next: "M5 5.5v13a1 1 0 0 0 1.6.8L15 13v5h3V6h-3v5L6.6 4.7A1 1 0 0 0 5 5.5z",
  prev: "M19 5.5v13a1 1 0 0 1-1.6.8L9 13v5H6V6h3v5l8.4-6.3a1 1 0 0 1 1.6.8z",
  shuffle: "M16 4h4v4M4 20 20 4M20 16v4h-4M14.5 14.5 20 20M4 4l5 5",
  repeat: "M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4",
  repeatOne: "M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4M11 10l1.5-1v6",
  heart: "M20.4 5.6a5 5 0 0 0-7.1 0L12 6.9l-1.3-1.3a5 5 0 1 0-7.1 7.1L12 21l8.4-8.3a5 5 0 0 0 0-7.1z",
  heartFill: "M20.4 5.6a5 5 0 0 0-7.1 0L12 6.9l-1.3-1.3a5 5 0 1 0-7.1 7.1L12 21l8.4-8.3a5 5 0 0 0 0-7.1z",
  download: "M12 4v11m-4.5-4.5L12 15l4.5-4.5M5 20h14",
  downloaded: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 5v7.5M8.8 11.3 12 14.5l3.2-3.2",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  plus: "M12 5v14M5 12h14",
  queue: "M3 6h14M3 12h14M3 18h8M16 15v6l5-3z",
  mic: "M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM18.5 10.5a6.5 6.5 0 0 1-13 0M12 17v4",
  devices: "M3 5h12v9H3zM7 18h4M17 8h4v12h-4z",
  volume: "M11 5 6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13",
  volumeLow: "M11 5 6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7",
  mute: "M11 5 6 9H3v6h3l5 4zM16 9l6 6M22 9l-6 6",
  expand: "M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 4.5V12l3 2",
  check: "M5 12.5l4.5 4.5L19 7.5",
  back: "M15 18l-6-6 6-6",
  forward: "M9 18l6-6-6-6",
  down: "M6 9l6 6 6-6",
  arrow: "M12 5v14M6.5 13.5 12 19l5.5-5.5",
  radio: "M4 9h16v11H4zM8 9l9-5M8 13.5a2 2 0 1 0 0 3.01M14 13h3M14 16h3",
  chart: "M5 20v-7M11 20V5M17 20v-10M3 20h18",
  settings: "M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1M15 5v4M9 10v4M17 15v4",
  close: "M6 6l12 12M18 6 6 18",
  grip: "M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01",
  list: "M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  gridDense:
    "M4 4h3.5v3.5H4zM10.25 4h3.5v3.5h-3.5zM16.5 4H20v3.5h-3.5zM4 10.25h3.5v3.5H4zM10.25 10.25h3.5v3.5h-3.5zM16.5 10.25H20v3.5h-3.5zM4 16.5h3.5V20H4zM10.25 16.5h3.5V20h-3.5zM16.5 16.5H20V20h-3.5z",
  rows: "M4 6h16M4 12h16M4 18h16",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 21a7.5 7.5 0 0 1 15 0",
  share: "M12 3v12M8 7l4-4 4 4M5 12v8h14v-8",
  keyboard: "M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10",
  pencil: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4",
  addToQueue: "M3 6h12M3 12h12M3 18h7M17 14v6M14 17h6",
  playNext: "M3 6h12M3 12h7M3 18h7M14 12l6 3.5-6 3.5z",
  album: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 6.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z",
  info: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5M12 7.5h.01",
  wifiOff:
    "M2 8.5a15 15 0 0 1 5-3M22 8.5a15 15 0 0 0-10-4M5.5 12a10 10 0 0 1 3.4-2.1M18.5 12a10 10 0 0 0-2.5-1.7M9 15.5a5 5 0 0 1 6 0M12 19h.01M3 3l18 18",
  refresh: "M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  sort: "M3 6h18M6 12h12M10 18h4",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  logout: "M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10",
  signal: "M4 19v-3M9 19v-6M14 19v-9M19 19V6",
  import: "M12 3v12M7.5 10.5 12 15l4.5-4.5M4 15v5h16v-5",
  waves:
    "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM7 9.6c3.4-1 7.3-.6 10 1.1M7.6 12.8c2.9-.8 6-.4 8.3 1M8.2 15.9c2.3-.6 4.7-.3 6.5.8",
} as const;

export type IconName = keyof typeof PATHS;

const FILLED = new Set<IconName>(["play", "pause", "next", "prev", "heartFill"]);
const HEAVY = new Set<IconName>(["more", "grip"]);

export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  const filled = FILLED.has(name);
  return (
    <svg
      className={className ? `i ${className}` : "i"}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill={filled ? "currentColor" : "none"}
      stroke={filled ? undefined : "currentColor"}
      strokeWidth={filled ? undefined : HEAVY.has(name) ? 3 : 1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true">
      <circle cx="256" cy="256" r="214" fill="#2F2B38" />
      <circle cx="256" cy="256" r="153" fill="none" stroke="#F3EFE8" strokeOpacity=".2" strokeWidth="16" />
      <circle cx="256" cy="256" r="99" fill="none" stroke="#F3EFE8" strokeOpacity=".12" strokeWidth="16" />
      <circle cx="256" cy="256" r="54" fill="#F6B23C" />
      <path d="M440 72 344 184" stroke="#F3EFE8" strokeWidth="38" strokeLinecap="round" />
      <circle cx="440" cy="72" r="38" fill="#F3EFE8" />
    </svg>
  );
}

export function Eq({ paused = false }: { paused?: boolean }) {
  return (
    <span
      className={paused ? "eq paused" : "eq"}
      aria-label={translate(paused ? "devices.paused" : "devices.playing")}
      role="img"
    >
      <i />
      <i />
      <i />
    </span>
  );
}
