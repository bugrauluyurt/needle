import type { YouTubeMusicSearchKind } from "@needle/shared";
import type { Authorization } from "../http/authorization.ts";
import type { App, AppContext } from "../http/context.ts";
import { YouTubeMusic, YouTubeMusicError } from "../youtube-music.ts";

type YouTubeMusicRouteDependencies = {
  authorization: Authorization;
  youtubeMusic: YouTubeMusic | null;
};

export function registerYouTubeMusicRoutes(app: App, { authorization, youtubeMusic }: YouTubeMusicRouteDependencies) {
  const youtubeMusicGuard = async (context: AppContext, next: () => Promise<void>) => {
    if (!youtubeMusic) {
      return context.json({ error: "Add YTMUSIC_CLIENT_ID and YTMUSIC_CLIENT_SECRET to the Needle server" }, 404);
    }

    if (!(await authorization.can(context.get("auth"), "youtubeMusic"))) {
      return authorization.forbiddenResponse(context, "Ask an admin to let you use YouTube Music in Needle");
    }

    context.set("youtubeMusic", youtubeMusic);

    await next();
  };

  app.use("/api/youtube-music", youtubeMusicGuard);
  app.use("/api/youtube-music/*", youtubeMusicGuard);

  app.post("/api/youtube-music/login", async (context) => {
    return context.json(await context.get("youtubeMusic").login(context.get("auth").user));
  });

  app.get("/api/youtube-music/login", async (context) => {
    return context.json(await context.get("youtubeMusic").loginStatus(context.get("auth").user));
  });

  app.delete("/api/youtube-music/login", (context) => {
    context.get("youtubeMusic").cancelLogin(context.get("auth").user);

    return context.body(null, 204);
  });

  app.delete("/api/youtube-music", (context) => {
    context.get("youtubeMusic").disconnect(context.get("auth").user);

    return context.body(null, 204);
  });

  app.put("/api/youtube-music/enabled", async (context) => {
    context.get("youtubeMusic").setEnabled(context.get("auth").user, await getYouTubeMusicOn(context));

    return context.body(null, 204);
  });

  app.get("/api/youtube-music/account", async (context) => {
    return context.json(await context.get("youtubeMusic").account(context.get("auth").user));
  });

  app.get("/api/youtube-music/liked", async (context) => {
    const limit = YouTubeMusic.limit(context.req.query("limit"));

    return context.json(await context.get("youtubeMusic").liked(context.get("auth").user, limit));
  });

  app.get("/api/youtube-music/albums", async (context) => {
    const limit = YouTubeMusic.limit(context.req.query("limit"));

    return context.json(await context.get("youtubeMusic").albums(context.get("auth").user, limit));
  });

  app.get("/api/youtube-music/artists", async (context) => {
    const limit = YouTubeMusic.limit(context.req.query("limit"));

    return context.json(await context.get("youtubeMusic").artists(context.get("auth").user, limit));
  });

  app.get("/api/youtube-music/playlists", async (context) => {
    const limit = YouTubeMusic.limit(context.req.query("limit"));

    return context.json(await context.get("youtubeMusic").playlists(context.get("auth").user, limit));
  });

  app.get("/api/youtube-music/search", async (context) => {
    const kind = context.req.query("kind") as YouTubeMusicSearchKind | undefined;
    const limit = YouTubeMusic.limit(context.req.query("limit"), 20, 100);

    return context.json(
      await context.get("youtubeMusic").search(context.get("auth").user, context.req.query("q") ?? "", kind, limit),
    );
  });

  app.get("/api/youtube-music/albums/:id", async (context) => {
    return context.json(await context.get("youtubeMusic").album(context.get("auth").user, context.req.param("id")));
  });

  app.get("/api/youtube-music/artists/:id", async (context) => {
    return context.json(await context.get("youtubeMusic").artist(context.get("auth").user, context.req.param("id")));
  });

  app.get("/api/youtube-music/artists/:id/songs", async (context) => {
    const limit = YouTubeMusic.limit(context.req.query("limit"));

    return context.json(
      await context.get("youtubeMusic").artistSongs(context.get("auth").user, context.req.param("id"), limit),
    );
  });

  app.get("/api/youtube-music/artists/:id/releases", async (context) => {
    const kind = context.req.query("kind") as "albums" | "singles";
    const limit = YouTubeMusic.limit(context.req.query("limit"));

    return context.json(
      await context.get("youtubeMusic").artistReleases(context.get("auth").user, context.req.param("id"), kind, limit),
    );
  });

  app.get("/api/youtube-music/playlists/:id", async (context) => {
    const limit = YouTubeMusic.limit(context.req.query("limit"), 3000);

    return context.json(
      await context.get("youtubeMusic").playlist(context.get("auth").user, context.req.param("id"), limit),
    );
  });

  app.get("/api/youtube-music/songs/:id/lyrics", async (context) => {
    return context.json(await context.get("youtubeMusic").lyrics(context.get("auth").user, context.req.param("id")));
  });

  app.get("/api/youtube-music/songs/:id/radio", async (context) => {
    return context.json(await context.get("youtubeMusic").radio(context.get("auth").user, context.req.param("id")));
  });

  app.put("/api/youtube-music/songs/:id/like", async (context) => {
    const isOn = await getYouTubeMusicOn(context);

    await context.get("youtubeMusic").like(context.get("auth").user, context.req.param("id"), isOn);

    return context.body(null, 204);
  });

  app.put("/api/youtube-music/albums/:id/saved", async (context) => {
    const isOn = await getYouTubeMusicOn(context);

    await context.get("youtubeMusic").saveAlbum(context.get("auth").user, context.req.param("id"), isOn);

    return context.body(null, 204);
  });

  app.put("/api/youtube-music/artists/:id/follow", async (context) => {
    const isOn = await getYouTubeMusicOn(context);

    await context.get("youtubeMusic").follow(context.get("auth").user, context.req.param("id"), isOn);

    return context.body(null, 204);
  });

  app.post("/api/youtube-music/import", async (context) => {
    const body = await context.req.json<{ source?: unknown }>().catch(() => ({ source: undefined }));

    if (typeof body.source !== "string") {
      throw new YouTubeMusicError(400, "Choose a YouTube Music playlist to import");
    }

    return context.json(await context.get("youtubeMusic").import(context.get("auth"), body.source));
  });
}

async function getYouTubeMusicOn(context: AppContext) {
  const body = await context.req.json<{ on?: unknown }>().catch(() => ({ on: undefined }));

  if (typeof body.on !== "boolean") throw new YouTubeMusicError(400, "Use a boolean on value");

  return body.on;
}
