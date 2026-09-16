const maintainerAssociations = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

function validatePolicy(policy) {
  if (!policy || !Number.isSafeInteger(policy.maxActiveAssignments) || policy.maxActiveAssignments < 0 || policy.maxActiveAssignments > 100 || typeof policy.limitMaintainers !== "boolean") {
    throw new Error("Invalid contributor active-work policy");
  }
}

function normalizeIssueNumbers(values) {
  if (!Array.isArray(values) || values.some((value) => !Number.isSafeInteger(value) || value < 1)) {
    throw new Error("Invalid active issue collection");
  }
  return [...new Set(values)].sort((a, b) => a - b);
}

export function isMaintainerAssociation(value) {
  return maintainerAssociations.has(value);
}

export function decideActiveWorkLimit({ policy, authorAssociation = "NONE", activeIssueNumbers = [] }) {
  validatePolicy(policy);
  const active = normalizeIssueNumbers(activeIssueNumbers);

  if (policy.maxActiveAssignments === 0) {
    return { allowed: true, reason: "disabled", activeIssueNumbers: active };
  }

  if (!policy.limitMaintainers && isMaintainerAssociation(authorAssociation)) {
    return { allowed: true, reason: "maintainer-exempt", activeIssueNumbers: active };
  }

  if (active.length < policy.maxActiveAssignments) {
    return { allowed: true, reason: "below-limit", activeIssueNumbers: active };
  }

  const references = active.map((number) => `#${number}`).join(", ");
  return {
    allowed: false,
    reason: "limit-reached",
    activeIssueNumbers: active,
    message: `RepoOps: you already have ${active.length} active RepoOps-managed issue${active.length === 1 ? "" : "s"} (${references}). The configured limit is ${policy.maxActiveAssignments}. Please finish one or use /unclaim before claiming another issue.`
  };
}
