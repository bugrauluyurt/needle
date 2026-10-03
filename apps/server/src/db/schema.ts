export const BASE_SCHEMA_SQL = `
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
CREATE TABLE IF NOT EXISTS youtube_music_tokens (
  user TEXT PRIMARY KEY,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  scope TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  reconnect INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS youtube_music_logins (
  user TEXT PRIMARY KEY,
  device_code TEXT NOT NULL,
  user_code TEXT NOT NULL,
  verification_url TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  interval INTEGER NOT NULL,
  next_poll INTEGER NOT NULL
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
CREATE TABLE IF NOT EXISTS listenbrainz (
  user TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  lb_user TEXT NOT NULL,
  navidrome_linked INTEGER NOT NULL DEFAULT 0,
  connected_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  user TEXT NOT NULL,
  verifier TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`;

export type ExpectedColumn = {
  name: string;
  type: "BLOB" | "INTEGER" | "REAL" | "TEXT";
  isRequired?: boolean;
  isPrimary?: boolean;
  defaultValue?: string;
};

export const EXPECTED_SCHEMA: Record<string, readonly ExpectedColumn[]> = {
  plays: [
    { name: "id", type: "INTEGER", isPrimary: true },
    { name: "user", type: "TEXT", isRequired: true },
    { name: "song_id", type: "TEXT", isRequired: true },
    { name: "title", type: "TEXT", isRequired: true },
    { name: "artist", type: "TEXT", isRequired: true },
    { name: "artist_id", type: "TEXT" },
    { name: "album", type: "TEXT", isRequired: true },
    { name: "album_id", type: "TEXT" },
    { name: "genre", type: "TEXT" },
    { name: "cover_art", type: "TEXT" },
    { name: "duration", type: "INTEGER", isRequired: true },
    { name: "ms_played", type: "INTEGER", isRequired: true },
    { name: "played_at", type: "INTEGER", isRequired: true },
    { name: "device", type: "TEXT", isRequired: true },
  ],
  spotify_tokens: [
    { name: "user", type: "TEXT", isPrimary: true },
    { name: "access_token", type: "TEXT", isRequired: true },
    { name: "refresh_token", type: "TEXT", isRequired: true },
    { name: "expires_at", type: "INTEGER", isRequired: true },
    { name: "scope", type: "TEXT", isRequired: true, defaultValue: "''" },
    { name: "enabled", type: "INTEGER", isRequired: true, defaultValue: "1" },
  ],
  requests: [
    { name: "id", type: "INTEGER", isPrimary: true },
    { name: "user", type: "TEXT", isRequired: true },
    { name: "kind", type: "TEXT", isRequired: true },
    { name: "ref", type: "TEXT", isRequired: true },
    { name: "title", type: "TEXT", isRequired: true },
    { name: "artist", type: "TEXT", isRequired: true },
    { name: "cover_url", type: "TEXT" },
    { name: "state", type: "TEXT", isRequired: true },
    { name: "progress", type: "REAL" },
    { name: "detail", type: "TEXT" },
    { name: "transfer", type: "TEXT" },
    { name: "created", type: "INTEGER", isRequired: true },
    { name: "updated", type: "INTEGER", isRequired: true },
  ],
  youtube_music_tokens: [
    { name: "user", type: "TEXT", isPrimary: true },
    { name: "access_token", type: "TEXT", isRequired: true },
    { name: "refresh_token", type: "TEXT", isRequired: true },
    { name: "expires_at", type: "INTEGER", isRequired: true },
    { name: "scope", type: "TEXT", isRequired: true },
    { name: "enabled", type: "INTEGER", isRequired: true, defaultValue: "1" },
    { name: "reconnect", type: "INTEGER", isRequired: true, defaultValue: "0" },
  ],
  youtube_music_logins: [
    { name: "user", type: "TEXT", isPrimary: true },
    { name: "device_code", type: "TEXT", isRequired: true },
    { name: "user_code", type: "TEXT", isRequired: true },
    { name: "verification_url", type: "TEXT", isRequired: true },
    { name: "expires_at", type: "INTEGER", isRequired: true },
    { name: "interval", type: "INTEGER", isRequired: true },
    { name: "next_poll", type: "INTEGER", isRequired: true },
  ],
  seen: [
    { name: "user", type: "TEXT", isPrimary: true },
    { name: "admin", type: "INTEGER", isRequired: true },
    { name: "last_seen", type: "INTEGER", isRequired: true },
  ],
  permissions: [
    { name: "user", type: "TEXT", isPrimary: true },
    { name: "can_request", type: "INTEGER", isRequired: true },
    { name: "can_spotify", type: "INTEGER", isRequired: true },
    { name: "can_youtube_music", type: "INTEGER" },
  ],
  profiles: [
    { name: "user", type: "TEXT", isPrimary: true },
    { name: "photo", type: "BLOB", isRequired: true },
    { name: "type", type: "TEXT", isRequired: true },
    { name: "updated_at", type: "INTEGER", isRequired: true },
  ],
  listenbrainz: [
    { name: "user", type: "TEXT", isPrimary: true },
    { name: "token", type: "TEXT", isRequired: true },
    { name: "lb_user", type: "TEXT", isRequired: true },
    { name: "navidrome_linked", type: "INTEGER", isRequired: true, defaultValue: "0" },
    { name: "connected_at", type: "INTEGER", isRequired: true },
  ],
  oauth_states: [
    { name: "state", type: "TEXT", isPrimary: true },
    { name: "user", type: "TEXT", isRequired: true },
    { name: "verifier", type: "TEXT", isRequired: true },
    { name: "created_at", type: "INTEGER", isRequired: true },
  ],
};
