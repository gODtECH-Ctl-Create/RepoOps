import { createHash } from "node:crypto";

const DELIVERY_PREFIX = "ghd1_";
const DELIVERY_EXISTS = "REPOOPS_DELIVERY_EXISTS";
const guidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const eventPattern = /^[a-z][a-z0-9_]{0,63}$/;
const actionPattern = /^[a-z][a-z0-9_-]{0,63}$/;
const positiveId = (value) => Number.isSafeInteger(value) && value > 0;

export class WebhookDeliveryValidationError extends Error {
  constructor(field) {
    super(`Invalid GitHub webhook delivery field: ${field}`);
    this.name = "WebhookDeliveryValidationError";
  }
}

export class WebhookDeliveryConflictError extends Error {
  constructor(deliveryId) {
    super(`Conflicting GitHub webhook deliveries share delivery id ${deliveryId}`);
    this.name = "WebhookDeliveryConflictError";
  }
}

function requireField(condition, field) {
  if (!condition) throw new WebhookDeliveryValidationError(field);
}

function normalizeTimestamp(value) {
  requireField(typeof value === "string" && Number.isFinite(Date.parse(value)), "receivedAt");
  const normalized = new Date(value).toISOString();
  requireField(normalized === value || normalized.replace(".000Z", "Z") === value, "receivedAt");
  return normalized;
}

function sameDeliveryFacts(left, right) {
  return left.deliveryId === right.deliveryId
    && left.eventName === right.eventName
    && left.action === right.action
    && left.installationId === right.installationId
    && left.repositoryId === right.repositoryId;
}

/**
 * Normalize trusted webhook-envelope metadata. Raw contributor-controlled payload
 * content is deliberately excluded from identity.
 */
export function createWebhookDelivery(input) {
  requireField(input !== null && typeof input === "object" && !Array.isArray(input), "envelope");

  const deliveryId = typeof input.deliveryId === "string" ? input.deliveryId.toLowerCase() : input.deliveryId;
  requireField(typeof deliveryId === "string" && guidPattern.test(deliveryId), "deliveryId");
  requireField(typeof input.eventName === "string" && eventPattern.test(input.eventName), "eventName");
  requireField(input.action === null || (typeof input.action === "string" && actionPattern.test(input.action)), "action");
  requireField(positiveId(input.installationId), "installationId");
  requireField(positiveId(input.repositoryId), "repositoryId");

  const receivedAt = normalizeTimestamp(input.receivedAt);
  const id = `${DELIVERY_PREFIX}${createHash("sha256").update(deliveryId).digest("hex")}`;

  return Object.freeze({
    id,
    deliveryId,
    eventName: input.eventName,
    action: input.action,
    installationId: input.installationId,
    repositoryId: input.repositoryId,
    receivedAt
  });
}

export function validateStoredWebhookDelivery(input) {
  requireField(input !== null && typeof input === "object" && !Array.isArray(input), "stored");
  const expected = createWebhookDelivery(input);
  requireField(input.id === expected.id, "id");
  return expected;
}

/**
 * Register one GitHub webhook delivery in an injected durable inbox store.
 *
 * Store contract:
 * - find(id) -> stored delivery | null
 * - create(id, delivery) -> stored delivery
 * - create MUST enforce uniqueness for id and, on a uniqueness race, throw an
 *   error whose `code` is `REPOOPS_DELIVERY_EXISTS`.
 *
 * The function performs no GitHub calls and enqueues no work. Hosted webhook
 * ingress should enqueue only when `type === "accepted"`.
 */
export async function registerWebhookDelivery({ store, input }) {
  if (!store || typeof store.find !== "function" || typeof store.create !== "function") {
    throw new Error("Webhook delivery store must implement find and create");
  }

  const delivery = createWebhookDelivery(input);
  let existing = await store.find(delivery.id);

  if (existing) {
    existing = validateStoredWebhookDelivery(existing);
    if (!sameDeliveryFacts(existing, delivery)) throw new WebhookDeliveryConflictError(delivery.deliveryId);
    return { type: "duplicate", delivery: existing };
  }

  try {
    const created = validateStoredWebhookDelivery(await store.create(delivery.id, delivery));
    if (!sameDeliveryFacts(created, delivery)) throw new WebhookDeliveryConflictError(delivery.deliveryId);
    return { type: "accepted", delivery: created };
  } catch (error) {
    if (error?.code !== DELIVERY_EXISTS) throw error;

    existing = await store.find(delivery.id);
    if (!existing) throw new Error("Webhook delivery uniqueness conflict could not be reconciled");
    existing = validateStoredWebhookDelivery(existing);
    if (!sameDeliveryFacts(existing, delivery)) throw new WebhookDeliveryConflictError(delivery.deliveryId);
    return { type: "duplicate", delivery: existing };
  }
}

export const WEBHOOK_DELIVERY_EXISTS = DELIVERY_EXISTS;
