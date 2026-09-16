export const REPOSITORY = "gODtECH-Ctl-Create/RepoOps";

export const LINKS = Object.freeze({
  repository: `https://github.com/${REPOSITORY}`,
  readyIssues: `https://github.com/${REPOSITORY}/issues?q=is%3Aissue+is%3Aopen+label%3A%22status%3A+ready%22+no%3Aassignee`,
  goodFirstIssues: `https://github.com/${REPOSITORY}/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22+label%3A%22status%3A+ready%22+no%3Aassignee`,
  problemProposal: `https://github.com/${REPOSITORY}/issues/new?template=problem.yml`,
  upgradeProposal: `https://github.com/${REPOSITORY}/issues/new?template=feature.yml`,
  contributing: `https://github.com/${REPOSITORY}/blob/MASTER/CONTRIBUTING.md`,
  roadmap: `https://github.com/${REPOSITORY}/blob/MASTER/docs/roadmap.md`,
  architecture: `https://github.com/${REPOSITORY}/blob/MASTER/docs/architecture.md`,
  security: `https://github.com/${REPOSITORY}/blob/MASTER/SECURITY.md`,
  changelog: `https://github.com/${REPOSITORY}/blob/MASTER/CHANGELOG.md`
});

export const GOOD_FIRST_ISSUES_API =
  `https://api.github.com/search/issues?q=${encodeURIComponent(
    `repo:${REPOSITORY} is:issue is:open label:"good first issue" label:"status: ready" no:assignee`
  )}&per_page=12&sort=updated&order=desc`;

export const CONTRIBUTORS_API =
  `https://api.github.com/repos/${REPOSITORY}/contributors?per_page=100&anon=0`;

function labelNames(issue) {
  return Array.isArray(issue?.labels)
    ? issue.labels.map((label) => (typeof label === "string" ? label : label?.name)).filter(Boolean)
    : [];
}

export function hasLabel(issue, name) {
  return labelNames(issue).includes(name);
}

export function isAvailableGoodFirstIssue(issue) {
  if (!issue || issue.pull_request || issue.state !== "open") return false;

  const assignees = Array.isArray(issue.assignees) ? issue.assignees : [];
  if (issue.assignee || assignees.length > 0) return false;

  return (
    hasLabel(issue, "good first issue") &&
    hasLabel(issue, "status: ready") &&
    !hasLabel(issue, "status: blocked") &&
    !hasLabel(issue, "status: in-progress")
  );
}

export function selectAvailableGoodFirstIssues(items, limit = 6) {
  if (!Array.isArray(items)) return [];

  return items
    .filter(isAvailableGoodFirstIssue)
    .sort((left, right) => {
      const timeDifference = Date.parse(right.updated_at ?? "") - Date.parse(left.updated_at ?? "");
      if (Number.isFinite(timeDifference) && timeDifference !== 0) return timeDifference;
      return (left.number ?? 0) - (right.number ?? 0);
    })
    .slice(0, Math.max(0, limit));
}

export function getIssueMetadata(issue) {
  const labels = labelNames(issue);
  const find = (prefix) => labels.find((label) => label.startsWith(prefix)) ?? null;

  return {
    difficulty: find("difficulty: "),
    area: find("area: "),
    priority: find("priority: ")
  };
}

export function normalizeContributors(items, limit = 12) {
  if (!Array.isArray(items)) return [];

  return items
    .filter(
      (contributor) =>
        contributor &&
        contributor.type !== "Bot" &&
        typeof contributor.login === "string" &&
        typeof contributor.html_url === "string" &&
        typeof contributor.avatar_url === "string"
    )
    .sort((left, right) => left.login.localeCompare(right.login, "en", { sensitivity: "base" }))
    .slice(0, Math.max(0, limit))
    .map((contributor) => ({
      login: contributor.login,
      profileUrl: contributor.html_url,
      avatarUrl: contributor.avatar_url,
      contributions: Number.isFinite(contributor.contributions) ? contributor.contributions : null
    }));
}
