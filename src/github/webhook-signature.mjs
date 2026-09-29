import { createHmac, timingSafeEqual } from "node:crypto";

const SIGNATURE_PATTERN = /^sha256=([a-f0-9]{64})$/i;

export class WebhookSignatureConfigurationError extends Error {
  constructor() {
    super("GitHub webhook signature verification is not configured");
    this.name = "WebhookSignatureConfigurationError";
  }
}

export class WebhookPayloadTypeError extends Error {
  constructor() {
    super("GitHub webhook payload must be raw UTF-8 text, Buffer, or Uint8Array");
    this.name = "WebhookPayloadTypeError";
  }
}

function secretBytes(secret) {
  if (typeof secret === "string") {
    if (!secret.length) throw new WebhookSignatureConfigurationError();
    return Buffer.from(secret, "utf8");
  }

  if (Buffer.isBuffer(secret) || secret instanceof Uint8Array) {
    if (!secret.byteLength) throw new WebhookSignatureConfigurationError();
    return Buffer.from(secret);
  }

  throw new WebhookSignatureConfigurationError();
}

function payloadBytes(body) {
  if (typeof body === "string") return Buffer.from(body, "utf8");
  if (Buffer.isBuffer(body) || body instanceof Uint8Array) return Buffer.from(body);
  throw new WebhookPayloadTypeError();
}

/**
 * Verify GitHub's X-Hub-Signature-256 against the exact raw webhook body.
 *
 * Call this before JSON parsing, delivery registration, queueing, or any other
 * processing that could cause an unauthenticated request to consume RepoOps work.
 * Malformed/missing signatures return false. Missing/invalid secret
 * configuration throws without including secret material.
 */
export function verifyGitHubWebhookSignature({ secret, signature, body }) {
  const key = secretBytes(secret);
  const payload = payloadBytes(body);

  if (typeof signature !== "string") return false;
  const match = SIGNATURE_PATTERN.exec(signature);
  if (!match) return false;

  const supplied = Buffer.from(match[1], "hex");
  const expected = createHmac("sha256", key).update(payload).digest();

  if (supplied.length !== expected.length) return false;
  return timingSafeEqual(supplied, expected);
}
