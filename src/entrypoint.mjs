import { readFile } from "node:fs/promises";

import { runRepoOps } from "./index.mjs";

async function readEvent() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) throw new Error("GITHUB_EVENT_PATH is required");
  return JSON.parse(await readFile(eventPath, "utf8"));
}

async function main() {
  await runRepoOps(await readEvent());
}

main().catch((error) => {
  console.error(`RepoOps failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
