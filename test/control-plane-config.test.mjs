import test from "node:test";
import assert from "node:assert/strict";

import {
  CONTROL_PLANE_DEFAULTS,
  ControlPlaneConfigError,
  parseControlPlaneConfig
} from "../src/control-plane/config.mjs";

test("control-plane config uses safe local defaults", () => {
  const config = parseControlPlaneConfig({});

  assert.deepEqual(config, CONTROL_PLANE_DEFAULTS);
  assert.equal(Object.isFrozen(config), true);
});

test("control-plane config accepts explicit hosted runtime settings", () => {
  const config = parseControlPlaneConfig({
    REPOOPS_ENV: "production",
    REPOOPS_HOST: "0.0.0.0",
    REPOOPS_PORT: "8080",
    REPOOPS_SHUTDOWN_TIMEOUT_MS: "20000",
    REPOOPS_REQUEST_TIMEOUT_MS: "30000"
  });

  assert.deepEqual(config, {
    environment: "production",
    host: "0.0.0.0",
    port: 8080,
    shutdownTimeoutMs: 20_000,
    requestTimeoutMs: 30_000
  });
});

test("control-plane config supports standard PORT while RepoOps-specific port wins", () => {
  assert.equal(parseControlPlaneConfig({ PORT: "4100" }).port, 4100);
  assert.equal(parseControlPlaneConfig({ PORT: "4100", REPOOPS_PORT: "4200" }).port, 4200);
});

test("control-plane environment falls back to NODE_ENV", () => {
  assert.equal(parseControlPlaneConfig({ NODE_ENV: "test" }).environment, "test");
  assert.equal(
    parseControlPlaneConfig({ NODE_ENV: "test", REPOOPS_ENV: "production" }).environment,
    "production"
  );
});

test("invalid control-plane configuration fails closed without echoing values", () => {
  const cases = [
    [{ REPOOPS_ENV: "staging-secret-value" }, "environment", "staging-secret-value"],
    [{ REPOOPS_HOST: "https://secret.example" }, "host", "secret.example"],
    [{ REPOOPS_PORT: "0" }, "port", "0"],
    [{ REPOOPS_PORT: "65536" }, "port", "65536"],
    [{ REPOOPS_SHUTDOWN_TIMEOUT_MS: "99" }, "shutdownTimeoutMs", "99"],
    [{ REPOOPS_REQUEST_TIMEOUT_MS: "999" }, "requestTimeoutMs", "999"]
  ];

  for (const [env, field, secretValue] of cases) {
    assert.throws(
      () => parseControlPlaneConfig(env),
      (error) => {
        assert.equal(error instanceof ControlPlaneConfigError, true);
        assert.match(error.message, new RegExp(field));
        assert.equal(error.message.includes(secretValue), false);
        return true;
      }
    );
  }
});

test("control-plane config rejects non-object environment input", () => {
  assert.throws(() => parseControlPlaneConfig(null), ControlPlaneConfigError);
  assert.throws(() => parseControlPlaneConfig([]), ControlPlaneConfigError);
});
