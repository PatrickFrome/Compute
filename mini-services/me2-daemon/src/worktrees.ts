// ME2 M4-lite — Worktree Manager (real git worktrees, dev-plane capability).
// Worktrees live OUTSIDE the Next.js dev tree (/home/z/me2-worktrees/<name>)
// so turbopack never watches them. Safety: strict name whitelist, cap of 8
// managed worktrees, removal restricted to the managed prefix, 10s timeouts.
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";

export const REPO_ROOT = "/home/z/my-project";
export const WORKTREE_ROOT = "/home/z/me2-worktrees";

const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,31}$/;
const MAX_WORKTREES = 8;
const GIT_TIMEOUT_MS = 10_000;

export interface WorktreeRow {
  name: string;
  path: string;
  branch: string;
  head: string;
  managed: boolean;
}

function git(args: string[], cwd = REPO_ROOT): { ok: boolean; out: string; err: string; code: number } {
  try {
    const p = spawnSync("git", args, { cwd, timeout: GIT_TIMEOUT_MS, encoding: "utf8" });
    return {
      ok: p.status === 0,
      out: (p.stdout ?? "").trim(),
      err: ((p.stderr ?? "") || "").trim(),
      code: p.status ?? -1,
    };
  } catch (e) {
    return { ok: false, out: "", err: e instanceof Error ? e.message : String(e), code: -1 };
  }
}

function gitFail(r: { err: string; out: string; code: number }): never {
  throw new Error("GIT_FAIL[" + r.code + "]: " + (r.err || r.out || "unknown").slice(0, 220));
}

export function listWorktrees(): { worktrees: WorktreeRow[]; error?: string } {
  const r = git(["worktree", "list", "--porcelain"]);
  if (!r.ok) return { worktrees: [], error: r.err || `git exit ${r.code}` };
  const rows: WorktreeRow[] = [];
  let path = "";
  let head = "";
  let branch = "";
  let bare = false;
  const flush = () => {
    if (!path) return;
    const parts = path.split("/").filter(Boolean);
    rows.push({
      name: parts[parts.length - 1] ?? path,
      path,
      branch: branch || "(detached)",
      head: head.slice(0, 10),
      managed: path.startsWith(WORKTREE_ROOT + "/"),
    });
    path = "";
    head = "";
    branch = "";
    bare = false;
  };
  for (const line of r.out.split("\n")) {
    if (line.startsWith("worktree ")) {
      flush();
      path = line.slice(9);
    } else if (line.startsWith("HEAD ")) head = line.slice(5);
    else if (line.startsWith("branch ")) branch = line.slice(7).replace("refs/heads/", "");
    else if (line === "bare") bare = true;
  }
  flush();
  void bare;
  return { worktrees: rows };
}

export function createWorktree(rawName: string): { name: string; path: string; branch: string } {
  const name = String(rawName ?? "").trim().toLowerCase();
  if (!NAME_RE.test(name)) throw new Error("BAD_NAME: expected ^[a-z0-9][a-z0-9._-]{0,31}$");
  const { worktrees } = listWorktrees();
  const managed = worktrees.filter((w) => w.managed);
  if (managed.length >= MAX_WORKTREES) throw new Error(`WORKTREE_CAP_REACHED (${MAX_WORKTREES})`);
  if (managed.some((w) => w.name === name)) throw new Error("WORKTREE_EXISTS: " + name);
  mkdirSync(WORKTREE_ROOT, { recursive: true });
  const path = `${WORKTREE_ROOT}/${name}`;
  const branch = `me2/${name}`;
  const r = git(["worktree", "add", "-b", branch, path]);
  if (!r.ok) gitFail(r);
  return { name, path, branch };
}

export function removeWorktree(rawName: string): { removed: string; path: string } {
  const name = String(rawName ?? "").trim().toLowerCase();
  if (!NAME_RE.test(name)) throw new Error("BAD_NAME: expected ^[a-z0-9][a-z0-9._-]{0,31}$");
  const path = `${WORKTREE_ROOT}/${name}`;
  if (!path.startsWith(WORKTREE_ROOT + "/")) throw new Error("ESCALATION_BLOCKED");
  const r = git(["worktree", "remove", "--force", path]);
  if (!r.ok) gitFail(r);
  return { removed: name, path };
}

export function pruneWorktrees(): { pruned: boolean } {
  const r = git(["worktree", "prune"]);
  if (!r.ok) gitFail(r);
  return { pruned: true };
}

export function repoHead(): { head: string; branch: string; root: string } {
  const h = git(["rev-parse", "--short=10", "HEAD"]);
  const b = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  return { head: h.out || "?", branch: b.out || "?", root: REPO_ROOT };
}
