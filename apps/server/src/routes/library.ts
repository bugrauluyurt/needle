import { ApiErrorCode } from "@needle/shared";
import { compress } from "hono/compress";
import { z } from "zod";
import type { App } from "../http/context.ts";
import { appError } from "../http/errors.ts";
import { validate } from "../http/validation.ts";
import type { LibrarySearch } from "../search.ts";
import type { Mixes } from "../mixes.ts";
import { PHOTO_MAX_BYTES, PHOTO_TYPES, type Profiles } from "../profiles.ts";
import type { PlayLog } from "../stats.ts";

const playReportSchema = z.object({
  songId: z.string().min(1).max(500),
  title: z.string().min(1).max(1000),
  artist: z.string().max(1000),
  artistId: z.string().max(500).optional(),
  album: z.string().max(1000),
  albumId: z.string().max(500).optional(),
  genre: z.string().max(500).optional(),
  coverArt: z.string().max(2048).optional(),
  duration: z.number().finite().nonnegative(),
  msPlayed: z.number().finite().nonnegative(),
  device: z.string().max(500),
});
const statsQuerySchema = z.object({
  period: z.enum(["month", "quarter", "year", "all"]).optional(),
});
const searchQuerySchema = z.object({ q: z.string().max(500).optional() });
const photoHeadersSchema = z.object({
  "content-type": z.string().refine((contentType) => PHOTO_TYPES.has(contentType), "Use a JPEG, PNG or WebP image"),
});

type LibraryRouteDependencies = {
  library: LibrarySearch;
  log: PlayLog;
  mixes: Mixes;
  profiles: Profiles;
};

export function registerLibraryRoutes(app: App, { library, log, mixes, profiles }: LibraryRouteDependencies) {
  app.post("/api/plays", validate("json", playReportSchema), (context) => {
    const play = context.req.valid("json");

    log.record(context.get("auth").user, play);

    return context.body(null, 204);
  });

  app.get("/api/stats", validate("query", statsQuerySchema), (context) => {
    const period = context.req.valid("query").period ?? "month";

    return context.json(log.stats(context.get("auth").user, period));
  });

  app.get("/api/search", validate("query", searchQuerySchema), async (context) => {
    const query = context.req.valid("query").q ?? "";

    return context.json(await library.search(context.get("auth"), query));
  });

  app.get("/api/library/songs", compress(), async (context) => {
    return context.json(await library.songs(context.get("auth")));
  });

  app.get("/api/me", (context) => {
    const { user } = context.get("auth");

    return context.json({ user, photo: profiles.photo(user) });
  });

  app.put("/api/me/photo", validate("header", photoHeadersSchema), async (context) => {
    const contentType = context.req.valid("header")["content-type"];
    const photo = new Uint8Array(await context.req.arrayBuffer());

    if (!photo.length || photo.length > PHOTO_MAX_BYTES) {
      throw appError(413, ApiErrorCode.PAYLOAD_TOO_LARGE, "That image is too large");
    }

    profiles.setPhoto(context.get("auth").user, photo, contentType);

    return context.body(null, 204);
  });

  app.delete("/api/me/photo", (context) => {
    profiles.removePhoto(context.get("auth").user);

    return context.body(null, 204);
  });

  app.get("/api/browse", async (context) => context.json(await library.browse(context.get("auth"))));
  app.get("/api/mixes", async (context) => context.json(await mixes.forUser(context.get("auth"))));
}
