import test from "node:test";
import assert from "node:assert/strict";

import {
  buildGitHubSearchUrl,
  collectAreas,
  filterContributorIssues,
  getWorkflowState,
  isAvailableIssue
} from "../site/hub-data.mjs";

function issue(number, labels = [], overrides = {}) {
  return {
    number,
    title: `Issue ${number}`,
    state: "open",
    assignee: null,
    assignees: [],
    updated_at: `2026-09-${String(Math.min(number, 28)).padStart(2, "0")}T00:00:00Z`,
    labels: labels.map((name) => ({ name })),
    ...overrides
  };
}

const ready = (number, extra = [], overrides = {}) =>
  issue(number, ["status: ready", "difficulty: starter", "area: docs", "priority: p2", ...extra], overrides);

test("ready availability rejects assigned, blocked, in-progress, closed and pull-request items", () => {
  assert.equal(isAvailableIssue(ready(1)), true);
  assert.equal(isAvailableIssue(ready(2, [], { assignee: { login: "alice" } })), false);
  assert.equal(isAvailableIssue(ready(3, ["status: blocked"])), false);
  assert.equal(isAvailableIssue(ready(4, ["status: in-progress"])), false);
  assert.equal(isAvailableIssue(ready(5, [], { state: "closed" })), false);
  assert.equal(isAvailableIssue(ready(6, [], { pull_request: { url: "https://example.test/pr" } })), false);
});

test("Good First view only returns genuinely available starter-labelled work", () => {
  const result = filterContributorIssues(
    [
      ready(1, ["good first issue"]),
      ready(2),
      ready(3, ["good first issue", "status: blocked"]),
      ready(4, ["good first issue"], { assignee: { login: "alice" } })
    ],
    { view: "good-first" }
  );

  assert.deepEqual(result.map((item) => item.number), [1]);
});

test("in-progress view is visible without treating work as available", () => {
  const active = issue(7, ["status: in-progress", "area: automation", "priority: p1"], {
    assignee: { login: "alice" },
    assignees: [{ login: "alice" }]
  });

  assert.equal(isAvailableIssue(active), false);
  assert.equal(getWorkflowState(active), "in-progress");
  assert.deepEqual(filterContributorIssues([active, ready(8)], { view: "in-progress" }).map((item) => item.number), [7]);
});

test("filters support difficulty, area and P1/P2 grouped priority", () => {
  const issues = [
    issue(1, ["status: ready", "difficulty: intermediate", "area: pull-requests", "priority: p1"]),
    issue(2, ["status: ready", "difficulty: intermediate", "area: pull-requests", "priority: p2"]),
    issue(3, ["status: ready", "difficulty: starter", "area: docs", "priority: p3"]),
    issue(4, ["status: ready", "difficulty: intermediate", "area: pull-requests", "priority: p0"])
  ];

  const result = filterContributorIssues(issues, {
    view: "ready",
    difficulty: "intermediate",
    area: "pull-requests",
    priority: "p1p2"
  });

  assert.deepEqual(result.map((item) => item.number), [1, 2]);
});

test("areas are derived deterministically from open issue labels", () => {
  const areas = collectAreas([
    issue(1, ["area: docs"]),
    issue(2, ["area: automation"]),
    issue(3, ["area: docs"]),
    issue(4, ["area: ignored"], { state: "closed" })
  ]);

  assert.deepEqual(areas, ["automation", "docs"]);
});

test("GitHub fallback search mirrors ready and grouped priority filters", () => {
  const url = buildGitHubSearchUrl({
    view: "ready",
    difficulty: "intermediate",
    area: "pull-requests",
    priority: "p1p2"
  });
  const query = decodeURIComponent(new URL(url).searchParams.get("q"));

  assert.match(query, /is:issue is:open/);
  assert.match(query, /label:"status: ready"/);
  assert.match(query, /no:assignee/);
  assert.match(query, /-label:"status: blocked"/);
  assert.match(query, /label:"difficulty: intermediate"/);
  assert.match(query, /label:"area: pull-requests"/);
  assert.match(query, /label:"priority: p1","priority: p2"/);
});
