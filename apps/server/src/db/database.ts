import { randomUUID } from "node:crypto";
import { chmodSync, closeSync, constants, lstatSync, mkdirSync, openSync } from "node:fs";
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
const DATA_DIRECTORY_MODE = 0o700;
const DATABASE_FILE_MODE = 0o600;
const DATABASE_FILE_SUFFIXES = ["", "-journal", "-shm", "-wal"] as const;

export function openDatabase(dataDirectory: string): Database {
  const { database, databaseExisted, databasePath } = createDatabase(dataDirectory);

  try {
    const isFirstDatabaseAdoption = !tableExists(database, MIGRATION_TABLE);
    if (dataDirectory !== MEMORY_PATH && isFirstDatabaseAdoption && databaseExisted && hasApplicationTables(database)) {
      throw new Error("A populated legacy database must be opened with backup support");
    }

    migrate(database);
    restrictDatabaseFiles(databasePath);

    return database;
  } catch (error) {
    database.close();

    throw error;
  }
}

export async function openDatabaseWithBackup(dataDirectory: string): Promise<Database> {
  if (dataDirectory === MEMORY_PATH) return openDatabase(dataDirectory);

  const { database, databaseExisted, databasePath } = createDatabase(dataDirectory);

  try {
    const isFirstDatabaseAdoption = !tableExists(database, MIGRATION_TABLE);
    if (isFirstDatabaseAdoption && databaseExisted && hasApplicationTables(database)) {
      const backupPath = join(dataDirectory, BACKUP_FILE);
      await ensureBackup(database, backupPath);
    }

    if (isFirstDatabaseAdoption) verifyLegacySchema(database);

    migrate(database);
    restrictDatabaseFiles(databasePath);

    return database;
  } catch (error) {
    database.close();

    throw error;
  }
}

function createDatabase(dataDirectory: string): {
  database: Database;
  databaseExisted: boolean;
  databasePath: string;
} {
  if (dataDirectory === MEMORY_PATH) {
    const database = new DatabaseSync(MEMORY_PATH, { timeout: 5_000 });
    configureDatabase(database);

    return { database, databaseExisted: false, databasePath: MEMORY_PATH };
  }

  prepareDataDirectory(dataDirectory);

  const databasePath = join(dataDirectory, DATABASE_FILE);
  const databaseExisted = prepareDatabaseFile(databasePath);
  const database = new DatabaseSync(databasePath, { timeout: 5_000 });
  configureDatabase(database);
  restrictDatabaseFiles(databasePath);

  return { database, databaseExisted, databasePath };
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

      const migrationCondition = migration.unlessColumnExists;
      if (!migrationCondition || !columnExists(database, migrationCondition.table, migrationCondition.column)) {
        database.exec(migration.sql);
      }

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

  const migrationRows = database.prepare(`SELECT version, name FROM ${MIGRATION_TABLE} ORDER BY version`).all() as {
    version: number;
    name: string;
  }[];

  return new Map(migrationRows.map((migration) => [migration.version, migration.name]));
}

function validateMigrationHistory(appliedMigrations: Map<number, string>): void {
  const knownMigrations = new Map(DATABASE_MIGRATIONS.map((migration) => [migration.version, migration.name]));

  for (const [migrationVersion, migrationName] of appliedMigrations) {
    if (knownMigrations.get(migrationVersion) !== migrationName) {
      throw new Error(`Database migration ${migrationVersion} is not supported by this Needle version`);
    }
  }
}

function verifySchema(database: Database): void {
  verifyColumns(database, MIGRATION_TABLE, MIGRATION_COLUMNS);

  for (const [tableName, expectedColumns] of Object.entries(EXPECTED_SCHEMA)) {
    verifyColumns(database, tableName, expectedColumns);
  }

  const playIndexColumns = indexColumnNames(database, "plays_user_time");
  if (playIndexColumns.join(",") !== "user,played_at")
    throw new Error("Database index plays_user_time is incompatible");

  const requestIndexes = database.prepare("PRAGMA index_list(requests)").all() as DatabaseIndex[];
  const hasRequestIdentity = requestIndexes.some(
    (databaseIndex) =>
      databaseIndex.unique === 1 && indexColumnNames(database, databaseIndex.name).join(",") === "user,kind,ref",
  );
  if (!hasRequestIdentity) throw new Error("Database requests identity constraint is missing");
}

