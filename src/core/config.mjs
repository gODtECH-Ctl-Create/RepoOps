import { readFile } from "node:fs/promises";

export const DEFAULT_CONFIG = Object.freeze({
  commands: Object.freeze({ claim: true, unclaim: true }),
  labels: Object.freeze({ inProgress: "status: in-progress" })
});

const allowedSections = new Set(["commands", "labels"]);
const allowedKeys = {
  commands: new Set(["claim", "unclaim"]),
  labels: new Set(["inProgress"])
};

function parseScalar(value) {
  const trimmed = value.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function parseRepoOpsConfig(text = "") {
  const result = {
    commands: { ...DEFAULT_CONFIG.commands },
    labels: { ...DEFAULT_CONFIG.labels }
  };

  let section = null;
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
      continue;
    }

    if (indent !== 2 || !section) throw new Error(`.repoops.yml line ${index + 1}: expected two-space indentation`);

    const separator = line.indexOf(":");
    if (separator === -1) throw new Error(`.repoops.yml line ${index + 1}: expected key: value`);

    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!allowedKeys[section].has(key)) throw new Error(`.repoops.yml line ${index + 1}: unknown ${section} key ${key}`);
    if (!value) throw new Error(`.repoops.yml line ${index + 1}: missing value for ${key}`);

    result[section][key] = parseScalar(value);
  }

  if (typeof result.commands.claim !== "boolean" || typeof result.commands.unclaim !== "boolean") {
    throw new Error(".repoops.yml command values must be true or false");
  }
  if (typeof result.labels.inProgress !== "string" || !result.labels.inProgress.trim()) {
    throw new Error(".repoops.yml labels.inProgress must be a non-empty string");
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
        labels: { ...DEFAULT_CONFIG.labels }
      };
    }
    throw error;
  }
}
