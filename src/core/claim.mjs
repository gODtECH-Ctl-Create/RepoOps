export function normalizeCommand(body = "") {
  return body.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
}

export function decideClaim({ body, actor, assignees = [], isPullRequest = false, label = "status: in-progress" }) {
  if (normalizeCommand(body) !== "/claim") {
    return { type: "ignore", reason: "not-claim-command" };
  }

  if (isPullRequest) {
    return { type: "ignore", reason: "pull-request-comment" };
  }

  if (!actor) {
    return { type: "ignore", reason: "missing-actor" };
  }

  const assignedLogins = assignees
    .map((assignee) => assignee?.login)
    .filter(Boolean);

  if (assignedLogins.includes(actor)) {
    return {
      type: "already-owned",
      actor,
      message: `@${actor}, you already have this issue assigned.`
    };
  }

  if (assignedLogins.length > 0) {
    return {
      type: "unavailable",
      actor,
      assignees: assignedLogins,
      message: `This issue is already assigned to ${assignedLogins.map((login) => `@${login}`).join(", ")}.`
    };
  }

  return {
    type: "claim",
    actor,
    label,
    message: `✅ @${actor} claimed this issue. RepoOps assigned it and marked it as in progress.`
  };
}
