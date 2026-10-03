import {
  ApiErrorCode,
  type LidarrAlbum,
  type LidarrSearch,
  type RequestItem,
  type SongCandidate,
  songKey,
} from "@needle/shared";
import { z } from "zod";
import type { Deezer } from "../deezer.ts";
import type { Authorization } from "../http/authorization.ts";
import type { App } from "../http/context.ts";
import { appError } from "../http/errors.ts";
import { validate } from "../http/validation.ts";
import type { Lidarr } from "../lidarr.ts";
import type { MusicBrainz } from "../musicbrainz.ts";
import type { Requests } from "../requests.ts";
import { toItem, toItemFor } from "../requests.ts";
import type { LibrarySearch } from "../search.ts";

const SONG_RESULTS = 12;
const requestPermissionMessage = "Ask an admin to let you request music";
const searchQuerySchema = z.object({
  q: z.string().trim().max(500).optional(),
});
const albumIdsQuerySchema = z.object({ ids: z.string().max(5000).optional() });
const resourceIdParamsSchema = z.object({
  id: z.string().trim().min(1).max(200),
});
const requestIdParamsSchema = z.object({
  id: z
    .string()
    .regex(/^[1-9]\d*$/)
    .transform(Number)
    .pipe(z.number().int().positive().safe()),
});
const requestsQuerySchema = z.object({ everyone: z.literal("1").optional() });
const artistNamesQuerySchema = z.object({
  names: z.string().max(4000).optional(),
});
const downloadsQuerySchema = z.object({ find: z.literal("1").optional() });
const songCandidateSchema = z.object({
  id: z.string().min(1).max(500),
  title: z.string().min(1).max(1000),
  artist: z.string().min(1).max(1000),
  album: z.string().max(1000).nullable(),
  duration: z.number().finite().nonnegative().nullable(),
  year: z.number().int().min(0).max(9999).nullable(),
  coverUrl: z.string().url().max(2048).nullable(),
});

export type RecordAlbum = (user: string, album: LidarrAlbum) => ReturnType<Requests["add"]>;

type RequestRouteDependencies = {
  authorization: Authorization;
  deezer: Deezer;
  lidarr: Lidarr | null;
  library: LibrarySearch;
  musicbrainz: MusicBrainz;
  recordAlbum: RecordAlbum;
  requests: Requests;
};

