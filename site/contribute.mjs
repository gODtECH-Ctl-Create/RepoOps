import { LINKS } from "./data.mjs";
import {
  OPEN_ISSUES_API,
  buildGitHubSearchUrl,
  collectAreas,
  filterContributorIssues,
  issueDisplayMetadata,
  isAvailableIssue
} from "./hub-data.mjs";

const githubHeaders = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28"
};

const state = {
  issues: [],
  loaded: false,
  error: null
};

const elements = {
  feed: document.querySelector("#hubIssueFeed"),
  status: document.querySelector("#hubStatus"),
  resultCount: document.querySelector("#resultCount"),
  explanation: document.querySelector("#finderExplanation"),
  view: document.querySelector("#viewFilter"),
  difficulty: document.querySelector("#difficultyFilter"),
  area: document.querySelector("#areaFilter"),
  priority: document.querySelector("#priorityFilter"),
  fallback: document.querySelector("#githubFallback")
};

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

function parseNextLink(linkHeader) {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(",")) {
    const match = part.match(/<([^>]+)>;\s*rel="([^"]+)"/);
    if (match?.[2] === "next") return match[1];
  }
  return null;
}

async function fetchOpenIssues(maxPages = 3) {
  const issues = [];
  let url = OPEN_ISSUES_API;
  let page = 0;

  while (url && page < maxPages) {
    const response = await fetch(url, {
      headers: githubHeaders,
      cache: "no-store"
    });

    if (!response.ok) {
      const error = new Error(`GitHub API request failed with ${response.status}`);
      error.status = response.status;
      error.remaining = response.headers.get("x-ratelimit-remaining");
      throw error;
    }

    const payload = await response.json();
    if (!Array.isArray(payload)) throw new Error("Unexpected GitHub issues response");
    issues.push(...payload);
    url = parseNextLink(response.headers.get("link"));
    page += 1;
  }

  return issues;
}

function currentFilters() {
  return {
    view: elements.view.value,
    difficulty: elements.difficulty.value,
    area: elements.area.value,
    priority: elements.priority.value
  };
}

function syncQueryString(filters) {
  const params = new URLSearchParams();
  if (filters.view && filters.view !== "ready") params.set("view", filters.view);
  if (filters.difficulty) params.set("difficulty", filters.difficulty);
  if (filters.area) params.set("area", filters.area);
  if (filters.priority) params.set("priority", filters.priority);
  const suffix = params.toString();
  history.replaceState(null, "", suffix ? `?${suffix}#finder` : "#finder");
}

function filtersFromLocation() {
  const params = new URLSearchParams(location.search);
  return {
    view: ["ready", "good-first", "in-progress", "all-open"].includes(params.get("view"))
      ? params.get("view")
      : "ready",
    difficulty: ["starter", "intermediate", "advanced"].includes(params.get("difficulty"))
      ? params.get("difficulty")
      : "",
    area: params.get("area") ?? "",
    priority: ["p0", "p1", "p2", "p3", "p1p2"].includes(params.get("priority"))
      ? params.get("priority")
      : ""
  };
}

function setSelectValue(select, value) {
  if ([...select.options].some((option) => option.value === value)) select.value = value;
}

function hydrateFiltersFromLocation() {
  const filters = filtersFromLocation();
  setSelectValue(elements.view, filters.view);
  setSelectValue(elements.difficulty, filters.difficulty);
  setSelectValue(elements.priority, filters.priority);
  return filters;
}

function populateAreas(issues, selectedArea = "") {
  const current = selectedArea || elements.area.value;
  const options = [element("option", null, "Any area")];
  options[0].value = "";

  for (const area of collectAreas(issues)) {
    const option = element("option", null, area);
    option.value = area;
    options.push(option);
  }

  elements.area.replaceChildren(...options);
  setSelectValue(elements.area, current);
}

function metadataChip(label) {
  if (!label) return null;
  const chip = element("span", "meta-chip", label.replace(/^\w+:\s*/, ""));
  chip.title = label;
  return chip;
}

function renderIssueCard(issue) {
  const metadata = issueDisplayMetadata(issue);
  const card = element("article", "hub-issue-card");
  const top = element("div", "hub-card-top");
  top.append(element("span", "issue-number", `#${issue.number}`));
  top.append(element("span", `state-pill state-pill--${metadata.state}`, metadata.state));

  const title = externalLink(issue.html_url, "hub-issue-title", issue.title);
  const meta = element("div", "hub-card-meta");
  [metadata.difficulty, metadata.area, metadata.priority].forEach((value) => {
    const chip = metadataChip(value);
    if (chip) meta.append(chip);
  });
  if (metadata.goodFirst) meta.append(element("span", "meta-chip", "good first issue"));

  const assignee = element(
    "p",
    "hub-card-assignee",
    metadata.assignee ? `Currently owned by @${metadata.assignee}` : "No current assignee"
  );

  const actions = element("div", "hub-card-actions");
  actions.append(externalLink(issue.html_url, "text-link", isAvailableIssue(issue) ? "Open & claim →" : "View issue →"));
  const hint = element("span", "claim-hint");
  if (isAvailableIssue(issue)) {
    hint.append("Use ", element("code", null, "/claim"), " on GitHub");
  } else {
    hint.textContent = "View-only state";
  }
  actions.append(hint);

  card.append(top, title, meta, assignee, actions);
  return card;
}

