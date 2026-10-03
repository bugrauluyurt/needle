import type { ImportedTrack } from "@needle/shared";
import type { Authorization } from "../http/authorization.ts";
import type { App } from "../http/context.ts";
import type { Spotify } from "../spotify.ts";
import type { RecordAlbum } from "./requests.ts";

const MISSING_ALBUMS_LIMIT = 25;

type SpotifyCallbackDependencies = {
  spotify: Spotify | null;
};

type SpotifyRouteDependencies = {
  authorization: Authorization;
  recordAlbum: RecordAlbum;
};

export function registerSpotifyCallbackRoute(app: App, { spotify }: SpotifyCallbackDependencies) {
  app.get("/api/spotify/callback", async (context) => {
    const code = context.req.query("code");
    const state = context.req.query("state");

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
  app.get("/api/spotify/login", async (context) => {
    const spotifyAccess = await authorization.getSpotifyAccess(context);

    return spotifyAccess.error ?? context.json({ url: spotifyAccess.spotify.authorizeUrl(context.get("auth").user) });
  });

  app.delete("/api/spotify", async (context) => {
    const spotifyAccess = await authorization.getSpotifyAccess(context);

    if (spotifyAccess.error) return spotifyAccess.error;

    spotifyAccess.spotify.disconnect(context.get("auth").user);

    return context.body(null, 204);
  });

  app.put("/api/spotify/enabled", async (context) => {
    const spotifyAccess = await authorization.getSpotifyAccess(context);

    if (spotifyAccess.error) return spotifyAccess.error;

    const body = await context.req.json<{ on: boolean }>();

    spotifyAccess.spotify.setEnabled(context.get("auth").user, body.on);

    return context.body(null, 204);
  });

  app.get("/api/spotify/token", async (context) => {
    const spotifyAccess = await authorization.getSpotifyAccess(context);

    return spotifyAccess.error ?? context.json(await spotifyAccess.spotify.token(context.get("auth").user));
  });

  app.get("/api/spotify/playlists", async (context) => {
    const spotifyAccess = await authorization.getSpotifyAccess(context);

    return spotifyAccess.error ?? context.json(await spotifyAccess.spotify.playlists(context.get("auth").user));
  });

  app.post("/api/spotify/import", async (context) => {
    const spotifyAccess = await authorization.getSpotifyAccess(context);

    if (spotifyAccess.error) return spotifyAccess.error;

    const body = await context.req.json<{ source: string }>();

    return context.json(await spotifyAccess.spotify.import(context.get("auth"), body.source));
  });

  app.post("/api/spotify/missing", async (context) => {
    const lidarrAccess = await authorization.getLidarrAccess(context);

    if (lidarrAccess.error) return lidarrAccess.error;

    const body = await context.req.json<{ tracks: ImportedTrack[] }>();
    const uniqueTracks = [...new Map(body.tracks.map((track) => [`${track.artist}\0${track.album}`, track])).values()];
    const missingAlbums = uniqueTracks.slice(0, MISSING_ALBUMS_LIMIT);
    let requestedAlbums = 0;

    for (const missingAlbum of missingAlbums) {
      const [matchingAlbum] = await lidarrAccess.lidarr.searchAlbums(`${missingAlbum.artist} ${missingAlbum.album}`);

      if (!matchingAlbum) continue;

      const album = await lidarrAccess.lidarr.getAlbum(matchingAlbum.foreignAlbumId);

      recordAlbum(context.get("auth").user, album);
      requestedAlbums++;
    }

    return context.json({
      requested: requestedAlbums,
      notFound: missingAlbums.length - requestedAlbums,
      skipped: uniqueTracks.length - missingAlbums.length,
    });
  });
}
