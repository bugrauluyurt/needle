import { z } from "zod";
import type { Authorization } from "../http/authorization.ts";
import type { App } from "../http/context.ts";
import { validate } from "../http/validation.ts";
import type { People } from "../people.ts";

const personParamsSchema = z.object({
  user: z.string().trim().min(1).max(200),
});
const personPatchSchema = z
  .object({
    canRequest: z.boolean().optional(),
    canSpotify: z.boolean().optional(),
    canYouTubeMusic: z.boolean().optional(),
  })
  .strict();

type PeopleRouteDependencies = {
  authorization: Authorization;
  people: People;
};

export function registerPeopleRoutes(app: App, { authorization, people }: PeopleRouteDependencies) {
  app.get("/api/people", authorization.requireAdmin("Only Navidrome admins can see people"), (context) =>
    context.json(people.list()),
  );

  app.put(
    "/api/people/:user",
    authorization.requireAdmin("Only Navidrome admins can change people"),
    validate("param", personParamsSchema),
    validate("json", personPatchSchema),
    (context) => {
      const { user } = context.req.valid("param");
      const patch = context.req.valid("json");

      return context.json(people.set(user, patch));
    },
  );
}