async function ensureBackup(database: Database, backupPath: string): Promise<void> {
  if (isValidLegacyBackup(backupPath)) return;

  const temporaryBackupPath = `${backupPath}.tmp-${process.pid}-${randomUUID()}`;

  try {
    await removeDatabaseFiles(temporaryBackupPath);
    createRestrictedFile(temporaryBackupPath);
    await backup(database, temporaryBackupPath);
    if (!hasValidDatabaseIntegrity(temporaryBackupPath)) {
      throw new Error("Needle could not create a valid database backup");
    }

    if (isValidLegacyBackup(backupPath)) return;

    await removeDatabaseFiles(backupPath);
    await rename(temporaryBackupPath, backupPath);
    restrictDatabaseFiles(backupPath);
  } finally {
    await removeDatabaseFiles(temporaryBackupPath);
  }
}

function isValidLegacyBackup(databasePath: string): boolean {
  restrictDatabaseFiles(databasePath);
  if (!fileExists(databasePath)) return false;

  let backupDatabase: Database | undefined;

  try {
    backupDatabase = new DatabaseSync(databasePath, { readOnly: true, timeout: 5_000 });
    if (!hasValidIntegrity(backupDatabase)) return false;
    if (tableExists(backupDatabase, MIGRATION_TABLE)) return false;
    if (!hasCompleteApplicationSchema(backupDatabase)) return false;

    verifyLegacySchema(backupDatabase);

    return true;
  } catch {
    return false;
  } finally {
    backupDatabase?.close();
  }
}

function hasValidDatabaseIntegrity(databasePath: string): boolean {
  restrictDatabaseFiles(databasePath);
  if (!fileExists(databasePath)) return false;

  let inspectedDatabase: Database | undefined;

  try {
    inspectedDatabase = new DatabaseSync(databasePath, { readOnly: true, timeout: 5_000 });

    return hasValidIntegrity(inspectedDatabase);
  } catch {
    return false;
  } finally {
    inspectedDatabase?.close();
  }
}

function hasValidIntegrity(database: Database): boolean {
  const integrityCheckResult = database.prepare("PRAGMA integrity_check").get() as
    { integrity_check?: unknown } | undefined;

  return integrityCheckResult?.integrity_check === "ok";
}

async function removeDatabaseFiles(databasePath: string): Promise<void> {
  const databaseFilePaths = pathsForDatabase(databasePath);
  validateDatabaseFiles(databaseFilePaths);

  await Promise.all(databaseFilePaths.map((databaseFilePath) => rm(databaseFilePath, { force: true })));
}

function prepareDataDirectory(dataDirectory: string): void {
  const existingDirectory = lstatSync(dataDirectory, { throwIfNoEntry: false });
  if (existingDirectory?.isSymbolicLink()) throw new Error(`Database data directory cannot be a symbolic link`);

  mkdirSync(dataDirectory, { recursive: true, mode: DATA_DIRECTORY_MODE });

  const dataDirectoryStats = lstatSync(dataDirectory);
  if (!dataDirectoryStats.isDirectory()) throw new Error("Database data directory must be a directory");

  chmodSync(dataDirectory, DATA_DIRECTORY_MODE);
}

function prepareDatabaseFile(databasePath: string): boolean {
  const databaseFilePaths = pathsForDatabase(databasePath);
  validateDatabaseFiles(databaseFilePaths);

  const databaseExisted = fileExists(databasePath);
  if (!databaseExisted) {
    try {
      createRestrictedFile(databasePath);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;

      restrictDatabaseFiles(databasePath);

      return true;
    }
  }

  restrictDatabaseFiles(databasePath);

  return databaseExisted;
}

function createRestrictedFile(filePath: string): void {
  const fileDescriptor = openSync(
    filePath,
    constants.O_CREAT | constants.O_EXCL | constants.O_RDWR,
    DATABASE_FILE_MODE,
  );
  closeSync(fileDescriptor);
}

function restrictDatabaseFiles(databasePath: string): void {
  if (databasePath === MEMORY_PATH) return;

  const databaseFilePaths = pathsForDatabase(databasePath);
  validateDatabaseFiles(databaseFilePaths);

  for (const databaseFilePath of databaseFilePaths) {
    if (fileExists(databaseFilePath)) chmodSync(databaseFilePath, DATABASE_FILE_MODE);
  }
}

