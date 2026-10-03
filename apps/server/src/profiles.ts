import type { Database } from "./db/types.ts";

export const PHOTO_TYPES = new Set(["image/webp", "image/jpeg", "image/png"]);
export const PHOTO_MAX_BYTES = 400_000;

export class Profiles {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  photo(user: string): string | null {
    const row = this.db.prepare("SELECT photo, type FROM profiles WHERE user = ?").get(user) as
      { photo: Uint8Array; type: string } | undefined;
    return row ? `data:${row.type};base64,${Buffer.from(row.photo).toString("base64")}` : null;
  }

  setPhoto(user: string, photo: Uint8Array, type: string) {
    this.db
      .prepare(
        `INSERT INTO profiles (user, photo, type, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(user) DO UPDATE SET photo = excluded.photo, type = excluded.type, updated_at = excluded.updated_at`,
      )
      .run(user, photo, type, Date.now());
  }

  removePhoto(user: string) {
    this.db.prepare("DELETE FROM profiles WHERE user = ?").run(user);
  }
}
