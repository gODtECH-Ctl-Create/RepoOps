import { operationKey } from "./idempotency.mjs";
export const DAY_MS = 86_400_000;

export function utcMillis(value) {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error("Invalid UTC timestamp");
  const time = Date.parse(value);
  if (new Date(time).toISOString().replace(".000Z", "Z") !== value.replace(".000Z", "Z")) throw new Error("Invalid UTC calendar date");
  return time;
}

export function managedAssignment(issue, timeline, botId) {
  if (!Array.isArray(timeline)) throw new Error("Malformed assignment timeline");
  const assignments = new Map();
  const events = timeline.filter((entry) => {
    if (!entry || typeof entry.event !== "string") throw new Error("Malformed timeline event");
    return ["assigned", "unassigned"].includes(entry.event);
  }).map((e) => {
    if (!Number.isSafeInteger(e.id) || e.id < 1 || typeof e.assignee?.login !== "string" || !Number.isSafeInteger(e.actor?.id)) throw new Error("Malformed assignment event");
    return { ...e, time: utcMillis(e.created_at) };
  }).sort((a, b) => a.time - b.time || a.id - b.id);
  for (const event of events) {
    if (event.event === "assigned") assignments.set(event.assignee.login, event);
    else assignments.delete(event.assignee.login);
  }
  if (issue.assignees.length !== 1) return null;
  const login = issue.assignees[0].login;
  const current = assignments.get(login);
  if (!current) throw new Error("Current assignment is absent from GitHub timeline");
  if (current.actor.id !== botId || current.actor.type !== "Bot") return null;
  return { eventId: current.id, login, assignedAt: current.created_at };
}

export function staleCandidate(issue, config) {
  if (issue.pull_request) return "pull-request";
  if (issue.state !== "open") return "closed";
  const labels = issue.labels.map((l) => typeof l === "string" ? l : l.name);
  if (!labels.includes(config.labels.inProgress)) return "not-in-progress";
  if (labels.includes(config.labels.ready)) throw new Error("Contradictory workflow state requires maintainer correction");
  if (!issue.assignees.length) return "unassigned";
  if (issue.assignees.length !== 1) return "multiple-assignees";
  return null;
}

export function decideStaleAssignment({ repositoryId, issue, assignment, linked, config, now, alreadyReminded = false }) {
  const days = config.assignments.reminderAfterDays;
  if (!Number.isSafeInteger(days) || days < 1 || days > 36500 || !Number.isSafeInteger(config.assignments.expireAfterDays) || config.assignments.expireAfterDays <= days || config.assignments.expireAfterDays > 36500 || typeof config.assignments.autoRelease !== "boolean") throw new Error("Invalid assignment policy");
  const currentTime = utcMillis(now);
  const excluded = staleCandidate(issue, config);
  if (excluded) return { type: "skip", reason: excluded };
  if (!assignment) return { type: "skip", reason: "not-repoops-managed" };
  if (assignment.login !== issue.assignees[0].login) throw new Error("Assignment identity changed");
  const assignedAt = utcMillis(assignment.assignedAt);
  if (assignedAt > currentTime) throw new Error("Assignment timestamp is in the future");
  if (!linked || !Array.isArray(linked.open) || !Array.isArray(linked.merged)) throw new Error("Missing linked-PR evidence");
  if (linked.open.length) return { type: "skip", reason: "linked-open-pr" };
  if (linked.merged.some((pr) => utcMillis(pr.mergedAt) >= assignedAt)) return { type: "skip", reason: "linked-merged-pr" };
  const window = Math.floor((currentTime - assignedAt) / (days * DAY_MS));
  if (window < 1) return { type: "skip", reason: "fresh" };
  const key = operationKey({ repositoryId, issueId: issue.id, event: "assignment_reminder", action: `reminder-${days}-window-${window}`, sourceId: assignment.eventId });
  if (alreadyReminded) return { type: "skip", reason: "already-reminded", key };
  return { type: "remind", key, window, assignmentEventId: assignment.eventId, message: `@${assignment.login}, this assignment has reached its ${days}-day reminder window without a linked active implementation PR. Please share a progress update or use /unclaim if you are no longer working on it. RepoOps has not removed your assignment.` };
}
