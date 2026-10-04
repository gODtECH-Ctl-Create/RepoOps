const MARKER = "<!-- repoops:contributor-diary:v1 -->";

function requiredString(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new Error("Invalid contributor diary " + field);
  return value.trim();
}

function positiveInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("Invalid contributor diary " + field);
  return value;
}

function cleanText(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\r?\n/g, " ")
    .replace(/\|/g, "\\|")
    .replace(/\x60/g, "")
    .trim();
}

function normalizeActive(active) {
  if (!Array.isArray(active)) throw new Error("Invalid active contributor diary data");
  return active
    .map((item) => ({
      number: positiveInteger(item.number, "active issue number"),
      title: requiredString(item.title, "active issue title"),
      contributors: [...new Set((Array.isArray(item.contributors) ? item.contributors : [])
        .filter((name) => typeof name === "string" && name.trim())
        .map((name) => name.trim()))]
        .sort((a, b) => a.localeCompare(b, "en"))
    }))
    .filter((item) => item.contributors.length > 0)
    .sort((a, b) => a.number - b.number || a.title.localeCompare(b.title, "en"));
}

function normalizeCompleted(completed) {
  if (!Array.isArray(completed)) throw new Error("Invalid completed contributor diary data");
  return completed
    .map((item) => ({
      issueNumber: positiveInteger(item.issueNumber, "completed issue number"),
      issueTitle: requiredString(item.issueTitle, "completed issue title"),
      pullRequestNumber: positiveInteger(item.pullRequestNumber, "completed pull request number"),
      contributor: requiredString(item.contributor, "completed contributor"),
      completedAt: requiredString(item.completedAt, "completed timestamp")
    }))
    .sort((a, b) => b.completedAt.localeCompare(a.completedAt) ||
      a.issueNumber - b.issueNumber ||
      a.pullRequestNumber - b.pullRequestNumber ||
      a.contributor.localeCompare(b.contributor, "en"))
    .slice(0, 12);
}

export function contributorDiaryMarker() {
  return MARKER;
}

export function buildContributorDiary({ repository, active = [], completed = [] } = {}) {
  const ownerRepo = requiredString(repository, "repository");
  if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(ownerRepo)) throw new Error("Invalid contributor diary repository");

  const activeItems = normalizeActive(active);
  const completedItems = normalizeCompleted(completed);
  const contributorNames = new Set();
  const activeCounts = new Map();

  for (const item of activeItems) {
    for (const contributor of item.contributors) {
      contributorNames.add(contributor);
      activeCounts.set(contributor, (activeCounts.get(contributor) || 0) + 1);
    }
  }
  for (const item of completedItems) contributorNames.add(item.contributor);

  const lines = [
    MARKER,
    "",
    "# Contributor Diary",
    "",
    "> Operational snapshot for **" + ownerRepo + "**. GitHub remains the source of truth.",
    "",
    "## Currently in progress",
    ""
  ];

  if (activeItems.length) {
    lines.push("| Contributor | Issue | Title |");
    lines.push("| --- | --- | --- |");
    for (const item of activeItems) {
      lines.push("| " + cleanText(item.contributors.join(", ")) + " | [#" + item.number + "](https://github.com/" + ownerRepo + "/issues/" + item.number + ") | " + cleanText(item.title) + " |");
    }
  } else {
    lines.push("_No RepoOps-managed work is currently marked in progress._");
  }

  lines.push("", "## Recently completed", "");

  if (completedItems.length) {
    lines.push("| Contributor | Issue | Pull Request | Title | Completed |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const item of completedItems) {
      const date = new Date(item.completedAt);
      const displayDate = Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : cleanText(item.completedAt);
      lines.push("| @" + cleanText(item.contributor) + " | [#" + item.issueNumber + "](https://github.com/" + ownerRepo + "/issues/" + item.issueNumber + ") | [#" + item.pullRequestNumber + "](https://github.com/" + ownerRepo + "/pull/" + item.pullRequestNumber + ") | " + cleanText(item.issueTitle) + " | " + displayDate + " |");
    }
    lines.push("", "_Showing the 12 most recent completed RepoOps-managed contributions when that many are available._");
  } else {
    lines.push("_No completed RepoOps-managed contributions are available in the current projection._");
  }

  lines.push("", "## Contributor snapshot", "");

  if (contributorNames.size) {
    lines.push("| Contributor | Active issues | Completed shown |");
    lines.push("| --- | ---: | ---: |");
    for (const contributor of [...contributorNames].sort((a, b) => a.localeCompare(b, "en"))) {
      const completedCount = completedItems.filter((item) => item.contributor === contributor).length;
      lines.push("| @" + cleanText(contributor) + " | " + (activeCounts.get(contributor) || 0) + " | " + completedCount + " |");
    }
  } else {
    lines.push("_No contributor activity in the current snapshot._");
  }

  lines.push(
    "",
    "---",
    "",
    "_This is an operational view, not a leaderboard. It does not score contributor quality, speed, reputation, or productivity._"
  );

  return lines.join("\n");
}
