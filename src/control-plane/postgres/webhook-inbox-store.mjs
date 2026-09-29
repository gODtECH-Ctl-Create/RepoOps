import { createHash } from "node:crypto";

import {
  WEBHOOK_INBOX_STATES,
  assertWebhookInboxStore,
  validateWebhookInboxRecord
} from "../../core/webhook-inbox.mjs";
import { toPostgresInfrastructureError } from "./database.mjs";

const RECORD_COLUMNS = `
  id,
  delivery_guid,
  schema_version,
  installation_id,
  repository_id,
  event_name,
  action,
  state,
  processing_mode,
  attempt_count,
  reason,
  next_attempt_at,
  lease_worker_id,
  lease_acquired_at,
  lease_expires_at,
  payload_sha256,
  payload_byte_length,
  received_at,
  created_at,
  updated_at,
  version
`;

export class PostgresWebhookInboxConflictError extends Error {
  constructor() {
    super("Conflicting webhook delivery already exists in the PostgreSQL inbox");
    this.name = "PostgresWebhookInboxConflictError";
  }
}

export class PostgresWebhookPayloadIntegrityError extends Error {
  constructor() {
    super("Stored webhook payload failed integrity validation");
    this.name = "PostgresWebhookPayloadIntegrityError";
  }
}

export class PostgresWebhookPayloadUnavailableError extends Error {
  constructor() {
    super("Stored webhook payload is no longer available");
    this.name = "PostgresWebhookPayloadUnavailableError";
  }
}

function isoTimestamp(value, field) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError(`Invalid PostgreSQL webhook inbox ${field}`);
  return date.toISOString();
}

function safeInteger(value, field) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(number)) throw new TypeError(`Invalid PostgreSQL webhook inbox ${field}`);
  return number;
}

function rawPayloadBytes(payload) {
  if (typeof payload === "string") return Buffer.from(payload, "utf8");
  if (Buffer.isBuffer(payload) || payload instanceof Uint8Array) return Buffer.from(payload);
  throw new TypeError("Authenticated webhook payload must be raw text, Buffer, or Uint8Array");
}

function verifyPayload(record, payload) {
  const bytes = rawPayloadBytes(payload);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (bytes.byteLength !== record.payload.byteLength || digest !== record.payload.sha256) {
    throw new PostgresWebhookPayloadIntegrityError();
  }
  return bytes;
}

function rowToRecord(row) {
  if (!row) return null;

  return validateWebhookInboxRecord({
    schemaVersion: safeInteger(row.schema_version, "schemaVersion"),
    id: row.id,
    delivery: {
      id: row.id,
      deliveryId: row.delivery_guid,
      eventName: row.event_name,
      action: row.action,
      installationId: safeInteger(row.installation_id, "installationId"),
      repositoryId: safeInteger(row.repository_id, "repositoryId"),
      receivedAt: isoTimestamp(row.received_at, "receivedAt")
    },
    payload: {
      sha256: row.payload_sha256.trim(),
      byteLength: safeInteger(row.payload_byte_length, "payloadByteLength")
    },
    state: row.state,
    processingMode: row.processing_mode,
    attemptCount: safeInteger(row.attempt_count, "attemptCount"),
    reason: row.reason,
    nextAttemptAt: row.next_attempt_at === null ? null : isoTimestamp(row.next_attempt_at, "nextAttemptAt"),
    lease: row.lease_worker_id === null ? null : {
      workerId: row.lease_worker_id,
      acquiredAt: isoTimestamp(row.lease_acquired_at, "leaseAcquiredAt"),
      expiresAt: isoTimestamp(row.lease_expires_at, "leaseExpiresAt")
    },
    createdAt: isoTimestamp(row.created_at, "createdAt"),
    updatedAt: isoTimestamp(row.updated_at, "updatedAt"),
    version: safeInteger(row.version, "version")
  });
}

function sameAcceptanceFacts(left, right) {
  return left.id === right.id
    && left.delivery.deliveryId === right.delivery.deliveryId
    && left.delivery.eventName === right.delivery.eventName
    && left.delivery.action === right.delivery.action
    && left.delivery.installationId === right.delivery.installationId
    && left.delivery.repositoryId === right.delivery.repositoryId
    && left.delivery.receivedAt === right.delivery.receivedAt
    && left.payload.sha256 === right.payload.sha256
    && left.payload.byteLength === right.payload.byteLength;
}

function validateLimit(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 1000) {
    throw new TypeError("PostgreSQL webhook inbox query limit must be an integer from 1 to 1000");
  }
  return value;
}

function normalizeQueryTime(value, field = "now") {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(`PostgreSQL webhook inbox ${field} must be an ISO timestamp`);
  }
  const normalized = new Date(value).toISOString();
  if (!(normalized === value || normalized.replace(".000Z", "Z") === value)) {
    throw new TypeError(`PostgreSQL webhook inbox ${field} must be an ISO timestamp`);
  }
  return normalized;
}