export function registerRequestRoutes(
  app: App,
  { authorization, deezer, lidarr, library, musicbrainz, recordAlbum, requests }: RequestRouteDependencies,
) {
  const requireRequestPermission = authorization.requirePermission("request", requestPermissionMessage);

  app.get(
    "/api/lidarr/search",
    authorization.requireLidarr,
    requireRequestPermission,
    validate("query", searchQuerySchema),
    async (context) => {
      const query = context.req.valid("query").q ?? "";

      if (query.length < 2) return context.json({ albums: [] } satisfies LidarrSearch);

      const configuredLidarr = context.get("lidarr");
      const search = await configuredLidarr.search(query);
      const matchingArtist = configuredLidarr.pickArtist(search.artists, query);
      const discography = !matchingArtist
        ? []
        : matchingArtist.id
          ? await configuredLidarr.artistAlbums(matchingArtist.id)
          : await musicbrainz.albumsBy(matchingArtist.foreignArtistId, matchingArtist.artistName).catch(() => []);
      const seenAlbumIds = new Set(discography.map((album) => album.foreignAlbumId));

      return context.json({
        albums: [
          ...discography.filter((album) => album.state !== "available"),
          ...search.albums.filter((album) => !seenAlbumIds.has(album.foreignAlbumId)),
        ],
      } satisfies LidarrSearch);
    },
  );

  app.get(
    "/api/lidarr/albums",
    authorization.requireLidarr,
    requireRequestPermission,
    validate("query", albumIdsQuerySchema),
    async (context) => {
      const albumIds = (context.req.valid("query").ids ?? "").split(",").filter(Boolean).slice(0, 20);

      return context.json(await context.get("lidarr").albumStates(albumIds));
    },
  );

  app.post(
    "/api/lidarr/albums/:id",
    authorization.requireLidarr,
    requireRequestPermission,
    validate("param", resourceIdParamsSchema),
    async (context) => {
      const album = await context.get("lidarr").getAlbum(context.req.valid("param").id);

      if (album.title) recordAlbum(context.get("auth").user, album);

      return context.json(album);
    },
  );

  app.get(
    "/api/songs/search",
    authorization.requireSongs,
    requireRequestPermission,
    validate("query", searchQuerySchema),
    async (context) => {
      const query = context.req.valid("query").q ?? "";

      if (query.length < 2) return context.json([]);

      const [topSongs, foundSongs, ownedSongKeys] = await Promise.all([
        deezer.topSongs(query),
        musicbrainz.recordings(query),
        library.songKeys(context.get("auth")),
      ]);
      const seenSongKeys = new Set<string>();
      const songs = [...topSongs, ...foundSongs]
        .filter((song) => {
          const key = songKey(song.artist, song.title);

          if (ownedSongKeys.has(key) || seenSongKeys.has(key)) return false;

          seenSongKeys.add(key);

          return true;
        })
        .slice(0, SONG_RESULTS);

      return context.json(songs);
    },
  );

  app.post(
    "/api/songs",
    authorization.requireSongs,
    requireRequestPermission,
    validate("json", songCandidateSchema),
    (context) => {
      const songCandidate = context.req.valid("json") satisfies SongCandidate;

      return context.json(toItem(context.get("songs").start(context.get("auth"), songCandidate)));
    },
  );

  app.get("/api/requests", validate("query", requestsQuerySchema), async (context) => {
    const auth = context.get("auth");
    const everyone = context.req.valid("query").everyone === "1";

    if (everyone && !(await authorization.isAdmin(auth))) {
      throw appError(403, ApiErrorCode.FORBIDDEN, "Only Navidrome admins can see everyone's requests");
    }

    const requestRows = everyone ? requests.others(auth.user) : requests.list(auth.user);
    const albumIds = requestRows
      .filter((requestRow) => requestRow.kind === "album")
      .map((requestRow) => requestRow.ref);
    const liveAlbums = lidarr && albumIds.length ? await lidarr.albumStates(albumIds).catch(() => []) : [];
    const liveAlbumsById = new Map(liveAlbums.map((album) => [album.foreignAlbumId, album]));
    const requestItems = requestRows.map((requestRow): RequestItem => {
      const album = requestRow.kind === "album" ? liveAlbumsById.get(requestRow.ref) : undefined;

      return {
        ...(everyone ? toItemFor(requestRow) : toItem(requestRow)),
        ...(album
          ? {
              state: album.state,
              progress: album.progress,
              coverUrl: album.coverUrl ?? requestRow.cover_url,
            }
          : {}),
      };
    });

    return context.json(requestItems);
  });

  app.post("/api/requests/:id/retry", validate("param", requestIdParamsSchema), async (context) => {
    const requestRow = requests.get(context.req.valid("param").id);

    if (requestRow?.user !== context.get("auth").user) {
      throw appError(404, ApiErrorCode.NOT_FOUND, "No such request");
    }

    if (requestRow.kind === "album") {
      const configuredLidarr = authorization.getLidarr();

      await authorization.authorize(context.get("auth"), "request", requestPermissionMessage);

      const album = await configuredLidarr.getAlbum(requestRow.ref);

      return context.json(toItem(recordAlbum(requestRow.user, album)));
    }

    const songDownloads = authorization.getSongs();

    await authorization.authorize(context.get("auth"), "request", requestPermissionMessage);

    const songCandidate: SongCandidate = {
      id: requestRow.ref,
      title: requestRow.title,
      artist: requestRow.artist,
      album: null,
      duration: null,
      year: null,
      coverUrl: requestRow.cover_url,
    };

    return context.json(toItem(songDownloads.start(context.get("auth"), songCandidate)));
  });

  app.delete("/api/requests/:id", validate("param", requestIdParamsSchema), async (context) => {
    const auth = context.get("auth");

    requests.remove((await authorization.isAdmin(auth)) ? null : auth.user, context.req.valid("param").id);

    return context.body(null, 204);
  });

  app.get(
    "/api/lidarr/artists",
    authorization.requireLidarr,
    requireRequestPermission,
    validate("query", artistNamesQuerySchema),
    async (context) => {
      const artistNames = (context.req.valid("query").names ?? "")
        .split("|")
        .map((artistName) => artistName.trim())
        .filter(Boolean)
        .slice(0, 8);

      return context.json(await context.get("lidarr").lookupArtists(artistNames));
    },
  );

  app.get(
    "/api/lidarr/downloads",
    authorization.requireLidarr,
    authorization.requireAdmin("Only Navidrome admins can manage Lidarr's downloads"),
    async (context) => context.json(await context.get("lidarr").downloads()),
  );

  app.delete(
    "/api/lidarr/downloads/:id",
    authorization.requireLidarr,
    authorization.requireAdmin("Only Navidrome admins can manage Lidarr's downloads"),
    validate("param", requestIdParamsSchema),
    validate("query", downloadsQuerySchema),
    async (context) => {
      await context
        .get("lidarr")
        .removeDownload(context.req.valid("param").id, context.req.valid("query").find === "1");

      return context.body(null, 204);
    },
  );
}
