import {
  CONTRIBUTORS_API,
  GOOD_FIRST_ISSUES_API,
  LINKS,
  getIssueMetadata,
  normalizeContributors,
  selectAvailableGoodFirstIssues
} from "./data.mjs";

const githubHeaders = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28"
};

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: githubHeaders,
    cache: "no-store"
  });

  if (!response.ok) {
    const error = new Error(`GitHub API request failed with ${response.status}`);
    error.status = response.status;
    error.remaining = response.headers.get("x-ratelimit-remaining");
    error.reset = response.headers.get("x-ratelimit-reset");
    throw error;
  }

  return response.json();
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function externalLink(href, className, text) {
  const link = element("a", className, text);
  link.href = href;
  link.target = "_blank";
  link.rel = "noreferrer";
  return link;
}

function labelChip(label) {
  if (!label) return null;
  const chip = element("span", "meta-chip", label.replace(/^\w+:\s*/, ""));
  chip.title = label;
  return chip;
}

function renderIssue(issue) {
  const card = element("article", "issue-card");
  const header = element("div", "issue-card__header");
  header.append(element("span", "issue-number", `#${issue.number}`));
  header.append(element("span", "live-dot", "LIVE"));

  const title = externalLink(issue.html_url, "issue-title", issue.title);
  const meta = element("div", "issue-meta");
  const { difficulty, area, priority } = getIssueMetadata(issue);

  [difficulty, area, priority].forEach((value) => {
    const chip = labelChip(value);
    if (chip) meta.append(chip);
  });

  const action = externalLink(issue.html_url, "text-link", "Open issue →");
  card.append(header, title, meta, action);
  return card;
}

function renderIssueState(message, detail, kind = "neutral") {
  const container = document.querySelector("#issueFeed");
  container.replaceChildren();
  const state = element("div", `feed-state feed-state--${kind}`);
  state.append(element("strong", null, message));
  if (detail) state.append(element("p", null, detail));
  state.append(externalLink(LINKS.goodFirstIssues, "text-link", "Browse on GitHub →"));
  container.append(state);
}

async function loadIssues() {
  try {
    const payload = await fetchJson(GOOD_FIRST_ISSUES_API);
    const issues = selectAvailableGoodFirstIssues(payload.items, 6);
    const container = document.querySelector("#issueFeed");
    container.replaceChildren();

    if (issues.length === 0) {
      renderIssueState(
        "No unassigned Good First Issues right now.",
        "The live feed only shows open, ready, unassigned work. Check all ready issues for more options."
      );
      return;
    }

    issues.forEach((issue) => container.append(renderIssue(issue)));
    document.querySelector("#issueFeedStatus").textContent = `Live from GitHub · ${issues.length} available`;
  } catch (error) {
    const rateLimited = error.status === 403 || error.remaining === "0";
    renderIssueState(
      rateLimited ? "GitHub's public API limit was reached." : "Live issue data is temporarily unavailable.",
      "You can still use the direct GitHub filter below; no contributor workflow is blocked.",
      "warning"
    );
    document.querySelector("#issueFeedStatus").textContent = "GitHub fallback active";
  }
}

function renderContributor(contributor) {
  const card = externalLink(contributor.profileUrl, "contributor-card", "");
  card.setAttribute("aria-label", `Open ${contributor.login}'s GitHub profile`);

  const avatar = document.createElement("img");
  avatar.src = contributor.avatarUrl;
  avatar.alt = "";
  avatar.loading = "lazy";
  avatar.width = 56;
  avatar.height = 56;

  const copy = element("span", "contributor-copy");
  copy.append(element("strong", null, `@${contributor.login}`));
  copy.append(
    element(
      "small",
      null,
      contributor.contributions === null
        ? "Repository contributor"
        : `${contributor.contributions} public repository contribution${contributor.contributions === 1 ? "" : "s"}`
    )
  );

  card.append(avatar, copy);
  return card;
}

async function loadContributors() {
  const container = document.querySelector("#contributorFeed");

  try {
    const payload = await fetchJson(CONTRIBUTORS_API);
    const contributors = normalizeContributors(payload, 12);
    container.replaceChildren();

    if (contributors.length === 0) {
      container.append(
        element("div", "feed-state", "Contributor activity will appear here as RepoOps grows.")
      );
      return;
    }

    contributors.forEach((contributor) => container.append(renderContributor(contributor)));
    document.querySelector("#contributorFeedStatus").textContent = `Live from GitHub · ${contributors.length} shown`;
  } catch {
    container.replaceChildren();
    const state = element("div", "feed-state feed-state--warning");
    state.append(element("strong", null, "Contributor data is temporarily unavailable."));
    state.append(externalLink(`${LINKS.repository}/graphs/contributors`, "text-link", "View contributors on GitHub →"));
    container.append(state);
    document.querySelector("#contributorFeedStatus").textContent = "GitHub fallback active";
  }
}

function wireLinks() {
  const mappings = {
    "[data-link='ready']": LINKS.readyIssues,
    "[data-link='good-first']": LINKS.goodFirstIssues,
    "[data-link='problem']": LINKS.problemProposal,
    "[data-link='upgrade']": LINKS.upgradeProposal,
    "[data-link='repo']": LINKS.repository,
    "[data-link='contributing']": LINKS.contributing,
    "[data-link='roadmap']": LINKS.roadmap,
    "[data-link='architecture']": LINKS.architecture,
    "[data-link='security']": LINKS.security,
    "[data-link='changelog']": LINKS.changelog
  };

  Object.entries(mappings).forEach(([selector, href]) => {
    document.querySelectorAll(selector).forEach((node) => {
      node.href = href;
    });
  });
}

function updateYear() {
  document.querySelector("#year").textContent = new Date().getUTCFullYear();
}

wireLinks();
updateYear();
await Promise.allSettled([loadIssues(), loadContributors()]);
