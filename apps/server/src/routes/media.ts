import { ApiErrorCode, type InternetRadioStation } from "@needle/shared";
import { z } from "zod";
import type { Config } from "../config.ts";
import type { Authorization } from "../http/authorization.ts";
import type { App } from "../http/context.ts";
import { appError } from "../http/errors.ts";
import { validate } from "../http/validation.ts";
import type { Navidrome } from "../navidrome.ts";
import { authFromQuery } from "../navidrome.ts";
import { proxyToNavidrome } from "../proxy.ts";
import type { YouTubeMusic } from "../youtube-music.ts";

const queryAuthenticationSchema = z.object({
  u: z.string().min(1).max(200).optional(),
  t: z.string().min(1).max(4096).optional(),
  s: z.string().min(1).max(200).optional(),
});
const radioParamsSchema = z.object({ id: z.string().min(1).max(500) });
const youtubeMusicStreamParamsSchema = z.object({
  videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
});
const rangeHeadersSchema = z.object({
  range: z
    .string()
    .regex(/^bytes=(?:\d+-\d*|-\d+)$/)
    .optional(),
});

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
    return proxyToNavidrome(context.req.raw, config.navidromeUrl).catch(() => {
      throw appError(502, ApiErrorCode.UPSTREAM_ERROR, "Navidrome isn't responding");
    });
  });

  app.get(
    "/radio/:id",
    validate("param", radioParamsSchema),
    validate("query", queryAuthenticationSchema),
    async (context) => {
      const auth = authFromQuery(new URL(context.req.url));

      if (!auth || (await navidrome.verify(auth)) !== "ok") {
        throw appError(401, ApiErrorCode.UNAUTHORIZED, "Sign in again");
      }

      const radioStationsResponse = await navidrome.call<{
        internetRadioStations: {
          internetRadioStation?: InternetRadioStation[];
        };
      }>(auth, "getInternetRadioStations");
      const station = radioStationsResponse.internetRadioStations.internetRadioStation?.find(
        (internetRadioStation) => internetRadioStation.id === context.req.valid("param").id,
      );

      if (!station) throw appError(404, ApiErrorCode.NOT_FOUND, "No such station");

      const upstream = await fetch(station.streamUrl, {
        headers: { "icy-metadata": "0", "user-agent": "Needle" },
        signal: context.req.raw.signal,
      }).catch(() => null);

      if (!upstream?.ok || !upstream.body) {
        throw appError(502, ApiErrorCode.UPSTREAM_ERROR, "The station isn't responding");
      }

      return new Response(upstream.body, {
        headers: {
          "content-type": upstream.headers.get("content-type") ?? "audio/mpeg",
          "cache-control": "no-store",
        },
      });
    },
  );

  app.get(
    "/youtube-music/stream/:videoId",
    validate("param", youtubeMusicStreamParamsSchema),
    validate("query", queryAuthenticationSchema),
    validate("header", rangeHeadersSchema),
    async (context) => {
      const auth = authFromQuery(new URL(context.req.url));

      if (!auth) throw appError(401, ApiErrorCode.UNAUTHORIZED, "Sign in again");

      const verification = await navidrome.verify(auth);

      if (verification === "down") {
        throw appError(503, ApiErrorCode.SERVICE_UNAVAILABLE, "Navidrome isn't responding");
      }

      if (verification !== "ok") throw appError(401, ApiErrorCode.UNAUTHORIZED, "Sign in again");
      if (!youtubeMusic) {
        throw appError(404, ApiErrorCode.INTEGRATION_NOT_CONFIGURED, "YouTube Music isn't set up on the Needle server");
      }

      await authorization.authorize(auth, "youtubeMusic", "Ask an admin to let you use YouTube Music in Needle");

      return youtubeMusic.stream(auth.user, context.req.valid("param").videoId, context.req.raw);
    },
  );

  app.all("/api/*", () => {
    throw appError(404, ApiErrorCode.NOT_FOUND, "Not found");
  });
}
