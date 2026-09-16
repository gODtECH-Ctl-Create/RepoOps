export function decideUnclaim({ actor, assignees = [], isPullRequest = false, label = "status: in-progress" }) {
  if (isPullRequest) return { type: "ignore", reason: "pull-request-comment" };
  if (!actor) return { type: "ignore", reason: "missing-actor" };

  const assignedLogins = assignees.map((assignee) => assignee?.login).filter(Boolean);

  if (!assignedLogins.includes(actor)) {
    if (assignedLogins.length === 0) {
      return {
        type: "not-owned",
        actor,
        message: `@${actor}, this issue is not currently assigned.`
      };
    }

    return {
      type: "forbidden",
      actor,
      assignees: assignedLogins,
      message: `@${actor}, only the current assignee can release this issue.`
    };
  }

  return {
    type: "unclaim",
    actor,
    label,
    message: `✅ @${actor} released this issue. RepoOps removed the assignment and marked it available again.`
  };
}
