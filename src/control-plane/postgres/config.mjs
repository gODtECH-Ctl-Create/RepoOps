export class PostgresConfigError extends Error {
  constructor(field) {
    super(`Invalid RepoOps PostgreSQL configuration: ${field}`);
    this.name = "PostgresConfigError";
  }
}

function requireConfig(condition, field) {
  if (!condition) throw new PostgresConfigError(field);
}

/**
 * Parse PostgreSQL credentials in a dedicated secret-bearing configuration
 * boundary. Callers must not include the returned connection string in ordinary
 * runtime diagnostics or serialized control-plane config.
 */
export function parsePostgresConfig(env = {}) {
  requireConfig(env !== null && typeof env === "object" && !Array.isArray(env), "environment");

  const connectionString = env.REPOOPS_DATABASE_URL ?? env.DATABASE_URL;
  requireConfig(typeof connectionString === "string" && connectionString.length > 0, "databaseUrl");
  requireConfig(connectionString === connectionString.trim(), "databaseUrl");

  let parsed;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new PostgresConfigError("databaseUrl");
  }

  requireConfig(["postgres:", "postgresql:"].includes(parsed.protocol), "databaseUrl");
  requireConfig(Boolean(parsed.hostname), "databaseUrl");
  requireConfig(Boolean(parsed.pathname && parsed.pathname !== "/"), "databaseUrl");

  return Object.freeze({ connectionString });
}
