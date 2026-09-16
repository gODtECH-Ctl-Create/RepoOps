import { GitHubClient } from "../src/github/client.mjs";
import { findLinkedPullRequests } from "../src/github/linked-pull-requests.mjs";
const issueNumber = Number(process.env.REPOOPS_ISSUE_NUMBER ?? process.argv[2]);
const client = new GitHubClient({ token: process.env.GITHUB_TOKEN, repository: process.env.GITHUB_REPOSITORY });
console.log(JSON.stringify(await findLinkedPullRequests(client, issueNumber), null, 2));
