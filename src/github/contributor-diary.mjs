import { collectContributionProjection } from "./contribution-history.mjs";
import { buildContributorDiary, contributorDiaryMarker } from "../core/contributor-diary.mjs";

export async function collectActiveContributorWork(client, config) {
  const issues = await client.paginate(
    "/repos/" + client.repository + "/issues?state=open&labels=" + encodeURIComponent(config.labels.inProgress) + "&sort=updated&direction=desc"
  );

  return issues
    .filter((issue) => issue && !issue.pull_request && issue.state === "open")
    .map((issue) => ({
      number: issue.number,
      title: issue.title,
      contributors: (Array.isArray(issue.assignees) ? issue.assignees : [])
        .map((assignee) => assignee?.login)
        .filter((login) => typeof login === "string" && login)
    }))
    .filter((issue) => issue.contributors.length > 0)
    .sort((a, b) => a.number - b.number);
}

export async function collectContributorDiarySnapshot(client, config) {
  const [active, history] = await Promise.all([
    collectActiveContributorWork(client, config),
    collectContributionProjection(client)
  ]);

  const recent = history.projection.completed.slice(-12).reverse();
  const completed = await Promise.all(recent.map(async (record) => {
    const contributor = history.contributorLogins.get(record.contributorId);
    if (!contributor) return null;
    const issue = await client.getIssue(record.issue.number);
    return {
      issueNumber: record.issue.number,
      issueTitle: issue.title,
      pullRequestNumber: record.pullRequest.number,
      contributor,
      completedAt: record.completedAt
    };
  }));

  return { active, completed: completed.filter(Boolean) };
}

export async function refreshContributorDiary({ client, config, snapshotProvider = collectContributorDiarySnapshot } = {}) {
  if (!config?.contributorDiary?.enabled) return { type: "skip", reason: "disabled" };

  const issueNumber = config.contributorDiary.issueNumber;
  if (!Number.isSafeInteger(issueNumber) || issueNumber < 1) throw new Error("Contributor diary issue number is not configured");

  const issue = await client.getIssue(issueNumber);
  if (issue.pull_request) throw new Error("Contributor diary target must be a normal Issue");
  if (typeof issue.body !== "string" || !issue.body.includes(contributorDiaryMarker())) {
    throw new Error("Contributor diary target is missing the RepoOps diary marker");
  }
  if (issue.state !== "open") return { type: "skip", reason: "diary-issue-closed", issueNumber };

  const snapshot = await snapshotProvider(client, config);
  const body = buildContributorDiary({
    repository: client.repository,
    active: snapshot.active,
    completed: snapshot.completed
  });

  if (issue.body === body) return { type: "unchanged", issueNumber };
  await client.updateIssue(issueNumber, { body });
  return { type: "updated", issueNumber };
}
