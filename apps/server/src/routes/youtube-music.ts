import { ApiErrorCode } from "@needle/shared";
import { createMiddleware } from "hono/factory";
import { z } from "zod";
import type { Authorization } from "../http/authorization.ts";
import type { App, AppEnv } from "../http/context.ts";
import { appError } from "../http/errors.ts";
import { validate } from "../http/validation.ts";
import { YouTubeMusic } from "../youtube-music.ts";

const youtubeMusicPermissionMessage = "Ask an admin to let you use YouTube Music in Needle";
const providerIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
const providerIdParamsSchema = z.object({ id: providerIdSchema });
const toggleBodySchema = z.object({ on: z.boolean() }).strict();
const importBodySchema = z.object({ source: z.union([z.literal("liked"), providerIdSchema]) }).strict();
const defaultLimitQuerySchema = getLimitQuerySchema(3000);
const searchQuerySchema = z.object({
  q: z.string().max(200).optional(),
  kind: z.enum(["songs", "albums", "artists", "playlists"]).optional(),
  limit: getLimitSchema(100),
});
const releaseQuerySchema = z.object({
  kind: z.enum(["albums", "singles"]),
  limit: getLimitSchema(3000),
});

type YouTubeMusicRouteDependencies = {
  authorization: Authorization;
  youtubeMusic: YouTubeMusic | null;
};

