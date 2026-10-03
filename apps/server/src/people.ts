import type { Person } from "@needle/shared";
import type { Database } from "./db/types.ts";

type Row = { can_request: number; can_spotify: number; can_youtube_music: number | null };
type Known = { user: string; admin: number; last_seen: number | null };
export type Permission = "request" | "spotify" | "youtubeMusic";
export type PersonPatch = {
  canRequest?: boolean | undefined;
  canSpotify?: boolean | undefined;
  canYouTubeMusic?: boolean | undefined;
};

export class People {
  constructor(db: Database) {
    this.db = db;
  }

  seen(user: string, admin: boolean, at = Date.now()) {
    this.db
      .prepare(
        `INSERT INTO seen (user, admin, last_seen) VALUES (?, ?, ?)
      ON CONFLICT(user) DO UPDATE SET admin = excluded.admin, last_seen = excluded.last_seen`,
      )
      .run(user, admin ? 1 : 0, at);
  }

  allowed(user: string, admin: boolean, what: Permission): boolean {
    const row = this.db
      .prepare("SELECT can_request, can_spotify, can_youtube_music FROM permissions WHERE user = ?")
      .get(user) as Row | undefined;
    if (what === "request") return admin || Boolean(row?.can_request);
    if (what === "youtubeMusic") return row?.can_youtube_music == null ? admin : Boolean(row.can_youtube_music);
    return row ? Boolean(row.can_spotify) : admin;
  }

  list(): Person[] {
    const rows = this.db
      .prepare(
        `SELECT user, admin, last_seen FROM seen
      UNION ALL SELECT user, 0, NULL FROM permissions WHERE user NOT IN (SELECT user FROM seen)
      ORDER BY admin DESC, user`,
      )
      .all() as Known[];
    return rows.map((r) => this.person(r.user, Boolean(r.admin), r.last_seen));
  }

  set(user: string, patch: PersonPatch): Person {
    const current = this.list().find((p) => p.user === user) ?? this.person(user, false, null);
    this.db
      .prepare(
        `INSERT INTO permissions (user, can_request, can_spotify, can_youtube_music) VALUES (?, ?, ?, ?)
      ON CONFLICT(user) DO UPDATE SET can_request = excluded.can_request, can_spotify = excluded.can_spotify,
      can_youtube_music = excluded.can_youtube_music`,
      )
      .run(
        user,
        (patch.canRequest ?? current.canRequest) ? 1 : 0,
        (patch.canSpotify ?? current.canSpotify) ? 1 : 0,
        (patch.canYouTubeMusic ?? current.canYouTubeMusic) ? 1 : 0,
      );
    return this.person(user, current.admin, current.lastSeen);
  }

  private person(user: string, admin: boolean, lastSeen: number | null): Person {
    return {
      user,
      admin,
      canRequest: this.allowed(user, admin, "request"),
      canSpotify: this.allowed(user, admin, "spotify"),
      canYouTubeMusic: this.allowed(user, admin, "youtubeMusic"),
      lastSeen,
    };
  }

  private readonly db: Database;
}
