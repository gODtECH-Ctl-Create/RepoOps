const query = `query RepoOpsLinkedPullRequests($owner: String!, $name: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      closedByPullRequestsReferences(first: 100, after: $cursor, includeClosedPrs: true) {
        nodes { id number url state isDraft mergedAt repository { nameWithOwner } }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`;

export async function findLinkedPullRequests(client, issueNumber) {
  if (!Number.isSafeInteger(issueNumber) || issueNumber < 1) throw new Error("Invalid issue number");
  const [owner, name, extra] = client.repository.split("/");
  if (!owner || !name || extra) throw new Error("Invalid repository");
  let cursor = null;
  const cursors = new Set();
  const found = new Map();
  do {
    const response = await client.request("/graphql", { method: "POST", body: JSON.stringify({ query, variables: { owner, name, number: issueNumber, cursor } }) });
    if (response?.errors?.length) throw new Error("GitHub GraphQL linked-PR query failed; results are incomplete");
    const connection = response?.data?.repository?.issue?.closedByPullRequestsReferences;
    if (!connection || !Array.isArray(connection.nodes) || typeof connection.pageInfo?.hasNextPage !== "boolean") throw new Error("Malformed GitHub linked-PR response");
    for (const pr of connection.nodes) {
      if (!pr || typeof pr.id !== "string" || !pr.id || !Number.isSafeInteger(pr.number) || pr.number < 1 || typeof pr.url !== "string" || !pr.url.startsWith("https://github.com/") || !["OPEN", "CLOSED", "MERGED"].includes(pr.state) || typeof pr.isDraft !== "boolean" || typeof pr.repository?.nameWithOwner !== "string" || !pr.repository.nameWithOwner.includes("/") || !(pr.mergedAt === null || (typeof pr.mergedAt === "string" && Number.isFinite(Date.parse(pr.mergedAt)))) || (pr.state === "MERGED") !== (pr.mergedAt !== null)) throw new Error("Malformed linked pull request");
      const normalized = { id: pr.id, number: pr.number, repository: pr.repository.nameWithOwner, url: pr.url, state: pr.state.toLowerCase(), isDraft: pr.isDraft, mergedAt: pr.mergedAt };
      if (found.has(pr.id) && JSON.stringify(found.get(pr.id)) !== JSON.stringify(normalized)) throw new Error("Linked pull request changed during pagination; retry collection");
      found.set(pr.id, normalized);
    }
    if (!connection.pageInfo.hasNextPage) break;
    cursor = connection.pageInfo.endCursor;
    if (typeof cursor !== "string" || !cursor || cursors.has(cursor)) throw new Error("Invalid GitHub pagination cursor");
    cursors.add(cursor);
  } while (true);
  const pullRequests = [...found.values()].sort((a, b) => a.repository.localeCompare(b.repository, "en") || a.number - b.number);
  return { relationship: "github-closing-reference", pullRequests, open: pullRequests.filter((p) => p.state === "open"), merged: pullRequests.filter((p) => p.state === "merged"), closed: pullRequests.filter((p) => p.state === "closed") };
}
