import type { InternetRadioStation } from "@needle/shared";
import type { Config } from "../config.ts";
import type { Authorization } from "../http/authorization.ts";
import type { App } from "../http/context.ts";
import type { Navidrome } from "../navidrome.ts";
import { authFromQuery } from "../navidrome.ts";
import { proxyToNavidrome } from "../proxy.ts";
import type { YouTubeMusic } from "../youtube-music.ts";

type MediaRouteDependencies = {
  authorization: Authorization;
  config: Config;
  navidrome: Navidrome;
  youtubeMusic: YouTubeMusic | null;
};

export function registerMediaRoutes(
  app: App,
  { authorization, config, navidrome, youtubeMusic }: MediaRouteDependencies,
) {
  app.all("/rest/*", (context) => {
    return proxyToNavidrome(context.req.raw, config.navidromeUrl).catch(() =>
      context.json({ error: "Navidrome isn't responding" }, 502),
    );
  });

  app.get("/radio/:id", async (context) => {
    const auth = authFromQuery(new URL(context.req.url));

    if (!auth || (await navidrome.verify(auth)) !== "ok") return context.text("Sign in again", 401);

    const radioStationsResponse = await navidrome.call<{
      internetRadioStations: { internetRadioStation?: InternetRadioStation[] };
    }>(auth, "getInternetRadioStations");
    const station = radioStationsResponse.internetRadioStations.internetRadioStation?.find(
      (internetRadioStation) => internetRadioStation.id === context.req.param("id"),
    );

    if (!station) return context.text("No such station", 404);

    const upstream = await fetch(station.streamUrl, {
      headers: { "icy-metadata": "0", "user-agent": "Needle" },
      signal: context.req.raw.signal,
    }).catch(() => null);

    if (!upstream?.ok || !upstream.body) return context.text("The station isn't responding", 502);

    return new Response(upstream.body, {
      headers: {
        "content-type": upstream.headers.get("content-type") ?? "audio/mpeg",
        "cache-control": "no-store",
      },
    });
  });

  app.get("/youtube-music/stream/:videoId", async (context) => {
    const auth = authFromQuery(new URL(context.req.url));

    if (!auth) return context.json({ error: "Sign in again" }, 401);

    const verification = await navidrome.verify(auth);

    if (verification === "down") return context.json({ error: "Navidrome isn't responding" }, 503);
    if (verification !== "ok") return context.json({ error: "Sign in again" }, 401);
    if (!youtubeMusic) return context.json({ error: "YouTube Music isn't set up on the Needle server" }, 404);

    if (!(await authorization.can(auth, "youtubeMusic"))) {
      return authorization.forbiddenResponse(context, "Ask an admin to let you use YouTube Music in Needle");
    }

    return youtubeMusic.stream(auth.user, context.req.param("videoId"), context.req.raw);
  });
}
