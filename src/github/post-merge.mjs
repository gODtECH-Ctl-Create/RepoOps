import { decideActiveWorkLimit } from "../core/active-work.mjs";
import { priorContributionStatus } from "../core/contributions.mjs";
import { buildPostMergeMessage, postMergeMarker, selectNextWork } from "../core/post-merge.mjs";
import { listManagedActiveAssignments } from "./active-work.mjs";
import { collectContributionProjection } from "./contribution-history.mjs";
import { findLinkedPullRequests } from "./linked-pull-requests.mjs";

async function contributorIsMaintainer(client, login, policy) {
  if (policy.limitMaintainers) return false;
  try {
    const permission = await client.request(`/repos/${client.repository}/collaborators/${encodeURIComponent(login)}/permission`);
    return ["admin", "maintain", "write"].includes(permission?.permission);
  } catch (error) {
    if ([403, 404].includes(error?.status)) return false;
    throw error;
  }
}

export async function suggestionsForContributor(client, config, contributor, completedIssueNumber) {
  const policy = config.contributorLimits;
  if (policy.maxActiveAssignments > 0 && !(await contributorIsMaintainer(client, contributor, policy))) {
    const activeIssueNumbers = await listManagedActiveAssignments(client, contributor, config);
    const limit = decideActiveWorkLimit({ policy, activeIssueNumbers });
    if (!limit.allowed) return [];
  }

  const candidates = await client.paginate(
    `/repos/${client.repository}/issues?state=open&labels=${encodeURIComponent(config.labels.ready)}&sort=updated&direction=desc`
  );
  return selectNextWork(candidates, {
    readyLabel: config.labels.ready,
    inProgressLabel: config.labels.inProgress,
    completedIssueNumber,
    limit: 3
  });
}

function chooseMergedPullRequest(linked, preferredNumber, repository) {
  const candidates = linked.merged.filter((pr) => pr.repository === repository);
  if (preferredNumber !== undefined) return candidates.find((pr) => pr.number === preferredNumber) ?? null;
  return candidates.sort((a, b) => b.mergedAt.localeCompare(a.mergedAt) || b.number - a.number)[0] ?? null;
}

async function fallbackPullRequestAuthor(client, pullRequestNumber) {
  const pr = await client.request(`/repos/${client.repository}/pulls/${pullRequestNumber}`);
  if (!pr || pr.number !== pullRequestNumber || pr.merged !== true || typeof pr.user?.login !== "string" || !pr.user.login || !Number.isSafeInteger(pr.user?.id) || pr.user.id < 1) throw new Error("Malformed merged pull request author");
  return { login: pr.user.login, id: pr.user.id };
}

export async function postMergeFollowUpForIssue({ client, config, issueNumber, pullRequestNumber }) {
  if (!Number.isSafeInteger(issueNumber) || issueNumber < 1 || (pullRequestNumber !== undefined && (!Number.isSafeInteger(pullRequestNumber) || pullRequestNumber < 1))) throw new Error("Invalid post-merge target");
  const issue = await client.getIssue(issueNumber);
  if (issue.pull_request || issue.state !== "closed") return { type: "skip", reason: "issue-not-complete" };

  const linked = await findLinkedPullRequests(client, issueNumber);
  const merged = chooseMergedPullRequest(linked, pullRequestNumber, client.repository);
  if (!merged) return { type: "skip", reason: "no-authoritative-merged-pr" };

  const marker = postMergeMarker(issue.id, merged.number);
  const comments = await client.listComments(issueNumber);
  if (comments.some((comment) => client.isOwnComment(comment) && comment.body.includes(marker))) {
    return { type: "skip", reason: "already-followed-up", issueNumber, pullRequestNumber: merged.number };
  }

  const history = await collectContributionProjection(client);
  const current = history.projection.completed.find((record) =>
    record.issue.id === issue.id && record.issue.number === issue.number && record.pullRequest.repository === client.repository && record.pullRequest.number === merged.number
  );

  let contributor;
  let contributionStatus = "unknown";
  if (current) {
    contributor = history.contributorLogins.get(current.contributorId);
    if (!contributor) throw new Error("Completed contribution is missing a contributor login");
    contributionStatus = priorContributionStatus(history.projection, current.contributorId, current.completedAt);
  } else {
    contributor = (await fallbackPullRequestAuthor(client, merged.number)).login;
  }

  const suggestions = await suggestionsForContributor(client, config, contributor, issue.number);
  const message = buildPostMergeMessage({
    contributor,
    issueNumber: issue.number,
    pullRequestNumber: merged.number,
    contributionStatus,
    suggestions,
    guidance: config.contributorGuidance
  });
  await client.addComment(issue.number, `${message}\n\n${marker}`);

  return { type: "followed-up", issueNumber: issue.number, pullRequestNumber: merged.number, contributor, contributionStatus, suggestions };
}
