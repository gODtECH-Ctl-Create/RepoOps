import { LINKS, REPOSITORY } from "./data.mjs";

export const OPEN_ISSUES_API = `https://api.github.com/repos/${REPOSITORY}/issues?state=open&sort=updated&direction=desc&per_page=100`;

const PRIORITY_ORDER = new Map([
  ["priority: p0", 0],
  ["priority: p1", 1],
  ["priority: p2", 2],
  ["priority: p3", 3]
]);

export function issueLabelNames(issue) {
  return Array.isArray(issue?.labels)
    ? issue.labels.map((label) => (typeof label === "string" ? label : label?.name)).filter(Boolean)
    : [];
}

export function hasIssueLabel(issue, label) {
  return issueLabelNames(issue).includes(label);
}

export function isOpenIssue(issue) {
  return Boolean(issue) && !issue.pull_request && issue.state === "open";
}

export function isAssigned(issue) {
  return Boolean(issue?.assignee) || (Array.isArray(issue?.assignees) && issue.assignees.length > 0);
}

export function isAvailableIssue(issue) {
  return (
    isOpenIssue(issue) &&
    !isAssigned(issue) &&
    hasIssueLabel(issue, "status: ready") &&
    !hasIssueLabel(issue, "status: blocked") &&
    !hasIssueLabel(issue, "status: in-progress")
  );
}

export function getWorkflowState(issue) {
  if (hasIssueLabel(issue, "status: blocked")) return "blocked";
  if (hasIssueLabel(issue, "status: in-progress") || isAssigned(issue)) return "in-progress";
  if (isAvailableIssue(issue)) return "ready";
  return "open";
}

function matchesPrefixLabel(issue, prefix, selectedValue) {
  if (!selectedValue) return true;
  return hasIssueLabel(issue, `${prefix}${selectedValue}`);
}

function matchesPriority(issue, priority) {
  if (!priority) return true;
  if (priority === "p1p2") {
    return hasIssueLabel(issue, "priority: p1") || hasIssueLabel(issue, "priority: p2");
  }
  return hasIssueLabel(issue, `priority: ${priority}`);
}

export function filterContributorIssues(issues, filters = {}) {
  const {
    view = "ready",
    difficulty = "",
    area = "",
    priority = ""
  } = filters;

  return (Array.isArray(issues) ? issues : [])
    .filter(isOpenIssue)
    .filter((issue) => {
      if (view === "good-first") {
        return isAvailableIssue(issue) && hasIssueLabel(issue, "good first issue");
      }
      if (view === "ready") return isAvailableIssue(issue);
      if (view === "in-progress") {
        return hasIssueLabel(issue, "status: in-progress") || isAssigned(issue);
      }
      return true;
    })
    .filter((issue) => matchesPrefixLabel(issue, "difficulty: ", difficulty))
    .filter((issue) => matchesPrefixLabel(issue, "area: ", area))
    .filter((issue) => matchesPriority(issue, priority))
    .sort((left, right) => {
      const leftPriority = issueLabelNames(left).find((label) => label.startsWith("priority: "));
      const rightPriority = issueLabelNames(right).find((label) => label.startsWith("priority: "));
      const priorityDifference =
        (PRIORITY_ORDER.get(leftPriority) ?? 99) - (PRIORITY_ORDER.get(rightPriority) ?? 99);
      if (priorityDifference !== 0) return priorityDifference;

      const timeDifference = Date.parse(right.updated_at ?? "") - Date.parse(left.updated_at ?? "");
      if (Number.isFinite(timeDifference) && timeDifference !== 0) return timeDifference;
      return (left.number ?? 0) - (right.number ?? 0);
    });
}

export function collectAreas(issues) {
  const areas = new Set();
  for (const issue of Array.isArray(issues) ? issues : []) {
    if (!isOpenIssue(issue)) continue;
    for (const label of issueLabelNames(issue)) {
      if (label.startsWith("area: ")) areas.add(label.slice("area: ".length));
    }
  }
  return [...areas].sort((a, b) => a.localeCompare(b));
}

export function issueDisplayMetadata(issue) {
  const labels = issueLabelNames(issue);
  const first = (prefix) => labels.find((label) => label.startsWith(prefix)) ?? null;

  return {
    state: getWorkflowState(issue),
    difficulty: first("difficulty: "),
    area: first("area: "),
    priority: first("priority: "),
    goodFirst: labels.includes("good first issue"),
    assignee: issue?.assignee?.login ?? issue?.assignees?.[0]?.login ?? null
  };
}

export function buildGitHubSearchUrl(filters = {}) {
  const {
    view = "ready",
    difficulty = "",
    area = "",
    priority = ""
  } = filters;

  const parts = ["is:issue", "is:open"];

  if (view === "good-first") {
    parts.push('label:"good first issue"', 'label:"status: ready"', "no:assignee", '-label:"status: blocked"');
  } else if (view === "ready") {
    parts.push('label:"status: ready"', "no:assignee", '-label:"status: blocked"');
  } else if (view === "in-progress") {
    parts.push('label:"status: in-progress"');
  }

  if (difficulty) parts.push(`label:"difficulty: ${difficulty}"`);
  if (area) parts.push(`label:"area: ${area}"`);
  if (priority === "p1p2") {
    parts.push('label:"priority: p1","priority: p2"');
  } else if (priority) {
    parts.push(`label:"priority: ${priority}"`);
  }

  return `https://github.com/${REPOSITORY}/issues?q=${encodeURIComponent(parts.join(" "))}`;
}

export function getHubLinks() {
  return {
    ...LINKS,
    hub: `https://${REPOSITORY.split("/")[0].toLowerCase()}.github.io/${REPOSITORY.split("/")[1]}/contribute.html`
  };
}
