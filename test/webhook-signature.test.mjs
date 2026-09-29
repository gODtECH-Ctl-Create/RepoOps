import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  WebhookPayloadTypeError,
  WebhookSignatureConfigurationError,
  verifyGitHubWebhookSignature
} from "../src/github/webhook-signature.mjs";

const publishedVector = {
  secret: "It's a Secret to Everybody",
  body: "Hello, World!",
  signature: "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17"
};

test("verifies GitHub's published HMAC-SHA256 test vector", () => {
  assert.equal(verifyGitHubWebhookSignature(publishedVector), true);
});

test("accepts the same exact UTF-8 payload as raw bytes", () => {
  assert.equal(verifyGitHubWebhookSignature({
    ...publishedVector,
    body: Buffer.from(publishedVector.body, "utf8")
  }), true);
});

test("fails verification when payload content changes", () => {
  assert.equal(verifyGitHubWebhookSignature({
    ...publishedVector,
    body: `${publishedVector.body} `
  }), false);
});

test("fails verification when the webhook secret is wrong", () => {
  assert.equal(verifyGitHubWebhookSignature({
    ...publishedVector,
    secret: "wrong secret"
  }), false);
});

test("missing and malformed signatures fail closed", () => {
  for (const signature of [
    undefined,
    null,
    "",
    "sha1=757107ea0eb2509fc211221cce984b8a37570b6d7",
    "SHA256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17",
    "sha256=not-hex",
    "sha256=757107ea"
  ]) {
    assert.equal(verifyGitHubWebhookSignature({ ...publishedVector, signature }), false);
  }
});

test("hex digest comparison accepts uppercase digest without changing algorithm", () => {
  assert.equal(verifyGitHubWebhookSignature({
    ...publishedVector,
    signature: publishedVector.signature.toUpperCase().replace("SHA256=", "sha256=")
  }), true);
});

test("raw Uint8Array bytes are authenticated without JSON parsing or reserialization", () => {
  const body = new Uint8Array([0x00, 0xff, 0x7b, 0x7d, 0x0a, 0x80]);
  const secret = "binary-test-secret";
  const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

  assert.equal(verifyGitHubWebhookSignature({ secret, signature, body }), true);

  const altered = new Uint8Array(body);
  altered[1] = 0xfe;
  assert.equal(verifyGitHubWebhookSignature({ secret, signature, body: altered }), false);
});

test("missing or invalid secret configuration fails without exposing secret material", () => {
  for (const secret of [undefined, null, "", Buffer.alloc(0)]) {
    assert.throws(
      () => verifyGitHubWebhookSignature({ ...publishedVector, secret }),
      (error) => {
        assert.ok(error instanceof WebhookSignatureConfigurationError);
        assert.equal(error.message, "GitHub webhook signature verification is not configured");
        assert.doesNotMatch(error.message, /Secret to Everybody/);
        return true;
      }
    );
  }
});

test("non-raw payload objects are rejected instead of being silently serialized", () => {
  assert.throws(
    () => verifyGitHubWebhookSignature({ ...publishedVector, body: { hello: "world" } }),
    WebhookPayloadTypeError
  );
});
