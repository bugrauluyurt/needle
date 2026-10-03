import { ApiErrorCode, AUTH_HEADERS } from "@needle/shared";
import { z } from "zod";
import type { Navidrome } from "../navidrome.ts";
import { authFromHeaders } from "../navidrome.ts";
import type { App } from "./context.ts";
import { appError } from "./errors.ts";
import { validate } from "./validation.ts";

const authenticationHeadersSchema = z.object({
  [AUTH_HEADERS.user]: z.string().min(1).max(200).optional(),
  [AUTH_HEADERS.token]: z.string().min(1).max(4096).optional(),
  [AUTH_HEADERS.salt]: z.string().min(1).max(200).optional(),
});

type AuthenticationDependencies = {
  navidrome: Navidrome;
};

export function registerAuthentication(app: App, { navidrome }: AuthenticationDependencies) {
  app.use("/api/*", validate("header", authenticationHeadersSchema));

  app.use("/api/*", async (context, next) => {
    const auth = authFromHeaders(context.req.raw.headers);
    const verification = auth ? await navidrome.verify(auth) : "denied";

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
