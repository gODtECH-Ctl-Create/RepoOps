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
