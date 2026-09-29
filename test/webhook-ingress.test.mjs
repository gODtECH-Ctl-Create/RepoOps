import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import { WebhookDeliveryValidationError } from "../src/core/webhook-delivery.mjs";
import {
  WebhookAuthenticationError,
  WebhookPayloadValidationError,
  createVerifiedWebhookEnvelope
} from "../src/github/webhook-ingress.mjs";

const secret = "repoops-test-webhook-secret";
const deliveryId = "12345678-1234-4abc-8def-1234567890ab";
const receivedAt = "2026-09-29T01:55:00Z";

function sign(body) {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

function rawPayload(overrides = {}) {
  return JSON.stringify({
    action: "created",
    installation: { id: 101 },
    repository: { id: 202, full_name: "owner/repo" },
    issue: { id: 303, number: 42 },
    comment: { id: 404, body: "/claim — ready ✅" },
    ...overrides
  });
}

function envelopeArgs(body, overrides = {}) {
  return {
    secret,
    signature: sign(body),
    deliveryId,
    eventName: "issue_comment",
    rawBody: body,
    receivedAt,
    ...overrides
  };
}

test("normalizes an authenticated repository-operation webhook", () => {
  const body = rawPayload();
  const envelope = createVerifiedWebhookEnvelope(envelopeArgs(body));

  assert.equal(envelope.delivery.deliveryId, deliveryId);
  assert.equal(envelope.delivery.eventName, "issue_comment");
  assert.equal(envelope.delivery.action, "created");
  assert.equal(envelope.delivery.installationId, 101);
  assert.equal(envelope.delivery.repositoryId, 202);
  assert.equal(envelope.delivery.receivedAt, "2026-09-29T01:55:00.000Z");
  assert.equal(envelope.payload.comment.body, "/claim — ready ✅");
});

test("authenticated payload remains immutable after verification", () => {
  const body = rawPayload();
  const envelope = createVerifiedWebhookEnvelope(envelopeArgs(body));

  assert.equal(Object.isFrozen(envelope), true);
  assert.equal(Object.isFrozen(envelope.payload), true);
  assert.equal(Object.isFrozen(envelope.payload.comment), true);
  assert.throws(() => {
    envelope.payload.comment.body = "tampered after verification";
  }, TypeError);
  assert.equal(envelope.payload.comment.body, "/claim — ready ✅");
});

test("invalid signature fails before malformed JSON is parsed", () => {
  const malformed = "{ definitely not JSON";
  assert.throws(
    () => createVerifiedWebhookEnvelope({
      ...envelopeArgs(malformed),
      signature: "sha256=" + "0".repeat(64)
    }),
    WebhookAuthenticationError
  );
});

test("authenticated malformed JSON fails as invalid payload", () => {
  const malformed = "{ definitely not JSON";
  assert.throws(
    () => createVerifiedWebhookEnvelope(envelopeArgs(malformed)),
    (error) => error instanceof WebhookPayloadValidationError && /json/.test(error.message)
  );
});

test("authenticated invalid UTF-8 bytes fail before JSON interpretation", () => {
  const body = new Uint8Array([0xff, 0xfe, 0xfd]);
  assert.throws(
    () => createVerifiedWebhookEnvelope(envelopeArgs(body)),
    (error) => error instanceof WebhookPayloadValidationError && /utf8/.test(error.message)
  );
});

test("supported repository webhook event names normalize through one boundary", () => {
  for (const [eventName, action] of [
    ["issue_comment", "created"],
    ["issues", "closed"],
    ["pull_request", "closed"]
  ]) {
    const body = rawPayload({ action });
    const envelope = createVerifiedWebhookEnvelope(envelopeArgs(body, { eventName }));
    assert.equal(envelope.delivery.eventName, eventName);
    assert.equal(envelope.delivery.action, action);
  }
});

test("unsupported event headers fail closed after authentication", () => {
  const body = rawPayload();
  assert.throws(
    () => createVerifiedWebhookEnvelope(envelopeArgs(body, { eventName: "push" })),
    (error) => error instanceof WebhookPayloadValidationError && /eventName/.test(error.message)
  );
});

test("missing or malformed trusted payload identities fail closed", () => {
  const cases = [
    [{ installation: undefined }, "installation.id"],
    [{ installation: { id: 0 } }, "installation.id"],
    [{ repository: undefined }, "repository.id"],
    [{ repository: { id: "202" } }, "repository.id"],
    [{ action: undefined }, "action"],
    [{ action: "" }, "action"]
  ];

  for (const [overrides, field] of cases) {
    const body = rawPayload(overrides);
    assert.throws(
      () => createVerifiedWebhookEnvelope(envelopeArgs(body)),
      (error) => error instanceof WebhookPayloadValidationError && error.message.includes(field)
    );
  }
});

test("malformed delivery header is rejected by the existing delivery validator", () => {
  const body = rawPayload();
  assert.throws(
    () => createVerifiedWebhookEnvelope(envelopeArgs(body, { deliveryId: "not-a-guid" })),
    WebhookDeliveryValidationError
  );
});

test("contributor-controlled payload content does not supply delivery identity", () => {
  const firstBody = rawPayload({ comment: { id: 404, body: "/claim" } });
  const secondBody = rawPayload({ comment: { id: 404, body: "completely different contributor text" } });

  const first = createVerifiedWebhookEnvelope(envelopeArgs(firstBody));
  const second = createVerifiedWebhookEnvelope(envelopeArgs(secondBody));

  assert.equal(first.delivery.id, second.delivery.id);
  assert.notEqual(first.payload.comment.body, second.payload.comment.body);
});

test("authenticated payload root must be an object", () => {
  for (const raw of ["null", "[]", "\"text\""]) {
    assert.throws(
      () => createVerifiedWebhookEnvelope(envelopeArgs(raw)),
      (error) => error instanceof WebhookPayloadValidationError && /root/.test(error.message)
    );
  }
});
