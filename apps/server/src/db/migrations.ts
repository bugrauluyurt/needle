import { BASE_SCHEMA_SQL } from "./schema.ts";
import type { ExpectedColumn } from "./schema.ts";

export const MIGRATION_TABLE = "needle_migrations";

export const MIGRATION_COLUMNS: readonly ExpectedColumn[] = [
  { name: "version", type: "INTEGER", isPrimary: true },
  { name: "name", type: "TEXT", isRequired: true },
  { name: "applied_at", type: "INTEGER", isRequired: true },
];

type ConditionalColumn = {
  table: string;
  column: string;
};

export type DatabaseMigration = {
  version: number;
  name: string;
  sql: string;
  unlessColumnExists?: ConditionalColumn;
};

export const DATABASE_MIGRATIONS: readonly DatabaseMigration[] = [
  { version: 1, name: "initial schema", sql: BASE_SCHEMA_SQL },
  {
    version: 2,
    name: "spotify scopes",
    sql: "ALTER TABLE spotify_tokens ADD COLUMN scope TEXT NOT NULL DEFAULT ''",
    unlessColumnExists: { table: "spotify_tokens", column: "scope" },
  },
  {
    version: 3,
    name: "spotify enabled",
    sql: "ALTER TABLE spotify_tokens ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1",
    unlessColumnExists: { table: "spotify_tokens", column: "enabled" },
  },
  {
    version: 4,
    name: "youtube music permissions",
    sql: "ALTER TABLE permissions ADD COLUMN can_youtube_music INTEGER",
    unlessColumnExists: { table: "permissions", column: "can_youtube_music" },
  },
];
