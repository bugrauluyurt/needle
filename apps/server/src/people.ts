import type { DatabaseSync } from "node:sqlite";
import type { Person } from "@needle/shared";
import type { Auth, Navidrome } from "./navidrome.ts";

type Row = { can_request: number; can_spotify: number };
export type Permission = "request" | "spotify";
export type PersonPatch = { canRequest?: boolean | undefined; canSpotify?: boolean | undefined };

export class People {
  private readonly db: DatabaseSync;
  private readonly navidrome: Navidrome;

  constructor(db: DatabaseSync, navidrome: Navidrome) {
    this.db = db;
    this.navidrome = navidrome;
  }

  allowed(user: string, admin: boolean, what: Permission): boolean {
    const row = this.db.prepare("SELECT can_request, can_spotify FROM permissions WHERE user = ?").get(user) as Row | undefined;
    if (what === "request") return admin || Boolean(row?.can_request);
    return row ? Boolean(row.can_spotify) : admin;
  }

  async list(auth: Auth): Promise<Person[]> {
    const r = await this.navidrome.call<{ users: { user?: { username: string; adminRole?: boolean }[] } }>(auth, "getUsers");
    return (r.users.user ?? []).map((u) => {
      const admin = Boolean(u.adminRole);
      return { user: u.username, admin, canRequest: this.allowed(u.username, admin, "request"), canSpotify: this.allowed(u.username, admin, "spotify") };
    });
  }

  set(person: Person, patch: PersonPatch): Person {
    const next = { ...person, canRequest: patch.canRequest ?? person.canRequest, canSpotify: patch.canSpotify ?? person.canSpotify };
    this.db.prepare(`INSERT INTO permissions (user, can_request, can_spotify) VALUES (?, ?, ?)
      ON CONFLICT(user) DO UPDATE SET can_request = excluded.can_request, can_spotify = excluded.can_spotify`)
      .run(person.user, next.canRequest ? 1 : 0, next.canSpotify ? 1 : 0);
    return { ...person, canRequest: this.allowed(person.user, person.admin, "request"), canSpotify: this.allowed(person.user, person.admin, "spotify") };
  }
}
