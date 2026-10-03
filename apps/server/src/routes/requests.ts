import type { LidarrAlbum, LidarrSearch, RequestItem, SongCandidate } from "@needle/shared";
import { songKey } from "@needle/shared";
import type { Deezer } from "../deezer.ts";
import type { Authorization } from "../http/authorization.ts";
import type { App } from "../http/context.ts";
import type { Lidarr } from "../lidarr.ts";
import type { LibrarySearch } from "../search.ts";
import type { MusicBrainz } from "../musicbrainz.ts";
import type { Requests } from "../requests.ts";
import { toItem, toItemFor } from "../requests.ts";

const SONG_RESULTS = 12;

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
  app.get("/api/lidarr/search", async (context) => {
    const lidarrAccess = await authorization.getLidarrAccess(context);

    if (lidarrAccess.error) return lidarrAccess.error;

    const query = context.req.query("q")?.trim() ?? "";

    if (query.length < 2) return context.json({ albums: [] } satisfies LidarrSearch);

    const search = await lidarrAccess.lidarr.search(query);
    const matchingArtist = lidarrAccess.lidarr.pickArtist(search.artists, query);
    const discography = !matchingArtist
      ? []
      : matchingArtist.id
        ? await lidarrAccess.lidarr.artistAlbums(matchingArtist.id)
        : await musicbrainz.albumsBy(matchingArtist.foreignArtistId, matchingArtist.artistName).catch(() => []);
    const seenAlbumIds = new Set(discography.map((album) => album.foreignAlbumId));

    return context.json({
      albums: [
        ...discography.filter((album) => album.state !== "available"),
        ...search.albums.filter((album) => !seenAlbumIds.has(album.foreignAlbumId)),
      ],
    } satisfies LidarrSearch);
  });

  app.get("/api/lidarr/albums", async (context) => {
    const lidarrAccess = await authorization.getLidarrAccess(context);

    if (lidarrAccess.error) return lidarrAccess.error;

    const albumIds = (context.req.query("ids") ?? "").split(",").filter(Boolean).slice(0, 20);

    return context.json(await lidarrAccess.lidarr.albumStates(albumIds));
  });

  app.post("/api/lidarr/albums/:id", async (context) => {
    const lidarrAccess = await authorization.getLidarrAccess(context);

    if (lidarrAccess.error) return lidarrAccess.error;

    const album = await lidarrAccess.lidarr.getAlbum(context.req.param("id"));

    if (album.title) recordAlbum(context.get("auth").user, album);

    return context.json(album);
  });

  app.get("/api/songs/search", async (context) => {
    const songAccess = await authorization.getSongAccess(context);

    if (songAccess.error) return songAccess.error;

    const query = context.req.query("q")?.trim() ?? "";

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
  });

  app.post("/api/songs", async (context) => {
    const songAccess = await authorization.getSongAccess(context);

    if (songAccess.error) return songAccess.error;

    const songCandidate = await context.req.json<SongCandidate>();

    return context.json(toItem(songAccess.songs.start(context.get("auth"), songCandidate)));
  });

  app.get("/api/requests", async (context) => {
    const auth = context.get("auth");
    const everyone = context.req.query("everyone") === "1";

    if (everyone && !(await authorization.isAdmin(auth))) {
      return authorization.forbiddenResponse(context, "Only Navidrome admins can see everyone's requests");
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

  app.post("/api/requests/:id/retry", async (context) => {
    const requestRow = requests.get(Number(context.req.param("id")));

    if (requestRow?.user !== context.get("auth").user) return context.json({ error: "No such request" }, 404);

    if (requestRow.kind === "album") {
      const lidarrAccess = await authorization.getLidarrAccess(context);

      if (lidarrAccess.error) return lidarrAccess.error;

      const album = await lidarrAccess.lidarr.getAlbum(requestRow.ref);

      return context.json(toItem(recordAlbum(requestRow.user, album)));
    }

    const songAccess = await authorization.getSongAccess(context);

    if (songAccess.error) return songAccess.error;

    const songCandidate: SongCandidate = {
      id: requestRow.ref,
      title: requestRow.title,
      artist: requestRow.artist,
      album: null,
      duration: null,
      year: null,
      coverUrl: requestRow.cover_url,
    };

    return context.json(toItem(songAccess.songs.start(context.get("auth"), songCandidate)));
  });

  app.delete("/api/requests/:id", async (context) => {
    const auth = context.get("auth");

    requests.remove((await authorization.isAdmin(auth)) ? null : auth.user, Number(context.req.param("id")));

    return context.body(null, 204);
  });

  app.get("/api/lidarr/artists", async (context) => {
    const lidarrAccess = await authorization.getLidarrAccess(context);

    if (lidarrAccess.error) return lidarrAccess.error;

    const artistNames = (context.req.query("names") ?? "")
      .split("|")
      .map((artistName) => artistName.trim())
      .filter(Boolean)
      .slice(0, 8);

    return context.json(await lidarrAccess.lidarr.lookupArtists(artistNames));
  });

  app.get("/api/lidarr/downloads", async (context) => {
    const lidarrAccess = await authorization.getLidarrAdminAccess(context);

    if (lidarrAccess.error) return lidarrAccess.error;

    return context.json(await lidarrAccess.lidarr.downloads());
  });

  app.delete("/api/lidarr/downloads/:id", async (context) => {
    const lidarrAccess = await authorization.getLidarrAdminAccess(context);

    if (lidarrAccess.error) return lidarrAccess.error;

    await lidarrAccess.lidarr.removeDownload(Number(context.req.param("id")), context.req.query("find") === "1");

    return context.body(null, 204);
  });
}
