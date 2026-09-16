const apiBase = "https://api.github.com";

export class GitHubClient {
  constructor({ token, repository }) {
    if (!token) throw new Error("GITHUB_TOKEN is required");
    if (!repository?.includes("/")) throw new Error("GITHUB_REPOSITORY must be owner/repo");

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
      throw new Error(`GitHub API failed ${response.status}: ${text}`);
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
    try {
      return await this.request(`/repos/${this.repository}/issues/${issueNumber}/labels/${encoded}`, {
        method: "DELETE"
      });
    } catch (error) {
      if (String(error?.message).includes("404")) return null;
      throw error;
    }
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
