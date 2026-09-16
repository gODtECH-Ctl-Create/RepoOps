const query = `query RepoOpsClosingIssues($owner: String!, $name: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      closingIssuesReferences(first: 100, after: $cursor) {
        nodes { number repository { nameWithOwner } }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`;

export async function findClosingIssuesForPullRequest(client, pullRequestNumber) {
  if (!Number.isSafeInteger(pullRequestNumber) || pullRequestNumber < 1) throw new Error("Invalid pull request number");
  const [owner, name, extra] = client.repository.split("/");
  if (!owner || !name || extra) throw new Error("Invalid repository");

  const found = new Map();
  const cursors = new Set();
  let cursor = null;
  do {
    const response = await client.request("/graphql", {
      method: "POST",
      body: JSON.stringify({ query, variables: { owner, name, number: pullRequestNumber, cursor } })
    });
    if (response?.errors?.length) throw new Error("GitHub GraphQL closing-issue query failed; results are incomplete");
    const connection = response?.data?.repository?.pullRequest?.closingIssuesReferences;
    if (!connection || !Array.isArray(connection.nodes) || typeof connection.pageInfo?.hasNextPage !== "boolean") throw new Error("Malformed GitHub closing-issue response");

    for (const issue of connection.nodes) {
      if (!issue || !Number.isSafeInteger(issue.number) || issue.number < 1 || typeof issue.repository?.nameWithOwner !== "string" || !issue.repository.nameWithOwner.includes("/")) throw new Error("Malformed closing issue");
      const normalized = { number: issue.number, repository: issue.repository.nameWithOwner };
      const key = `${normalized.repository}#${normalized.number}`;
      if (found.has(key) && JSON.stringify(found.get(key)) !== JSON.stringify(normalized)) throw new Error("Closing issue changed during pagination; retry collection");
      found.set(key, normalized);
    }

    if (!connection.pageInfo.hasNextPage) break;
    cursor = connection.pageInfo.endCursor;
    if (typeof cursor !== "string" || !cursor || cursors.has(cursor)) throw new Error("Invalid GitHub pagination cursor");
    cursors.add(cursor);
  } while (true);

  return [...found.values()].sort((a, b) => a.repository.localeCompare(b.repository, "en") || a.number - b.number);
}
