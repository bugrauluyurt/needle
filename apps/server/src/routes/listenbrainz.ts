import type { DiscoveryTrack } from "@needle/shared";
import { trackCandidate } from "@needle/shared";
import type { Authorization } from "../http/authorization.ts";
import type { App, AppContext } from "../http/context.ts";
import type { ListenBrainz } from "../listenbrainz.ts";
import type { Navidrome } from "../navidrome.ts";

const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_MAX = 200;
const PASSWORD_MAX = 1024;
const MISSING_SONGS_LIMIT = 50;

type ListenBrainzBody = {
  password?: unknown;
  token?: unknown;
};

type ListenBrainzRouteDependencies = {
  authorization: Authorization;
  listenbrainz: ListenBrainz;
  navidrome: Navidrome;
};

export function registerListenBrainzRoutes(
  app: App,
  { authorization, listenbrainz, navidrome }: ListenBrainzRouteDependencies,
) {
  app.put("/api/listenbrainz", async (context) => {
    const body = await getListenBrainzBody(context);
    const token = typeof body.token === "string" ? body.token.trim() : "";

    if (!token || token.length > TOKEN_MAX) {
      return context.json({ error: "Paste your ListenBrainz user token" }, 400);
    }

    return context.json(await listenbrainz.connect(context.get("auth"), token, getPassword(body)));
  });

  app.delete("/api/listenbrainz", async (context) => {
    const body = await getListenBrainzBody(context);

    return context.json(await listenbrainz.disconnect(context.get("auth"), getPassword(body)));
  });

  app.get("/api/listenbrainz/playlists", async (context) => {
    return context.json(await listenbrainz.playlists(context.get("auth")));
  });

  app.get("/api/listenbrainz/playlists/:mbid", async (context) => {
    const mbid = getPlaylistMbid(context);

    return mbid ? context.json(await listenbrainz.playlist(context.get("auth"), mbid)) : noPlaylistResponse(context);
  });

  app.post("/api/listenbrainz/playlists/:mbid/missing", async (context) => {
    const songAccess = await authorization.getSongAccess(context);

    if (songAccess.error) return songAccess.error;

    const mbid = getPlaylistMbid(context);

    if (!mbid) return noPlaylistResponse(context);

    const auth = context.get("auth");
    const playlist = await listenbrainz.playlist(auth, mbid);
    const missingTracks = playlist.tracks.filter(isWantedTrack).slice(0, MISSING_SONGS_LIMIT);

    for (const missingTrack of missingTracks) {
      songAccess.songs.start(auth, trackCandidate(missingTrack));
    }

    return context.json({
      started: missingTracks.length,
      skipped: playlist.tracks.filter((playlistTrack) => !playlistTrack.song).length - missingTracks.length,
    });
  });

  app.post("/api/listenbrainz/playlists/:mbid/save", async (context) => {
    const mbid = getPlaylistMbid(context);

    if (!mbid) return noPlaylistResponse(context);

    const auth = context.get("auth");
    const playlist = await listenbrainz.playlist(auth, mbid);
    const songIds = playlist.tracks.flatMap((playlistTrack) => (playlistTrack.song ? [playlistTrack.song.id] : []));

    if (!songIds.length) return context.json({ error: "None of these songs are in your library yet" }, 409);

    const name = playlist.date ? `${playlist.name}, ${playlist.date.slice(0, 10)}` : playlist.name;
    const playlistId = await navidrome.upsertPlaylist(auth, name, songIds);

    return context.json({ playlistId, matched: songIds.length, total: playlist.total });
  });
}

function getListenBrainzBody(context: AppContext) {
  return context.req
    .json<ListenBrainzBody>()
    .catch((): ListenBrainzBody => ({ token: undefined, password: undefined }));
}

function getPlaylistMbid(context: AppContext) {
  const mbid = context.req.param("mbid") ?? "";

  return MBID.test(mbid) ? mbid.toLowerCase() : null;
}

function noPlaylistResponse(context: AppContext) {
  return context.json({ error: "No such ListenBrainz playlist" }, 404);
}

function getPassword(body: ListenBrainzBody) {
  return typeof body.password === "string" && body.password && body.password.length <= PASSWORD_MAX
    ? body.password
    : undefined;
}

function isWantedTrack(playlistTrack: DiscoveryTrack) {
  return !playlistTrack.song && (!playlistTrack.request || playlistTrack.request.state === "failed");
}
