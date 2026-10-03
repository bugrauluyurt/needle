import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { DATABASE_MIGRATIONS, MIGRATION_COLUMNS, MIGRATION_TABLE } from "./migrations.ts";
import { EXPECTED_SCHEMA } from "./schema.ts";
import type { ExpectedColumn } from "./schema.ts";
import type { Database, DatabaseColumn, DatabaseIndex, DatabaseIndexColumn } from "./types.ts";

const MEMORY_PATH = ":memory:";
const DATABASE_FILE = "needle.db";
const BACKUP_FILE = "needle.pre-migrations.db";

export function openDatabase(dataDir: string): Database {
  const { database, databaseExisted } = createDatabase(dataDir);

  try {
    const isFirstAdoption = !tableExists(database, MIGRATION_TABLE);
    if (dataDir !== MEMORY_PATH && isFirstAdoption && databaseExisted && hasApplicationTables(database)) {
      throw new Error("A populated legacy database must be opened with backup support");
    }

    migrate(database);

    return database;
  } catch (error) {
    database.close();

    throw error;
  }
}

export async function openDatabaseWithBackup(dataDir: string): Promise<Database> {
  if (dataDir === MEMORY_PATH) return openDatabase(dataDir);

  const { database, databaseExisted } = createDatabase(dataDir);

  try {
    const isFirstAdoption = !tableExists(database, MIGRATION_TABLE);
    if (isFirstAdoption && databaseExisted && hasApplicationTables(database)) {
      const backupPath = join(dataDir, BACKUP_FILE);
      await ensureBackup(database, backupPath);
    }

    if (isFirstAdoption) verifyLegacySchema(database);

    migrate(database);

    return database;
  } catch (error) {
    database.close();

    throw error;
  }
}

function createDatabase(dataDir: string): { database: Database; databaseExisted: boolean } {
  if (dataDir !== MEMORY_PATH) mkdirSync(dataDir, { recursive: true });

  const databasePath = dataDir === MEMORY_PATH ? MEMORY_PATH : join(dataDir, DATABASE_FILE);
  const databaseExisted = dataDir !== MEMORY_PATH && existsSync(databasePath);
  const database = new DatabaseSync(databasePath, { timeout: 5_000 });
  configureDatabase(database);

  return { database, databaseExisted };
}

function migrate(database: Database): void {
  database.exec("BEGIN IMMEDIATE");

  try {
    database.exec(`CREATE TABLE IF NOT EXISTS ${MIGRATION_TABLE} (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    )`);

    verifyColumns(database, MIGRATION_TABLE, MIGRATION_COLUMNS);

    const appliedMigrations = migrationHistory(database);
    validateMigrationHistory(appliedMigrations);

    for (const migration of DATABASE_MIGRATIONS) {
      if (appliedMigrations.has(migration.version)) continue;

      const condition = migration.unlessColumnExists;
      if (!condition || !columnExists(database, condition.table, condition.column)) database.exec(migration.sql);

      database
        .prepare(`INSERT INTO ${MIGRATION_TABLE} (version, name, applied_at) VALUES (?, ?, ?)`)
        .run(migration.version, migration.name, Date.now());
    }

    verifySchema(database);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");

    throw error;
  }
}

function migrationHistory(database: Database): Map<number, string> {
  if (!tableExists(database, MIGRATION_TABLE)) return new Map();

  const rows = database.prepare(`SELECT version, name FROM ${MIGRATION_TABLE} ORDER BY version`).all() as {
    version: number;
    name: string;
  }[];

  return new Map(rows.map((migration) => [migration.version, migration.name]));
}

function validateMigrationHistory(appliedMigrations: Map<number, string>): void {
  const knownMigrations = new Map(DATABASE_MIGRATIONS.map((migration) => [migration.version, migration.name]));

  for (const [version, name] of appliedMigrations) {
    if (knownMigrations.get(version) !== name)
      throw new Error(`Database migration ${version} is not supported by this Needle version`);
  }
}

