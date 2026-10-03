import { upgradeWebSocket } from "@hono/node-server";
import { createMiddleware } from "hono/factory";
import { Hono } from "hono";
import type { WebSocket } from "ws";
import { z } from "zod";
import type { DeviceConnection, DeviceHub } from "../devices.ts";
import { getClientAddress } from "../http/client-address.ts";
import type { App, AppContext, AppEnv } from "../http/context.ts";
import type { InMemoryNavidromeVerifier } from "../http/navidrome-verifier.ts";
import { authFromQuery } from "../navidrome.ts";

export const DEVICE_MAX_PAYLOAD_BYTES = 8 * 1024 * 1024;

const deviceQuerySchema = z.object({
  u: z.string().min(1).max(200),
  t: z.string().min(1).max(4096),
  s: z.string().min(1).max(200),
});

type DeviceRealtimeDependencies = {
  hub: DeviceHub;
  trustedProxy: boolean;
  verifier: InMemoryNavidromeVerifier;
};

export function createRealtimeApp(httpApp: App, dependencies: DeviceRealtimeDependencies) {
  const realtimeApp = new Hono<AppEnv>();

  registerDeviceRealtime(realtimeApp, dependencies);
  realtimeApp.all("*", (context) => httpApp.fetch(context.req.raw, context.env));

  return realtimeApp;
}

export function registerDeviceRealtime(app: App, { hub, trustedProxy, verifier }: DeviceRealtimeDependencies) {
  const authenticateDevice = createMiddleware<AppEnv>(async (context, next) => {
    const deviceRequestUrl = new URL(context.req.url);
    const deviceQuery = Object.fromEntries(deviceRequestUrl.searchParams);
    const deviceQueryResult = deviceQuerySchema.safeParse(deviceQuery);

    if (!deviceQueryResult.success) {
      return new Response(null, {
        status: Object.keys(deviceQuery).length ? 400 : 401,
      });
    }

    const deviceAuth = authFromQuery(deviceRequestUrl);

    if (!deviceAuth) return new Response(null, { status: 401 });

    const navidromeVerification = await verifier.verify(deviceAuth, {
      clientAddress: getClientAddress(context, { trustedProxy }),
    });

    if (navidromeVerification === "down") return new Response(null, { status: 503 });
    if (navidromeVerification === "limited") return new Response(null, { status: 429 });
    if (navidromeVerification !== "ok") return new Response(null, { status: 401 });

    context.set("auth", deviceAuth);

    await next();
  });

  app.get(
    "/api/devices",
    authenticateDevice,
    upgradeWebSocket(
      (context: AppContext) => {
        const user = context.get("auth").user;
        let connection: DeviceConnection | undefined;

        const detach = () => {
          if (!connection) return;

          hub.detach(connection);
          connection = undefined;
        };

        return {
          onOpen: (_webSocketEvent, webSocket) => {
            if (!webSocket.raw) {
              webSocket.close(1011, "socket unavailable");

              return;
            }

            connection = hub.attach(webSocket.raw as WebSocket, user, {
              managesEvents: false,
            });
          },
          onMessage: (event) => {
            if (connection) hub.receive(connection, event.data);
          },
          onClose: detach,
          onError: (_webSocketEvent, webSocket) => {
            detach();
            webSocket.close(1011, "socket error");
          },
        };
      },
      {
        onError: (error) => console.error("Device WebSocket handler failed", error),
      },
    ),
  );
}
