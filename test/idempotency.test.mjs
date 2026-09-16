import test from "node:test";
import assert from "node:assert/strict";
import { operationKey, executeOperation } from "../src/core/idempotency.mjs";
import { commentOperationStore } from "../src/github/operations.mjs";
import { GitHubClient } from "../src/github/client.mjs";

const context = { repositoryId: 1, issueId: 2, event: "issue_comment", action: "created", sourceId: 3 };
function harness() {
  let stored = null;
  const counts = { creates: 0, mutations: 0 };
  const store = {
    find: async () => structuredClone(stored),
    create: async (_key, r) => { counts.creates++; stored = structuredClone(r); return r; },
    save: async (_key, r) => { stored = structuredClone(r); return r; }
  };
  const applied = new Set();
  let fail = null;
  const run = () => executeOperation({ key: operationKey(context), store, prepare: async () => ({ message: "Done" }), steps: () => ["assign", "label"].map((name) => ({
    name, inspect: async () => { if (fail === `read-${name}`) throw new Error("API unavailable"); return applied.has(name) ? "applied" : "absent"; },
    apply: async () => { counts.mutations++; if (fail === `before-${name}`) throw new Error("unknown outcome"); applied.add(name); if (fail === `after-${name}`) throw new Error("lost response"); }
  })) });
  return { run, counts, applied, fail: (value) => { fail = value; } };
}

test("operation keys are stable, scoped, and ignore contributor text", () => {
  assert.equal(operationKey(context), operationKey({ ...context, body: "spoof" }));
  for (const field of ["sourceId", "repositoryId", "issueId"]) assert.notEqual(operationKey(context), operationKey({ ...context, [field]: 99 }));
});
test("malformed trusted context is rejected", () => {
  for (const value of [undefined, "3", -1, 0, NaN, 1.5]) assert.throws(() => operationKey({ ...context, sourceId: value }));
  assert.throws(() => operationKey({ ...context, action: "bad\ntext" }));
});
test("first delivery, duplicate delivery and retry after full success", async () => {
  const h = harness();
  assert.equal((await h.run()).type, "completed");
  assert.equal((await h.run()).type, "duplicate");
  assert.equal((await h.run()).type, "duplicate");
  assert.deepEqual(h.counts, { creates: 1, mutations: 2 });
});
test("partial mutation followed by retry only performs remaining work", async () => {
  const h = harness(); h.fail("read-label");
  await assert.rejects(h.run(), /API unavailable/);
  h.fail(null); await h.run();
  assert.deepEqual(h.counts, { creates: 1, mutations: 2 });
});
test("lost successful mutation response is recovered from state", async () => {
  const h = harness(); h.fail("after-assign"); await assert.rejects(h.run());
  h.fail(null); await h.run(); assert.equal(h.counts.mutations, 2);
});
test("ambiguous prior mutation fails without unsafe retry", async () => {
  const h = harness(); h.fail("before-assign"); await assert.rejects(h.run());
  h.fail(null); await assert.rejects(h.run(), /Ambiguous/); assert.equal(h.counts.mutations, 1);
});
test("already-applied mutations are not repeated", async () => {
  const h = harness(); h.applied.add("assign"); h.applied.add("label"); await h.run(); assert.equal(h.counts.mutations, 0);
});
test("completed receipt does not replay after later state changes", async () => {
  const h = harness(); await h.run(); h.applied.clear(); await h.run(); assert.equal(h.counts.mutations, 2);
});
test("receipt comments are authenticated, paginated, and validated", async () => {
  const client = new GitHubClient({ token: "test", repository: "owner/repo" });
  const key = operationKey(context);
  const fake = { id: 1, user: { id: 2, type: "User" }, body: `<!-- repoops:v1:${key} broken -->` };
  let comments = [fake];
  client.listComments = async () => comments;
  const store = commentOperationStore(client, 2);
  assert.equal(await store.find(key), null);
  comments = [{ ...fake, user: { id: 41898282, type: "Bot" } }];
  await assert.rejects(store.find(key), /malformed receipt/);
  comments.push(comments[0]); await assert.rejects(store.find(key), /multiple receipts/);
});
test("pagination and malformed API responses fail safely", async () => {
  const client = new GitHubClient({ token: "test", repository: "owner/repo" });
  const paths = []; client.request = async (path) => { paths.push(path); return paths.length === 1 ? Array(100).fill(1) : [2]; };
  assert.equal((await client.paginate("/test")).length, 101);
  assert.match(paths[1], /page=2$/);
  client.request = async () => ({}); await assert.rejects(client.paginate("/test"), /Malformed/);
  client.request = async () => { throw new Error("404 permission denied"); };
  await assert.rejects(client.removeLabel(2, "x"), /permission denied/);
});
