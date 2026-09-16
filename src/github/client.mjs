const apiBase = "https://api.github.com";

export class GitHubClient {
  constructor({ token, repository, botId = 41898282 }) {
    if (!token) throw new Error("GITHUB_TOKEN is required");
    if (!repository?.includes("/")) throw new Error("GITHUB_REPOSITORY must be owner/repo");

    this.botId = botId;
    this.token = token;
    this.repository = repository;
  }

  async request(path, options = {}) {
    const response = await fetch(`${apiBase}${path}`, {
      ...options,
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        ...(options.headers ?? {})
      }
    });

    if (!response.ok) {
      const text = await response.text();
      const error = new Error(`GitHub API failed ${response.status}: ${text}`);
      error.status = response.status;
      throw error;
    }

    if (response.status === 204) return null;
    return response.json();
  }

  assignIssue(issueNumber, login) {
    return this.request(`/repos/${this.repository}/issues/${issueNumber}/assignees`, {
      method: "POST",
      body: JSON.stringify({ assignees: [login] })
    });
  }

  removeAssignees(issueNumber, logins) {
    if (!logins.length) return Promise.resolve(null);
    return this.request(`/repos/${this.repository}/issues/${issueNumber}/assignees`, {
      method: "DELETE",
      body: JSON.stringify({ assignees: logins })
    });
  }

  addLabels(issueNumber, labels) {
    return this.request(`/repos/${this.repository}/issues/${issueNumber}/labels`, {
      method: "POST",
      body: JSON.stringify({ labels })
    });
  }

  async removeLabel(issueNumber, label) {
    const encoded = encodeURIComponent(label);
    return this.request(`/repos/${this.repository}/issues/${issueNumber}/labels/${encoded}`, {
      method: "DELETE"
    });
  }

  async getIssue(issueNumber) {
    const issue = await this.request(`/repos/${this.repository}/issues/${issueNumber}`);
    if (!issue || !["open", "closed"].includes(issue.state) || !Array.isArray(issue.assignees) || issue.assignees.some((a) => typeof a?.login !== "string") || !Array.isArray(issue.labels) || issue.labels.some((l) => typeof (typeof l === "string" ? l : l?.name) !== "string")) throw new Error("Malformed GitHub issue response");
    return issue;
  }

  async paginate(path) {
    const result = [];
    for (let page = 1; ; page++) {
      const items = await this.request(`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
      if (!Array.isArray(items)) throw new Error("Malformed GitHub paginated response");
      result.push(...items);
      if (items.length < 100) return result;
    }
  }

  async listComments(issueNumber) {
    const comments = await this.paginate(`/repos/${this.repository}/issues/${issueNumber}/comments`);
    if (comments.some((c) => !Number.isSafeInteger(c?.id) || typeof c.body !== "string" || !Number.isSafeInteger(c.user?.id))) throw new Error("Malformed GitHub comment response");
    return comments;
  }

  isOwnComment(comment) { return comment?.user?.id === this.botId && comment?.user?.type === "Bot"; }

  updateComment(commentId, body) {
    return this.request(`/repos/${this.repository}/issues/comments/${commentId}`, { method: "PATCH", body: JSON.stringify({ body }) });
  }

  addComment(issueNumber, body) {
    return this.request(`/repos/${this.repository}/issues/${issueNumber}/comments`, {
      method: "POST",
      body: JSON.stringify({ body })
    });
  }

  async ensureLabel(name, color = "1d76db", description = "Managed by RepoOps") {
    const encoded = encodeURIComponent(name);

    const lookup = await fetch(`${apiBase}/repos/${this.repository}/labels/${encoded}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        Authorization: `Bearer ${this.token}`
      }
    });

    if (lookup.ok) return;
    if (lookup.status !== 404) {
      const text = await lookup.text();
      throw new Error(`GitHub API failed ${lookup.status}: ${text}`);
    }

    await this.request(`/repos/${this.repository}/labels`, {
      method: "POST",
      body: JSON.stringify({ name, color, description })
    });
  }
}
