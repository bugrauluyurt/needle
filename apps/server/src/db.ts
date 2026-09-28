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
CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY,
  user TEXT NOT NULL,
  kind TEXT NOT NULL,
  ref TEXT NOT NULL,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  cover_url TEXT,
  state TEXT NOT NULL,
  progress REAL,
  detail TEXT,
  transfer TEXT,
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL,
  UNIQUE (user, kind, ref)
);
CREATE TABLE IF NOT EXISTS seen (
  user TEXT PRIMARY KEY,
  admin INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS permissions (
  user TEXT PRIMARY KEY,
  can_request INTEGER NOT NULL,
  can_spotify INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS profiles (
  user TEXT PRIMARY KEY,
  photo BLOB NOT NULL,
  type TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  user TEXT NOT NULL,
  verifier TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`;

function addColumn(db: DatabaseSync, table: string, column: string, ddl: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!columns.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}

export function openDatabase(dataDir: string): DatabaseSync {
  if (dataDir !== ":memory:") mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(dataDir === ":memory:" ? ":memory:" : join(dataDir, "needle.db"));
  db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
  db.exec(SCHEMA);
  addColumn(db, "spotify_tokens", "scope", "TEXT NOT NULL DEFAULT ''");
  addColumn(db, "spotify_tokens", "enabled", "INTEGER NOT NULL DEFAULT 1");
  return db;
}
