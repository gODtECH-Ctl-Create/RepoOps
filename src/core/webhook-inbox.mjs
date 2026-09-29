import { createHash } from "node:crypto";

import { validateStoredWebhookDelivery } from "./webhook-delivery.mjs";

export const WEBHOOK_INBOX_STATES = Object.freeze({
  RECEIVED: "RECEIVED",
  QUEUED: "QUEUED",
  PROCESSING: "PROCESSING",
  RETRY_WAIT: "RETRY_WAIT",
  RECONCILE_REQUIRED: "RECONCILE_REQUIRED",
  NO_OP: "NO_OP",
  COMPLETED: "COMPLETED",
  FAILED_PERMANENT: "FAILED_PERMANENT",
  DEAD_LETTER: "DEAD_LETTER"
});

export const WEBHOOK_INBOX_RECOVERY = Object.freeze({
  RETRY_DUE: "retry-due",
  RECONCILIATION_REQUIRED: "reconciliation-required",
  ABANDONED_PROCESSING: "abandoned-processing",
  DEAD_LETTER: "dead-letter"
});

const TERMINAL_STATES = new Set([
  WEBHOOK_INBOX_STATES.NO_OP,
  WEBHOOK_INBOX_STATES.COMPLETED,
  WEBHOOK_INBOX_STATES.FAILED_PERMANENT,
  WEBHOOK_INBOX_STATES.DEAD_LETTER
]);

const OUTCOMES = new Set([
  WEBHOOK_INBOX_STATES.RETRY_WAIT,
  WEBHOOK_INBOX_STATES.RECONCILE_REQUIRED,
  ...TERMINAL_STATES
]);

const sha256Pattern = /^[a-f0-9]{64}$/;
const workerPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const reasonPattern = /^[A-Za-z0-9][A-Za-z0-9._:/ -]{0,255}$/;
const positiveInteger = (value) => Number.isSafeInteger(value) && value > 0;
const nonNegativeInteger = (value) => Number.isSafeInteger(value) && value >= 0;

export class WebhookInboxValidationError extends Error {
  constructor(field) {
    super(`Invalid webhook inbox field: ${field}`);
    this.name = "WebhookInboxValidationError";
  }
}

export class WebhookInboxTransitionError extends Error {
  constructor(from, to) {
    super(`Invalid webhook inbox transition: ${from} -> ${to}`);
    this.name = "WebhookInboxTransitionError";
  }
}

function requireField(condition, field) {
  if (!condition) throw new WebhookInboxValidationError(field);
}

function normalizeTimestamp(value, field) {
  requireField(typeof value === "string" && Number.isFinite(Date.parse(value)), field);
  const normalized = new Date(value).toISOString();
  requireField(normalized === value || normalized.replace(".000Z", "Z") === value, field);
  return normalized;
}

function rawBytes(body) {
  if (typeof body === "string") return Buffer.from(body, "utf8");
  if (Buffer.isBuffer(body) || body instanceof Uint8Array) return Buffer.from(body);
  throw new WebhookInboxValidationError("authenticatedPayload");
}

function validateReason(reason, required = false) {
  if (reason === null || reason === undefined) {
    requireField(!required, "reason");
    return null;
  }
  requireField(typeof reason === "string" && reasonPattern.test(reason), "reason");
  return reason;
}

function cloneDelivery(delivery) {
  const valid = validateStoredWebhookDelivery(delivery);
  return Object.freeze({ ...valid });
}

function freezeRecord(record) {
  if (record.delivery && !Object.isFrozen(record.delivery)) Object.freeze(record.delivery);
  if (record.payload && !Object.isFrozen(record.payload)) Object.freeze(record.payload);
  if (record.lease && !Object.isFrozen(record.lease)) Object.freeze(record.lease);
  return Object.freeze(record);
}

function nextVersion(record, now, updates) {
  const timestamp = normalizeTimestamp(now, "now");
  requireField(Date.parse(timestamp) >= Date.parse(record.updatedAt), "now");
  return freezeRecord({
    ...record,
    ...updates,
    version: record.version + 1,
    updatedAt: timestamp
  });
}

export function createWebhookInboxRecord({ delivery, authenticatedPayload }) {
  const normalizedDelivery = cloneDelivery(delivery);
  const bytes = rawBytes(authenticatedPayload);

  return freezeRecord({
    schemaVersion: 1,
    id: normalizedDelivery.id,
    delivery: normalizedDelivery,
    payload: {
      sha256: createHash("sha256").update(bytes).digest("hex"),
      byteLength: bytes.byteLength
    },
    state: WEBHOOK_INBOX_STATES.RECEIVED,
    processingMode: null,
    attemptCount: 0,
    reason: null,
    nextAttemptAt: null,
    lease: null,
    createdAt: normalizedDelivery.receivedAt,
    updatedAt: normalizedDelivery.receivedAt,
    version: 0
  });
}

