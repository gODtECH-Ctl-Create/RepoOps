const apiBase = "https://api.github.com";

function integerHeader(headers, name) {
  const value = headers?.get?.(name);
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function safeResponseMessage(text) {
  if (typeof text !== "string" || !text.length) return "";

  let message = text;
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed?.message === "string") message = parsed.message;
  } catch {
    // Fall back to bounded plain text when GitHub did not return JSON.
  }

  return message.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 500);
}

export class GitHubApiError extends Error {
  constructor({ status, responseMessage = "", requestId = null, retryAfterSeconds = null, rateLimitRemaining = null, rateLimitReset = null }) {
    super(`GitHub API failed ${status}${responseMessage ? `: ${responseMessage}` : ""}`);
    this.name = "GitHubApiError";
    this.status = status;
    this.responseMessage = responseMessage;
    this.requestId = requestId;
    this.retryAfterSeconds = retryAfterSeconds;
    this.rateLimitRemaining = rateLimitRemaining;
    this.rateLimitReset = rateLimitReset;
  }
}

export class GitHubNetworkError extends Error {
  constructor(cause) {
    super("GitHub network request failed", { cause });
    this.name = "GitHubNetworkError";
    this.code = typeof cause?.code === "string" ? cause.code : null;
  }
}

export class GitHubClient {
  constructor({ token, repository, botId = 41898282, fetchImpl = globalThis.fetch }) {
    if (!token) throw new Error("GITHUB_TOKEN is required");
    if (!repository?.includes("/")) throw new Error("GITHUB_REPOSITORY must be owner/repo");
    if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required");

    this.botId = botId;
    this.token = token;
    this.repository = repository;
    this.fetchImpl = fetchImpl;
  }

  requestHeaders(extra = {}) {
    return {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
      ...extra
    };
  }

  async fetchResponse(url, options = {}) {
    try {
      return await this.fetchImpl(url, options);
    } catch (error) {
      if (error instanceof GitHubNetworkError) throw error;
      throw new GitHubNetworkError(error);
    }
  }

  async apiError(response) {
    const text = await response.text();
    const requestId = response.headers?.get?.("x-github-request-id") ?? null;
    return new GitHubApiError({
      status: response.status,
      responseMessage: safeResponseMessage(text),
      requestId: typeof requestId === "string" ? requestId.slice(0, 200) : null,
      retryAfterSeconds: integerHeader(response.headers, "retry-after"),
      rateLimitRemaining: integerHeader(response.headers, "x-ratelimit-remaining"),
      rateLimitReset: integerHeader(response.headers, "x-ratelimit-reset")
    });
  }

  async request(path, options = {}) {
    const response = await this.fetchResponse(`${apiBase}${path}`, {
      ...options,
      headers: this.requestHeaders(options.headers ?? {})
    });

    if (!response.ok) throw await this.apiError(response);
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

  async updateIssue(issueNumber, { body } = {}) {
    if (!Number.isSafeInteger(issueNumber) || issueNumber < 1 || typeof body !== "string") {
      throw new Error("Invalid issue update");
    }
    return this.request("/repos/" + this.repository + "/issues/" + issueNumber, {
      method: "PATCH",
      body: JSON.stringify({ body })
    });
  }

  async reopenIssue(issueNumber) {
    if (!Number.isSafeInteger(issueNumber) || issueNumber < 1) throw new Error("Invalid issue reopen");
    return this.request("/repos/" + this.repository + "/issues/" + issueNumber, {
      method: "PATCH",
      body: JSON.stringify({ state: "open", state_reason: "reopened" })
    });
  }

  async ensureLabel(name, color = "1d76db", description = "Managed by RepoOps") {
    const encoded = encodeURIComponent(name);
    const lookup = await this.fetchResponse(`${apiBase}/repos/${this.repository}/labels/${encoded}`, {
      headers: this.requestHeaders()
    });

    if (lookup.ok) return;
    if (lookup.status !== 404) throw await this.apiError(lookup);

    await this.request(`/repos/${this.repository}/labels`, {
      method: "POST",
      body: JSON.stringify({ name, color, description })
    });
  }
}
