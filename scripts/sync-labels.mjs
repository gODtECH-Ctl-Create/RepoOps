import { readFile } from "node:fs/promises";

const apiBase = "https://api.github.com";
const token = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;

if (!token) throw new Error("GITHUB_TOKEN is required");
if (!repository?.includes("/")) throw new Error("GITHUB_REPOSITORY must be owner/repo");

const headers = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json"
};

async function request(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: { ...headers, ...(options.headers ?? {}) }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API failed ${response.status}: ${text}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

const desired = JSON.parse(await readFile(".github/labels.json", "utf8"));
const names = new Set();

for (const label of desired) {
  if (!label?.name || !/^[0-9a-fA-F]{6}$/.test(label.color ?? "")) {
    throw new Error(`Invalid label definition: ${JSON.stringify(label)}`);
  }
  if (names.has(label.name)) throw new Error(`Duplicate label definition: ${label.name}`);
  names.add(label.name);
}

const existing = await request(`/repos/${repository}/labels?per_page=100`);
const byName = new Map(existing.map((label) => [label.name, label]));

for (const label of desired) {
  const current = byName.get(label.name);

  if (!current) {
    await request(`/repos/${repository}/labels`, {
      method: "POST",
      body: JSON.stringify(label)
    });
    console.log(`created: ${label.name}`);
    continue;
  }

  const description = label.description ?? "";
  if (current.color.toLowerCase() === label.color.toLowerCase() && (current.description ?? "") === description) {
    console.log(`unchanged: ${label.name}`);
    continue;
  }

  await request(`/repos/${repository}/labels/${encodeURIComponent(label.name)}`, {
    method: "PATCH",
    body: JSON.stringify(label)
  });
  console.log(`updated: ${label.name}`);
}
