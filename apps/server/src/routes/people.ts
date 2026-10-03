import type { Authorization } from "../http/authorization.ts";
import type { App } from "../http/context.ts";
import type { People, PersonPatch } from "../people.ts";

type PeopleRouteDependencies = {
  authorization: Authorization;
  people: People;
};

export function registerPeopleRoutes(app: App, { authorization, people }: PeopleRouteDependencies) {
  app.get("/api/people", async (context) => {
    const auth = context.get("auth");

    if (!(await authorization.isAdmin(auth))) {
      return authorization.forbiddenResponse(context, "Only Navidrome admins can see people");
    }

    return context.json(people.list());
  });

  app.put("/api/people/:user", async (context) => {
    const auth = context.get("auth");

    if (!(await authorization.isAdmin(auth))) {
      return authorization.forbiddenResponse(context, "Only Navidrome admins can change people");
    }

    const user = context.req.param("user").trim();

    if (!user) return context.json({ error: "Which user?" }, 400);

    return context.json(people.set(user, await context.req.json<PersonPatch>()));
  });
}