function insertParameters(record, payloadBytes) {
  return [
    record.id,
    record.delivery.deliveryId,
    record.schemaVersion,
    record.delivery.installationId,
    record.delivery.repositoryId,
    record.delivery.eventName,
    record.delivery.action,
    record.state,
    record.processingMode,
    record.attemptCount,
    record.reason,
    record.nextAttemptAt,
    record.lease?.workerId ?? null,
    record.lease?.acquiredAt ?? null,
    record.lease?.expiresAt ?? null,
    record.payload.sha256,
    record.payload.byteLength,
    payloadBytes,
    record.delivery.receivedAt,
    record.createdAt,
    record.updatedAt,
    record.version
  ];
}

async function safeQuery(pool, operation, text, values = []) {
  try {
    return await pool.query(text, values);
  } catch (error) {
    throw toPostgresInfrastructureError(operation, error);
  }
}

/**
 * PostgreSQL implementation of the version-1 webhook inbox store contract.
 * State transitions remain in src/core/webhook-inbox.mjs; this adapter only
 * persists validated records with atomic SQL semantics.
 */
export function createPostgresWebhookInboxStore({ pool }) {
  if (!pool || typeof pool.query !== "function") {
    throw new TypeError("PostgreSQL webhook inbox pool must expose query()");
  }

  const store = {
    async find(id) {
      if (typeof id !== "string" || !id) throw new TypeError("Webhook inbox id must be a non-empty string");
      const result = await safeQuery(
        pool,
        "webhook-inbox-find",
        `SELECT ${RECORD_COLUMNS} FROM repoops_webhook_inbox WHERE id = $1`,
        [id]
      );
      return rowToRecord(result.rows[0] ?? null);
    },

    async insertIfAbsent(input, authenticatedPayload) {
      const record = validateWebhookInboxRecord(input);
      if (record.state !== WEBHOOK_INBOX_STATES.RECEIVED || record.version !== 0 || record.attemptCount !== 0) {
        throw new TypeError("New webhook inbox records must be unattempted RECEIVED version 0 records");
      }
      const bytes = verifyPayload(record, authenticatedPayload);

      const result = await safeQuery(
        pool,
        "webhook-inbox-insert",
        `INSERT INTO repoops_webhook_inbox (
          id, delivery_guid, schema_version, installation_id, repository_id,
          event_name, action, state, processing_mode, attempt_count, reason,
          next_attempt_at, lease_worker_id, lease_acquired_at, lease_expires_at,
          payload_sha256, payload_byte_length, payload_bytes,
          received_at, created_at, updated_at, version
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9, $10, $11,
          $12, $13, $14, $15,
          $16, $17, $18,
          $19, $20, $21, $22
        )
        ON CONFLICT DO NOTHING
        RETURNING ${RECORD_COLUMNS}`,
        insertParameters(record, bytes)
      );

      if (result.rows[0]) {
        return Object.freeze({ type: "inserted", record: rowToRecord(result.rows[0]) });
      }

      const existingResult = await safeQuery(
        pool,
        "webhook-inbox-insert-reconcile",
        `SELECT ${RECORD_COLUMNS}
         FROM repoops_webhook_inbox
         WHERE id = $1 OR delivery_guid = $2::uuid
         ORDER BY CASE WHEN id = $1 THEN 0 ELSE 1 END
         LIMIT 1`,
        [record.id, record.delivery.deliveryId]
      );
      const existing = rowToRecord(existingResult.rows[0] ?? null);
      if (!existing || !sameAcceptanceFacts(existing, record)) {
        throw new PostgresWebhookInboxConflictError();
      }

      return Object.freeze({ type: "existing", record: existing });
    },

    async compareAndSwap(id, expectedVersion, nextInput) {
      if (typeof id !== "string" || !id) throw new TypeError("Webhook inbox id must be a non-empty string");
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
        throw new TypeError("Webhook inbox expectedVersion must be a non-negative integer");
      }

      const nextRecord = validateWebhookInboxRecord(nextInput);
      if (nextRecord.id !== id || nextRecord.version !== expectedVersion + 1) {
        throw new TypeError("Webhook inbox compare-and-swap record/version mismatch");
      }

      const result = await safeQuery(
        pool,
        "webhook-inbox-cas",
        `UPDATE repoops_webhook_inbox
         SET state = $3,
             processing_mode = $4,
             attempt_count = $5,
             reason = $6,
             next_attempt_at = $7,
             lease_worker_id = $8,
             lease_acquired_at = $9,
             lease_expires_at = $10,
             updated_at = $11,
             version = $12
         WHERE id = $1
           AND version = $2
           AND delivery_guid = $13::uuid
           AND installation_id = $14
           AND repository_id = $15
           AND event_name = $16
           AND action IS NOT DISTINCT FROM $17
           AND payload_sha256 = $18
           AND payload_byte_length = $19
           AND received_at = $20
           AND created_at = $21
         RETURNING ${RECORD_COLUMNS}`,
        [
          id,
          expectedVersion,
          nextRecord.state,
          nextRecord.processingMode,
          nextRecord.attemptCount,
          nextRecord.reason,
          nextRecord.nextAttemptAt,
          nextRecord.lease?.workerId ?? null,
          nextRecord.lease?.acquiredAt ?? null,
          nextRecord.lease?.expiresAt ?? null,
          nextRecord.updatedAt,
          nextRecord.version,
          nextRecord.delivery.deliveryId,
          nextRecord.delivery.installationId,
          nextRecord.delivery.repositoryId,
          nextRecord.delivery.eventName,
          nextRecord.delivery.action,
          nextRecord.payload.sha256,
          nextRecord.payload.byteLength,
          nextRecord.delivery.receivedAt,
          nextRecord.createdAt
        ]
      );

      if (result.rows[0]) {
        return Object.freeze({ type: "updated", record: rowToRecord(result.rows[0]) });
      }

      const current = await store.find(id);
      return Object.freeze({ type: current ? "conflict" : "missing", record: current });
    },

    async listRetryDue(now, limit = 100) {
      const timestamp = normalizeQueryTime(now);
      const result = await safeQuery(
        pool,
        "webhook-inbox-list-retry-due",
        `SELECT ${RECORD_COLUMNS}
         FROM repoops_webhook_inbox
         WHERE state = 'RETRY_WAIT' AND next_attempt_at <= $1
         ORDER BY next_attempt_at ASC, id ASC
         LIMIT $2`,
        [timestamp, validateLimit(limit)]
      );
      return Object.freeze(result.rows.map(rowToRecord));
    },

    async listReconcileRequired(limit = 100) {
      const result = await safeQuery(
        pool,
        "webhook-inbox-list-reconcile",
        `SELECT ${RECORD_COLUMNS}
         FROM repoops_webhook_inbox
         WHERE state = 'RECONCILE_REQUIRED'
         ORDER BY updated_at ASC, id ASC
         LIMIT $1`,
        [validateLimit(limit)]
      );
      return Object.freeze(result.rows.map(rowToRecord));
    },

    async listAbandonedProcessing(now, limit = 100) {
      const timestamp = normalizeQueryTime(now);
      const result = await safeQuery(
        pool,
        "webhook-inbox-list-abandoned",
        `SELECT ${RECORD_COLUMNS}
         FROM repoops_webhook_inbox
         WHERE state = 'PROCESSING' AND lease_expires_at <= $1
         ORDER BY lease_expires_at ASC, id ASC
         LIMIT $2`,
        [timestamp, validateLimit(limit)]
      );
      return Object.freeze(result.rows.map(rowToRecord));
    },

    async listDeadLetter(limit = 100) {
      const result = await safeQuery(
        pool,
        "webhook-inbox-list-dead-letter",
        `SELECT ${RECORD_COLUMNS}
         FROM repoops_webhook_inbox
         WHERE state = 'DEAD_LETTER'
         ORDER BY updated_at ASC, id ASC
         LIMIT $1`,
        [validateLimit(limit)]
      );
      return Object.freeze(result.rows.map(rowToRecord));
    },

    async readWithPayload(id) {
      if (typeof id !== "string" || !id) throw new TypeError("Webhook inbox id must be a non-empty string");
      const result = await safeQuery(
        pool,
        "webhook-inbox-read-payload",
        `SELECT ${RECORD_COLUMNS}, payload_bytes
         FROM repoops_webhook_inbox
         WHERE id = $1`,
        [id]
      );
      const row = result.rows[0];
      if (!row) return null;

      const record = rowToRecord(row);
      if (!Buffer.isBuffer(row.payload_bytes)) throw new PostgresWebhookPayloadUnavailableError();
      const payload = verifyPayload(record, row.payload_bytes);
      return Object.freeze({ record, authenticatedPayload: Buffer.from(payload) });
    },

    async listForRepository({ installationId, repositoryId, limit = 100 }) {
      if (!Number.isSafeInteger(installationId) || installationId < 1) {
        throw new TypeError("installationId must be a positive safe integer");
      }
      if (!Number.isSafeInteger(repositoryId) || repositoryId < 1) {
        throw new TypeError("repositoryId must be a positive safe integer");
      }
      const result = await safeQuery(
        pool,
        "webhook-inbox-list-repository",
        `SELECT ${RECORD_COLUMNS}
         FROM repoops_webhook_inbox
         WHERE installation_id = $1 AND repository_id = $2
         ORDER BY created_at ASC, id ASC
         LIMIT $3`,
        [installationId, repositoryId, validateLimit(limit)]
      );
      return Object.freeze(result.rows.map(rowToRecord));
    }
  };

  assertWebhookInboxStore(store);
  return Object.freeze(store);
}
