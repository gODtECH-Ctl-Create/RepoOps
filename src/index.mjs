import { readFile } from "node:fs/promises";

import { decideClaim } from "./core/claim.mjs";
import { GitHubClient } from "./github/client.mjs";

async function readEvent() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) throw new Error("GITHUB_EVENT_PATH is required");

  return JSON.parse(await readFile(eventPath, "utf8"));
}

async function main() {
  const event = await readEvent();
  const issueNumber = event.issue?.number;

  if (!issueNumber) {
    console.log("RepoOps: no issue found in event; nothing to do.");
    return;
  }

  const decision = decideClaim({
    body: event.comment?.body ?? "",
    actor: event.comment?.user?.login ?? event.sender?.login ?? "",
    assignees: event.issue?.assignees ?? [],
    isPullRequest: Boolean(event.issue?.pull_request)
  });

  if (decision.type === "ignore") {
    console.log(`RepoOps: ignored event (${decision.reason}).`);
    return;
  }

  const client = new GitHubClient({
    token: process.env.GITHUB_TOKEN,
    repository: process.env.GITHUB_REPOSITORY
  });

  if (decision.type === "already-owned" || decision.type === "unavailable") {
    await client.addComment(issueNumber, decision.message);
    console.log(`RepoOps: ${decision.type}.`);
    return;
  }

  await client.ensureLabel(
    decision.label,
    "1d76db",
    "Issue currently claimed by a contributor"
  );
  await client.assignIssue(issueNumber, decision.actor);
  await client.addLabels(issueNumber, [decision.label]);
  await client.addComment(issueNumber, decision.message);

  console.log(`RepoOps: assigned #${issueNumber} to @${decision.actor}.`);
}

main().catch((error) => {
  console.error(`RepoOps failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
