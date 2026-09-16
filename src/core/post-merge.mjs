const priorityOrder = new Map([
  ["priority: p0", 0],
  ["priority: p1", 1],
  ["priority: p2", 2],
  ["priority: p3", 3]
]);

function labelsOf(issue) {
  if (!Array.isArray(issue?.labels)) throw new Error("Malformed next-work labels");
  return issue.labels.map((label) => typeof label === "string" ? label : label?.name).filter((name) => typeof name === "string");
}

export function selectNextWork(candidates, { readyLabel, inProgressLabel, completedIssueNumber, limit = 3 } = {}) {
  if (!Array.isArray(candidates) || typeof readyLabel !== "string" || !readyLabel || typeof inProgressLabel !== "string" || !inProgressLabel || !Number.isSafeInteger(completedIssueNumber) || completedIssueNumber < 1 || !Number.isSafeInteger(limit) || limit < 0 || limit > 10) {
    throw new Error("Invalid next-work selection input");
  }

  return candidates
    .filter((issue) => {
      if (!issue || !Number.isSafeInteger(issue.number) || issue.number < 1 || typeof issue.title !== "string" || issue.state !== "open" || issue.pull_request) return false;
      if (issue.number === completedIssueNumber) return false;
      const assignees = Array.isArray(issue.assignees) ? issue.assignees : [];
      if (issue.assignee || assignees.length) return false;
      const labels = labelsOf(issue);
      return labels.includes(readyLabel) && !labels.includes(inProgressLabel) && !labels.includes("status: blocked") && !labels.includes("dependency: blocked");
    })
    .sort((left, right) => {
      const leftPriority = labelsOf(left).find((label) => priorityOrder.has(label));
      const rightPriority = labelsOf(right).find((label) => priorityOrder.has(label));
      const priorityDifference = (priorityOrder.get(leftPriority) ?? 99) - (priorityOrder.get(rightPriority) ?? 99);
      if (priorityDifference !== 0) return priorityDifference;
      return left.number - right.number;
    })
    .slice(0, limit)
    .map((issue) => Object.freeze({ number: issue.number, title: issue.title }));
}

function resourceLinks(guidance = {}) {
  const links = [];
  if (guidance.contributingUrl) links.push(`- [Contributor guide](${guidance.contributingUrl})`);
  if (guidance.developmentUrl) links.push(`- [Development guide](${guidance.developmentUrl})`);
  if (guidance.architectureUrl) links.push(`- [Architecture](${guidance.architectureUrl})`);
  if (guidance.roadmapUrl) links.push(`- [Roadmap](${guidance.roadmapUrl})`);
  if (guidance.contributorHubUrl) links.push(`- [Contributor Hub / ready work](${guidance.contributorHubUrl})`);
  return links;
}

function validateCompletionIdentity({ contributor, issueNumber, contributionStatus }) {
  if (typeof contributor !== "string" || !contributor || !Number.isSafeInteger(issueNumber) || issueNumber < 1 || !["first", "returning", "unknown"].includes(contributionStatus)) {
    throw new Error("Invalid post-merge completion identity");
  }
}

export function buildPostMergeMessage({ contributor, issueNumber, pullRequestNumber, contributionStatus = "unknown", suggestions = [], guidance = {} }) {
  validateCompletionIdentity({ contributor, issueNumber, contributionStatus });
  if (!Number.isSafeInteger(pullRequestNumber) || pullRequestNumber < 1 || !Array.isArray(suggestions)) {
    throw new Error("Invalid post-merge message input");
  }

  const first = contributionStatus === "first";
  const parts = [
    first
      ? `🎉 Welcome to RepoOps, @${contributor} — your first merged contribution is complete!`
      : `✅ Thanks, @${contributor} — your contribution has been merged.`,
    `You completed #${issueNumber} through PR #${pullRequestNumber}.`
  ];

  if (first) {
    parts.push("Welcome to the RepoOps contributor community. You do not need to pick up another issue immediately, but these links are here whenever you are ready.");
  }

  const links = resourceLinks(guidance);
  if (links.length) parts.push(`**Useful contributor resources**\n${links.join("\n")}`);

  if (suggestions.length) {
    const issueLines = suggestions.map((issue) => `- #${issue.number} — ${issue.title}`);
    parts.push(`**Available work you can look at next**\n${issueLines.join("\n")}\n\nIf you want one of these, open the issue and comment \`/claim\`. RepoOps will never assign the next issue automatically.`);
  } else if (guidance.contributorHubUrl) {
    parts.push(`When you want another task, browse the [Contributor Hub](${guidance.contributorHubUrl}) and use \`/claim\` on an available issue.`);
  }

  parts.push("Thanks for helping build RepoOps.");
  return parts.join("\n\n");
}

export function buildPullRequestPostMergeMessage({ contributor, issueNumber, contributionStatus = "unknown" }) {
  validateCompletionIdentity({ contributor, issueNumber, contributionStatus });
  const first = contributionStatus === "first";
  const parts = [
    first
      ? `🎉 Welcome to RepoOps, @${contributor} — your first contribution has been merged!`
      : `✅ Thanks, @${contributor} — your contribution has been merged.`,
    `Thanks for completing #${issueNumber} through this pull request.`
  ];

  if (first) parts.push("Welcome to the RepoOps contributor community.");
  parts.push(`The detailed completion follow-up, contributor resources, and any available next work are recorded on #${issueNumber}.`);
  parts.push("Thanks for helping build RepoOps. 🚀");
  return parts.join("\n\n");
}

export function postMergeMarker(issueId, pullRequestNumber) {
  if (!Number.isSafeInteger(issueId) || issueId < 1 || !Number.isSafeInteger(pullRequestNumber) || pullRequestNumber < 1) throw new Error("Invalid post-merge marker identity");
  return `<!-- repoops:post-merge:v1:${issueId}:${pullRequestNumber} -->`;
}

export function postMergePullRequestMarker(issueId, pullRequestNumber) {
  if (!Number.isSafeInteger(issueId) || issueId < 1 || !Number.isSafeInteger(pullRequestNumber) || pullRequestNumber < 1) throw new Error("Invalid post-merge pull request marker identity");
  return `<!-- repoops:post-merge-pr:v1:${issueId}:${pullRequestNumber} -->`;
}