export function registerYouTubeMusicRoutes(app: App, { authorization, youtubeMusic }: YouTubeMusicRouteDependencies) {
  const requireYouTubeMusic = createMiddleware<AppEnv>(async (context, next) => {
    if (!youtubeMusic) {
      throw appError(
        404,
        ApiErrorCode.INTEGRATION_NOT_CONFIGURED,
        "Add YTMUSIC_CLIENT_ID and YTMUSIC_CLIENT_SECRET to the Needle server",
      );
    }

    context.set("youtubeMusic", youtubeMusic);

    await next();
  });
  const requireYouTubeMusicPermission = authorization.requirePermission("youtubeMusic", youtubeMusicPermissionMessage);

  app.use("/api/youtube-music", requireYouTubeMusic);
  app.use("/api/youtube-music/*", requireYouTubeMusic);
  app.use("/api/youtube-music", requireYouTubeMusicPermission);
  app.use("/api/youtube-music/*", requireYouTubeMusicPermission);

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

  app.put("/api/youtube-music/enabled", validate("json", toggleBodySchema), (context) => {
    context.get("youtubeMusic").setEnabled(context.get("auth").user, context.req.valid("json").on);

    return context.body(null, 204);
  });

  app.get("/api/youtube-music/account", async (context) => {
    return context.json(await context.get("youtubeMusic").account(context.get("auth").user));
  });

  app.get("/api/youtube-music/liked", validate("query", defaultLimitQuerySchema), async (context) => {
    const limit = YouTubeMusic.limit(context.req.valid("query").limit);

    return context.json(await context.get("youtubeMusic").liked(context.get("auth").user, limit));
  });

  app.get("/api/youtube-music/albums", validate("query", defaultLimitQuerySchema), async (context) => {
    const limit = YouTubeMusic.limit(context.req.valid("query").limit);

    return context.json(await context.get("youtubeMusic").albums(context.get("auth").user, limit));
  });

  app.get("/api/youtube-music/artists", validate("query", defaultLimitQuerySchema), async (context) => {
    const limit = YouTubeMusic.limit(context.req.valid("query").limit);

    return context.json(await context.get("youtubeMusic").artists(context.get("auth").user, limit));
  });

  app.get("/api/youtube-music/playlists", validate("query", defaultLimitQuerySchema), async (context) => {
    const limit = YouTubeMusic.limit(context.req.valid("query").limit);

    return context.json(await context.get("youtubeMusic").playlists(context.get("auth").user, limit));
  });

  app.get("/api/youtube-music/search", validate("query", searchQuerySchema), async (context) => {
    const query = context.req.valid("query");
    const limit = YouTubeMusic.limit(query.limit, 20, 100);

    return context.json(
      await context.get("youtubeMusic").search(context.get("auth").user, query.q ?? "", query.kind, limit),
    );
  });

  app.get("/api/youtube-music/albums/:id", validate("param", providerIdParamsSchema), async (context) => {
    return context.json(
      await context.get("youtubeMusic").album(context.get("auth").user, context.req.valid("param").id),
    );
  });

  app.get("/api/youtube-music/artists/:id", validate("param", providerIdParamsSchema), async (context) => {
    return context.json(
      await context.get("youtubeMusic").artist(context.get("auth").user, context.req.valid("param").id),
    );
  });

  app.get(
    "/api/youtube-music/artists/:id/songs",
    validate("param", providerIdParamsSchema),
    validate("query", defaultLimitQuerySchema),
    async (context) => {
      const limit = YouTubeMusic.limit(context.req.valid("query").limit);

      return context.json(
        await context.get("youtubeMusic").artistSongs(context.get("auth").user, context.req.valid("param").id, limit),
      );
    },
  );

  app.get(
    "/api/youtube-music/artists/:id/releases",
    validate("param", providerIdParamsSchema),
    validate("query", releaseQuerySchema),
    async (context) => {
      const query = context.req.valid("query");
      const limit = YouTubeMusic.limit(query.limit);

      return context.json(
        await context
          .get("youtubeMusic")
          .artistReleases(context.get("auth").user, context.req.valid("param").id, query.kind, limit),
      );
    },
  );

  app.get(
    "/api/youtube-music/playlists/:id",
    validate("param", providerIdParamsSchema),
    validate("query", defaultLimitQuerySchema),
    async (context) => {
      const limit = YouTubeMusic.limit(context.req.valid("query").limit, 3000);

      return context.json(
        await context.get("youtubeMusic").playlist(context.get("auth").user, context.req.valid("param").id, limit),
      );
    },
  );

  app.get("/api/youtube-music/songs/:id/lyrics", validate("param", providerIdParamsSchema), async (context) => {
    return context.json(
      await context.get("youtubeMusic").lyrics(context.get("auth").user, context.req.valid("param").id),
    );
  });

  app.get("/api/youtube-music/songs/:id/radio", validate("param", providerIdParamsSchema), async (context) => {
    return context.json(
      await context.get("youtubeMusic").radio(context.get("auth").user, context.req.valid("param").id),
    );
  });

  app.put(
    "/api/youtube-music/songs/:id/like",
    validate("param", providerIdParamsSchema),
    validate("json", toggleBodySchema),
    async (context) => {
      await context
        .get("youtubeMusic")
        .like(context.get("auth").user, context.req.valid("param").id, context.req.valid("json").on);

      return context.body(null, 204);
    },
  );

  app.put(
    "/api/youtube-music/albums/:id/saved",
    validate("param", providerIdParamsSchema),
    validate("json", toggleBodySchema),
    async (context) => {
      await context
        .get("youtubeMusic")
        .saveAlbum(context.get("auth").user, context.req.valid("param").id, context.req.valid("json").on);

      return context.body(null, 204);
    },
  );

  app.put(
    "/api/youtube-music/artists/:id/follow",
    validate("param", providerIdParamsSchema),
    validate("json", toggleBodySchema),
    async (context) => {
      await context
        .get("youtubeMusic")
        .follow(context.get("auth").user, context.req.valid("param").id, context.req.valid("json").on);

      return context.body(null, 204);
    },
  );

  app.post("/api/youtube-music/import", validate("json", importBodySchema), async (context) => {
    return context.json(
      await context.get("youtubeMusic").import(context.get("auth"), context.req.valid("json").source),
    );
  });
}

function getLimitQuerySchema(maximum: number) {
  return z.object({ limit: getLimitSchema(maximum) });
}

function getLimitSchema(maximum: number) {
  return z
    .string()
    .regex(/^\d+$/)
    .refine((limit) => Number(limit) >= 1 && Number(limit) <= maximum)
    .optional();
}
