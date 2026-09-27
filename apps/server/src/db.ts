import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS plays (
  id INTEGER PRIMARY KEY,
  user TEXT NOT NULL,
  song_id TEXT NOT NULL,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  artist_id TEXT,
  album TEXT NOT NULL,
  album_id TEXT,
  genre TEXT,
  cover_art TEXT,
  duration INTEGER NOT NULL,
  ms_played INTEGER NOT NULL,
  played_at INTEGER NOT NULL,
  device TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS plays_user_time ON plays (user, played_at);
CREATE TABLE IF NOT EXISTS spotify_tokens (
  user TEXT PRIMARY KEY,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  user TEXT NOT NULL,
  verifier TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`;

export function openDatabase(dataDir: string): DatabaseSync {
  if (dataDir !== ":memory:") mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(dataDir === ":memory:" ? ":memory:" : join(dataDir, "needle.db"));
  db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
  db.exec(SCHEMA);
  const columns = db.prepare("PRAGMA table_info(spotify_tokens)").all() as { name: string }[];
  if (!columns.some((c) => c.name === "scope")) db.exec("ALTER TABLE spotify_tokens ADD COLUMN scope TEXT NOT NULL DEFAULT ''");
  return db;
}
