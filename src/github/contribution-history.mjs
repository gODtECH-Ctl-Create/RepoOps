import { projectCompletedContributions } from "../core/contributions.mjs";
import { createOperationalEvent } from "../core/events.mjs";
import { findLinkedPullRequests } from "./linked-pull-requests.mjs";

function actorKind(actor) {
  if (actor?.type === "Bot") return "bot";
  if (actor?.type === "User") return "user";
  return null;
}

function timestamp(value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error("Malformed GitHub timeline timestamp");
  return new Date(value).toISOString();
}

function rememberContributor(logins, id, login) {
  if (!Number.isSafeInteger(id) || id < 1 || typeof login !== "string" || !login) throw new Error("Malformed GitHub assignee identity");
  if (logins.has(id) && logins.get(id) !== login) throw new Error("Contributor identity changed during history collection");
  logins.set(id, login);
}

function assignmentEventsFromTimeline({ repository, issue, timeline, contributorLogins }) {
  if (!Array.isArray(timeline)) throw new Error("Malformed GitHub issue timeline");
  const events = [];
  let hasRepoOpsAssignment = false;

  for (const entry of timeline) {
    if (!entry || !["assigned", "unassigned"].includes(entry.event)) continue;
    const kind = actorKind(entry.actor);
    if (!Number.isSafeInteger(entry.id) || entry.id < 1 || !kind || !Number.isSafeInteger(entry.actor.id) || entry.actor.id < 1 || !Number.isSafeInteger(entry.assignee?.id) || entry.assignee.id < 1 || typeof entry.assignee.login !== "string") {
      throw new Error("Malformed GitHub assignment timeline event");
    }
    rememberContributor(contributorLogins, entry.assignee.id, entry.assignee.login);
    if (entry.event === "assigned" && entry.actor.id === repository.botId && entry.actor.type === "Bot") hasRepoOpsAssignment = true;

    events.push(createOperationalEvent({
      schemaVersion: 1,
      type: entry.event === "assigned" ? "github.issue.assigned" : "github.issue.unassigned",
      timestamp: timestamp(entry.created_at),
      repository: { id: repository.id, fullName: repository.fullName },
      actor: { kind, id: entry.actor.id },
      resource: { type: "issue", id: issue.id, number: issue.number },
      source: { kind: "github", eventName: "issues", action: entry.event, eventId: entry.id },
      metadata: { assigneeId: entry.assignee.id }
    }));
  }

  return { events, hasRepoOpsAssignment };
}

async function mergeEventForPullRequest(client, repository, pullRequestNumber) {
  const pr = await client.request(`/repos/${client.repository}/pulls/${pullRequestNumber}`);
  if (!pr || !Number.isSafeInteger(pr.id) || pr.id < 1 || pr.number !== pullRequestNumber || pr.merged !== true || typeof pr.merged_at !== "string" || !Number.isFinite(Date.parse(pr.merged_at))) return null;

  const timeline = await client.paginate(`/repos/${client.repository}/issues/${pullRequestNumber}/timeline`);
  const merged = timeline.filter((entry) => entry?.event === "merged");
  if (merged.length !== 1) return null;
  const entry = merged[0];
  const kind = actorKind(entry.actor);
  if (!Number.isSafeInteger(entry.id) || entry.id < 1 || !kind || !Number.isSafeInteger(entry.actor.id) || entry.actor.id < 1) return null;

  return createOperationalEvent({
    schemaVersion: 1,
    type: "github.pull_request.merged",
    timestamp: timestamp(pr.merged_at),
    repository: { id: repository.id, fullName: repository.fullName },
    actor: { kind, id: entry.actor.id },
    resource: { type: "pull_request", id: pr.id, number: pr.number },
    source: { kind: "github", eventName: "pull_request", action: "closed", eventId: entry.id },
    metadata: {}
  });
}

/**
 * Reconstruct the RepoOps-managed completion projection from GitHub's current
 * authoritative issue timelines and closing relationships. This remains a
 * read-time bridge until structured audit persistence (#20) exists.
 */
export async function collectContributionProjection(client) {
  const repositoryResponse = await client.request(`/repos/${client.repository}`);
  if (!Number.isSafeInteger(repositoryResponse?.id) || repositoryResponse.id < 1 || typeof repositoryResponse.full_name !== "string") throw new Error("Malformed GitHub repository identity");
  const repository = { id: repositoryResponse.id, fullName: repositoryResponse.full_name, botId: client.botId };

  const closedItems = await client.paginate(`/repos/${client.repository}/issues?state=closed&sort=updated&direction=desc`);
  const events = [];
  const linkedIssues = [];
  const contributorLogins = new Map();
  const mergeEventKeys = new Set();

  for (const summary of closedItems) {
    if (!summary || summary.pull_request) continue;
    if (!Number.isSafeInteger(summary.number) || summary.number < 1) throw new Error("Malformed closed issue history item");
    const issue = await client.getIssue(summary.number);
    if (!Number.isSafeInteger(issue.id) || issue.id < 1) throw new Error("Malformed closed issue identity");

    const timeline = await client.paginate(`/repos/${client.repository}/issues/${issue.number}/timeline`);
    const assignments = assignmentEventsFromTimeline({ repository, issue, timeline, contributorLogins });
    if (!assignments.hasRepoOpsAssignment) continue;

    const linked = await findLinkedPullRequests(client, issue.number);
    if (!linked.merged.length) continue;
    events.push(...assignments.events);
    linkedIssues.push({
      relationship: linked.relationship,
      repository: { id: repository.id, fullName: repository.fullName },
      issue: { id: issue.id, number: issue.number },
      pullRequests: linked.pullRequests
    });

    for (const pr of linked.merged) {
      if (pr.repository !== client.repository) continue;
      const key = `${pr.repository}#${pr.number}`;
      if (mergeEventKeys.has(key)) continue;
      mergeEventKeys.add(key);
      const event = await mergeEventForPullRequest(client, repository, pr.number);
      if (event) events.push(event);
    }
  }

  return {
    projection: projectCompletedContributions(events, linkedIssues),
    contributorLogins,
    repository: { id: repository.id, fullName: repository.fullName }
  };
}
