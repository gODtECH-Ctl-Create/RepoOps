import test from "node:test";
import assert from "node:assert/strict";
import {
  WEBHOOK_DELIVERY_EXISTS,
  WebhookDeliveryConflictError,
  createWebhookDelivery,
  registerWebhookDelivery
} from "../src/core/webhook-delivery.mjs";

const input = {
  deliveryId: "A1B2C3D4-1111-2222-3333-444455556666",
  eventName: "issue_comment",
  action: "created",
  installationId: 123,
  repositoryId: 456,
  receivedAt: "2026-09-29T01:00:00Z"
};

function memoryStore() {
  const records = new Map();
  return {
    records,
    async find(id) { return records.has(id) ? structuredClone(records.get(id)) : null; },
    async create(id, delivery) {
      if (records.has(id)) {
        const error = new Error("exists");
        error.code = WEBHOOK_DELIVERY_EXISTS;
        throw error;
      }
      records.set(id, structuredClone(delivery));
      return structuredClone(delivery);
    }
  };
}

test("delivery identity is stable, GUID-based, and excludes receipt time", () => {
  const first = createWebhookDelivery(input);
  const sameGuid = createWebhookDelivery({ ...input, deliveryId: input.deliveryId.toLowerCase(), receivedAt: "2026-09-29T02:00:00Z" });

  assert.equal(first.id, sameGuid.id);
  assert.equal(first.deliveryId, input.deliveryId.toLowerCase());
  assert.notEqual(first.receivedAt, sameGuid.receivedAt);
});

test("different GitHub delivery GUIDs have different identities", () => {
  const first = createWebhookDelivery(input);
  const second = createWebhookDelivery({ ...input, deliveryId: "A1B2C3D4-1111-2222-3333-444455556667" });
  assert.notEqual(first.id, second.id);
});

test("first registration is accepted and redelivery is duplicate", async () => {
  const store = memoryStore();
  const first = await registerWebhookDelivery({ store, input });
  const duplicate = await registerWebhookDelivery({ store, input: { ...input, receivedAt: "2026-09-29T01:05:00Z" } });

  assert.equal(first.type, "accepted");
  assert.equal(duplicate.type, "duplicate");
  assert.equal(store.records.size, 1);
  assert.equal(duplicate.delivery.receivedAt, "2026-09-29T01:00:00.000Z");
});

test("same delivery id with conflicting event metadata fails closed", async () => {
  const store = memoryStore();
  await registerWebhookDelivery({ store, input });

  await assert.rejects(
    registerWebhookDelivery({ store, input: { ...input, eventName: "issues" } }),
    WebhookDeliveryConflictError
  );
  await assert.rejects(
    registerWebhookDelivery({ store, input: { ...input, repositoryId: 999 } }),
    WebhookDeliveryConflictError
  );
});

test("uniqueness race reconciles to one accepted logical delivery", async () => {
  const stored = createWebhookDelivery(input);
  let finds = 0;
  const store = {
    async find() {
      finds += 1;
      return finds === 1 ? null : structuredClone(stored);
    },
    async create() {
      const error = new Error("concurrent insert");
      error.code = WEBHOOK_DELIVERY_EXISTS;
      throw error;
    }
  };

  const result = await registerWebhookDelivery({ store, input });
  assert.equal(result.type, "duplicate");
  assert.equal(result.delivery.id, stored.id);
});

test("uniqueness race with no durable record fails instead of accepting work twice", async () => {
  const store = {
    find: async () => null,
    async create() {
      const error = new Error("concurrent insert");
      error.code = WEBHOOK_DELIVERY_EXISTS;
      throw error;
    }
  };

  await assert.rejects(
    registerWebhookDelivery({ store, input }),
    /could not be reconciled/
  );
});

test("invalid webhook envelope fields are rejected deterministically", () => {
  const invalid = [
    ["deliveryId", "not-a-guid"],
    ["eventName", "Issue Comment"],
    ["action", "bad action"],
    ["installationId", 0],
    ["repositoryId", "456"],
    ["receivedAt", "yesterday"]
  ];

  for (const [field, value] of invalid) {
    assert.throws(() => createWebhookDelivery({ ...input, [field]: value }), new RegExp(field));
  }
});

test("payload or contributor text is not needed for delivery identity", () => {
  const first = createWebhookDelivery({ ...input, payload: { comment: { body: "/claim" } } });
  const second = createWebhookDelivery({ ...input, payload: { comment: { body: "malicious or different text" } } });
  assert.equal(first.id, second.id);
});