function renderEmpty(message, detail) {
  elements.feed.replaceChildren();
  const block = element("div", "feed-state");
  block.append(element("strong", null, message));
  block.append(element("p", null, detail));
  block.append(externalLink(elements.fallback.href, "text-link", "Open this filter on GitHub →"));
  elements.feed.append(block);
}

function explanationForView(view) {
  if (view === "good-first") {
    return "Good First Issues are open, unassigned, unblocked, marked status: ready, and explicitly labeled for starter contribution.";
  }
  if (view === "in-progress") {
    return "In-progress work is shown for visibility. These issues are not presented as available to claim.";
  }
  if (view === "all-open") {
    return "All open issues may include blocked or assigned work. Read the state badge before acting.";
  }
  return "Ready work is open, unassigned, unblocked, and marked status: ready.";
}

function render() {
  const filters = currentFilters();
  elements.fallback.href = buildGitHubSearchUrl(filters);
  elements.explanation.textContent = explanationForView(filters.view);
  syncQueryString(filters);

  if (!state.loaded) return;
  if (state.error) {
    elements.resultCount.textContent = "—";
    renderEmpty(
      "Live GitHub data is temporarily unavailable.",
      "The equivalent GitHub search remains available, so issue discovery is not blocked."
    );
    return;
  }

  const matches = filterContributorIssues(state.issues, filters);
  elements.resultCount.textContent = String(matches.length);
  elements.feed.replaceChildren();

  if (matches.length === 0) {
    renderEmpty(
      "No issues match this combination.",
      "Try a broader difficulty, area, or priority filter, or open the equivalent search on GitHub."
    );
    return;
  }

  matches.forEach((issue) => elements.feed.append(renderIssueCard(issue)));
}

function applyQuickRoute(route) {
  if (route === "good-first") {
    elements.view.value = "good-first";
    elements.difficulty.value = "";
    elements.priority.value = "";
  } else if (route === "ready") {
    elements.view.value = "ready";
    elements.difficulty.value = "";
    elements.priority.value = "";
  } else if (route === "in-progress") {
    elements.view.value = "in-progress";
    elements.difficulty.value = "";
    elements.priority.value = "";
  } else if (route === "p1p2") {
    elements.view.value = "ready";
    elements.priority.value = "p1p2";
  }
  render();
  document.querySelector("#finder").scrollIntoView({ behavior: "smooth", block: "start" });
}

function wireStaticLinks() {
  document.querySelector("#repoLink").href = LINKS.repository;
  document.querySelector("#goodFirstFallback").href = LINKS.goodFirstIssues;
  document.querySelector("#problemLink").href = LINKS.problemProposal;
  document.querySelector("#upgradeLink").href = LINKS.upgradeProposal;
  document.querySelector("#contributingLink").href = LINKS.contributing;
  document.querySelector("#developmentLink").href = `${LINKS.repository}/blob/main/docs/development.md`;
  document.querySelector("#roadmapLink").href = LINKS.roadmap;
  document.querySelector("#securityLink").href = LINKS.security;
}

function wireControls() {
  document.querySelectorAll("#issueFilters select").forEach((select) => {
    select.addEventListener("change", render);
  });

  document.querySelectorAll("[data-route]").forEach((button) => {
    button.addEventListener("click", () => applyQuickRoute(button.dataset.route));
  });
}

async function load() {
  const initial = hydrateFiltersFromLocation();
  wireStaticLinks();
  wireControls();
  elements.fallback.href = buildGitHubSearchUrl(initial);

  try {
    const issues = await fetchOpenIssues(3);
    state.issues = issues;
    state.loaded = true;
    populateAreas(issues, initial.area);
    elements.status.textContent = `Live from GitHub · ${issues.filter((issue) => !issue.pull_request).length} open issues loaded`;
  } catch (error) {
    state.loaded = true;
    state.error = error;
    const rateLimited = error.status === 403 || error.remaining === "0";
    elements.status.textContent = rateLimited ? "GitHub public API limit reached" : "GitHub fallback active";
  }

  elements.feed.setAttribute("aria-busy", "false");
  render();
}

await load();
