import { GitHubApiError, GitHubNetworkError } from "../../github/client.mjs";
import { createGitHubAppJwt } from "./jwt.mjs";

const API_VERSION = "2026-03-10";
const ACCEPT = "application/vnd.github+json";
const USER_AGENT = "RepoOps-GitHub-App";
const DEFAULT_REFRESH_WINDOW_MS = 5 * 60_000;
const PERMISSION_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const PERMISSION_LEVELS = new Set(["read", "write"]);

export class GitHubInstallationTokenError extends Error {
  constructor(reason) {
    super(`RepoOps GitHub installation token failed: ${reason}`);
    this.name = "GitHubInstallationTokenError";
    this.reason = reason;
  }
}

function requirePositiveId(value, field) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new GitHubInstallationTokenError(field);
  }
  return value;
}

function integerHeader(headers, name) {
  const value = headers?.get?.(name);
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function safeRequestId(headers) {
  const value = headers?.get?.("x-github-request-id");
  return typeof value === "string" ? value.slice(0, 200) : null;
}

function normalizeRepositoryIds(value) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length < 1 || value.length > 500) {
    throw new GitHubInstallationTokenError("repository-scope");
  }

  const ids = value.map((id) => requirePositiveId(id, "repository-scope"));
  if (new Set(ids).size !== ids.length) throw new GitHubInstallationTokenError("repository-scope");
  return Object.freeze([...ids].sort((left, right) => left - right));
}

function normalizePermissions(value) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GitHubInstallationTokenError("permissions-scope");
  }

  const entries = Object.entries(value);
  if (!entries.length) throw new GitHubInstallationTokenError("permissions-scope");

  const normalized = {};
  for (const [name, level] of entries.sort(([left], [right]) => left.localeCompare(right))) {
    if (!PERMISSION_PATTERN.test(name) || !PERMISSION_LEVELS.has(level)) {
      throw new GitHubInstallationTokenError("permissions-scope");
    }
    normalized[name] = level;
  }
  return Object.freeze(normalized);
}

export function normalizeInstallationTokenScope({ installationId, repositoryIds, permissions } = {}) {
  const normalizedInstallationId = requirePositiveId(installationId, "installation-id");
  const normalizedRepositoryIds = normalizeRepositoryIds(repositoryIds);
  const normalizedPermissions = normalizePermissions(permissions);

  return Object.freeze({
    installationId: normalizedInstallationId,
    repositoryIds: normalizedRepositoryIds,
    permissions: normalizedPermissions
  });
}

function scopeKey(scope) {
  return JSON.stringify([
    scope.installationId,
    scope.repositoryIds,
    scope.permissions
  ]);
}

function requestBody(scope) {
  const body = {};
  if (scope.repositoryIds !== null) body.repository_ids = scope.repositoryIds;
  if (scope.permissions !== null) body.permissions = scope.permissions;
  return body;
}

function normalizedExpiry(value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new GitHubInstallationTokenError("malformed-response");
  }
  return new Date(value).toISOString();
}

function validateRefreshWindow(value) {
  if (!Number.isSafeInteger(value) || value < 1_000 || value > 30 * 60_000) {
    throw new TypeError("GitHub installation token refresh window must be 1 second to 30 minutes");
  }
  return value;
}

function validateClock(clock) {
  if (typeof clock !== "function") throw new TypeError("GitHub installation token clock must be a function");
  return clock;
}

function safeNow(clock) {
  const value = clock();
  if (!Number.isSafeInteger(value) || value < 0) throw new GitHubInstallationTokenError("clock");
  return value;
}

/**
 * In-memory installation credential manager.
 *
 * Tokens are deliberately not persisted. Cache identity includes the exact
 * installation/repository/permission scope. Concurrent misses share one mint.
 */
