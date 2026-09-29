import { TextDecoder } from "node:util";

import { createWebhookDelivery } from "../core/webhook-delivery.mjs";
import { verifyGitHubWebhookSignature } from "./webhook-signature.mjs";

const SUPPORTED_EVENTS = new Set(["issue_comment", "issues", "pull_request"]);
const utf8 = new TextDecoder("utf-8", { fatal: true });

export class WebhookAuthenticationError extends Error {
  constructor() {
    super("GitHub webhook authentication failed");
    this.name = "WebhookAuthenticationError";
  }
}

export class WebhookPayloadValidationError extends Error {
  constructor(field) {
    super(`Invalid authenticated GitHub webhook payload: ${field}`);
    this.name = "WebhookPayloadValidationError";
  }
}

function rawText(body) {
  if (typeof body === "string") return body;
  try {
    if (Buffer.isBuffer(body) || body instanceof Uint8Array) return utf8.decode(body);
  } catch {
    throw new WebhookPayloadValidationError("utf8");
  }
  throw new WebhookPayloadValidationError("rawBody");
}

function parsePayload(body) {
  let payload;
  try {
    payload = JSON.parse(rawText(body));
  } catch (error) {
    if (error instanceof WebhookPayloadValidationError) throw error;
    throw new WebhookPayloadValidationError("json");
  }

  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new WebhookPayloadValidationError("root");
  }
  return payload;
}

function positiveId(value, field) {
  if (!(Number.isSafeInteger(value) && value > 0)) throw new WebhookPayloadValidationError(field);
  return value;
}

function actionFor(payload) {
  if (typeof payload.action !== "string" || !payload.action.length) {
    throw new WebhookPayloadValidationError("action");
  }
  return payload.action;
}

/**
 * Authenticate and normalize one repository-operation GitHub App webhook.
 *
 * Signature verification intentionally occurs before UTF-8 decoding or JSON
 * parsing. Returned payload content remains untrusted contributor-controlled
 * data; authentication proves origin/integrity, not authorization or intent.
 *
 * This helper does not persist or enqueue work. A future durable inbox adapter
 * can atomically persist the returned delivery metadata and authenticated payload.
 */
export function createVerifiedWebhookEnvelope({
  secret,
  signature,
  deliveryId,
  eventName,
  rawBody,
  receivedAt
}) {
  if (!verifyGitHubWebhookSignature({ secret, signature, body: rawBody })) {
    throw new WebhookAuthenticationError();
  }

  if (typeof eventName !== "string" || !SUPPORTED_EVENTS.has(eventName)) {
    throw new WebhookPayloadValidationError("eventName");
  }

  const payload = parsePayload(rawBody);
  const installationId = positiveId(payload.installation?.id, "installation.id");
  const repositoryId = positiveId(payload.repository?.id, "repository.id");
  const action = actionFor(payload);

  const delivery = createWebhookDelivery({
    deliveryId,
    eventName,
    action,
    installationId,
    repositoryId,
    receivedAt
  });

  return Object.freeze({ delivery, payload });
}
