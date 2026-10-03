import type { Period, PlayReport } from "@needle/shared";
import { compress } from "hono/compress";
import type { App } from "../http/context.ts";
import type { LibrarySearch } from "../search.ts";
import type { Mixes } from "../mixes.ts";
import { PHOTO_MAX_BYTES, PHOTO_TYPES, type Profiles } from "../profiles.ts";
import type { PlayLog } from "../stats.ts";

const PERIODS = new Set<Period>(["month", "quarter", "year", "all"]);

type LibraryRouteDependencies = {
  library: LibrarySearch;
  log: PlayLog;
  mixes: Mixes;
  profiles: Profiles;
};

export function registerLibraryRoutes(app: App, { library, log, mixes, profiles }: LibraryRouteDependencies) {
  app.post("/api/plays", async (context) => {
    const play = await context.req.json<PlayReport>();

    if (!play.songId || !play.title || typeof play.msPlayed !== "number") {
      return context.json({ error: "Missing play fields" }, 400);
    }

    log.record(context.get("auth").user, play);

    return context.body(null, 204);
  });

  app.get("/api/stats", (context) => {
    const period = (context.req.query("period") ?? "month") as Period;

    if (!PERIODS.has(period)) return context.json({ error: "Unknown period" }, 400);

    return context.json(log.stats(context.get("auth").user, period));
  });

  app.get("/api/search", async (context) => {
    return context.json(await library.search(context.get("auth"), context.req.query("q") ?? ""));
  });

  app.get("/api/library/songs", compress(), async (context) => {
    return context.json(await library.songs(context.get("auth")));
  });

  app.get("/api/me", (context) => {
    const { user } = context.get("auth");

    return context.json({ user, photo: profiles.photo(user) });
  });

  app.put("/api/me/photo", async (context) => {
    const contentType = context.req.header("content-type") ?? "";
    const photo = new Uint8Array(await context.req.arrayBuffer());

    if (!PHOTO_TYPES.has(contentType)) return context.json({ error: "Use a JPEG, PNG or WebP image" }, 415);
    if (!photo.length || photo.length > PHOTO_MAX_BYTES) return context.json({ error: "That image is too large" }, 413);

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
