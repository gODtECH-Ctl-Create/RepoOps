import { readFile } from "node:fs/promises";

const actionPath = new URL("../action.yml", import.meta.url);
const action = await readFile(actionPath, "utf8");

const requiredFragments = [
  "name: RepoOps",
  "runs:",
  "using: composite",
  "uses: actions/setup-node@v4",
  'node-version: "20"',
  "GITHUB_TOKEN:",
  "github.token",
  'GITHUB_ACTION_PATH}/src/index.mjs'
];

for (const fragment of requiredFragments) {
  if (!action.includes(fragment)) {
    throw new Error(`action.yml is missing required fragment: ${fragment}`);
  }
}

if (action.includes("permissions:") || action.includes("secrets:")) {
  throw new Error("action.yml must not declare repository-level permissions or secrets");
}

console.log("RepoOps reusable Action metadata is valid.");
