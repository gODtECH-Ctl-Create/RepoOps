import test from "node:test";
import assert from "node:assert/strict";

import { decideClaim, normalizeCommand } from "../src/core/claim.mjs";

test("normalizes claim command", () => {
  assert.equal(normalizeCommand("  /CLAIM  "), "/claim");
  assert.equal(normalizeCommand("/claim please"), "/claim");
});

test("ignores unrelated comments", () => {
  assert.deepEqual(
    decideClaim({ body: "I can take this", actor: "ada", assignees: [] }),
    { type: "ignore", reason: "not-claim-command" }
  );
});

test("ignores pull request comments", () => {
  assert.deepEqual(
    decideClaim({ body: "/claim", actor: "ada", assignees: [], isPullRequest: true }),
    { type: "ignore", reason: "pull-request-comment" }
  );
});

test("claims an unassigned issue", () => {
  assert.deepEqual(
    decideClaim({ body: "/claim", actor: "ada", assignees: [] }),
    {
      type: "claim",
      actor: "ada",
      label: "status: in-progress",
      message: "✅ @ada claimed this issue. RepoOps assigned it and marked it as in progress."
    }
  );
});

test("recognizes an issue already owned by the same contributor", () => {
  const result = decideClaim({
    body: "/claim",
    actor: "ada",
    assignees: [{ login: "ada" }]
  });

  assert.equal(result.type, "already-owned");
  assert.match(result.message, /already have this issue assigned/);
});

test("does not steal an issue from another contributor", () => {
  const result = decideClaim({
    body: "/claim",
    actor: "ada",
    assignees: [{ login: "grace" }]
  });

  assert.equal(result.type, "unavailable");
  assert.deepEqual(result.assignees, ["grace"]);
  assert.match(result.message, /@grace/);
});
