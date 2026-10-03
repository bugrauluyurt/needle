import type { App } from "./context.ts";
import { LidarrError } from "../lidarr.ts";
import { ListenBrainzError } from "../listenbrainz.ts";
import { MusicBrainzError } from "../musicbrainz.ts";
import { SubsonicFailure } from "../navidrome.ts";
import { SlskdError } from "../soulseek.ts";
import { SpotifyError } from "../spotify.ts";
import { YouTubeMusicError } from "../youtube-music.ts";

export function registerErrorHandler(app: App) {
  app.onError((error, context) => {
    if (error instanceof YouTubeMusicError) {
      return context.json({ error: error.message, code: error.code }, error.status);
    }

    if (error instanceof SpotifyError) {
      return context.json({ error: error.message }, error.status === 401 || error.status === 409 ? error.status : 502);
    }

    if (error instanceof ListenBrainzError) return context.json({ error: error.message }, error.status);

    if (
      error instanceof LidarrError ||
      error instanceof SubsonicFailure ||
      error instanceof SlskdError ||
      error instanceof MusicBrainzError
    ) {
      return context.json({ error: error.message }, 502);
    }

    console.error(error);

    return context.json({ error: "Something went wrong on the Needle server" }, 500);
  });
}
