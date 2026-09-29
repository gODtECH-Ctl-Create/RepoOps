import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { toPostgresInfrastructureError } from "./database.mjs";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_MIGRATIONS_DIRECTORY = resolve(moduleDirectory, "../../../db/migrations");
const migrationPattern = /^(\d{3,})_([a-z0-9][a-z0-9_-]*)\.sql$/;
const MIGRATION_LOCK_KEY = 1_380_996_176;

export class PostgresMigrationValidationError extends Error {
  constructor(message) {
    super(`Invalid RepoOps PostgreSQL migration: ${message}`);
    this.name = "PostgresMigrationValidationError";
  }
}

function migrationChecksum(sql) {
  return createHash("sha256").update(sql, "utf8").digest("hex");
}

async function loadMigrations(directory) {
  const files = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort();
  const migrations = [];
  const versions = new Set();

  for (const file of files) {
    const match = migrationPattern.exec(file);
    if (!match) throw new PostgresMigrationValidationError(`unexpected filename ${file}`);

    const version = Number(match[1]);
    if (!Number.isSafeInteger(version) || version < 1) {
      throw new PostgresMigrationValidationError(`invalid version in ${file}`);
    }
    if (versions.has(version)) {
      throw new PostgresMigrationValidationError(`duplicate version ${version}`);
    }
    versions.add(version);

    const sql = await readFile(resolve(directory, file), "utf8");
    if (!sql.trim()) throw new PostgresMigrationValidationError(`empty migration ${file}`);

    migrations.push(Object.freeze({
      version,
      name: match[2],
      file,
      checksum: migrationChecksum(sql),
      sql
    }));
  }

  if (!migrations.length) throw new PostgresMigrationValidationError("no migration files found");
  return migrations.sort((left, right) => left.version - right.version);
}

/**
 * Apply versioned migrations under a PostgreSQL advisory transaction lock.
 * Applied checksums are immutable: changing an already-applied migration fails
 * rather than silently rewriting database history.
 */
export async function runPostgresMigrations({
  pool,
  migrationsDirectory = DEFAULT_MIGRATIONS_DIRECTORY
}) {
  if (!pool || typeof pool.connect !== "function") {
    throw new TypeError("PostgreSQL migration pool must expose connect()");
  }

  let migrations;
  try {
    migrations = await loadMigrations(migrationsDirectory);
  } catch (error) {
    if (error instanceof PostgresMigrationValidationError) throw error;
    throw new PostgresMigrationValidationError("migration files could not be loaded");
  }

  const client = await pool.connect().catch((error) => {
    throw toPostgresInfrastructureError("migration-connect", error);
  });

  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [MIGRATION_LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS repoops_schema_migrations (
        version integer PRIMARY KEY CHECK (version > 0),
        name text NOT NULL,
        checksum char(64) NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const appliedResult = await client.query(
      "SELECT version, name, checksum FROM repoops_schema_migrations ORDER BY version"
    );
    const applied = new Map(
      appliedResult.rows.map((row) => [Number(row.version), row])
    );

    const newlyApplied = [];
    for (const migration of migrations) {
      const existing = applied.get(migration.version);
      if (existing) {
        if (existing.name !== migration.name || existing.checksum.trim() !== migration.checksum) {
          throw new PostgresMigrationValidationError(
            `applied migration ${migration.version} does not match ${migration.file}`
          );
        }
        continue;
      }

      await client.query(migration.sql);
      await client.query(
        `INSERT INTO repoops_schema_migrations (version, name, checksum)
         VALUES ($1, $2, $3)`,
        [migration.version, migration.name, migration.checksum]
      );
      newlyApplied.push(migration.version);
    }

    await client.query("COMMIT");
    return Object.freeze({
      applied: Object.freeze(newlyApplied),
      currentVersion: migrations.at(-1).version
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error instanceof PostgresMigrationValidationError) throw error;
    throw toPostgresInfrastructureError("migration-apply", error);
  } finally {
    client.release();
  }
}
