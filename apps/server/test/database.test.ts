import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { chmod, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openDatabase, openDatabaseWithBackup } from "../src/db/database.ts";

const { TEMPORARY_BACKUP_ID, temporaryBackupModes } = vi.hoisted(() => ({
  TEMPORARY_BACKUP_ID: "00000000-0000-4000-8000-000000000000",
  temporaryBackupModes: [] as number[],
}));

vi.mock("node:crypto", () => ({ randomUUID: () => TEMPORARY_BACKUP_ID }));
vi.mock("node:sqlite", async (importOriginal) => {
  const sqlite = await importOriginal<{ backup: typeof backup; DatabaseSync: typeof DatabaseSync }>();

  return {
    ...sqlite,
    backup: async (...backupArguments: Parameters<typeof sqlite.backup>) => {
      const [, backupPath] = backupArguments;
      if (backupPath.toString().includes(".tmp-")) temporaryBackupModes.push(statSync(backupPath).mode & 0o777);

      return sqlite.backup(...backupArguments);
    },
  };
});

const LEGACY_SCHEMA = `
CREATE TABLE plays (
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
CREATE INDEX plays_user_time ON plays (user, played_at);
CREATE TABLE spotify_tokens (
  user TEXT PRIMARY KEY,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE requests (
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
CREATE TABLE youtube_music_tokens (
  user TEXT PRIMARY KEY,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  scope TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  reconnect INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE youtube_music_logins (
  user TEXT PRIMARY KEY,
  device_code TEXT NOT NULL,
  user_code TEXT NOT NULL,
  verification_url TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  interval INTEGER NOT NULL,
  next_poll INTEGER NOT NULL
);
CREATE TABLE seen (
  user TEXT PRIMARY KEY,
  admin INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);
CREATE TABLE permissions (
  user TEXT PRIMARY KEY,
  can_request INTEGER NOT NULL,
  can_spotify INTEGER NOT NULL
);
CREATE TABLE profiles (
  user TEXT PRIMARY KEY,
  photo BLOB NOT NULL,
  type TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE listenbrainz (
  user TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  lb_user TEXT NOT NULL,
  navidrome_linked INTEGER NOT NULL DEFAULT 0,
  connected_at INTEGER NOT NULL
);
CREATE TABLE oauth_states (
  state TEXT PRIMARY KEY,
  user TEXT NOT NULL,
  verifier TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`;

const temporaryDirectories: string[] = [];
const execFileAsync = promisify(execFile);

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "needle-database-"));
  temporaryDirectories.push(directory);

  return directory;
}

function createLegacyDatabase(directory: string): DatabaseSync {
  const database = new DatabaseSync(join(directory, "needle.db"));
  database.exec(LEGACY_SCHEMA);

  return database;
}

function columnNames(database: DatabaseSync, tableName: string): string[] {
  return (database.prepare(`PRAGMA table_info(${tableName})`).all() as { name: string }[]).map(
    (databaseColumn) => databaseColumn.name,
  );
}

function databaseIntegrity(databasePath: string): string {
  const database = new DatabaseSync(databasePath, { readOnly: true });

  try {
    const integrityCheckResult = database.prepare("PRAGMA integrity_check").get() as { integrity_check: string };

    return integrityCheckResult.integrity_check;
  } finally {
    database.close();
  }
}

function fileMode(filePath: string): number {
  return statSync(filePath).mode & 0o777;
}

