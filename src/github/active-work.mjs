import { managedAssignment, staleCandidate } from "../core/stale-assignment.mjs";

export async function listManagedActiveAssignments(client, login, config) {
  if (typeof login !== "string" || !login) throw new Error("Invalid contributor login");
  const issues = await client.paginate(
    `/repos/${client.repository}/issues?state=open&assignee=${encodeURIComponent(login)}&labels=${encodeURIComponent(config.labels.inProgress)}`
  );

  const active = [];
  const seen = new Set();
  for (const summary of issues) {
    if (!Number.isSafeInteger(summary?.number) || summary.number < 1) throw new Error("Malformed active-work issue");
    if (summary.pull_request || seen.has(summary.number)) continue;
    seen.add(summary.number);

    const issue = await client.getIssue(summary.number);
    const excluded = staleCandidate(issue, config);
    if (excluded) continue;

    const timeline = await client.paginate(`/repos/${client.repository}/issues/${summary.number}/timeline`);
    const assignment = managedAssignment(issue, timeline, client.botId);
    if (assignment?.login === login) active.push(summary.number);
  }

  return active.sort((a, b) => a - b);
}
