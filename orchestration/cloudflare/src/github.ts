import type { AopLease, Env } from "./types";

const REPO = "PatrickFrome/Compute";
const API = "https://api.github.com";

function branchFor(lease: AopLease): string {
  const branch = lease.role_config?.branch;
  if (!branch) throw new Error("role_branch_missing");
  if (branch === "main") throw new Error("main_branch_write_forbidden");
  return branch;
}

async function gh(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  if (!env.GITHUB_TOKEN) throw new Error("github_token_unavailable");
  return fetch(`${API}${path}`, {
    ...init,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "x-github-api-version": "2022-11-28",
      "user-agent": "metaengine-aop1",
      ...(init.headers ?? {}),
    },
  });
}

export async function readFile(env: Env, lease: AopLease, path: string): Promise<Record<string, unknown>> {
  const branch = branchFor(lease);
  const res = await gh(env, `/repos/${REPO}/contents/${encodeURIComponent(path).replaceAll("%2F", "/")}?ref=${encodeURIComponent(branch)}`);
  if (!res.ok) throw new Error(`github_read_failed:${res.status}:${await res.text()}`);
  const body = (await res.json()) as Record<string, unknown>;
  if (body.type !== "file") throw new Error("github_path_not_file");
  return { path, branch, sha: body.sha, content: body.content, encoding: body.encoding };
}

export async function writeFile(env: Env, lease: AopLease, path: string, contentUtf8: string, message: string): Promise<Record<string, unknown>> {
  const branch = branchFor(lease);
  let sha: string | undefined;
  const existing = await gh(env, `/repos/${REPO}/contents/${encodeURIComponent(path).replaceAll("%2F", "/")}?ref=${encodeURIComponent(branch)}`);
  if (existing.ok) {
    const body = (await existing.json()) as Record<string, unknown>;
    if (body.type !== "file") throw new Error("github_path_not_file");
    sha = String(body.sha);
  } else if (existing.status !== 404) {
    throw new Error(`github_lookup_failed:${existing.status}:${await existing.text()}`);
  }

  const bytes = new TextEncoder().encode(contentUtf8);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  const encoded = btoa(binary);
  const res = await gh(env, `/repos/${REPO}/contents/${encodeURIComponent(path).replaceAll("%2F", "/")}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, content: encoded, branch, ...(sha ? { sha } : {}) }),
  });
  if (!res.ok) throw new Error(`github_write_failed:${res.status}:${await res.text()}`);
  const body = (await res.json()) as { commit?: { sha?: string }; content?: { sha?: string } };
  return { path, branch, commit_sha: body.commit?.sha ?? null, blob_sha: body.content?.sha ?? null };
}

export async function pullRequest(env: Env, number: number): Promise<Record<string, unknown>> {
  const res = await gh(env, `/repos/${REPO}/pulls/${number}`);
  if (!res.ok) throw new Error(`github_pr_failed:${res.status}:${await res.text()}`);
  const b = (await res.json()) as Record<string, unknown>;
  return {
    number: b.number, state: b.state, draft: b.draft, merged: b.merged, mergeable: b.mergeable,
    head: (b.head as Record<string, unknown> | undefined)?.sha,
    head_ref: (b.head as Record<string, unknown> | undefined)?.ref,
    base: (b.base as Record<string, unknown> | undefined)?.sha,
  };
}

export async function workflowRuns(env: Env, lease: AopLease): Promise<Record<string, unknown>> {
  const branch = branchFor(lease);
  const res = await gh(env, `/repos/${REPO}/actions/runs?branch=${encodeURIComponent(branch)}&per_page=20`);
  if (!res.ok) throw new Error(`github_runs_failed:${res.status}:${await res.text()}`);
  const body = (await res.json()) as { workflow_runs?: Array<Record<string, unknown>> };
  return {
    branch,
    runs: (body.workflow_runs ?? []).map((r) => ({
      id: r.id, name: r.name, event: r.event, status: r.status, conclusion: r.conclusion,
      head_sha: r.head_sha, created_at: r.created_at, updated_at: r.updated_at,
    })),
  };
}