import { ApiErrorCode, AUTH_HEADERS } from "@needle/shared";
import { z } from "zod";
import { authFromHeaders } from "../navidrome.ts";
import { getClientAddress } from "./client-address.ts";
import type { App } from "./context.ts";
import { appError } from "./errors.ts";
import type { InMemoryNavidromeVerifier } from "./navidrome-verifier.ts";
import { validate } from "./validation.ts";

const authenticationHeadersSchema = z.object({
  [AUTH_HEADERS.user]: z.string().min(1).max(200).optional(),
  [AUTH_HEADERS.token]: z.string().min(1).max(4096).optional(),
  [AUTH_HEADERS.salt]: z.string().min(1).max(200).optional(),
});

type AuthenticationDependencies = {
  trustedProxy: boolean;
  verifier: InMemoryNavidromeVerifier;
};

export function registerAuthentication(app: App, { trustedProxy, verifier }: AuthenticationDependencies) {
  app.use("/api/*", validate("header", authenticationHeadersSchema));

  app.use("/api/*", async (context, next) => {
    const auth = authFromHeaders(context.req.raw.headers);
    const verification = auth
      ? await verifier.verify(auth, { clientAddress: getClientAddress(context, { trustedProxy }) })
      : "denied";

    if (verification === "limited") {
      throw appError(429, ApiErrorCode.RATE_LIMITED, "Too many sign-in attempts. Try again later.");
    }

    if (verification === "down") {
      throw appError(503, ApiErrorCode.SERVICE_UNAVAILABLE, "Navidrome isn't responding");
    }

    if (!auth || verification === "denied") {
      throw appError(401, ApiErrorCode.UNAUTHORIZED, "Sign in again");
    }

    context.set("auth", auth);

    await next();
  });
}
