import type { DatabaseSync } from "node:sqlite";
import type { LidarrAlbum } from "@needle/shared";
import { Hono } from "hono";
import type { Config } from "./config.ts";
import { Deezer } from "./deezer.ts";
import { DeviceHub } from "./devices.ts";
import { registerAuthentication } from "./http/authentication.ts";
import { createAuthorization } from "./http/authorization.ts";
import type { AppEnv } from "./http/context.ts";
import { registerErrorHandler } from "./http/errors.ts";
import { InMemoryNavidromeVerifier } from "./http/navidrome-verifier.ts";
import { Lidarr } from "./lidarr.ts";
import { ListenBrainz } from "./listenbrainz.ts";
import { Mixes } from "./mixes.ts";
import { MusicBrainz } from "./musicbrainz.ts";
import { Navidrome } from "./navidrome.ts";
import { People } from "./people.ts";
import { Profiles } from "./profiles.ts";
import { Requests } from "./requests.ts";
import { registerLibraryRoutes } from "./routes/library.ts";
import { registerListenBrainzRoutes } from "./routes/listenbrainz.ts";
import { registerMediaRoutes } from "./routes/media.ts";
import { registerPeopleRoutes } from "./routes/people.ts";
import { registerRequestRoutes } from "./routes/requests.ts";
import { registerSpotifyCallbackRoute, registerSpotifyRoutes } from "./routes/spotify.ts";
import { registerStaticRoutes } from "./routes/static.ts";
import { registerHealthRoute, registerSystemRoutes } from "./routes/system.ts";
import { registerYouTubeMusicRoutes } from "./routes/youtube-music.ts";
import { LibrarySearch } from "./search.ts";
import { Slskd, SongDownloads } from "./soulseek.ts";
import { Spotify } from "./spotify.ts";
import { PlayLog } from "./stats.ts";
import { Status } from "./status.ts";
import { YouTubeMusic } from "./youtube-music.ts";

export function createApp(config: Config, db: DatabaseSync) {
  const navidrome = new Navidrome(config.navidromeUrl);
  const verifier = new InMemoryNavidromeVerifier(navidrome);
  const playLog = new PlayLog(db);
  const mixes = new Mixes(navidrome, playLog);
  const librarySearch = new LibrarySearch(navidrome);
  const profiles = new Profiles(db);
  const requests = new Requests(db);
  const musicBrainz = new MusicBrainz(config.musicbrainzUrl);
  const deezer = new Deezer(config.deezerUrl);
  const slskd = config.soulseek ? new Slskd(config.soulseek.url, config.soulseek.apiKey) : null;
  const songDownloads =
    config.soulseek && slskd
      ? new SongDownloads({
          slskd,
          requests,
          navidrome,
          downloadsDir: config.soulseek.downloadsDir,
          singlesDir: config.soulseek.singlesDir,
        })
      : null;
  const lidarr = config.lidarr ? new Lidarr(config.lidarr) : null;
  const people = new People(db);
  const listenBrainz = new ListenBrainz({
    url: config.listenbrainzUrl,
    db,
    navidrome,
    library: librarySearch,
    requests,
  });
  const spotify =
    config.spotify && config.publicUrl
      ? new Spotify({ ...config.spotify, publicUrl: config.publicUrl, db, navidrome, library: librarySearch })
      : null;
  const youtubeMusic = config.youtubeMusic
    ? new YouTubeMusic({ ...config.youtubeMusic, db, navidrome, library: librarySearch })
    : null;
  const systemStatus = new Status({
    config,
    navidrome,
    library: librarySearch,
    lidarr,
    slskd,
    musicbrainz: musicBrainz,
    deezer,
    listenbrainz: listenBrainz,
    youtubeMusic,
  });
  const hub = new DeviceHub();
  const authorization = createAuthorization({ lidarr, navidrome, people, songs: songDownloads, spotify });
  const recordAlbum = (user: string, album: LidarrAlbum) =>
    requests.add({
      user,
      kind: "album",
      ref: album.foreignAlbumId,
      title: album.title,
      artist: album.artist,
      cover_url: album.coverUrl,
      state: album.state,
    });

  const app = new Hono<AppEnv>();

  registerErrorHandler(app);
  registerHealthRoute(app);
  registerSpotifyCallbackRoute(app, { spotify });
  registerAuthentication(app, { trustedProxy: config.trustedProxy, verifier });
  registerYouTubeMusicRoutes(app, { authorization, youtubeMusic });
  registerSystemRoutes(app, {
    authorization,
    config,
    lidarr,
    listenbrainz: listenBrainz,
    songs: songDownloads,
    spotify,
    status: systemStatus,
    youtubeMusic,
  });
  registerLibraryRoutes(app, { library: librarySearch, log: playLog, mixes, profiles });
  registerRequestRoutes(app, {
    authorization,
    deezer,
    lidarr,
    library: librarySearch,
    musicbrainz: musicBrainz,
    recordAlbum,
    requests,
  });
  registerPeopleRoutes(app, { authorization, people });
  registerListenBrainzRoutes(app, { authorization, listenbrainz: listenBrainz, navidrome });
  registerSpotifyRoutes(app, { authorization, recordAlbum });
  registerMediaRoutes(app, { authorization, config, navidrome, verifier, youtubeMusic });
  registerStaticRoutes(app, config);

  return { app, hub, verifier };
}
