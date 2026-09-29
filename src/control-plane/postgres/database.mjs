import pg from "pg";

import { parsePostgresConfig } from "./config.mjs";

const { Pool } = pg;

export class PostgresInfrastructureError extends Error {
  constructor(operation, databaseCode = null) {
    super(`RepoOps PostgreSQL operation failed: ${operation}`);
    this.name = "PostgresInfrastructureError";
    this.databaseCode = databaseCode;
  }
}

export function safePostgresCode(error) {
  return typeof error?.code === "string" && /^[0-9A-Z]{5}$/.test(error.code)
    ? error.code
    : null;
}

export function toPostgresInfrastructureError(operation, error) {
  if (error instanceof PostgresInfrastructureError) return error;
  return new PostgresInfrastructureError(operation, safePostgresCode(error));
}

/**
 * Create the shared PostgreSQL pool. The returned pool intentionally does not
 * expose its connection string through RepoOps runtime configuration/logging.
 */
export function createPostgresPool({ env = process.env, PoolClass = Pool, max = 10 } = {}) {
  if (!Number.isSafeInteger(max) || max < 1 || max > 100) {
    throw new TypeError("PostgreSQL pool max must be an integer from 1 to 100");
  }
  if (typeof PoolClass !== "function") {
    throw new TypeError("PostgreSQL PoolClass must be constructable");
  }

  const { connectionString } = parsePostgresConfig(env);
  return new PoolClass({
    connectionString,
    max,
    connectionTimeoutMillis: 2_000,
    statement_timeout: 5_000,
    query_timeout: 6_000,
    application_name: "repoops-control-plane"
  });
}

export function createPostgresReadinessCheck(pool) {
  if (!pool || typeof pool.query !== "function") {
    throw new TypeError("PostgreSQL pool must expose query()");
  }

  return async () => {
    await pool.query("SELECT 1 AS ready");
    return true;
  };
}
