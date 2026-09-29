import { createWebhookInboxRecord } from "../core/webhook-inbox.mjs";
import { WebhookDeliveryValidationError } from "../core/webhook-delivery.mjs";
import {
  createVerifiedWebhookEnvelope, WebhookAuthenticationError, WebhookPayloadValidationError
} from "../github/webhook-ingress.mjs";
import { WebhookSignatureConfigurationError } from "../github/webhook-signature.mjs";
import { PostgresWebhookInboxConflictError } from "./postgres/webhook-inbox-store.mjs";

export function webhookSecret(env) {
  const value = env.REPOOPS_WEBHOOK_SECRET;
  if (typeof value !== "string" || !value.trim()) throw new WebhookSignatureConfigurationError();
  return value;
}

function reply(response, status, error) {
  if (response.destroyed || response.writableEnded) return;
  const body = JSON.stringify(status === 202 ? { status: "accepted" } : { error });
  response.writeHead(status, {
    "content-type": "application/json", "cache-control": "no-store",
    "content-length": Buffer.byteLength(body), connection: "close",
    ...(status === 405 ? { allow: "POST" } : {})
  });
  response.end(body);
}

// Duplicate security/envelope headers are ambiguous even if Node joins values.
function header(request, name) {
  const values = request.headersDistinct[name];
  return values?.length === 1 ? values[0] : undefined;
}

/** Receipt only: never obtains GitHub credentials or executes domain mutations. */
export function createWebhookHttpHandler({
  secret, store, now = () => new Date().toISOString(),
  maxBytes = 25 * 1024 * 1024, timeoutMs = 8_000
}) {
  webhookSecret({ REPOOPS_WEBHOOK_SECRET: secret });
  if (typeof store?.insertIfAbsent !== "function" || typeof now !== "function"
    || !Number.isSafeInteger(maxBytes) || maxBytes < 1
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 9_000) {
    throw new TypeError("Invalid webhook HTTP dependencies or limits");
  }

  return async function receive(request, response) {
    if (request.method !== "POST") return reply(response, 405, "method-not-allowed");
    const media = header(request, "content-type");
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(media ?? "")
      || (request.headersDistinct["content-encoding"]
        && header(request, "content-encoding") !== "identity")) {
      return reply(response, 415, "unsupported-media-type");
    }
    const length = header(request, "content-length");
    if (length && Number(length) > maxBytes) return reply(response, 413, "payload-too-large");

    let expired = false;
    let cancelRead = () => {};
    const timer = setTimeout(() => {
      expired = true;
      reply(response, 503, "acceptance-timeout");
      cancelRead();
    }, timeoutMs);
    try {
      const rawBody = await new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        const cleanup = () => {
          request.off("data", onData);
          request.off("end", onEnd);
          request.off("aborted", onAbort);
          request.off("error", onAbort);
        };
        const fail = (status) => { cleanup(); reject({ status }); };
        const onData = (chunk) => {
          size += chunk.length;
          if (size > maxBytes) { fail(413); request.resume(); return; }
          chunks.push(chunk);
        };
        const onEnd = () => { cleanup(); resolve(Buffer.concat(chunks, size)); };
        const onAbort = () => fail(400);
        cancelRead = () => fail(503);
        request.on("data", onData);
        request.once("end", onEnd);
        request.once("aborted", onAbort);
        request.once("error", onAbort);
      });
      if (expired) return;
      const { delivery } = createVerifiedWebhookEnvelope({
        secret, rawBody, receivedAt: now(),
        signature: header(request, "x-hub-signature-256"),
        deliveryId: header(request, "x-github-delivery"),
        eventName: header(request, "x-github-event")
      });
      const record = createWebhookInboxRecord({ delivery, authenticatedPayload: rawBody });
      const result = await store.insertIfAbsent(record, rawBody);
      if (!["inserted", "existing"].includes(result?.type)) throw new Error("Invalid acceptance result");
      // A timed-out write may still commit. Never send late success; redelivery
      // reconciles through the same unique delivery identity.
      if (!expired) reply(response, 202);
    } catch (error) {
      if (expired) return;
      if (error instanceof WebhookAuthenticationError) reply(response, 401, "unauthorized");
      else if (error instanceof WebhookPayloadValidationError || error instanceof WebhookDeliveryValidationError) {
        reply(response, 400, "invalid-webhook");
      } else if (error instanceof PostgresWebhookInboxConflictError) reply(response, 409, "delivery-conflict");
      else if (error?.status === 413) reply(response, 413, "payload-too-large");
      else if (error?.status === 400) reply(response, 400, "incomplete-request");
      else reply(response, 503, "acceptance-unavailable");
    } finally {
      clearTimeout(timer);
    }
  };
}