export function createInstallationTokenManager({
  clientId,
  privateKey,
  apiBaseUrl = "https://api.github.com",
  fetchImpl = globalThis.fetch,
  clock = Date.now,
  refreshWindowMs = DEFAULT_REFRESH_WINDOW_MS
}) {
  if (typeof clientId !== "string" || !clientId.length) throw new TypeError("GitHub App clientId is required");
  if (!privateKey) throw new TypeError("GitHub App privateKey is required");
  if (typeof apiBaseUrl !== "string" || !apiBaseUrl.length) throw new TypeError("GitHub API base URL is required");
  if (typeof fetchImpl !== "function") throw new TypeError("GitHub App fetch implementation is required");

  const now = validateClock(clock);
  const refreshWindow = validateRefreshWindow(refreshWindowMs);
  const cache = new Map();
  const inflight = new Map();
  const generations = new Map();

  const generation = (installationId) => generations.get(installationId) ?? 0;

  function usable(entry, nowMs) {
    return entry && Date.parse(entry.expiresAt) - refreshWindow > nowMs;
  }

  async function mint(scope, expectedGeneration) {
    const nowMs = safeNow(now);
    const jwt = createGitHubAppJwt({ clientId, privateKey, nowMs });
    const url = `${apiBaseUrl}/app/installations/${scope.installationId}/access_tokens`;

    let response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: {
          Accept: ACCEPT,
          Authorization: `Bearer ${jwt}`,
          "Content-Type": "application/json",
          "User-Agent": USER_AGENT,
          "X-GitHub-Api-Version": API_VERSION
        },
        body: JSON.stringify(requestBody(scope))
      });
    } catch (error) {
      if (error instanceof GitHubNetworkError) throw error;
      throw new GitHubNetworkError(error);
    }

    if (!response?.ok) {
      throw new GitHubApiError({
        status: Number.isSafeInteger(response?.status) ? response.status : 0,
        responseMessage: "",
        requestId: safeRequestId(response?.headers),
        retryAfterSeconds: integerHeader(response?.headers, "retry-after"),
        rateLimitRemaining: integerHeader(response?.headers, "x-ratelimit-remaining"),
        rateLimitReset: integerHeader(response?.headers, "x-ratelimit-reset")
      });
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new GitHubInstallationTokenError("malformed-response");
    }

    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new GitHubInstallationTokenError("malformed-response");
    }
    if (typeof payload.token !== "string" || payload.token.length < 1) {
      throw new GitHubInstallationTokenError("malformed-response");
    }

    const expiresAt = normalizedExpiry(payload.expires_at);
    const checkedAt = safeNow(now);
    if (Date.parse(expiresAt) - refreshWindow <= checkedAt) {
      throw new GitHubInstallationTokenError("expiry-window");
    }
    if (generation(scope.installationId) !== expectedGeneration) {
      throw new GitHubInstallationTokenError("installation-invalidated");
    }

    return Object.freeze({
      token: payload.token,
      expiresAt,
      installationId: scope.installationId,
      repositoryIds: scope.repositoryIds,
      permissions: scope.permissions
    });
  }

  async function getToken(input) {
    const scope = normalizeInstallationTokenScope(input);
    const key = scopeKey(scope);
    const nowMs = safeNow(now);
    const cached = cache.get(key);
    if (usable(cached, nowMs)) return cached;
    if (cached) cache.delete(key);

    const pending = inflight.get(key);
    if (pending) return pending;

    const expectedGeneration = generation(scope.installationId);
    const promise = mint(scope, expectedGeneration)
      .then((entry) => {
        if (generation(scope.installationId) !== expectedGeneration) {
          throw new GitHubInstallationTokenError("installation-invalidated");
        }
        cache.set(key, entry);
        return entry;
      })
      .finally(() => {
        if (inflight.get(key) === promise) inflight.delete(key);
      });

    inflight.set(key, promise);
    return promise;
  }

  function invalidateInstallation(installationId) {
    const id = requirePositiveId(installationId, "installation-id");
    generations.set(id, generation(id) + 1);
    const prefix = `[${id},`;
    for (const key of cache.keys()) if (key.startsWith(prefix)) cache.delete(key);
    for (const key of inflight.keys()) if (key.startsWith(prefix)) inflight.delete(key);
  }

  return Object.freeze({ getToken, invalidateInstallation });
}

export const GITHUB_APP_API_VERSION = API_VERSION;
export const GITHUB_APP_INSTALLATION_TOKEN_REFRESH_WINDOW_MS = DEFAULT_REFRESH_WINDOW_MS;
