import { createHash } from "node:crypto";
import { appendOperationalEvent } from "./events.mjs";

const assignmentTypes = new Map([
  ["issue.claimed", "assign"],
  ["github.issue.assigned", "assign"],
  ["issue.unclaimed", "unassign"],
  ["github.issue.unassigned", "unassign"]
]);

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function positiveId(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function normalizeTime(value, field) {
  requireValue(typeof value === "string" && Number.isFinite(Date.parse(value)), `Invalid ${field}`);
  return new Date(value).toISOString();
}

function recordId(repositoryId, issueId, pullRequestRepository, pullRequestNumber) {
  const identity = `${repositoryId}:${issueId}:${pullRequestRepository}:${pullRequestNumber}`;
  return `roc1_${createHash("sha256").update(identity).digest("hex")}`;
}

function freeze(value) {
  for (const child of Object.values(value)) if (child && typeof child === "object" && !Object.isFrozen(child)) freeze(child);
  return Object.freeze(value);
}

function validateLinkedIssue(linked) {
  requireValue(linked && typeof linked === "object", "Invalid linked issue snapshot");
  requireValue(linked.relationship === "github-closing-reference", "Unsupported issue/PR relationship");
  requireValue(linked.repository && positiveId(linked.repository.id) && typeof linked.repository.fullName === "string" && linked.repository.fullName.includes("/"), "Invalid linked repository");
  requireValue(linked.issue && positiveId(linked.issue.id) && positiveId(linked.issue.number), "Invalid linked issue identity");
  requireValue(Array.isArray(linked.pullRequests), "Invalid linked pull request collection");
}

function mergedPullRequests(linked) {
  const seen = new Set();
  const result = [];
  for (const pr of linked.pullRequests) {
    requireValue(pr && typeof pr === "object" && Number.isSafeInteger(pr.number) && pr.number > 0, "Invalid linked pull request");
    requireValue(typeof pr.repository === "string" && pr.repository.includes("/"), "Invalid linked pull request repository");
    requireValue(["open", "closed", "merged"].includes(pr.state), "Invalid linked pull request state");
    if (pr.state !== "merged") continue;
    const mergedAt = normalizeTime(pr.mergedAt, "pull request mergedAt");
    const key = `${pr.repository}#${pr.number}`;
    requireValue(!seen.has(key), "Duplicate linked pull request");
    seen.add(key);
    result.push({ repository: pr.repository, number: pr.number, mergedAt });
  }
  return result.sort((a, b) => a.mergedAt.localeCompare(b.mergedAt) || a.repository.localeCompare(b.repository, "en") || a.number - b.number);
}

function activeAssigneesAt(events, timestamp) {
  const cutoff = Date.parse(timestamp);
  const relevant = events
    .filter((event) => assignmentTypes.has(event.type) && Date.parse(event.timestamp) <= cutoff)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id));
  const active = new Set();
  for (const event of relevant) {
    const assigneeId = event.metadata.assigneeId;
    if (assignmentTypes.get(event.type) === "assign") active.add(assigneeId);
    else active.delete(assigneeId);
  }
  return { active, evidenceEventIds: relevant.map((event) => event.id) };
}

/**
 * Project immutable operational events plus authoritative GitHub closing references
 * into completed contribution records. This is a pure read model, not persistence.
 */
export function projectCompletedContributions(events = [], linkedIssues = []) {
  requireValue(Array.isArray(events), "Operational event history must be an array");
  requireValue(Array.isArray(linkedIssues), "Linked issue snapshots must be an array");

  let validated = Object.freeze([]);
  for (const raw of events) validated = appendOperationalEvent(validated, raw);

  const completed = [];
  const unresolved = [];
  const completedIds = new Set();

  for (const linked of linkedIssues) {
    validateLinkedIssue(linked);
    const issueEvents = validated.filter((event) =>
      event.repository.id === linked.repository.id &&
      event.resource.type === "issue" &&
      event.resource.id === linked.issue.id &&
      event.resource.number === linked.issue.number
    );

    for (const pr of mergedPullRequests(linked)) {
      const id = recordId(linked.repository.id, linked.issue.id, pr.repository, pr.number);
      if (completedIds.has(id)) continue;
      completedIds.add(id);

      const mergeEvents = validated.filter((event) =>
        event.type === "github.pull_request.merged" &&
        event.repository.fullName === pr.repository &&
        event.resource.type === "pull_request" &&
        event.resource.number === pr.number
      );
      const assignment = activeAssigneesAt(issueEvents, pr.mergedAt);

      let reason = null;
      if (mergeEvents.length !== 1) reason = mergeEvents.length ? "ambiguous-merge-event" : "missing-merge-event";
      else if (assignment.active.size !== 1) reason = assignment.active.size ? "ambiguous-assignee" : "missing-assignee";

      const base = {
        id,
        repository: { ...linked.repository },
        issue: { ...linked.issue },
        pullRequest: { repository: pr.repository, number: pr.number },
        completedAt: pr.mergedAt,
        evidenceEventIds: freeze([
          ...assignment.evidenceEventIds,
          ...mergeEvents.map((event) => event.id)
        ])
      };

      if (reason) {
        unresolved.push(freeze({ ...base, reason }));
        continue;
      }

      completed.push(freeze({ ...base, contributorId: [...assignment.active][0] }));
    }
  }

  completed.sort((a, b) => a.completedAt.localeCompare(b.completedAt) || a.id.localeCompare(b.id));
  unresolved.sort((a, b) => a.completedAt.localeCompare(b.completedAt) || a.id.localeCompare(b.id));
  return freeze({ completed, unresolved });
}

/**
 * Return whether a contributor has a prior completed contribution before cutoff.
 * `unknown` is deliberately conservative when an earlier unresolved completion
 * could belong to the contributor.
 */
export function priorContributionStatus(projection, contributorId, before) {
  requireValue(projection && Array.isArray(projection.completed) && Array.isArray(projection.unresolved), "Invalid contribution projection");
  requireValue(positiveId(contributorId), "Invalid contributor id");
  const cutoff = normalizeTime(before, "contribution cutoff");

  if (projection.completed.some((record) => record.contributorId === contributorId && record.completedAt < cutoff)) return "returning";
  if (projection.unresolved.some((record) => record.completedAt < cutoff)) return "unknown";
  return "first";
}
