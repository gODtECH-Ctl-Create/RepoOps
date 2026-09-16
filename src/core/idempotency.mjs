import { createHash } from "node:crypto";

export class AmbiguousOperationError extends Error {
  constructor(message) { super(`Ambiguous RepoOps operation: ${message}`); this.name = "AmbiguousOperationError"; }
}

export function operationKey({ repositoryId, issueId, event, action, sourceId }) {
  for (const [key, value] of Object.entries({ repositoryId, issueId, sourceId })) {
    if (!(Number.isSafeInteger(value) && value > 0)) throw new Error(`Invalid operation context: ${key}`);
  }
  if (!["issue_comment", "issues", "assignment_reminder"].includes(event) || !/^[a-z][a-z0-9-]{0,63}$/.test(action ?? "")) {
    throw new Error("Invalid operation event/action");
  }
  return createHash("sha256").update(JSON.stringify([1, repositoryId, issueId, event, action, sourceId])).digest("hex");
}

// Store and steps are injected: this layer never calls GitHub.
export async function executeOperation({ store, key, prepare, steps }) {
  let receipt = await store.find(key);
  if (receipt?.state === "complete") return { type: "duplicate", receipt };
  if (!receipt) {
    receipt = await store.create(key, { state: "pending", plan: await prepare(), done: [], started: null });
  }
  const save = async () => { receipt = await store.save(key, receipt); };
  for (const step of steps(receipt.plan)) {
    if (receipt.done.includes(step.name)) continue;
    const evidence = await step.inspect();
    if (!["applied", "absent"].includes(evidence)) throw new AmbiguousOperationError(`${key}/${step.name}: unknown evidence`);
    if (receipt.started && receipt.started !== step.name) throw new AmbiguousOperationError(`${key}: inconsistent checkpoint`);
    if (evidence === "absent") {
      if (receipt.started) throw new AmbiguousOperationError(`${key}/${step.name}: a prior mutation may have run; inspect GitHub before retrying`);
      receipt.started = step.name;
      await save();
      await step.apply();
      if (await step.inspect() !== "applied") throw new AmbiguousOperationError(`${key}/${step.name}: mutation not confirmed`);
    }
    receipt.done.push(step.name);
    receipt.started = null;
    await save();
  }
  receipt.state = "complete";
  await save();
  return { type: "completed", receipt };
}
