import test from "node:test";
import assert from "node:assert/strict";
import { buildClaimConfirmation } from "../src/core/contributor-guidance.mjs";

test("default guidance gives generic next steps without inventing project commands", () => {
  const message = buildClaimConfirmation({
    actor: "alice",
    issueNumber: 23,
    baseMessage: "✅ @alice claimed this issue.",
    guidance: {
      enabled: true,
      requirements: "",
      setupCommand: "",
      checkCommand: "",
      contributingUrl: "",
      developmentUrl: "",
      architectureUrl: ""
    }
  });
  assert.match(message, /Welcome, @alice/);
  assert.match(message, /focused branch for #23/);
  assert.match(message, /pull request linked to #23/);
  assert.doesNotMatch(message, /npm install/);
});

test("configured guidance renders repository-owned requirements, commands and docs", () => {
  const message = buildClaimConfirmation({
    actor: "alice",
    issueNumber: 23,
    baseMessage: "✅ claimed",
    guidance: {
      enabled: true,
      requirements: "Node.js 20+ and Git",
      setupCommand: "npm install",
      checkCommand: "npm run check",
      contributingUrl: "https://example.com/CONTRIBUTING.md",
      developmentUrl: "https://example.com/development",
      architectureUrl: "https://example.com/architecture"
    }
  });
  for (const expected of [
    "Node.js 20+ and Git",
    "`npm install`",
    "`npm run check`",
    "[Contributor guide](https://example.com/CONTRIBUTING.md)",
    "[Development guide](https://example.com/development)",
    "[Architecture](https://example.com/architecture)"
  ]) assert.ok(message.includes(expected));
});

test("disabled guidance preserves the existing confirmation exactly", () => {
  assert.equal(buildClaimConfirmation({
    actor: "alice",
    issueNumber: 23,
    baseMessage: "existing confirmation",
    guidance: { enabled: false }
  }), "existing confirmation");
});
