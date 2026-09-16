const unavailable = new Set(["status: blocked", "status: needs-design", "status: needs-review", "dependency: blocked"]);
export function isAvailable(labels) {
  return !labels.some((l) => unavailable.has((typeof l === "string" ? l : l.name).toLowerCase()));
}

export function workflowTransition({ state, assignees, labels, action, policy }) {
  let target = null;
  if (state === "open") {
    if (assignees.length) target = policy.inProgress;
    else if (action === "unclaim" && isAvailable(labels)) target = policy.ready;
  }
  const mutations = [policy.ready, policy.inProgress].filter((label) => label !== target).map((label) => ({ type: "remove-label", label }));
  if (target) mutations.push({ type: "add-label", label: target });
  return mutations;
}
