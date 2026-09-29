import test from "node:test";
import assert from "node:assert/strict";

import { PostgresConfigError, parsePostgresConfig } from "../src/control-plane/postgres/config.mjs";
import {
  PostgresInfrastructureError,
  createPostgresPool,
  createPostgresReadinessCheck,
  toPostgresInfrastructureError
} from "../src/control-plane/postgres/database.mjs";

test("PostgreSQL config accepts RepoOps database URL and standard fallback", () => {
  assert.equal(
    parsePostgresConfig({ REPOOPS_DATABASE_URL: "postgresql://user:pass@db/repoops" }).connectionString,
    "postgresql://user:pass@db/repoops"
  );
  assert.equal(
    parsePostgresConfig({ DATABASE_URL: "postgres://user:pass@db/repoops" }).connectionString,
    "postgres://user:pass@db/repoops"
  );
  assert.equal(
    parsePostgresConfig({
      DATABASE_URL: "postgres://fallback:pass@db/other",
      REPOOPS_DATABASE_URL: "postgres://repoops:pass@db/repoops"
    }).connectionString,
    "postgres://repoops:pass@db/repoops"
  );
});

test("PostgreSQL config fails closed without echoing secret connection strings", () => {
  const secret = "https://repoops:super-secret-password@example.com/private";
  for (const env of [
    {},
    { REPOOPS_DATABASE_URL: "" },
    { REPOOPS_DATABASE_URL: secret },
    { REPOOPS_DATABASE_URL: "postgres://localhost" },
    { REPOOPS_DATABASE_URL: " postgres://user:pass@db/repoops" }
  ]) {
    assert.throws(
      () => parsePostgresConfig(env),
      (error) => {
        assert.equal(error instanceof PostgresConfigError, true);
        assert.equal(error.message.includes("super-secret-password"), false);
        assert.equal(error.message.includes(secret), false);
        return true;
      }
    );
  }
});

test("PostgreSQL pool creation keeps secret config in the dedicated adapter boundary", () => {
  let observed = null;
  class FakePool {
    constructor(config) {
      observed = config;
    }
  }

  const pool = createPostgresPool({
    env: { REPOOPS_DATABASE_URL: "postgres://repoops:secret@db/repoops" },
    PoolClass: FakePool,
    max: 7
  });

  assert.equal(pool instanceof FakePool, true);
  assert.deepEqual(observed, {
    connectionString: "postgres://repoops:secret@db/repoops",
    max: 7,
    application_name: "repoops-control-plane"
  });
});

test("PostgreSQL readiness check performs a minimal query", async () => {
  const queries = [];
  const check = createPostgresReadinessCheck({
    async query(text) {
      queries.push(text);
      return { rows: [{ ready: 1 }] };
    }
  });

  assert.equal(await check(), true);
  assert.deepEqual(queries, ["SELECT 1 AS ready"]);
});

test("PostgreSQL infrastructure errors expose only safe SQLSTATE metadata", () => {
  const wrapped = toPostgresInfrastructureError("connect", {
    code: "08006",
    message: "password=super-secret database URL should not escape"
  });

  assert.equal(wrapped instanceof PostgresInfrastructureError, true);
  assert.equal(wrapped.databaseCode, "08006");
  assert.equal(wrapped.message.includes("super-secret"), false);

  const unsafeCode = toPostgresInfrastructureError("connect", { code: "secret-value" });
  assert.equal(unsafeCode.databaseCode, null);
});
