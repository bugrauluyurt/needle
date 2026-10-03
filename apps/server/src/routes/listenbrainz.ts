import { ApiErrorCode, trackCandidate, type DiscoveryTrack } from "@needle/shared";
import { z } from "zod";
import type { Authorization } from "../http/authorization.ts";
import type { App } from "../http/context.ts";
import { appError } from "../http/errors.ts";
import { validate } from "../http/validation.ts";
import type { ListenBrainz } from "../listenbrainz.ts";
import type { Navidrome } from "../navidrome.ts";

const MISSING_SONGS_LIMIT = 50;
const requestPermissionMessage = "Ask an admin to let you request music";
const passwordSchema = z
  .string()
  .max(1024)
  .transform((password) => (password.length ? password : undefined))
  .optional();
const connectBodySchema = z
  .object({
    token: z.string().trim().min(1).max(200),
    password: passwordSchema,
  })
  .strict();
const disconnectBodySchema = z.object({ password: passwordSchema }).strict();
const playlistParamsSchema = z.object({
  mbid: z
    .string()
    .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    .transform((mbid) => mbid.toLowerCase()),
});

type ListenBrainzRouteDependencies = {
  authorization: Authorization;
  listenbrainz: ListenBrainz;
  navidrome: Navidrome;
};

export function registerListenBrainzRoutes(
  app: App,
  { authorization, listenbrainz, navidrome }: ListenBrainzRouteDependencies,
) {
  app.put("/api/listenbrainz", validate("json", connectBodySchema), async (context) => {
    const body = context.req.valid("json");

    return context.json(await listenbrainz.connect(context.get("auth"), body.token, body.password));
  });

  app.delete("/api/listenbrainz", validate("json", disconnectBodySchema), async (context) => {
    const body = context.req.valid("json");

    return context.json(await listenbrainz.disconnect(context.get("auth"), body.password));
  });

  app.get("/api/listenbrainz/playlists", async (context) => {
    return context.json(await listenbrainz.playlists(context.get("auth")));
  });

  app.get("/api/listenbrainz/playlists/:mbid", validate("param", playlistParamsSchema), async (context) => {
    return context.json(await listenbrainz.playlist(context.get("auth"), context.req.valid("param").mbid));
  });

  app.post(
    "/api/listenbrainz/playlists/:mbid/missing",
    authorization.requireSongs,
    authorization.requirePermission("request", requestPermissionMessage),
    validate("param", playlistParamsSchema),
    async (context) => {
      const auth = context.get("auth");
      const playlist = await listenbrainz.playlist(auth, context.req.valid("param").mbid);
      const missingTracks = playlist.tracks.filter(isWantedTrack).slice(0, MISSING_SONGS_LIMIT);

      for (const missingTrack of missingTracks) {
        context.get("songs").start(auth, trackCandidate(missingTrack));
      }

      return context.json({
        started: missingTracks.length,
        skipped: playlist.tracks.filter((playlistTrack) => !playlistTrack.song).length - missingTracks.length,
      });
    },
  );

  app.post("/api/listenbrainz/playlists/:mbid/save", validate("param", playlistParamsSchema), async (context) => {
    const auth = context.get("auth");
    const playlist = await listenbrainz.playlist(auth, context.req.valid("param").mbid);
    const songIds = playlist.tracks.flatMap((playlistTrack) => (playlistTrack.song ? [playlistTrack.song.id] : []));

    if (!songIds.length) {
      throw appError(409, ApiErrorCode.CONFLICT, "None of these songs are in your library yet");
    }

    const name = playlist.date ? `${playlist.name}, ${playlist.date.slice(0, 10)}` : playlist.name;
    const playlistId = await navidrome.upsertPlaylist(auth, name, songIds);

    return context.json({
      playlistId,
      matched: songIds.length,
      total: playlist.total,
    });
  });
}

function isWantedTrack(playlistTrack: DiscoveryTrack) {
  return !playlistTrack.song && (!playlistTrack.request || playlistTrack.request.state === "failed");
}
