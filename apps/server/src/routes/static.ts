import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Config } from "../config.ts";
import type { App, AppEnv } from "../http/context.ts";

const FILE = /\/[^/]+\.[a-z0-9]+$/i;

export function registerStaticRoutes(app: App, config: Config) {
  if (!existsSync(config.webDist)) return;

  const index = readFileSync(join(config.webDist, "index.html"), "utf8");

  app.use("/assets/*", async (context, next) => {
    await next();

    context.header("cache-control", "public, max-age=31536000, immutable");
  });

  const files = serveStatic<AppEnv>({ root: config.webDist, precompressed: true });

  app.use((context, next) => {
    return FILE.test(context.req.path) && !context.req.path.endsWith("/index.html") ? files(context, next) : next();
  });

  app.get("*", (context) => {
    if (FILE.test(context.req.path) && !context.req.path.endsWith("/index.html")) return context.notFound();

    context.header("cache-control", "no-cache");

    return context.html(index);
  });
}
