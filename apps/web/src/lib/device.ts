import type { DeviceKind } from "@needle/shared";

const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
const touchMac = typeof navigator !== "undefined" && /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;

export const isIOS = /iPhone|iPad|iPod/.test(ua) || touchMac;
export const isAndroid = /Android/.test(ua);
export const isStandalone = typeof window !== "undefined"
  && (window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);

export function deviceKind(): DeviceKind {
  if (/iPad/.test(ua) || touchMac || (isAndroid && !/Mobile/.test(ua))) return "tablet";
  if (/iPhone|iPod/.test(ua) || (isAndroid && /Mobile/.test(ua))) return "phone";
  return "desktop";
}

export function defaultDeviceName(): string {
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua) || touchMac) return "iPad";
  if (isAndroid) return /Mobile/.test(ua) ? "Android phone" : "Android tablet";
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

export function randomId(): string {
  return crypto.getRandomValues(new Uint32Array(4)).reduce((s, n) => s + n.toString(36), "");
}
