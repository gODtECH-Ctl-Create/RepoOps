import { AmbiguousOperationError } from "../core/idempotency.mjs";
import { GitHubApiError, GitHubNetworkError } from "./client.mjs";

const DEFAULT_BASE_DELAY_MS = 1_000;
const DEFAULT_MAX_DELAY_MS = 5 * 60_000;
const DEFAULT_MAX_RATE_LIMIT_DELAY_MS = 24 * 60 * 60_000;

function positiveInteger(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

export function boundedBackoffMs(attempt, {
  baseDelayMs = DEFAULT_BASE_DELAY_MS,
  maxDelayMs = DEFAULT_MAX_DELAY_MS
} = {}) {
  const normalizedAttempt = positiveInteger(attempt, 1);
  const base = positiveInteger(baseDelayMs, DEFAULT_BASE_DELAY_MS);
  const cap = positiveInteger(maxDelayMs, DEFAULT_MAX_DELAY_MS);
  const exponent = Math.min(normalizedAttempt - 1, 30);
  return Math.min(cap, base * (2 ** exponent));
}

function boundedRateLimitDelay(value, maxRateLimitDelayMs) {
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.min(Math.ceil(value), maxRateLimitDelayMs);
}

function rateLimitDelayMs(error, nowMs, fallbackDelayMs, maxRateLimitDelayMs) {
  if (Number.isSafeInteger(error.retryAfterSeconds) && error.retryAfterSeconds >= 0) {
    return boundedRateLimitDelay(error.retryAfterSeconds * 1_000, maxRateLimitDelayMs);
  }

  if (error.rateLimitRemaining === 0 && Number.isSafeInteger(error.rateLimitReset) && error.rateLimitReset > 0) {
    return boundedRateLimitDelay(Math.max(0, (error.rateLimitReset * 1_000) - nowMs), maxRateLimitDelayMs);
  }

  return boundedRateLimitDelay(fallbackDelayMs, maxRateLimitDelayMs);
}

function isRateLimited(error) {
  if (!(error instanceof GitHubApiError)) return false;
  if (error.status === 429) return true;
  if (error.status !== 403) return false;

  return error.retryAfterSeconds !== null
    || error.rateLimitRemaining === 0
    || /(?:secondary\s+)?rate\s+limit/i.test(error.responseMessage ?? "");
}

function reconcile(reason) {
  return Object.freeze({ action: "reconcile", reason, retryAfterMs: null });
}

/**
 * Return scheduling/reconciliation guidance only. This function never sleeps and
 * never performs a retry itself.
 *
 * Set `mutation: true` when the failed request may have changed GitHub state.
 * Network/timeout/5xx failures for mutations are ambiguous because GitHub may
 * have committed the write before the response was lost; those require a fresh
 * state inspection before another write is attempted.
 */
export function classifyGitHubFailure(error, {
  attempt = 1,
  nowMs = Date.now(),
  baseDelayMs = DEFAULT_BASE_DELAY_MS,
  maxDelayMs = DEFAULT_MAX_DELAY_MS,
  maxRateLimitDelayMs = DEFAULT_MAX_RATE_LIMIT_DELAY_MS,
  mutation = false
} = {}) {
  const fallbackDelayMs = boundedBackoffMs(attempt, { baseDelayMs, maxDelayMs });
  const rateLimitCap = positiveInteger(maxRateLimitDelayMs, DEFAULT_MAX_RATE_LIMIT_DELAY_MS);

  if (error instanceof AmbiguousOperationError) return reconcile("ambiguous-mutation");

  if (error instanceof GitHubNetworkError) {
    if (mutation) return reconcile("network-after-mutation-attempt");
    return Object.freeze({ action: "retry", reason: "network", retryAfterMs: fallbackDelayMs });
  }

  if (!(error instanceof GitHubApiError)) {
    return Object.freeze({ action: "fail", reason: "unknown-error", retryAfterMs: null });
  }

  if (isRateLimited(error)) {
    return Object.freeze({
      action: "retry",
      reason: "rate-limit",
      retryAfterMs: rateLimitDelayMs(error, nowMs, fallbackDelayMs, rateLimitCap)
    });
  }

  if (error.status === 408 || error.status >= 500) {
    if (mutation) return reconcile("transient-response-after-mutation-attempt");
    return Object.freeze({
      action: "retry",
      reason: "github-transient",
      retryAfterMs: fallbackDelayMs
    });
  }

  if ([401, 403].includes(error.status)) {
    return Object.freeze({ action: "fail", reason: "authorization", retryAfterMs: null });
  }

  if (error.status === 404) {
    return Object.freeze({ action: "fail", reason: "resource-unavailable", retryAfterMs: null });
  }

  if (error.status === 422) {
    return Object.freeze({ action: "fail", reason: "validation", retryAfterMs: null });
  }

  return Object.freeze({ action: "fail", reason: "github-permanent", retryAfterMs: null });
}
