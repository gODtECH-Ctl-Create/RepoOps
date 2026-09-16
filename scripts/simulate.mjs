import { readFile } from "node:fs/promises";

import { decideClaim } from "../src/core/claim.mjs";
import { routeCommand } from "../src/core/commands.mjs";
import { loadRepoOpsConfig } from "../src/core/config.mjs";
import { decideClosedIssueCleanup } from "../src/core/lifecycle.mjs";
import { decideUnclaim } from "../src/core/unclaim.mjs";

const fixturePath = process.argv[2];
if (!fixturePath) {
  console.error("Usage: npm run simulate -- <event-fixture.json>");
  process.exit(1);
}

const event = JSON.parse(await readFile(fixturePath, "utf8"));
const config = await loadRepoOpsConfig();

if (event.comment) {
  const routed = routeCommand(event.comment.body ?? "", config);
  if (routed.type !== "command") {
    console.log(JSON.stringify(routed, null, 2));
    process.exit(0);
  }

  const common = {
    actor: event.comment.user?.login ?? event.sender?.login ?? "",
    assignees: event.issue?.assignees ?? [],
    isPullRequest: Boolean(event.issue?.pull_request),
    label: config.labels.inProgress
  };

  const decision = routed.command.name === "/claim"
    ? decideClaim({ body: event.comment.body ?? "", ...common })
    : decideUnclaim(common);

  console.log(JSON.stringify(decision, null, 2));
  process.exit(0);
}

if (event.action === "closed" && event.issue) {
  console.log(JSON.stringify(decideClosedIssueCleanup({
    assignees: event.issue.assignees ?? [],
    labels: event.issue.labels ?? [],
    inProgressLabel: config.labels.inProgress
  }), null, 2));
  process.exit(0);
}

console.log(JSON.stringify({ type: "ignore", reason: "unsupported-fixture" }, null, 2));
