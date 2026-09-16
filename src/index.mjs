import { readFile } from "node:fs/promises";

import { decideActiveWorkLimit, isMaintainerAssociation } from "./core/active-work.mjs";
import { decideClaim } from "./core/claim.mjs";
import { routeCommand } from "./core/commands.mjs";
import { loadRepoOpsConfig } from "./core/config.mjs";
import { buildClaimConfirmation, buildCommentGuidance, commentGuidanceMarker } from "./core/contributor-guidance.mjs";
import { isAvailable, workflowTransition } from "./core/workflow-state.mjs";
import { decideUnclaim } from "./core/unclaim.mjs";
import { executeOperation, operationKey } from "./core/idempotency.mjs";
import { listManagedActiveAssignments } from "./github/active-work.mjs";
import { commentOperationStore, issueMutationSteps } from "./github/operations.mjs";
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

function labelNames(labels = []) {
  return labels.map((label) => typeof label === "string" ? label : label.name).filter(Boolean);
}

export async function handleIssueComment(event, client, config) {
  if (event.action !== "created" || event.issue?.pull_request) return;
  if (event.comment?.user?.type && event.comment.user.type !== "User") return;

  const actor = event.comment?.user?.login;
  const actorId = event.comment?.user?.id;
  if (!actor || !Number.isSafeInteger(actorId)) throw new Error("Malformed comment actor");
  const issueNumber = event.issue.number;
  const routed = routeCommand(event.comment?.body ?? "", config);

  if (routed.type === "ignore") {
    if (routed.reason !== "not-command") return;
    const issue = await client.getIssue(issueNumber);
    if (issue.id !== event.issue.id || issue.pull_request || issue.state !== "open") return;
    const names = labelNames(issue.labels);
    const explicitlyReady = names.includes(config.labels.ready);
    if (issue.assignees.length || !explicitlyReady || !isAvailable(issue.labels)) return;

    const message = buildCommentGuidance({ guidance: config.contributorGuidance });
    if (!message) return;
    const marker = commentGuidanceMarker(actorId);
    const existing = await client.listComments(issueNumber);
    if (existing.some((comment) => client.isOwnComment(comment) && comment.body.includes(marker))) return;
    await client.addComment(issueNumber, `${message}\n\n${marker}`);
    return;
  }

  const key = operationKey({ repositoryId: event.repository?.id, issueId: event.issue?.id, event: "issue_comment", action: "created", sourceId: event.comment?.id });
  return executeOperation({
    key, store: commentOperationStore(client, issueNumber),
    prepare: async () => {
      const issue = await client.getIssue(issueNumber);
      if (issue.id !== event.issue.id || issue.pull_request) throw new Error("Issue identity mismatch");
      if (issue.state !== "open") return { state: issue.state, message: "RepoOps: commands require an open issue.", mutations: [] };
      if (routed.command.name === "/claim" && !issue.assignees.some((a) => a.login === actor) && !isAvailable(issue.labels)) return { state: issue.state, message: "RepoOps: this issue is blocked or awaiting design/review and is not available to claim.", mutations: [] };

      if (routed.command.name === "/claim" && !issue.assignees.some((a) => a.login === actor)) {
        const policy = config.contributorLimits;
        const association = event.comment?.author_association ?? "NONE";
        const maintainerExempt = !policy.limitMaintainers && isMaintainerAssociation(association);
        if (policy.maxActiveAssignments > 0 && !maintainerExempt) {
          const activeIssueNumbers = await listManagedActiveAssignments(client, actor, config);
          const limit = decideActiveWorkLimit({ policy, authorAssociation: association, activeIssueNumbers });
          if (!limit.allowed) {
            return {
              state: issue.state,
              message: limit.message,
              expectedAssignees: issue.assignees.map((a) => a.login),
              mutations: []
            };
          }
        }
      }

      const common = { actor, assignees: issue.assignees, label: config.labels.inProgress };
      const decision = routed.command.name === "/claim"
        ? decideClaim({ body: "/claim", ...common }) : decideUnclaim(common);
      const mutations = [];
      let expectedAssignees = issue.assignees.map((a) => a.login);
      if (decision.type === "claim" || decision.type === "already-owned") {
        if (decision.type === "claim") mutations.push({ type: "assign", login: actor });
        expectedAssignees = [...new Set([...expectedAssignees, actor])];
      }
      if (decision.type === "unclaim") {
        mutations.push({ type: "unassign", login: actor });
        expectedAssignees = expectedAssignees.filter((a) => a !== actor);
      }
      if (["claim", "already-owned", "unclaim", "not-owned"].includes(decision.type)) {
        mutations.push(...workflowTransition({ state: issue.state, assignees: expectedAssignees, labels: issue.labels, action: routed.command.name.slice(1), policy: config.labels }));
      }
      let message = decision.type === "unclaim" && (expectedAssignees.length || !isAvailable(issue.labels))
        ? `✅ @${actor} released their assignment. This issue is not available for a new claim.` : decision.message;
      if (decision.type === "claim") {
        message = buildClaimConfirmation({
          actor,
          issueNumber,
          baseMessage: message,
          guidance: config.contributorGuidance
        });
      }
      return { state: issue.state, message, expectedAssignees, mutations };
    },
    steps: (plan) => issueMutationSteps(client, issueNumber, plan)
  });
}

export async function handleIssueLifecycle(event, client, config) {
  if (event.action !== "closed" || !event.issue?.number || event.issue.pull_request) return;
  const issue = await client.getIssue(event.issue.number);
  if (issue.state !== "closed") return;
  if (issue.assignees.length) await client.removeAssignees(event.issue.number, issue.assignees.map((a) => a.login));
  for (const label of [config.labels.ready, config.labels.inProgress]) {
    const current = await client.getIssue(event.issue.number);
    if (current.state !== "closed") return;
    if (current.labels.some((l) => (typeof l === "string" ? l : l.name) === label)) await client.removeLabel(event.issue.number, label);
  }
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
