import { readFile } from "node:fs/promises";

export const DEFAULT_CONFIG = Object.freeze({
  commands: Object.freeze({ claim: true, unclaim: true }),
  labels: Object.freeze({ inProgress: "status: in-progress", ready: "status: ready" }),
  assignments: Object.freeze({ reminderAfterDays: 3, expireAfterDays: 7, autoRelease: false }),
  contributorLimits: Object.freeze({ maxActiveAssignments: 0, limitMaintainers: false }),
  contributorGuidance: Object.freeze({
    enabled: true,
    requirements: "",
    setupCommand: "",
    checkCommand: "",
    contributingUrl: "",
    developmentUrl: "",
    architectureUrl: "",
    problemUrl: "",
    upgradeUrl: ""
  })
});

const allowedSections = new Set(["commands", "labels", "assignments", "contributorLimits", "contributorGuidance"]);
const allowedKeys = {
  commands: new Set(["claim", "unclaim"]),
  labels: new Set(["inProgress", "ready"]),
  assignments: new Set(["reminderAfterDays", "expireAfterDays", "autoRelease"]),
  contributorLimits: new Set(["maxActiveAssignments", "limitMaintainers"]),
  contributorGuidance: new Set([
    "enabled",
    "requirements",
    "setupCommand",
    "checkCommand",
    "contributingUrl",
    "developmentUrl",
    "architectureUrl",
    "problemUrl",
    "upgradeUrl"
  ])
};

function parseScalar(value, numeric = false) {
  const trimmed = value.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  if (numeric && /^-?\d+$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}

function validateGuidanceString(key, value) {
  if (typeof value !== "string" || value !== value.trim()) {
    throw new Error(`contributorGuidance.${key} must be a trimmed string`);
  }
  if (value.includes("`")) {
    throw new Error(`contributorGuidance.${key} must not contain backticks`);
  }
}

function validateGuidanceUrl(key, value) {
  validateGuidanceString(key, value);
  if (!value) return;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`contributorGuidance.${key} must be an absolute https URL`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`contributorGuidance.${key} must be an absolute https URL`);
  }
}

export function parseRepoOpsConfig(text = "") {
  const result = {
    commands: { ...DEFAULT_CONFIG.commands },
    labels: { ...DEFAULT_CONFIG.labels },
    assignments: { ...DEFAULT_CONFIG.assignments },
    contributorLimits: { ...DEFAULT_CONFIG.contributorLimits },
    contributorGuidance: { ...DEFAULT_CONFIG.contributorGuidance }
  };

  let section = null;
  const seen = new Set();
  const lines = text.split(/\r?\n/);

  for (const [index, rawLine] of lines.entries()) {
    if (!rawLine.trim() || rawLine.trimStart().startsWith("#")) continue;
    if (rawLine.includes("\t")) throw new Error(`.repoops.yml line ${index + 1}: tabs are not supported`);

    const indent = rawLine.match(/^ */)[0].length;
    const line = rawLine.trim();

    if (indent === 0) {
      if (!line.endsWith(":")) throw new Error(`.repoops.yml line ${index + 1}: expected a section`);
      section = line.slice(0, -1);
      if (!allowedSections.has(section)) throw new Error(`.repoops.yml line ${index + 1}: unknown section ${section}`);
      if (seen.has(section)) throw new Error(`Duplicate section ${section}`);
      seen.add(section);
      continue;
    }

    if (indent !== 2 || !section) throw new Error(`.repoops.yml line ${index + 1}: expected two-space indentation`);

    const separator = line.indexOf(":");
    if (separator === -1) throw new Error(`.repoops.yml line ${index + 1}: expected key: value`);

    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!allowedKeys[section].has(key)) throw new Error(`.repoops.yml line ${index + 1}: unknown ${section} key ${key}`);
    if (!value) throw new Error(`.repoops.yml line ${index + 1}: missing value for ${key}`);

    const path = `${section}.${key}`;
    if (seen.has(path)) throw new Error(`Duplicate key ${path}`);
    seen.add(path);
    const numeric =
      (section === "assignments" && key !== "autoRelease") ||
      (section === "contributorLimits" && key === "maxActiveAssignments");
    result[section][key] = parseScalar(value, numeric);
  }

  if (typeof result.commands.claim !== "boolean" || typeof result.commands.unclaim !== "boolean") {
    throw new Error(".repoops.yml command values must be true or false");
  }
  for (const [key, value] of Object.entries(result.labels)) {
    if (typeof value !== "string" || !value.trim() || value !== value.trim()) throw new Error(`.repoops.yml labels.${key} must be a non-empty trimmed string`);
  }
  if (result.labels.ready.toLowerCase() === result.labels.inProgress.toLowerCase()) throw new Error("Workflow labels must be distinct");
  for (const key of ["reminderAfterDays", "expireAfterDays"]) {
    const value = result.assignments[key];
    if (!Number.isSafeInteger(value) || value < 1 || value > 36500) throw new Error(`assignments.${key} must be an integer from 1 to 36500`);
  }
  if (result.assignments.expireAfterDays <= result.assignments.reminderAfterDays) throw new Error("expireAfterDays must exceed reminderAfterDays");
  if (typeof result.assignments.autoRelease !== "boolean") throw new Error("assignments.autoRelease must be true or false");

  if (!Number.isSafeInteger(result.contributorLimits.maxActiveAssignments) || result.contributorLimits.maxActiveAssignments < 0 || result.contributorLimits.maxActiveAssignments > 100) {
    throw new Error("contributorLimits.maxActiveAssignments must be an integer from 0 to 100");
  }
  if (typeof result.contributorLimits.limitMaintainers !== "boolean") {
    throw new Error("contributorLimits.limitMaintainers must be true or false");
  }

  if (typeof result.contributorGuidance.enabled !== "boolean") {
    throw new Error("contributorGuidance.enabled must be true or false");
  }
  for (const key of ["requirements", "setupCommand", "checkCommand"]) {
    validateGuidanceString(key, result.contributorGuidance[key]);
  }
  for (const key of ["contributingUrl", "developmentUrl", "architectureUrl", "problemUrl", "upgradeUrl"]) {
    validateGuidanceUrl(key, result.contributorGuidance[key]);
  }

  return result;
}

export async function loadRepoOpsConfig(path = ".repoops.yml") {
  try {
    return parseRepoOpsConfig(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        commands: { ...DEFAULT_CONFIG.commands },
        labels: { ...DEFAULT_CONFIG.labels },
        assignments: { ...DEFAULT_CONFIG.assignments },
        contributorLimits: { ...DEFAULT_CONFIG.contributorLimits },
        contributorGuidance: { ...DEFAULT_CONFIG.contributorGuidance }
      };
    }
    throw error;
  }
}
