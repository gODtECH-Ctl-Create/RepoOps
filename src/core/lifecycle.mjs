export function decideClosedIssueCleanup({ assignees = [], labels = [], inProgressLabel = "status: in-progress" }) {
  const assignedLogins = assignees.map((assignee) => assignee?.login).filter(Boolean);
  const labelNames = labels.map((label) => typeof label === "string" ? label : label?.name).filter(Boolean);

  return {
    assignees: assignedLogins,
    removeInProgressLabel: labelNames.includes(inProgressLabel),
    inProgressLabel
  };
}
