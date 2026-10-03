import { ApiErrorCode, type InternetRadioStation } from "@needle/shared";
import { z } from "zod";
import type { Config } from "../config.ts";
import type { Authorization } from "../http/authorization.ts";
import { getClientAddress } from "../http/client-address.ts";
import type { App } from "../http/context.ts";
import { appError } from "../http/errors.ts";
import type { InMemoryNavidromeVerifier } from "../http/navidrome-verifier.ts";
import { getRequestBodyLimit, validate } from "../http/validation.ts";
import { authFromQuery, type Auth, type Navidrome } from "../navidrome.ts";
import { proxyToNavidrome } from "../proxy.ts";
import type { YouTubeMusic } from "../youtube-music.ts";

const queryAuthenticationSchema = z.object({
  u: z.string().min(1).max(200).optional(),
  t: z.string().min(1).max(4096).optional(),
  s: z.string().min(1).max(200).optional(),
});
const SUBSONIC_VERSION = "1.16.1";
export const SUBSONIC_FORM_BODY_MAX_BYTES = 64 * 1024;
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
  verifier: InMemoryNavidromeVerifier;
  youtubeMusic: YouTubeMusic | null;
};

export function registerMediaRoutes(
  app: App,
  { authorization, config, navidrome, verifier, youtubeMusic }: MediaRouteDependencies,
) {
  app.use(
    "/rest/*",
    getRequestBodyLimit({
      maxBytes: SUBSONIC_FORM_BODY_MAX_BYTES,
      message: "Subsonic request body is too large",
    }),
  );

  app.all("/rest/*", validate("query", queryAuthenticationSchema), async (context) => {
    const proxyAuthentication = await getProxyAuthentication(context.req.raw);
    const { auth } = proxyAuthentication;

    if (!auth) throw appError(401, ApiErrorCode.UNAUTHORIZED, "Sign in again");

    const verification = await verifier.verify(auth, {
      clientAddress: getClientAddress(context, { trustedProxy: config.trustedProxy }),
    });

    if (verification === "limited") {
      throw appError(429, ApiErrorCode.RATE_LIMITED, "Too many sign-in attempts. Try again later.");
    }

    if (verification === "down") {
      throw appError(503, ApiErrorCode.SERVICE_UNAVAILABLE, "Navidrome isn't responding");
    }

    if (verification !== "ok") {
      if (proxyAuthentication.responseFormat === "json") {
        return context.json({
          "subsonic-response": {
            status: "failed",
            version: SUBSONIC_VERSION,
            error: { code: 40, message: "Wrong username or password" },
          },
        });
      }

      throw appError(401, ApiErrorCode.UNAUTHORIZED, "Sign in again");
    }

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

      const verification = auth
        ? await verifier.verify(auth, {
            clientAddress: getClientAddress(context, { trustedProxy: config.trustedProxy }),
          })
        : "denied";

      if (verification === "limited") {
        throw appError(429, ApiErrorCode.RATE_LIMITED, "Too many sign-in attempts. Try again later.");
      }

      if (!auth || verification !== "ok") {
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

      const verification = await verifier.verify(auth, {
        clientAddress: getClientAddress(context, { trustedProxy: config.trustedProxy }),
      });

      if (verification === "limited") {
        throw appError(429, ApiErrorCode.RATE_LIMITED, "Too many sign-in attempts. Try again later.");
      }

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

type ProxyAuthentication = {
  auth: Auth | null;
  responseFormat: string | null;
};

async function getProxyAuthentication(request: Request): Promise<ProxyAuthentication> {
  const requestUrl = new URL(request.url);
  const queryAuth = authFromQuery(requestUrl);
  if (queryAuth) return { auth: queryAuth, responseFormat: requestUrl.searchParams.get("f") };

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/x-www-form-urlencoded")) {
    return { auth: null, responseFormat: requestUrl.searchParams.get("f") };
  }

  const formParameters = new URLSearchParams(await request.clone().text());
  const formAuthentication = queryAuthenticationSchema.safeParse(Object.fromEntries(formParameters));
  if (!formAuthentication.success) return { auth: null, responseFormat: formParameters.get("f") };

  const { u: user, t: token, s: salt } = formAuthentication.data;

  return {
    auth: user && token && salt ? { user, token, salt } : null,
    responseFormat: formParameters.get("f"),
  };
}
