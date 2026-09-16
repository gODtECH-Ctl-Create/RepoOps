import { AmbiguousOperationError } from "../core/idempotency.mjs";

const marker = (key) => `<!-- repoops:v1:${key} `;
const encode = (key, receipt) => `${receipt.state === "complete" ? receipt.plan.message : "RepoOps operation pending; incomplete operations require inspection if a retry fails."}\n\n${marker(key)}${JSON.stringify({ state: receipt.state, plan: receipt.plan, done: receipt.done, started: receipt.started })} -->`;

export function commentOperationStore(client, issueNumber) {
  return {
    async find(key) {
      const matches = (await client.listComments(issueNumber)).filter((c) => client.isOwnComment(c) && c.body.includes(marker(key)));
      if (matches.length > 1) throw new AmbiguousOperationError(`${key}: multiple receipts`);
      if (!matches.length) return null;
      const comment = matches[0];
      try {
        const prefix = marker(key);
        const start = comment.body.indexOf(prefix) + prefix.length;
        const receipt = JSON.parse(comment.body.slice(start, comment.body.indexOf(" -->", start)));
        if (!["pending", "complete"].includes(receipt.state) || !receipt.plan || typeof receipt.plan.message !== "string" || !Array.isArray(receipt.done) || receipt.done.some((x) => typeof x !== "string") || !(receipt.started === null || typeof receipt.started === "string")) throw new Error("schema");
        return { ...receipt, id: comment.id };
      } catch { throw new AmbiguousOperationError(`${key}: malformed receipt`); }
    },
    async create(key, receipt) {
      // Do not retry a failed POST in this delivery: its outcome may be unknown.
      const comment = await client.addComment(issueNumber, encode(key, receipt));
      if (!client.isOwnComment(comment)) throw new AmbiguousOperationError("Unexpected receipt author; use a trusted configured bot identity");
      return { ...receipt, id: comment.id };
    },
    async save(key, receipt) {
      await client.updateComment(receipt.id, encode(key, receipt));
      return receipt;
    }
  };
}

export function issueMutationSteps(client, issueNumber, plan) {
  return (plan.mutations ?? []).map((mutation, index) => ({
    name: `${index}-${mutation.type}`,
    async inspect() {
      const issue = await client.getIssue(issueNumber);
      if (issue.state !== plan.state) throw new AmbiguousOperationError("Issue state changed during operation");
      const names = issue.assignees.map((a) => a.login);
      const labels = issue.labels.map((l) => typeof l === "string" ? l : l.name);
      if (mutation.type === "assign") {
        if (names.some((n) => n !== mutation.login)) throw new AmbiguousOperationError("Assignment ownership changed");
        return names.includes(mutation.login) ? "applied" : "absent";
      }
      if (mutation.type === "unassign") return names.includes(mutation.login) ? "absent" : "applied";
      if (plan.expectedAssignees && JSON.stringify([...names].sort()) !== JSON.stringify([...plan.expectedAssignees].sort())) throw new AmbiguousOperationError("Assignment ownership changed before label transition");
      if (mutation.type === "add-label") return labels.includes(mutation.label) ? "applied" : "absent";
      if (mutation.type === "remove-label") return labels.includes(mutation.label) ? "absent" : "applied";
      throw new Error("Unknown mutation");
    },
    async apply() {
      if (mutation.type === "assign") return client.assignIssue(issueNumber, mutation.login);
      if (mutation.type === "unassign") return client.removeAssignees(issueNumber, [mutation.login]);
      if (mutation.type === "remove-label") return client.removeLabel(issueNumber, mutation.label);
      await client.ensureLabel(mutation.label);
      return client.addLabels(issueNumber, [mutation.label]);
    }
  }));
}
