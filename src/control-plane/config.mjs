const ENVIRONMENTS = new Set(["development", "test", "production"]);

export const CONTROL_PLANE_DEFAULTS = Object.freeze({
  environment: "development",
  host: "127.0.0.1",
  port: 3000,
  shutdownTimeoutMs: 10_000,
  requestTimeoutMs: 15_000
});

export class ControlPlaneConfigError extends Error {
  constructor(field) {
    super(`Invalid RepoOps control-plane configuration: ${field}`);
    this.name = "ControlPlaneConfigError";
  }
}

function requireConfig(condition, field) {
  if (!condition) throw new ControlPlaneConfigError(field);
}

function parseEnvironment(value) {
  requireConfig(typeof value === "string" && ENVIRONMENTS.has(value), "environment");
  return value;
}

function parseHost(value) {
  requireConfig(typeof value === "string" && value.length > 0 && value.length <= 255, "host");
  requireConfig(value === value.trim(), "host");
  requireConfig(!/[\s/\\]/.test(value) && !value.includes("://"), "host");
  return value;
}

function parseInteger(value, field, { min, max }) {
  const text = typeof value === "number" ? String(value) : value;
  requireConfig(typeof text === "string" && /^\d+$/.test(text), field);
  const parsed = Number(text);
  requireConfig(Number.isSafeInteger(parsed) && parsed >= min && parsed <= max, field);
  return parsed;
}

/**
 * Parse only settings required by the hosted process itself.
 *
 * GitHub App credentials, webhook secrets, and database URLs deliberately do not
 * belong here until a runtime component actually consumes them.
 */
export function parseControlPlaneConfig(env = {}) {
  requireConfig(env !== null && typeof env === "object" && !Array.isArray(env), "environment");

  const environment = parseEnvironment(
    env.REPOOPS_ENV ?? env.NODE_ENV ?? CONTROL_PLANE_DEFAULTS.environment
  );
  const host = parseHost(env.REPOOPS_HOST ?? CONTROL_PLANE_DEFAULTS.host);
  const port = parseInteger(
    env.REPOOPS_PORT ?? env.PORT ?? String(CONTROL_PLANE_DEFAULTS.port),
    "port",
    { min: 1, max: 65_535 }
  );
  const shutdownTimeoutMs = parseInteger(
    env.REPOOPS_SHUTDOWN_TIMEOUT_MS ?? String(CONTROL_PLANE_DEFAULTS.shutdownTimeoutMs),
    "shutdownTimeoutMs",
    { min: 100, max: 60_000 }
  );
  const requestTimeoutMs = parseInteger(
    env.REPOOPS_REQUEST_TIMEOUT_MS ?? String(CONTROL_PLANE_DEFAULTS.requestTimeoutMs),
    "requestTimeoutMs",
    { min: 1_000, max: 120_000 }
  );

  return Object.freeze({
    environment,
    host,
    port,
    shutdownTimeoutMs,
    requestTimeoutMs
  });
}