export function validateWebhookInboxRecord(input) {
  requireField(input !== null && typeof input === "object" && !Array.isArray(input), "record");
  requireField(input.schemaVersion === 1, "schemaVersion");

  const delivery = cloneDelivery(input.delivery);
  requireField(input.id === delivery.id, "id");
  requireField(input.payload !== null && typeof input.payload === "object" && !Array.isArray(input.payload), "payload");
  requireField(typeof input.payload.sha256 === "string" && sha256Pattern.test(input.payload.sha256), "payload.sha256");
  requireField(nonNegativeInteger(input.payload.byteLength), "payload.byteLength");
  requireField(Object.values(WEBHOOK_INBOX_STATES).includes(input.state), "state");
  requireField(input.processingMode === null || ["normal", "reconcile"].includes(input.processingMode), "processingMode");
  requireField(nonNegativeInteger(input.attemptCount), "attemptCount");
  const reason = validateReason(input.reason);
  const createdAt = normalizeTimestamp(input.createdAt, "createdAt");
  const updatedAt = normalizeTimestamp(input.updatedAt, "updatedAt");
  requireField(Date.parse(updatedAt) >= Date.parse(createdAt), "updatedAt");
  requireField(input.createdAt === delivery.receivedAt || createdAt === delivery.receivedAt, "createdAt");
  requireField(nonNegativeInteger(input.version), "version");

  let nextAttemptAt = null;
  if (input.nextAttemptAt !== null) nextAttemptAt = normalizeTimestamp(input.nextAttemptAt, "nextAttemptAt");

  let lease = null;
  if (input.lease !== null) {
    requireField(input.lease && typeof input.lease === "object" && !Array.isArray(input.lease), "lease");
    requireField(typeof input.lease.workerId === "string" && workerPattern.test(input.lease.workerId), "lease.workerId");
    const acquiredAt = normalizeTimestamp(input.lease.acquiredAt, "lease.acquiredAt");
    const expiresAt = normalizeTimestamp(input.lease.expiresAt, "lease.expiresAt");
    requireField(Date.parse(expiresAt) > Date.parse(acquiredAt), "lease.expiresAt");
    lease = Object.freeze({ workerId: input.lease.workerId, acquiredAt, expiresAt });
  }

  if (input.state === WEBHOOK_INBOX_STATES.PROCESSING) {
    requireField(lease !== null, "lease");
    requireField(["normal", "reconcile"].includes(input.processingMode), "processingMode");
    requireField(input.attemptCount > 0, "attemptCount");
  } else {
    requireField(lease === null, "lease");
    requireField(input.processingMode === null, "processingMode");
  }

  if (input.state === WEBHOOK_INBOX_STATES.RETRY_WAIT) {
    requireField(nextAttemptAt !== null, "nextAttemptAt");
    validateReason(reason, true);
  } else {
    requireField(nextAttemptAt === null, "nextAttemptAt");
  }

  if ([
    WEBHOOK_INBOX_STATES.RECONCILE_REQUIRED,
    WEBHOOK_INBOX_STATES.FAILED_PERMANENT,
    WEBHOOK_INBOX_STATES.DEAD_LETTER
  ].includes(input.state)) validateReason(reason, true);

  return freezeRecord({
    schemaVersion: 1,
    id: input.id,
    delivery,
    payload: { sha256: input.payload.sha256, byteLength: input.payload.byteLength },
    state: input.state,
    processingMode: input.processingMode,
    attemptCount: input.attemptCount,
    reason,
    nextAttemptAt,
    lease,
    createdAt,
    updatedAt,
    version: input.version
  });
}

export function queueWebhookInboxRecord(input, { now }) {
  const record = validateWebhookInboxRecord(input);
  if (record.state === WEBHOOK_INBOX_STATES.RECEIVED) {
    return nextVersion(record, now, { state: WEBHOOK_INBOX_STATES.QUEUED, reason: null });
  }
  if (record.state === WEBHOOK_INBOX_STATES.RETRY_WAIT) {
    const timestamp = normalizeTimestamp(now, "now");
    if (Date.parse(timestamp) < Date.parse(record.nextAttemptAt)) {
      throw new WebhookInboxTransitionError(record.state, WEBHOOK_INBOX_STATES.QUEUED);
    }
    return nextVersion(record, timestamp, {
      state: WEBHOOK_INBOX_STATES.QUEUED,
      reason: null,
      nextAttemptAt: null
    });
  }
  throw new WebhookInboxTransitionError(record.state, WEBHOOK_INBOX_STATES.QUEUED);
}

