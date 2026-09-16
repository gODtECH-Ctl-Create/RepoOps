import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { parseCommand, routeCommand } from "../src/core/commands.mjs";
import { parseRepoOpsConfig } from "../src/core/config.mjs";
import { decideClosedIssueCleanup } from "../src/core/lifecycle.mjs";
import { decideUnclaim } from "../src/core/unclaim.mjs";

test("parses slash commands and arguments", () => {
  assert.deepEqual(parseCommand("  /UNCLAIM now  "), {
    name: "/unclaim",
    args: ["now"]
  });
  assert.equal(parseCommand("hello"), null);
});

test("routes supported commands and respects config", () => {
  const config = {
    commands: { claim: true, unclaim: false },
    labels: { inProgress: "status: in-progress" }
  };

  assert.equal(routeCommand("/claim", config).type, "command");
  assert.deepEqual(routeCommand("/unclaim", config), {
    type: "ignore",
    reason: "command-disabled",
    command: "/unclaim"
  });
  assert.equal(routeCommand("/wat", config).reason, "unknown-command");
});

test("parses valid RepoOps configuration", () => {
  assert.deepEqual(
    parseRepoOpsConfig(`commands:\n  claim: true\n  unclaim: false\nlabels:\n  inProgress: "work: active"\n`),
    {
      commands: { claim: true, unclaim: false },
      labels: { inProgress: "work: active", ready: "status: ready" },
      assignments: { reminderAfterDays: 3, expireAfterDays: 7, autoRelease: false },
      contributorLimits: { maxActiveAssignments: 0, limitMaintainers: false },
      contributorGuidance: {
        enabled: true,
        requirements: "",
        setupCommand: "",
        checkCommand: "",
        contributingUrl: "",
        developmentUrl: "",
        architectureUrl: "",
        problemUrl: "",
        upgradeUrl: "",
        contributorHubUrl: "",
        roadmapUrl: ""
      }
    }
  );
});

test("rejects unknown configuration keys", () => {
  assert.throws(
    () => parseRepoOpsConfig("commands:\n  explode: true\n"),
    /unknown commands key explode/
  );
});

test("allows the current assignee to unclaim", () => {
  assert.deepEqual(
    decideUnclaim({
      actor: "alice",
      assignees: [{ login: "alice" }],
      label: "status: in-progress"
    }),
    {
      type: "unclaim",
      actor: "alice",
      label: "status: in-progress",
      message: "✅ @alice released this issue. RepoOps removed the assignment and marked it available again."
    }
  );
});

test("prevents a different contributor from unclaiming", () => {
  const result = decideUnclaim({
    actor: "alice",
    assignees: [{ login: "bob" }]
  });

  assert.equal(result.type, "forbidden");
  assert.deepEqual(result.assignees, ["bob"]);
});

test("plans cleanup for a closed claimed issue", () => {
  assert.deepEqual(
    decideClosedIssueCleanup({
      assignees: [{ login: "alice" }],
      labels: [{ name: "status: in-progress" }]
    }),
    {
      assignees: ["alice"],
      removeInProgressLabel: true,
      inProgressLabel: "status: in-progress"
    }
  );
});

test("IssueOps has permission to acknowledge merged pull requests", async () => {
  const workflow = await readFile(new URL("../.github/workflows/repoops-claim.yml", import.meta.url), "utf8");
  assert.match(workflow, /pull-requests:\s*write/);
});
