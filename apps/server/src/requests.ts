import type { DatabaseSync } from "node:sqlite";
import type { RequestItem } from "@needle/shared";

export type RequestRow = {
  id: number;
  user: string;
  kind: RequestItem["kind"];
  ref: string;
  title: string;
  artist: string;
  cover_url: string | null;
  state: RequestItem["state"];
  progress: number | null;
  detail: string | null;
  transfer: string | null;
  created: number;
};

type NewRequest = Pick<RequestRow, "user" | "kind" | "ref" | "title" | "artist" | "cover_url" | "state">;
type Patch = Partial<Pick<RequestRow, "state" | "progress" | "detail" | "transfer">>;

const LIST_LIMIT = 50;
export const ACTIVE_SONG = ["searching", "downloading", "moving"];

export const toItem = (r: RequestRow): RequestItem => ({
  id: r.id,
  kind: r.kind,
  ref: r.ref,
  title: r.title,
  artist: r.artist,
  coverUrl: r.cover_url,
  state: r.state,
  progress: r.progress,
  detail: r.detail,
  created: r.created,
});

export const toItemFor = (r: RequestRow): RequestItem => ({ ...toItem(r), user: r.user });

export class Requests {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  add(r: NewRequest): RequestRow {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO requests (user, kind, ref, title, artist, cover_url, state, progress, detail, transfer, created, updated)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)
      ON CONFLICT(user, kind, ref) DO UPDATE SET state = excluded.state, progress = NULL, detail = NULL, transfer = NULL, created = excluded.created, updated = excluded.updated`,
      )
      .run(r.user, r.kind, r.ref, r.title, r.artist, r.cover_url, r.state, now, now);
    return this.db
      .prepare("SELECT * FROM requests WHERE user = ? AND kind = ? AND ref = ?")
      .get(r.user, r.kind, r.ref) as RequestRow;
  }

  get(id: number): RequestRow | undefined {
    return this.db.prepare("SELECT * FROM requests WHERE id = ?").get(id) as RequestRow | undefined;
  }

  list(user: string): RequestRow[] {
    return this.db
      .prepare("SELECT * FROM requests WHERE user = ? ORDER BY created DESC LIMIT ?")
      .all(user, LIST_LIMIT) as RequestRow[];
  }

  others(user: string): RequestRow[] {
    return this.db
      .prepare("SELECT * FROM requests WHERE user != ? ORDER BY created DESC LIMIT ?")
      .all(user, LIST_LIMIT) as RequestRow[];
  }

  byRefs(user: string, kind: RequestItem["kind"], refs: string[]): RequestRow[] {
    if (!refs.length) return [];
    return this.db
      .prepare(`SELECT * FROM requests WHERE user = ? AND kind = ? AND ref IN (${refs.map(() => "?").join(", ")})`)
      .all(user, kind, ...refs) as RequestRow[];
  }

  active(): RequestRow[] {
    return this.db
      .prepare(`SELECT * FROM requests WHERE kind = 'song' AND state IN (${ACTIVE_SONG.map(() => "?").join(", ")})`)
      .all(...ACTIVE_SONG) as RequestRow[];
  }

  update(id: number, patch: Patch) {
    const keys = Object.keys(patch) as (keyof Patch)[];
    if (!keys.length) return;
    this.db
      .prepare(`UPDATE requests SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated = ? WHERE id = ?`)
      .run(...keys.map((k) => patch[k] ?? null), Date.now(), id);
  }

  remove(user: string | null, id: number) {
    if (user === null) this.db.prepare("DELETE FROM requests WHERE id = ?").run(id);
    else this.db.prepare("DELETE FROM requests WHERE user = ? AND id = ?").run(user, id);
  }
}