export function claimWebhookInboxRecord(input, { workerId, now, leaseMs = 60_000 }) {
  const record = validateWebhookInboxRecord(input);
  requireField(typeof workerId === "string" && workerPattern.test(workerId), "workerId");
  requireField(positiveInteger(leaseMs) && leaseMs <= 3_600_000, "leaseMs");
  if (![WEBHOOK_INBOX_STATES.QUEUED, WEBHOOK_INBOX_STATES.RECONCILE_REQUIRED].includes(record.state)) {
    throw new WebhookInboxTransitionError(record.state, WEBHOOK_INBOX_STATES.PROCESSING);
  }

  const acquiredAt = normalizeTimestamp(now, "now");
  const expiresAt = new Date(Date.parse(acquiredAt) + leaseMs).toISOString();
  return nextVersion(record, acquiredAt, {
    state: WEBHOOK_INBOX_STATES.PROCESSING,
    processingMode: record.state === WEBHOOK_INBOX_STATES.RECONCILE_REQUIRED ? "reconcile" : "normal",
    attemptCount: record.attemptCount + 1,
    reason: null,
    nextAttemptAt: null,
    lease: { workerId, acquiredAt, expiresAt }
  });
}

export function finishWebhookInboxRecord(input, { outcome, now, reason = null, nextAttemptAt = null }) {
  const record = validateWebhookInboxRecord(input);
  if (record.state !== WEBHOOK_INBOX_STATES.PROCESSING || !OUTCOMES.has(outcome)) {
    throw new WebhookInboxTransitionError(record.state, outcome);
  }

  const timestamp = normalizeTimestamp(now, "now");
  const needsReason = [
    WEBHOOK_INBOX_STATES.RETRY_WAIT,
    WEBHOOK_INBOX_STATES.RECONCILE_REQUIRED,
    WEBHOOK_INBOX_STATES.FAILED_PERMANENT,
    WEBHOOK_INBOX_STATES.DEAD_LETTER
  ].includes(outcome);
  const normalizedReason = validateReason(reason, needsReason);

  let normalizedNextAttempt = null;
  if (outcome === WEBHOOK_INBOX_STATES.RETRY_WAIT) {
    normalizedNextAttempt = normalizeTimestamp(nextAttemptAt, "nextAttemptAt");
    requireField(Date.parse(normalizedNextAttempt) > Date.parse(timestamp), "nextAttemptAt");
  } else {
    requireField(nextAttemptAt === null || nextAttemptAt === undefined, "nextAttemptAt");
  }

  return nextVersion(record, timestamp, {
    state: outcome,
    processingMode: null,
    reason: normalizedReason,
    nextAttemptAt: normalizedNextAttempt,
    lease: null
  });
}

export function recoverAbandonedWebhookInboxRecord(input, { now, reason = "worker-lease-expired" }) {
  const record = validateWebhookInboxRecord(input);
  if (record.state !== WEBHOOK_INBOX_STATES.PROCESSING) {
    throw new WebhookInboxTransitionError(record.state, WEBHOOK_INBOX_STATES.RECONCILE_REQUIRED);
  }
  const timestamp = normalizeTimestamp(now, "now");
  if (Date.parse(timestamp) < Date.parse(record.lease.expiresAt)) {
    throw new WebhookInboxTransitionError(record.state, WEBHOOK_INBOX_STATES.RECONCILE_REQUIRED);
  }
  return nextVersion(record, timestamp, {
    state: WEBHOOK_INBOX_STATES.RECONCILE_REQUIRED,
    processingMode: null,
    reason: validateReason(reason, true),
    nextAttemptAt: null,
    lease: null
  });
}

export function classifyWebhookInboxRecovery(input, { now }) {
  const record = validateWebhookInboxRecord(input);
  const timestamp = normalizeTimestamp(now, "now");

  if (record.state === WEBHOOK_INBOX_STATES.RETRY_WAIT && Date.parse(timestamp) >= Date.parse(record.nextAttemptAt)) {
    return WEBHOOK_INBOX_RECOVERY.RETRY_DUE;
  }
  if (record.state === WEBHOOK_INBOX_STATES.RECONCILE_REQUIRED) {
    return WEBHOOK_INBOX_RECOVERY.RECONCILIATION_REQUIRED;
  }
  if (record.state === WEBHOOK_INBOX_STATES.PROCESSING && Date.parse(timestamp) >= Date.parse(record.lease.expiresAt)) {
    return WEBHOOK_INBOX_RECOVERY.ABANDONED_PROCESSING;
  }
  if (record.state === WEBHOOK_INBOX_STATES.DEAD_LETTER) {
    return WEBHOOK_INBOX_RECOVERY.DEAD_LETTER;
  }
  return null;
}

export function isWebhookInboxTerminal(input) {
  return TERMINAL_STATES.has(validateWebhookInboxRecord(input).state);
}

const STORE_METHODS = Object.freeze([
  "find",
  "insertIfAbsent",
  "compareAndSwap",
  "listRetryDue",
  "listReconcileRequired",
  "listAbandonedProcessing",
  "listDeadLetter"
]);

export function assertWebhookInboxStore(store) {
  requireField(store !== null && typeof store === "object", "store");
  for (const method of STORE_METHODS) requireField(typeof store[method] === "function", `store.${method}`);
  return store;
}
