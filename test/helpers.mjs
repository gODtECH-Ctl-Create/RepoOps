export function fakeClient() {
  const client = {
    repository: "owner/repo",
    botId: 41898282,
    issue: { id: 20, number: 2, state: "open", assignees: [], labels: [] }, comments: [], calls: [],
    getIssue: async () => structuredClone(client.issue),
    listComments: async () => structuredClone(client.comments),
    isOwnComment: (c) => c.user?.id === 41898282 && c.user?.type === "Bot",
    addComment: async (_n, body) => { const c = { id: client.comments.length + 1, body, user: { id: 41898282, type: "Bot" } }; client.comments.push(c); client.calls.push("comment"); return structuredClone(c); },
    updateComment: async (id, body) => { client.comments.find((c) => c.id === id).body = body; },
    assignIssue: async (_n, login) => { client.issue.assignees.push({ login }); client.calls.push("assign"); },
    removeAssignees: async (_n, logins) => { client.issue.assignees = client.issue.assignees.filter((a) => !logins.includes(a.login)); client.calls.push("unassign"); },
    ensureLabel: async () => {},
    addLabels: async (_n, labels) => { client.issue.labels.push(...labels.map((name) => ({ name }))); client.calls.push("add-label"); },
    removeLabel: async (_n, label) => { client.issue.labels = client.issue.labels.filter((l) => l.name !== label); client.calls.push("remove-label"); },
    request: async (path) => {
      if (path === "/graphql") {
        return {
          data: {
            repository: {
              issue: {
                closedByPullRequestsReferences: {
                  nodes: [],
                  pageInfo: { hasNextPage: false, endCursor: null }
                }
              }
            }
          }
        };
      }
      throw new Error(`Unexpected request ${path}`);
    }
  };
  return client;
}
export const event = (id = 1, body = "/claim") => ({ action: "created", repository: { id: 10 }, issue: { id: 20, number: 2 }, comment: { id, body, user: { id: 3, login: "alice" } } });
