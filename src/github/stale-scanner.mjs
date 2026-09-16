import { executeOperation } from "../core/idempotency.mjs";
import { decideStaleAssignment, managedAssignment, staleCandidate, utcMillis } from "../core/stale-assignment.mjs";
import { commentOperationStore } from "./operations.mjs";
import { findLinkedPullRequests } from "./linked-pull-requests.mjs";

export async function collectStaleAssignment(client, issueNumber, config) {
  const issue = await client.getIssue(issueNumber);
  const excluded = staleCandidate(issue, config);
  if (excluded) return { issue, assignment: null, linked: { open: [], merged: [] } };
  const timeline = await client.paginate(`/repos/${client.repository}/issues/${issueNumber}/timeline`);
  const assignment = managedAssignment(issue, timeline, client.botId);
  const linked = assignment ? await findLinkedPullRequests(client, issueNumber) : { open: [], merged: [] };
  return { issue, assignment, linked };
}

export async function scanIssue({ client, repositoryId, issueNumber, config, now, dryRun = true }) {
  const collected = await collectStaleAssignment(client, issueNumber, config);
  let decision = decideStaleAssignment({ ...collected, repositoryId, config, now });
  if (decision.type !== "remind") return { issueNumber, ...decision };
  const store = commentOperationStore(client, issueNumber);
  const receipt = await store.find(decision.key);
  if (receipt?.state === "complete") return { issueNumber, type: "skip", reason: "already-reminded", key: decision.key };
  if (dryRun) return { issueNumber, ...decision, dryRun: true };
  // Recollect before writing, including ownership epoch and implementation links.
  const fresh = await collectStaleAssignment(client, issueNumber, config);
  const verified = decideStaleAssignment({ ...fresh, repositoryId, config, now });
  if (verified.type !== "remind" || verified.key !== decision.key) return { issueNumber, type: "skip", reason: "state-changed-before-reminder" };
  decision = verified;
  const result = await executeOperation({
    key: decision.key, store,
    prepare: async () => ({ message: decision.message, assignmentEventId: decision.assignmentEventId, window: decision.window, reminderAfterDays: config.assignments.reminderAfterDays, evaluatedAt: now }),
    steps: () => []
  });
  return { issueNumber, type: result.type === "duplicate" ? "skip" : "reminded", reason: result.type === "duplicate" ? "already-reminded" : "stale", key: decision.key };
}

export async function scanRepository({ client, config, now, dryRun = true, issueNumber }) {
  utcMillis(now);
  const repository = await client.request(`/repos/${client.repository}`);
  if (!Number.isSafeInteger(repository?.id) || repository.id < 1) throw new Error("Malformed repository identity");
  if (issueNumber !== undefined && (!Number.isSafeInteger(issueNumber) || issueNumber < 1)) throw new Error("Invalid issue number");
  const issues = issueNumber !== undefined ? [{ number: issueNumber }] : await client.paginate(`/repos/${client.repository}/issues?state=open&labels=${encodeURIComponent(config.labels.inProgress)}`);
  const results = [];
  const seen = new Set();
  for (const issue of issues) {
    if (!Number.isSafeInteger(issue?.number) || issue.number < 1) throw new Error("Malformed scanned issue");
    if (issue.pull_request || seen.has(issue.number)) continue;
    seen.add(issue.number);
    results.push(await scanIssue({ client, repositoryId: repository.id, issueNumber: issue.number, config, now, dryRun }));
  }
  return results;
}
