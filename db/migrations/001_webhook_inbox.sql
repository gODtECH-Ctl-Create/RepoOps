CREATE TABLE IF NOT EXISTS repoops_webhook_inbox (
  id text PRIMARY KEY,
  delivery_guid uuid NOT NULL UNIQUE,
  schema_version smallint NOT NULL CHECK (schema_version = 1),
  installation_id bigint NOT NULL CHECK (installation_id > 0),
  repository_id bigint NOT NULL CHECK (repository_id > 0),
  event_name varchar(64) NOT NULL,
  action varchar(64),
  state text NOT NULL CHECK (state IN (
    'RECEIVED',
    'QUEUED',
    'PROCESSING',
    'RETRY_WAIT',
    'RECONCILE_REQUIRED',
    'NO_OP',
    'COMPLETED',
    'FAILED_PERMANENT',
    'DEAD_LETTER'
  )),
  processing_mode text CHECK (processing_mode IN ('normal', 'reconcile')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  reason varchar(256),
  next_attempt_at timestamptz,
  lease_worker_id varchar(128),
  lease_acquired_at timestamptz,
  lease_expires_at timestamptz,
  payload_sha256 char(64) NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  payload_byte_length integer NOT NULL CHECK (payload_byte_length >= 0),
  payload_bytes bytea,
  received_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),

  CHECK (created_at = received_at),
  CHECK (updated_at >= created_at),
  CHECK (payload_bytes IS NULL OR octet_length(payload_bytes) = payload_byte_length),
  CHECK (
    (state = 'PROCESSING'
      AND processing_mode IS NOT NULL
      AND lease_worker_id IS NOT NULL
      AND lease_acquired_at IS NOT NULL
      AND lease_expires_at IS NOT NULL
      AND attempt_count > 0
      AND lease_acquired_at = updated_at
      AND lease_expires_at > lease_acquired_at)
    OR
    (state <> 'PROCESSING'
      AND processing_mode IS NULL
      AND lease_worker_id IS NULL
      AND lease_acquired_at IS NULL
      AND lease_expires_at IS NULL)
  ),
  CHECK (
    (state = 'RETRY_WAIT' AND next_attempt_at IS NOT NULL AND next_attempt_at > updated_at)
    OR
    (state <> 'RETRY_WAIT' AND next_attempt_at IS NULL)
  ),
  CHECK (
    (state IN ('RETRY_WAIT', 'RECONCILE_REQUIRED', 'FAILED_PERMANENT', 'DEAD_LETTER')
      AND reason IS NOT NULL)
    OR
    (state NOT IN ('RETRY_WAIT', 'RECONCILE_REQUIRED', 'FAILED_PERMANENT', 'DEAD_LETTER')
      AND reason IS NULL)
  ),
  CHECK (
    payload_bytes IS NOT NULL
    OR state IN ('NO_OP', 'COMPLETED', 'FAILED_PERMANENT', 'DEAD_LETTER')
  )
);

CREATE INDEX IF NOT EXISTS repoops_webhook_inbox_retry_due_idx
  ON repoops_webhook_inbox (state, next_attempt_at, id)
  WHERE state = 'RETRY_WAIT';

CREATE INDEX IF NOT EXISTS repoops_webhook_inbox_abandoned_idx
  ON repoops_webhook_inbox (state, lease_expires_at, id)
  WHERE state = 'PROCESSING';

CREATE INDEX IF NOT EXISTS repoops_webhook_inbox_recovery_idx
  ON repoops_webhook_inbox (state, updated_at, id)
  WHERE state IN ('RECONCILE_REQUIRED', 'DEAD_LETTER');

CREATE INDEX IF NOT EXISTS repoops_webhook_inbox_installation_repo_idx
  ON repoops_webhook_inbox (installation_id, repository_id, created_at, id);
