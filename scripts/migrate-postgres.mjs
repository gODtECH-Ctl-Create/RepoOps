import { createPostgresPool } from "../src/control-plane/postgres/database.mjs";
import { runPostgresMigrations } from "../src/control-plane/postgres/migrations.mjs";

const pool = createPostgresPool();

try {
  const result = await runPostgresMigrations({ pool });
  const applied = result.applied.length ? result.applied.join(", ") : "none";
  console.log(`RepoOps PostgreSQL migrations complete; applied: ${applied}; current: ${result.currentVersion}`);
} catch (error) {
  const message = error instanceof Error && error.message
    ? error.message
    : "RepoOps PostgreSQL migration failed";
  console.error(message);
  process.exitCode = 1;
} finally {
  await pool.end().catch(() => {});
}
