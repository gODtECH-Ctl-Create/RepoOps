import { loadRepoOpsConfig } from "../src/core/config.mjs";
import { GitHubClient } from "../src/github/client.mjs";
import { scanRepository } from "../src/github/stale-scanner.mjs";

const config = await loadRepoOpsConfig();
const dryInput = process.env.REPOOPS_DRY_RUN ?? "true";
if (!["true", "false"].includes(dryInput)) throw new Error("REPOOPS_DRY_RUN must be true or false");
const dryRun = dryInput === "true";
if (process.env.REPOOPS_NOW && !dryRun) throw new Error("Clock overrides are only allowed in dry runs");
const client = new GitHubClient({ token: process.env.GITHUB_TOKEN, repository: process.env.GITHUB_REPOSITORY });
const now = process.env.REPOOPS_NOW ?? new Date().toISOString();
const issueNumber = process.env.REPOOPS_ISSUE_NUMBER ? Number(process.env.REPOOPS_ISSUE_NUMBER) : undefined;
console.log(JSON.stringify({ now, dryRun, results: await scanRepository({ client, config, now, dryRun, issueNumber }) }, null, 2));
