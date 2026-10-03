import type { ImportedTrack } from "@needle/shared";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { CookieOptions } from "hono/utils/cookie";
import { z } from "zod";
import type { Authorization } from "../http/authorization.ts";
import type { App } from "../http/context.ts";
import { getRequestBodyLimit, jsonBodyLimit, validate } from "../http/validation.ts";
import type { Spotify } from "../spotify.ts";
import type { RecordAlbum } from "./requests.ts";

const MISSING_ALBUMS_LIMIT = 25;
const MISSING_TRACKS_BODY_MAX_BYTES = 64 * 1024 * 1024;
const spotifyPermissionMessage = "Ask an admin to let you use Spotify in Needle";
const requestPermissionMessage = "Ask an admin to let you request music";
export const SPOTIFY_OAUTH_STATE_COOKIE = "needle_spotify_oauth_state";
const SPOTIFY_CALLBACK_PATH = "/api/spotify/callback";
const spotifyCallbackQuerySchema = z.object({
  code: z.string().min(1).max(4096).optional(),
  state: z.string().min(1).max(4096).optional(),
});
const toggleBodySchema = z.object({ on: z.boolean() }).strict();
const importBodySchema = z.object({ source: z.string().min(1).max(200) }).strict();
const importedTrackSchema = z.object({
  title: z.string().min(1).max(1000),
  artist: z.string().max(1000),
  album: z.string().max(1000),
});
const missingBodySchema = z.object({ tracks: z.array(importedTrackSchema).max(5000) }).strict();

type SpotifyCallbackDependencies = {
  spotify: Spotify | null;
};

type SpotifyRouteDependencies = {
  authorization: Authorization;
  recordAlbum: RecordAlbum;
};

export function registerSpotifyCallbackRoute(app: App, { spotify }: SpotifyCallbackDependencies) {
  app.get(SPOTIFY_CALLBACK_PATH, async (context) => {
    const callbackQuery = spotifyCallbackQuerySchema.safeParse(context.req.query());
    const cookieState = getCookie(context, SPOTIFY_OAUTH_STATE_COOKIE);
    let redirectLocation = "/settings?spotify=error";

    try {
      if (spotify && callbackQuery.success) {
        const { code, state } = callbackQuery.data;

        if (code && state && state === cookieState) {
          await spotify.complete(code, state);

          redirectLocation = "/settings?spotify=connected";
        }
      }
    } catch {
      redirectLocation = "/settings?spotify=error";
    } finally {
      deleteCookie(
        context,
        SPOTIFY_OAUTH_STATE_COOKIE,
        getSpotifyStateCookieOptions({ secure: spotify?.usesSecureCallbackCookie() ?? false }),
      );
    }

    return context.redirect(redirectLocation);
  });
}

export function registerSpotifyRoutes(app: App, { authorization, recordAlbum }: SpotifyRouteDependencies) {
  const requireSpotifyPermission = authorization.requirePermission("spotify", spotifyPermissionMessage);

  app.get("/api/spotify/login", authorization.requireSpotify, requireSpotifyPermission, (context) => {
    const spotifyAuthorization = context.get("spotify").getAuthorization(context.get("auth").user);

    setCookie(
      context,
      SPOTIFY_OAUTH_STATE_COOKIE,
      spotifyAuthorization.state,
      getSpotifyStateCookieOptions({
        maxAge: spotifyAuthorization.maxAgeSeconds,
        secure: spotifyAuthorization.secure,
      }),
    );

    return context.json({ url: spotifyAuthorization.url });
  });

  app.delete("/api/spotify", authorization.requireSpotify, requireSpotifyPermission, (context) => {
    context.get("spotify").disconnect(context.get("auth").user);

    return context.body(null, 204);
  });

  app.put(
    "/api/spotify/enabled",
    authorization.requireSpotify,
    requireSpotifyPermission,
    jsonBodyLimit,
    validate("json", toggleBodySchema),
    (context) => {
      context.get("spotify").setEnabled(context.get("auth").user, context.req.valid("json").on);

      return context.body(null, 204);
    },
  );

  app.get("/api/spotify/token", authorization.requireSpotify, requireSpotifyPermission, async (context) =>
    context.json(await context.get("spotify").token(context.get("auth").user)),
  );

  app.get("/api/spotify/playlists", authorization.requireSpotify, requireSpotifyPermission, async (context) =>
    context.json(await context.get("spotify").playlists(context.get("auth").user)),
  );

  app.post(
    "/api/spotify/import",
    authorization.requireSpotify,
    requireSpotifyPermission,
    jsonBodyLimit,
    validate("json", importBodySchema),
    async (context) => {
      return context.json(await context.get("spotify").import(context.get("auth"), context.req.valid("json").source));
    },
  );

  app.post(
    "/api/spotify/missing",
    authorization.requireLidarr,
    authorization.requirePermission("request", requestPermissionMessage),
    getRequestBodyLimit({ maxBytes: MISSING_TRACKS_BODY_MAX_BYTES }),
    validate("json", missingBodySchema),
    async (context) => {
      const tracks = context.req.valid("json").tracks satisfies ImportedTrack[];
      const uniqueTracks = [...new Map(tracks.map((track) => [`${track.artist}\0${track.album}`, track])).values()];
      const missingAlbums = uniqueTracks.slice(0, MISSING_ALBUMS_LIMIT);
      let requestedAlbums = 0;

      for (const missingAlbum of missingAlbums) {
        const [matchingAlbum] = await context
          .get("lidarr")
          .searchAlbums(`${missingAlbum.artist} ${missingAlbum.album}`);

        if (!matchingAlbum) continue;

        const album = await context.get("lidarr").getAlbum(matchingAlbum.foreignAlbumId);

        recordAlbum(context.get("auth").user, album);
        requestedAlbums++;
      }

      return context.json({
        requested: requestedAlbums,
        notFound: missingAlbums.length - requestedAlbums,
        skipped: uniqueTracks.length - missingAlbums.length,
      });
    },
  );
}

function getSpotifyStateCookieOptions({ secure, maxAge }: { secure: boolean; maxAge?: number }): CookieOptions {
  return {
    httpOnly: true,
    path: SPOTIFY_CALLBACK_PATH,
    sameSite: "Lax",
    secure,
    ...(maxAge === undefined ? {} : { maxAge }),
  };
}