afterEach(async () => {
  temporaryBackupModes.length = 0;
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("database migrations", () => {
  it("creates the current schema and migration history for a fresh database", async () => {
    const directory = await temporaryDirectory();
    await chmod(directory, 0o755);
    const database = await openDatabaseWithBackup(directory);

    expect(columnNames(database, "spotify_tokens")).toEqual(expect.arrayContaining(["scope", "enabled"]));
    expect(columnNames(database, "permissions")).toContain("can_youtube_music");
    expect(database.prepare("SELECT COUNT(*) AS count FROM needle_migrations").get()).toEqual({ count: 4 });
    expect(existsSync(join(directory, "needle.pre-migrations.db"))).toBe(false);
    expect(fileMode(directory)).toBe(0o700);
    expect(fileMode(join(directory, "needle.db"))).toBe(0o600);
    expect(fileMode(join(directory, "needle.db-wal"))).toBe(0o600);
    expect(fileMode(join(directory, "needle.db-shm"))).toBe(0o600);

    database.close();
  });

  it("restricts an existing database and data directory before opening them", async () => {
    const directory = await temporaryDirectory();
    const initialDatabase = await openDatabaseWithBackup(directory);

    const databasePath = join(directory, "needle.db");
    const writeAheadLogPath = `${databasePath}-wal`;
    const sharedMemoryPath = `${databasePath}-shm`;
    await chmod(directory, 0o755);
    await chmod(databasePath, 0o666);
    await chmod(writeAheadLogPath, 0o666);
    await chmod(sharedMemoryPath, 0o666);

    const database = openDatabase(directory);

    expect(fileMode(directory)).toBe(0o700);
    expect(fileMode(databasePath)).toBe(0o600);
    expect(fileMode(writeAheadLogPath)).toBe(0o600);
    expect(fileMode(sharedMemoryPath)).toBe(0o600);

    database.close();
    initialDatabase.close();
  });

  it("adopts an older database, preserves rows and creates one backup", async () => {
    const directory = await temporaryDirectory();
    const legacy = createLegacyDatabase(directory);
    legacy
      .prepare("INSERT INTO spotify_tokens (user, access_token, refresh_token, expires_at) VALUES (?, ?, ?, ?)")
      .run("alex", "access", "refresh", 123);
    legacy
      .prepare(
        `INSERT INTO requests (user, kind, ref, title, artist, state, created, updated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run("alex", "album", "album-1", "Album", "Artist", "wanted", 1, 1);
    legacy.close();

    expect(() => openDatabase(directory)).toThrow(/backup support/);

    const database = await openDatabaseWithBackup(directory);

    expect(
      database
        .prepare("SELECT user, access_token, refresh_token, expires_at, scope, enabled FROM spotify_tokens")
        .get(),
    ).toEqual({
      user: "alex",
      access_token: "access",
      refresh_token: "refresh",
      expires_at: 123,
      scope: "",
      enabled: 1,
    });
    expect(database.prepare("SELECT user, kind, ref, title, artist, state FROM requests").get()).toEqual({
      user: "alex",
      kind: "album",
      ref: "album-1",
      title: "Album",
      artist: "Artist",
      state: "wanted",
    });
    expect(columnNames(database, "permissions")).toContain("can_youtube_music");
    expect(existsSync(join(directory, "needle.pre-migrations.db"))).toBe(true);
    expect(fileMode(join(directory, "needle.db"))).toBe(0o600);
    expect(fileMode(join(directory, "needle.pre-migrations.db"))).toBe(0o600);
    expect(temporaryBackupModes).toEqual([0o600]);

    database.close();

    const backupDatabase = new DatabaseSync(join(directory, "needle.pre-migrations.db"));
    expect(columnNames(backupDatabase, "spotify_tokens")).not.toContain("scope");
    expect(backupDatabase.prepare("SELECT user, access_token FROM spotify_tokens").get()).toEqual({
      user: "alex",
      access_token: "access",
    });
    backupDatabase.close();

    const backupModifiedAt = statSync(join(directory, "needle.pre-migrations.db")).mtimeMs;
    const reopened = openDatabase(directory);

    expect(reopened.prepare("SELECT COUNT(*) AS count FROM needle_migrations").get()).toEqual({ count: 4 });
    expect(statSync(join(directory, "needle.pre-migrations.db")).mtimeMs).toBe(backupModifiedAt);

    reopened.close();
  });

  it("adopts the current legacy schema without changing existing column values", async () => {
    const directory = await temporaryDirectory();
    const legacy = createLegacyDatabase(directory);
    legacy.exec(
      "ALTER TABLE spotify_tokens ADD COLUMN scope TEXT NOT NULL DEFAULT ''; ALTER TABLE spotify_tokens ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1; ALTER TABLE permissions ADD COLUMN can_youtube_music INTEGER;",
    );
    legacy
      .prepare("INSERT INTO permissions (user, can_request, can_spotify, can_youtube_music) VALUES (?, ?, ?, ?)")
      .run("alex", 1, 0, null);
    legacy.close();

    const database = await openDatabaseWithBackup(directory);

    expect(database.prepare("SELECT * FROM permissions WHERE user = ?").get("alex")).toEqual({
      user: "alex",
      can_request: 1,
      can_spotify: 0,
      can_youtube_music: null,
    });

    database.close();
  });

  it("replaces a partial backup atomically before adopting a legacy database", async () => {
    const directory = await temporaryDirectory();
    const legacy = createLegacyDatabase(directory);
    legacy.prepare("INSERT INTO seen (user, admin, last_seen) VALUES (?, ?, ?)").run("alex", 1, 123);
    legacy.close();

    const backupPath = join(directory, "needle.pre-migrations.db");
    await writeFile(backupPath, "partial backup");
    const temporaryBackupPath = `${backupPath}.tmp-${process.pid}-${TEMPORARY_BACKUP_ID}`;
    await writeFile(`${temporaryBackupPath}-shm`, "temporary shared memory");

    const database = await openDatabaseWithBackup(directory);
    database.close();

    expect(databaseIntegrity(backupPath)).toBe("ok");

    const databaseFiles = await readdir(directory);
    expect(databaseFiles.some((databaseFile) => databaseFile.startsWith("needle.pre-migrations.db.tmp"))).toBe(false);

    const backupDatabase = new DatabaseSync(backupPath, { readOnly: true });
    expect(backupDatabase.prepare("SELECT * FROM seen").get()).toEqual({ user: "alex", admin: 1, last_seen: 123 });
    backupDatabase.close();
  });

  it("replaces an empty valid SQLite backup with the legacy Needle database", async () => {
    const directory = await temporaryDirectory();
    const legacy = createLegacyDatabase(directory);
    legacy.prepare("INSERT INTO seen (user, admin, last_seen) VALUES (?, ?, ?)").run("alex", 1, 123);
    legacy.close();

    const backupPath = join(directory, "needle.pre-migrations.db");
    const emptyBackup = new DatabaseSync(backupPath);
    emptyBackup.close();

    const database = await openDatabaseWithBackup(directory);
    database.close();

    const backupDatabase = new DatabaseSync(backupPath, { readOnly: true });
    expect(backupDatabase.prepare("SELECT * FROM seen").get()).toEqual({ user: "alex", admin: 1, last_seen: 123 });
    backupDatabase.close();
  });

  it("keeps an existing valid backup during first adoption", async () => {
    const directory = await temporaryDirectory();
    const legacy = createLegacyDatabase(directory);
    legacy.prepare("INSERT INTO seen (user, admin, last_seen) VALUES (?, ?, ?)").run("alex", 1, 123);

    const backupPath = join(directory, "needle.pre-migrations.db");
    await backup(legacy, backupPath);
    legacy.close();
    await chmod(backupPath, 0o666);

    const backupModifiedAt = statSync(backupPath).mtimeMs;
    const database = await openDatabaseWithBackup(directory);
    database.close();

    expect(statSync(backupPath).mtimeMs).toBe(backupModifiedAt);
    expect(databaseIntegrity(backupPath)).toBe("ok");
    expect(fileMode(backupPath)).toBe(0o600);
  });

  it("refuses a symbolic link as the active database without changing its target", async () => {
    const directory = await temporaryDirectory();
    const targetPath = join(directory, "target.db");
    await writeFile(targetPath, "unchanged");
    await symlink(targetPath, join(directory, "needle.db"));

    await expect(openDatabaseWithBackup(directory)).rejects.toThrow(/symbolic link/);
    expect(await readFile(targetPath, "utf8")).toBe("unchanged");
  });

  it("refuses a symbolic link as an active database sidecar", async () => {
    const directory = await temporaryDirectory();
    const targetPath = join(directory, "target-wal");
    await writeFile(targetPath, "unchanged");
    await symlink(targetPath, join(directory, "needle.db-wal"));

    await expect(openDatabaseWithBackup(directory)).rejects.toThrow(/symbolic link/);
    expect(await readFile(targetPath, "utf8")).toBe("unchanged");
  });

  it("refuses a symbolic link as the migration backup without changing its target", async () => {
    const directory = await temporaryDirectory();
    const legacy = createLegacyDatabase(directory);
    legacy.close();

    const targetPath = join(directory, "backup-target.db");
    await writeFile(targetPath, "unchanged");
    await symlink(targetPath, join(directory, "needle.pre-migrations.db"));

    await expect(openDatabaseWithBackup(directory)).rejects.toThrow(/symbolic link/);
    expect(await readFile(targetPath, "utf8")).toBe("unchanged");
  });

  it("refuses a symbolic link as the temporary migration backup without changing its target", async () => {
    const directory = await temporaryDirectory();
    const legacy = createLegacyDatabase(directory);
    legacy.close();

    const backupPath = join(directory, "needle.pre-migrations.db");
    const temporaryBackupPath = `${backupPath}.tmp-${process.pid}-${TEMPORARY_BACKUP_ID}`;
    const targetPath = join(directory, "temporary-backup-target.db");
    await writeFile(targetPath, "unchanged");
    await symlink(targetPath, temporaryBackupPath);

    await expect(openDatabaseWithBackup(directory)).rejects.toThrow(/symbolic link/);
    expect(await readFile(targetPath, "utf8")).toBe("unchanged");
  });

  it("uses no backup file for an in-memory database", () => {
    const database = openDatabase(":memory:");

    expect(database.prepare("SELECT COUNT(*) AS count FROM needle_migrations").get()).toEqual({ count: 4 });

    database.close();
  });

  it("rolls back and refuses startup when an existing table has an incompatible shape", async () => {
    const directory = await temporaryDirectory();
    const databasePath = join(directory, "needle.db");
    const invalid = new DatabaseSync(databasePath);
    invalid.exec("CREATE TABLE plays (id TEXT PRIMARY KEY)");
    invalid.close();

    await expect(openDatabaseWithBackup(directory)).rejects.toThrow(/plays/);
    expect(existsSync(join(directory, "needle.pre-migrations.db"))).toBe(true);

    const inspected = new DatabaseSync(databasePath);
    expect(
      inspected.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'needle_migrations'").get(),
    ).toBeUndefined();
    expect(columnNames(inspected, "plays")).toEqual(["id"]);
    inspected.close();
  });

  it("refuses startup when migration history has an incompatible shape", async () => {
    const directory = await temporaryDirectory();
    const database = await openDatabaseWithBackup(directory);
    database.exec(`ALTER TABLE needle_migrations RENAME TO old_migrations;
      CREATE TABLE needle_migrations (version INTEGER, name TEXT);
      INSERT INTO needle_migrations (version, name) SELECT version, name FROM old_migrations;
      DROP TABLE old_migrations;`);
    database.close();

    expect(() => openDatabase(directory)).toThrow(/needle_migrations/);
  });

  it("serializes concurrent startup migration planning", async () => {
    const directory = await temporaryDirectory();
    const legacy = createLegacyDatabase(directory);
    legacy.close();

    const databaseModule = new URL("../src/db/database.ts", import.meta.url).href;
    const script = `import { openDatabaseWithBackup } from ${JSON.stringify(databaseModule)};
      const database = await openDatabaseWithBackup(${JSON.stringify(directory)});
      database.close();`;
    const command = ["--disable-warning=ExperimentalWarning", "--input-type=module", "--eval", script];

    await Promise.all([execFileAsync(process.execPath, command), execFileAsync(process.execPath, command)]);

    const database = openDatabase(directory);
    expect(database.prepare("SELECT COUNT(*) AS count FROM needle_migrations").get()).toEqual({ count: 4 });
    database.close();
  });

  it("serializes concurrent startup for a fresh database", async () => {
    const directory = await temporaryDirectory();
    const databaseModule = new URL("../src/db/database.ts", import.meta.url).href;
    const script = `import { openDatabaseWithBackup } from ${JSON.stringify(databaseModule)};
      const database = await openDatabaseWithBackup(${JSON.stringify(directory)});
      database.close();`;
    const command = ["--disable-warning=ExperimentalWarning", "--input-type=module", "--eval", script];

    await Promise.all([execFileAsync(process.execPath, command), execFileAsync(process.execPath, command)]);

    const database = openDatabase(directory);
    expect(database.prepare("SELECT COUNT(*) AS count FROM needle_migrations").get()).toEqual({ count: 4 });
    database.close();
  });
});
