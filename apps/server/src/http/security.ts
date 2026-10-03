import { secureHeaders } from "hono/secure-headers";
import type { App } from "./context.ts";

export function registerSecurityHeaders(app: App): void {
  app.use(
    "*",
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        connectSrc: [
          "'self'",
          "https://api.spotify.com",
          "https://*.spotify.com",
          "https://*.spotifycdn.com",
          "https://*.scdn.co",
          "wss://*.spotify.com",
        ],
        fontSrc: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        frameSrc: ["https://sdk.scdn.co", "https://*.spotify.com"],
        imgSrc: ["'self'", "data:", "blob:", "https:"],
        manifestSrc: ["'self'"],
        mediaSrc: ["'self'", "blob:", "https://*.spotify.com", "https://*.spotifycdn.com", "https://*.scdn.co"],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'", "https://sdk.scdn.co"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        workerSrc: ["'self'", "blob:"],
      },
      crossOriginOpenerPolicy: false,
      permissionsPolicy: {
        camera: false,
        geolocation: false,
        microphone: false,
      },
      xFrameOptions: "DENY",
    }),
  );
}
