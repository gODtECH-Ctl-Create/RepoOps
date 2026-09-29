import { sign } from "node:crypto";

const ISSUED_AT_SKEW_SECONDS = 60;
const JWT_LIFETIME_SECONDS = 9 * 60;

export class GitHubAppJwtError extends Error {
  constructor(reason) {
    super(`RepoOps GitHub App JWT generation failed: ${reason}`);
    this.name = "GitHubAppJwtError";
    this.reason = reason;
  }
}

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function safeNowMs(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new GitHubAppJwtError("clock");
  }
  return value;
}

/**
 * Generate the short-lived RS256 JWT GitHub requires when authenticating as an
 * App. The token is intentionally not cached here: callers can create it when
 * minting an installation token and must never persist/log it.
 */
export function createGitHubAppJwt({ clientId, privateKey, nowMs = Date.now() }) {
  if (typeof clientId !== "string" || !clientId.length) throw new GitHubAppJwtError("client-id");
  if (!privateKey) throw new GitHubAppJwtError("private-key");

  const now = safeNowMs(nowMs);
  const nowSeconds = Math.floor(now / 1_000);
  const header = Object.freeze({ alg: "RS256", typ: "JWT" });
  const payload = Object.freeze({
    iat: nowSeconds - ISSUED_AT_SKEW_SECONDS,
    exp: nowSeconds + JWT_LIFETIME_SECONDS,
    iss: clientId
  });

  const signingInput = `${base64urlJson(header)}.${base64urlJson(payload)}`;

  let signature;
  try {
    signature = sign("RSA-SHA256", Buffer.from(signingInput, "ascii"), privateKey).toString("base64url");
  } catch {
    throw new GitHubAppJwtError("signing");
  }

  return `${signingInput}.${signature}`;
}

export const GITHUB_APP_JWT_ISSUED_AT_SKEW_SECONDS = ISSUED_AT_SKEW_SECONDS;
export const GITHUB_APP_JWT_LIFETIME_SECONDS = JWT_LIFETIME_SECONDS;