function verifySchema(database: Database): void {
  verifyColumns(database, MIGRATION_TABLE, MIGRATION_COLUMNS);

  for (const [table, expectedColumns] of Object.entries(EXPECTED_SCHEMA)) {
    verifyColumns(database, table, expectedColumns);
  }

  const playIndexColumns = indexColumns(database, "plays_user_time");
  if (playIndexColumns.join(",") !== "user,played_at")
    throw new Error("Database index plays_user_time is incompatible");

  const requestIndexes = database.prepare("PRAGMA index_list(requests)").all() as DatabaseIndex[];
  const hasRequestIdentity = requestIndexes.some(
    (index) => index.unique === 1 && indexColumns(database, index.name).join(",") === "user,kind,ref",
  );
  if (!hasRequestIdentity) throw new Error("Database requests identity constraint is missing");
}

async function ensureBackup(database: Database, backupPath: string): Promise<void> {
  if (validDatabase(backupPath)) return;

  const temporaryPath = `${backupPath}.tmp-${process.pid}-${randomUUID()}`;

  try {
    await backup(database, temporaryPath);
    if (!validDatabase(temporaryPath)) throw new Error("Needle could not create a valid database backup");
    if (validDatabase(backupPath)) return;

    await rm(backupPath, { force: true });
    await rename(temporaryPath, backupPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

function validDatabase(databasePath: string): boolean {
  if (!existsSync(databasePath)) return false;

  let database: Database | undefined;

  try {
    database = new DatabaseSync(databasePath, { readOnly: true, timeout: 5_000 });
    const result = database.prepare("PRAGMA integrity_check").get() as { integrity_check?: unknown } | undefined;

    return result?.integrity_check === "ok";
  } catch {
    return false;
  } finally {
    database?.close();
  }
}

function configureDatabase(database: Database): void {
  const deadline = Date.now() + 5_000;

  for (;;) {
    try {
      database.prepare("PRAGMA journal_mode = WAL").get();
      database.exec("PRAGMA synchronous = NORMAL");

      return;
    } catch (error) {
      if (!(error instanceof Error && /locked|busy/i.test(error.message)) || Date.now() >= deadline) throw error;

      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
}

function verifyLegacySchema(database: Database): void {
  const legacyColumns = new Set(["spotify_tokens.scope", "spotify_tokens.enabled", "permissions.can_youtube_music"]);

  for (const [table, expectedColumns] of Object.entries(EXPECTED_SCHEMA)) {
    if (!tableExists(database, table)) continue;

    verifyColumns(database, table, expectedColumns, legacyColumns);
  }
}

function verifyColumns(
  database: Database,
  table: string,
  expectedColumns: readonly ExpectedColumn[],
  allowedMissing = new Set<string>(),
): void {
  const actualColumns = new Map(columns(database, table).map((column) => [column.name, column]));

  for (const expectedColumn of expectedColumns) {
    const actualColumn = actualColumns.get(expectedColumn.name);
    if (!actualColumn && allowedMissing.has(`${table}.${expectedColumn.name}`)) continue;
    if (!actualColumn) throw new Error(`Database table ${table} is missing column ${expectedColumn.name}`);
    if (actualColumn.type.toUpperCase() !== expectedColumn.type)
      throw new Error(`Database column ${table}.${expectedColumn.name} has type ${actualColumn.type || "none"}`);
    if (Boolean(actualColumn.notnull) !== Boolean(expectedColumn.isRequired))
      throw new Error(`Database column ${table}.${expectedColumn.name} has incompatible nullability`);
    if (Boolean(actualColumn.pk) !== Boolean(expectedColumn.isPrimary))
      throw new Error(`Database column ${table}.${expectedColumn.name} has incompatible primary key state`);
    if (expectedColumn.defaultValue !== undefined && actualColumn.dflt_value !== expectedColumn.defaultValue) {
      throw new Error(`Database column ${table}.${expectedColumn.name} has incompatible default`);
    }
  }
}

function hasApplicationTables(database: Database): boolean {
  return Object.keys(EXPECTED_SCHEMA).some((table) => tableExists(database, table));
}

function tableExists(database: Database, table: string): boolean {
  return Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

function columnExists(database: Database, table: string, column: string): boolean {
  return columns(database, table).some((databaseColumn) => databaseColumn.name === column);
}

function columns(database: Database, table: string): DatabaseColumn[] {
  return database.prepare(`PRAGMA table_info(${identifier(table)})`).all() as DatabaseColumn[];
}

function indexColumns(database: Database, index: string): string[] {
  return (database.prepare(`PRAGMA index_info(${identifier(index)})`).all() as DatabaseIndexColumn[]).map(
    (column) => column.name,
  );
}

function identifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
