import { createPrivateKey } from "node:crypto";

const DEFAULT_API_BASE_URL = "https://api.github.com";
const CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export class GitHubAppConfigError extends Error {
  constructor(field) {
    super(`Invalid RepoOps GitHub App configuration: ${field}`);
    this.name = "GitHubAppConfigError";
  }
}

function requireConfig(condition, field) {
  if (!condition) throw new GitHubAppConfigError(field);
}

function parseClientId(value) {
  requireConfig(typeof value === "string" && CLIENT_ID_PATTERN.test(value), "clientId");
  return value;
}

function parsePrivateKey(value) {
  requireConfig(typeof value === "string" && value.trim().length > 0, "privateKey");
  try {
    const key = createPrivateKey(value);
    requireConfig(key.asymmetricKeyType === "rsa", "privateKey");
    return key;
  } catch (error) {
    if (error instanceof GitHubAppConfigError) throw error;
    throw new GitHubAppConfigError("privateKey");
  }
}

function parseApiBaseUrl(value) {
  requireConfig(typeof value === "string" && value.length > 0 && value === value.trim(), "apiBaseUrl");

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new GitHubAppConfigError("apiBaseUrl");
  }

  requireConfig(url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname)), "apiBaseUrl");
  requireConfig(!url.username && !url.password && !url.search && !url.hash, "apiBaseUrl");

  const normalizedPath = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${normalizedPath}`;
}

/**
 * Parse the secret-bearing GitHub App identity boundary.
 *
 * The raw PEM is converted to a KeyObject immediately so ordinary callers do not
 * need to retain or re-parse the secret string. This object must never be merged
 * into the public control-plane runtime configuration or serialized to logs.
 */
export function parseGitHubAppConfig(env = {}) {
  requireConfig(env !== null && typeof env === "object" && !Array.isArray(env), "environment");

  const clientId = parseClientId(env.REPOOPS_GITHUB_APP_CLIENT_ID);
  const privateKey = parsePrivateKey(env.REPOOPS_GITHUB_APP_PRIVATE_KEY);
  const apiBaseUrl = parseApiBaseUrl(env.REPOOPS_GITHUB_API_BASE_URL ?? DEFAULT_API_BASE_URL);

  return Object.freeze({ clientId, privateKey, apiBaseUrl });
}

export const GITHUB_APP_DEFAULT_API_BASE_URL = DEFAULT_API_BASE_URL;
