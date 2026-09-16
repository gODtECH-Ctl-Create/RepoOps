import test from "node:test";
import assert from "node:assert/strict";
import { parseRepoOpsConfig } from "../src/core/config.mjs";

test("assignment defaults preserve old configuration and disable release", () => {
  assert.deepEqual(parseRepoOpsConfig('commands:\n  claim: true').assignments, { reminderAfterDays: 3, expireAfterDays: 7, autoRelease: false });
  assert.equal(parseRepoOpsConfig('assignments:\n  reminderAfterDays: 2\n  expireAfterDays: 8').assignments.expireAfterDays, 8);
});
test("reject invalid, contradictory and duplicate assignment policy", () => {
  for (const value of ['-1', '0', '1.5', 'NaN', 'true', '"3"', '36501', '9007199254740992']) assert.throws(() => parseRepoOpsConfig(`assignments:\n  reminderAfterDays: ${value}`));
  for (const text of ['assignments:\n  reminderAfterDays: 7', 'assignments:\n  expireAfterDays: 2', 'assignments:\n  autoRelease: "false"', 'assignments:\n  reminderAfterDays: 2\n  reminderAfterDays: 3', 'assignments:\nassignments:', 'labels:\n  ready: "status: in-progress"']) assert.throws(() => parseRepoOpsConfig(text));
});

test("parses contributor guidance without assuming project-specific commands", () => {
  const defaults = parseRepoOpsConfig("commands:\n  claim: true").contributorGuidance;
  assert.deepEqual(defaults, {
    enabled: true,
    requirements: "",
    setupCommand: "",
    checkCommand: "",
    contributingUrl: "",
    developmentUrl: "",
    architectureUrl: "",
    problemUrl: "",
    upgradeUrl: ""
  });

  const configured = parseRepoOpsConfig(`contributorGuidance:
  enabled: true
  requirements: "Node.js 20+ and Git"
  setupCommand: "npm install"
  checkCommand: "npm run check"
  contributingUrl: "https://example.com/CONTRIBUTING.md"
  developmentUrl: "https://example.com/development"
  architectureUrl: "https://example.com/architecture"
  problemUrl: "https://example.com/problems/new"
  upgradeUrl: "https://example.com/upgrades/new"
`).contributorGuidance;
  assert.equal(configured.setupCommand, "npm install");
  assert.equal(configured.checkCommand, "npm run check");
  assert.equal(configured.problemUrl, "https://example.com/problems/new");
  assert.equal(configured.upgradeUrl, "https://example.com/upgrades/new");
});

test("rejects unsafe or malformed contributor guidance", () => {
  for (const text of [
    "contributorGuidance:\n  enabled: yes",
    "contributorGuidance:\n  setupCommand: \"npm `install`\"",
    "contributorGuidance:\n  contributingUrl: \"http://example.com/guide\"",
    "contributorGuidance:\n  developmentUrl: \"../docs/development.md\"",
    "contributorGuidance:\n  problemUrl: \"javascript:alert(1)\"",
    "contributorGuidance:\n  upgradeUrl: \"http://example.com/upgrade\"",
    "contributorGuidance:\n  unknown: \"value\""
  ]) assert.throws(() => parseRepoOpsConfig(text));
});
