import type { Navidrome } from "../navidrome.ts";
import { authFromHeaders } from "../navidrome.ts";
import type { App } from "./context.ts";

type AuthenticationDependencies = {
  navidrome: Navidrome;
};

export function registerAuthentication(app: App, { navidrome }: AuthenticationDependencies) {
  app.use("/api/*", async (context, next) => {
    const auth = authFromHeaders(context.req.raw.headers);
    const verification = auth ? await navidrome.verify(auth) : "denied";

    if (verification === "down") return context.json({ error: "Navidrome isn't responding" }, 503);
    if (!auth || verification === "denied") return context.json({ error: "Sign in again" }, 401);

    context.set("auth", auth);

    await next();
  });
}
