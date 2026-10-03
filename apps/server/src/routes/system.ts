import type { Capabilities } from "@needle/shared";
import type { Config } from "../config.ts";
import type { Authorization } from "../http/authorization.ts";
import type { App } from "../http/context.ts";
import type { Lidarr } from "../lidarr.ts";
import type { ListenBrainz } from "../listenbrainz.ts";
import type { SongDownloads } from "../soulseek.ts";
import type { Spotify } from "../spotify.ts";
import type { Status } from "../status.ts";
import { VERSION } from "../version.ts";
import type { YouTubeMusic } from "../youtube-music.ts";

type SystemRouteDependencies = {
  authorization: Authorization;
  config: Config;
  lidarr: Lidarr | null;
  listenbrainz: ListenBrainz;
  songs: SongDownloads | null;
  spotify: Spotify | null;
  status: Status;
  youtubeMusic: YouTubeMusic | null;
};

export function registerHealthRoute(app: App) {
  app.get("/api/health", (context) => context.json({ ok: true, version: VERSION }));
}

export function registerSystemRoutes(
  app: App,
  { authorization, config, lidarr, listenbrainz, songs, spotify, status, youtubeMusic }: SystemRouteDependencies,
) {
  app.get("/api/capabilities", async (context) => {
    const auth = context.get("auth");
    const admin = await authorization.isAdmin(auth);
    const canRequest = await authorization.can(auth, "request");
    const allowedSpotify = (await authorization.can(auth, "spotify")) ? spotify : null;
    const allowedYouTubeMusic = (await authorization.can(auth, "youtubeMusic")) ? youtubeMusic : null;
    const listenbrainzAccount = listenbrainz.account(auth.user);
    const capabilities: Capabilities = {
      admin,
      lidarr: Boolean(lidarr) && canRequest,
      spotify: Boolean(allowedSpotify),
      spotifyConnected: allowedSpotify?.connected(auth.user) ?? false,
      spotifyPlayback: allowedSpotify?.canPlay(auth.user) ?? false,
      spotifyReconnect: allowedSpotify?.needsReconnect(auth.user) ?? false,
      spotifyEnabled: allowedSpotify?.enabled(auth.user) ?? false,
      ...(config.youtubeMusic
        ? {
            youtubeMusic: Boolean(allowedYouTubeMusic),
            youtubeMusicConnected: allowedYouTubeMusic?.connected(auth.user) ?? false,
            youtubeMusicEnabled: allowedYouTubeMusic?.enabled(auth.user) ?? false,
            youtubeMusicReconnect: allowedYouTubeMusic?.needsReconnect(auth.user) ?? false,
          }
        : {}),
      songs: Boolean(songs) && canRequest,
      publicUrl: config.publicUrl,
      listenbrainzUser: listenbrainzAccount?.user ?? null,
      listenbrainzNavidrome: listenbrainzAccount?.navidrome ?? false,
    };

    return context.json(capabilities);
  });

  app.get("/api/status", async (context) => {
    const auth = context.get("auth");

    if (!(await authorization.isAdmin(auth))) {
      return context.json({ error: "Only Navidrome admins can see connections" }, 403);
    }

    return context.json({ checks: await status.checks(auth, context.req.query("fresh") === "1") });
  });
}
