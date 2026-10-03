import type { ConnectionCheck } from "@needle/shared";

export function browserChecks(publicUrl: string | null, origin: string, secure: boolean): ConnectionCheck[] {
  const https: ConnectionCheck = secure
    ? { id: "https", label: "Secure address", state: "ok", detail: `Opened at ${origin}` }
    : {
        id: "https",
        label: "Secure address",
        state: "warn",
        detail: `Opened at ${origin}, without HTTPS`,
        fix: "Offline downloads, Spotify and installing the app need an https:// address. Put Needle behind Tailscale Serve, Caddy or another reverse proxy.",
      };
  const address: ConnectionCheck = !publicUrl
    ? {
        id: "public-url",
        label: "Public address",
        state: "off",
        detail: "PUBLIC_URL isn't set",
        fix: "Only Spotify sign-in needs it: set PUBLIC_URL to the address people open.",
      }
    : publicUrl === origin
      ? { id: "public-url", label: "Public address", state: "ok", detail: publicUrl }
      : {
          id: "public-url",
          label: "Public address",
          state: "warn",
          detail: `PUBLIC_URL is ${publicUrl}, but this page is ${origin}`,
          fix: "Set PUBLIC_URL to the address people open, or Spotify sign-in returns to the wrong place.",
        };
  return [https, address];
}