function validateDatabaseFiles(databaseFilePaths: readonly string[]): void {
  for (const databaseFilePath of databaseFilePaths) {
    const databaseFileStats = lstatSync(databaseFilePath, { throwIfNoEntry: false });
    if (!databaseFileStats) continue;
    if (databaseFileStats.isSymbolicLink()) {
      throw new Error(`Database file ${databaseFilePath} cannot be a symbolic link`);
    }
    if (!databaseFileStats.isFile()) throw new Error(`Database file ${databaseFilePath} must be a regular file`);
  }
}

function pathsForDatabase(databasePath: string): string[] {
  return DATABASE_FILE_SUFFIXES.map((databaseFileSuffix) => `${databasePath}${databaseFileSuffix}`);
}

function fileExists(filePath: string): boolean {
  return lstatSync(filePath, { throwIfNoEntry: false }) !== undefined;
}

function configureDatabase(database: Database): void {
  const configurationDeadline = Date.now() + 5_000;

  for (;;) {
    try {
      database.prepare("PRAGMA journal_mode = WAL").get();
      database.exec("PRAGMA synchronous = NORMAL");

      return;
    } catch (error) {
      if (!(error instanceof Error && /locked|busy/i.test(error.message)) || Date.now() >= configurationDeadline) {
        throw error;
      }

      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
}

function verifyLegacySchema(database: Database): void {
  const legacyColumns = new Set(["spotify_tokens.scope", "spotify_tokens.enabled", "permissions.can_youtube_music"]);

  for (const [tableName, expectedColumns] of Object.entries(EXPECTED_SCHEMA)) {
    if (!tableExists(database, tableName)) continue;

    verifyColumns(database, tableName, expectedColumns, legacyColumns);
  }
}

function verifyColumns(
  database: Database,
  tableName: string,
  expectedColumns: readonly ExpectedColumn[],
  allowedMissingColumns = new Set<string>(),
): void {
  const actualColumns = new Map(
    columns(database, tableName).map((databaseColumn) => [databaseColumn.name, databaseColumn]),
  );

  for (const expectedColumn of expectedColumns) {
    const actualColumn = actualColumns.get(expectedColumn.name);
    if (!actualColumn && allowedMissingColumns.has(`${tableName}.${expectedColumn.name}`)) continue;
    if (!actualColumn) throw new Error(`Database table ${tableName} is missing column ${expectedColumn.name}`);
    if (actualColumn.type.toUpperCase() !== expectedColumn.type)
      throw new Error(`Database column ${tableName}.${expectedColumn.name} has type ${actualColumn.type || "none"}`);
    if (Boolean(actualColumn.notnull) !== Boolean(expectedColumn.isRequired))
      throw new Error(`Database column ${tableName}.${expectedColumn.name} has incompatible nullability`);
    if (Boolean(actualColumn.pk) !== Boolean(expectedColumn.isPrimary))
      throw new Error(`Database column ${tableName}.${expectedColumn.name} has incompatible primary key state`);
    if (expectedColumn.defaultValue !== undefined && actualColumn.dflt_value !== expectedColumn.defaultValue) {
      throw new Error(`Database column ${tableName}.${expectedColumn.name} has incompatible default`);
    }
  }
}

function hasApplicationTables(database: Database): boolean {
  return Object.keys(EXPECTED_SCHEMA).some((tableName) => tableExists(database, tableName));
}

function hasCompleteApplicationSchema(database: Database): boolean {
  return Object.keys(EXPECTED_SCHEMA).every((tableName) => tableExists(database, tableName));
}

function tableExists(database: Database, tableName: string): boolean {
  return Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName));
}

function columnExists(database: Database, tableName: string, columnName: string): boolean {
  return columns(database, tableName).some((databaseColumn) => databaseColumn.name === columnName);
}

function columns(database: Database, tableName: string): DatabaseColumn[] {
  return database.prepare(`PRAGMA table_info(${quotedIdentifier(tableName)})`).all() as DatabaseColumn[];
}

function indexColumnNames(database: Database, indexName: string): string[] {
  return (database.prepare(`PRAGMA index_info(${quotedIdentifier(indexName)})`).all() as DatabaseIndexColumn[]).map(
    (databaseIndexColumn) => databaseIndexColumn.name,
  );
}

function quotedIdentifier(identifierValue: string): string {
  return `"${identifierValue.replaceAll('"', '""')}"`;
}
