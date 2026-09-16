import { readFile } from "node:fs/promises";

import { decideClaim } from "./core/claim.mjs";
import { routeCommand } from "./core/commands.mjs";
import { loadRepoOpsConfig } from "./core/config.mjs";
import { decideClosedIssueCleanup } from "./core/lifecycle.mjs";
import { decideUnclaim } from "./core/unclaim.mjs";
import { GitHubClient } from "./github/client.mjs";

async function readEvent() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) throw new Error("GITHUB_EVENT_PATH is required");
  return JSON.parse(await readFile(eventPath, "utf8"));
}

function eventNameFor(event) {
  if (process.env.GITHUB_EVENT_NAME) return process.env.GITHUB_EVENT_NAME;
  if (event.comment) return "issue_comment";
  if (event.issue && event.action) return "issues";
  return "unknown";
}

async function handleIssueComment(event, client, config) {
  const issueNumber = event.issue?.number;
  if (!issueNumber) return console.log("RepoOps: no issue found in comment event.");

  const routed = routeCommand(event.comment?.body ?? "", config);
  if (routed.type === "ignore") {
    console.log(`RepoOps: ignored comment (${routed.reason}).`);
    return;
  }

  const common = {
    actor: event.comment?.user?.login ?? event.sender?.login ?? "",
    assignees: event.issue?.assignees ?? [],
    isPullRequest: Boolean(event.issue?.pull_request),
    label: config.labels.inProgress
  };

  if (routed.command.name === "/claim") {
    const decision = decideClaim({ body: event.comment?.body ?? "", ...common });

    if (decision.type === "ignore") return console.log(`RepoOps: ignored claim (${decision.reason}).`);
    if (decision.type === "already-owned" || decision.type === "unavailable") {
      await client.addComment(issueNumber, decision.message);
      return console.log(`RepoOps: ${decision.type}.`);
    }

    await client.ensureLabel(decision.label, "1d76db", "Issue currently claimed by a contributor");
    await client.assignIssue(issueNumber, decision.actor);
    await client.addLabels(issueNumber, [decision.label]);
    await client.addComment(issueNumber, decision.message);
    return console.log(`RepoOps: assigned #${issueNumber} to @${decision.actor}.`);
  }

  const decision = decideUnclaim(common);
  if (decision.type === "ignore") return console.log(`RepoOps: ignored unclaim (${decision.reason}).`);
  if (decision.type === "not-owned" || decision.type === "forbidden") {
    await client.addComment(issueNumber, decision.message);
    return console.log(`RepoOps: ${decision.type}.`);
  }

  await client.removeAssignees(issueNumber, [decision.actor]);
  await client.removeLabel(issueNumber, decision.label);
  await client.addComment(issueNumber, decision.message);
  console.log(`RepoOps: released #${issueNumber} from @${decision.actor}.`);
}

async function handleIssueLifecycle(event, client, config) {
  if (event.action !== "closed" || !event.issue?.number) {
    console.log("RepoOps: lifecycle event requires no action.");
    return;
  }

  const cleanup = decideClosedIssueCleanup({
    assignees: event.issue.assignees ?? [],
    labels: event.issue.labels ?? [],
    inProgressLabel: config.labels.inProgress
  });

  if (cleanup.assignees.length) {
    await client.removeAssignees(event.issue.number, cleanup.assignees);
  }
  if (cleanup.removeInProgressLabel) {
    await client.removeLabel(event.issue.number, cleanup.inProgressLabel);
  }

  console.log(`RepoOps: cleaned lifecycle state for closed issue #${event.issue.number}.`);
}

export async function runRepoOps(event, { token, repository } = {}) {
  const config = await loadRepoOpsConfig();
  const eventName = eventNameFor(event);

  if (!event.issue?.number) {
    console.log("RepoOps: no issue found in event; nothing to do.");
    return;
  }

  const client = new GitHubClient({
    token: token ?? process.env.GITHUB_TOKEN,
    repository: repository ?? process.env.GITHUB_REPOSITORY
  });

  if (eventName === "issue_comment") return handleIssueComment(event, client, config);
  if (eventName === "issues") return handleIssueLifecycle(event, client, config);

  console.log(`RepoOps: unsupported event ${eventName}; nothing to do.`);
}

async function main() {
  await runRepoOps(await readEvent());
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error) => {
    console.error(`RepoOps failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
