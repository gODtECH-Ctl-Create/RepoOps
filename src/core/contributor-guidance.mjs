function link(label, url) {
  return url ? `- [${label}](${url})` : null;
}

export function buildClaimConfirmation({ actor, issueNumber, baseMessage, guidance }) {
  if (typeof baseMessage !== "string" || !baseMessage.trim()) {
    throw new Error("Claim confirmation requires a base message");
  }
  if (!guidance?.enabled) return baseMessage;
  if (typeof actor !== "string" || !actor.trim() || !Number.isSafeInteger(issueNumber) || issueNumber < 1) {
    throw new Error("Claim confirmation requires a valid actor and issue number");
  }

  const steps = [
    `- Fork (if needed) or clone the repository, then create a focused branch for #${issueNumber}.`,
    guidance.requirements ? `- Requirements: ${guidance.requirements}` : null,
    guidance.setupCommand ? `- Set up the project: \`${guidance.setupCommand}\`` : null,
    guidance.checkCommand ? `- Before opening your PR, run: \`${guidance.checkCommand}\`` : null,
    `- Open a pull request linked to #${issueNumber} and include useful test or validation evidence.`
  ].filter(Boolean);

  const guides = [
    link("Contributor guide", guidance.contributingUrl),
    link("Development guide", guidance.developmentUrl),
    link("Architecture", guidance.architectureUrl)
  ].filter(Boolean);

  const sections = [
    baseMessage,
    "",
    `Welcome, @${actor} — thanks for picking this up.`,
    "",
    "**Next steps**",
    ...steps
  ];

  if (guides.length) {
    sections.push("", "**Useful guides**", ...guides);
  }

  return sections.join("\n");
}

export function commentGuidanceMarker(actorId) {
  if (!Number.isSafeInteger(actorId) || actorId < 1) throw new Error("Comment guidance requires a valid actor id");
  return `<!-- repoops:comment-guidance:v1:${actorId} -->`;
}

export function buildCommentGuidance({ guidance }) {
  if (!guidance?.enabled) return null;

  const proposalLinks = [
    link("Propose a problem", guidance.problemUrl),
    link("Propose an upgrade", guidance.upgradeUrl)
  ].filter(Boolean);

  const lines = [
    "👋 Thanks for joining the discussion.",
    "",
    "Want to work on this issue? Comment:",
    "",
    "`/claim`",
    "",
    "RepoOps only treats the explicit `/claim` command as an ownership request. An ordinary comment does not reserve the issue."
  ];

  if (proposalLinks.length) {
    lines.push("", "Have something broader in mind?", ...proposalLinks);
  }

  return lines.join("\n");
}
