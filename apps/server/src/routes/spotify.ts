import type { ImportedTrack } from "@needle/shared";
import { z } from "zod";
import type { Authorization } from "../http/authorization.ts";
import type { App } from "../http/context.ts";
import { validate } from "../http/validation.ts";
import type { Spotify } from "../spotify.ts";
import type { RecordAlbum } from "./requests.ts";

const MISSING_ALBUMS_LIMIT = 25;
const spotifyPermissionMessage = "Ask an admin to let you use Spotify in Needle";
const requestPermissionMessage = "Ask an admin to let you request music";
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
  app.get("/api/spotify/callback", validate("query", spotifyCallbackQuerySchema), async (context) => {
    const { code, state } = context.req.valid("query");

    if (!spotify || !code || !state) return context.redirect("/settings?spotify=error");

    try {
      await spotify.complete(code, state);

      return context.redirect("/settings?spotify=connected");
    } catch {
      return context.redirect("/settings?spotify=error");
    }
  });
}

export function registerSpotifyRoutes(app: App, { authorization, recordAlbum }: SpotifyRouteDependencies) {
  const requireSpotifyPermission = authorization.requirePermission("spotify", spotifyPermissionMessage);

  app.get("/api/spotify/login", authorization.requireSpotify, requireSpotifyPermission, (context) =>
    context.json({
      url: context.get("spotify").authorizeUrl(context.get("auth").user),
    }),
  );

  app.delete("/api/spotify", authorization.requireSpotify, requireSpotifyPermission, (context) => {
    context.get("spotify").disconnect(context.get("auth").user);

    return context.body(null, 204);
  });

  app.put(
    "/api/spotify/enabled",
    authorization.requireSpotify,
    requireSpotifyPermission,
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
    validate("json", importBodySchema),
    async (context) => {
      return context.json(await context.get("spotify").import(context.get("auth"), context.req.valid("json").source));
    },
  );

  app.post(
    "/api/spotify/missing",
    authorization.requireLidarr,
    authorization.requirePermission("request", requestPermissionMessage),
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
