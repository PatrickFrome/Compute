// Whitelisted git worktree operations (spawnSync wrappers, protocol style).
// Names are whitelisted; no arbitrary paths; machine-coded errors.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { OpError } from "./errors";
import { appendEvent } from "./eventlog";

export const REPO_ROOT = "/home/z/my-project";
const WORKTREE_DIR = join(REPO_ROOT, ".worktrees");
const NAME_RE = /^wt-[a-z0-9][a-z0-9-]{1,31}$/;

function git(args: string[]) {
  const r = spawnSync("git", args, { cwd: REPO_ROOT, timeout: 15_000, maxBuffer: 1 << 20, encoding: "utf8" });
  return { ok: r.status === 0, stdout: (r.stdout || "").trim(), stderr: (r.stderr || "").trim() };
}

export interface WorktreeInfo {
  path: string;
  head: string;
  branch: string | null;
  bare: boolean;
  detached: boolean;
}

export function listWorktrees(): WorktreeInfo[] {
  const r = git(["worktree", "list", "--porcelain"]);
  if (!r.ok) throw new OpError("worktree_list_failed", r.stderr || "git worktree list failed", 500);
  const out: WorktreeInfo[] = [];
  let cur: Partial<WorktreeInfo> | null = null;
  for (const line of r.stdout.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (cur && cur.path) out.push(cur as WorktreeInfo);
      cur = { path: line.slice(9).trim() };
    } else if (cur && line.startsWith("HEAD ")) cur.head = line.slice(5).trim();
    else if (cur && line.startsWith("branch ")) cur.branch = line.slice(7).trim();
    else if (cur && line === "bare") cur.bare = true;
    else if (cur && line === "detached") cur.detached = true;
  }
  if (cur && cur.path) out.push(cur as WorktreeInfo);
  return out;
}

export function createWorktree(name: string): WorktreeInfo {
  if (typeof name !== "string" || !NAME_RE.test(name)) {
    throw new OpError("worktree_name_invalid", `name must match ${NAME_RE}`);
  }
  if (existsSync(join(WORKTREE_DIR, name))) {
    throw new OpError("worktree_exists", `worktree path already exists: ${name}`);
  }
  const branch = `work/${name}`;
  const r = git(["worktree", "add", "-b", branch, join(WORKTREE_DIR, name)]);
  if (!r.ok) throw new OpError("worktree_create_failed", r.stderr || "git worktree add failed", 500);
  appendEvent("WORKTREE_CREATED", "daemon", name, { branch, base: "HEAD" });
  const all = listWorktrees();
  const created = all.find((w) => w.path === join(WORKTREE_DIR, name));
  if (!created) throw new OpError("worktree_create_unverified", "worktree not visible after create", 500);
  return created;
}

export function removeWorktree(name: string): { removed: string } {
  if (typeof name !== "string" || !NAME_RE.test(name)) {
    throw new OpError("worktree_name_invalid", `name must match ${NAME_RE}`);
  }
  const target = join(WORKTREE_DIR, name);
  if (!existsSync(target)) {
    throw new OpError("worktree_not_found", `no worktree named ${name}`);
  }
  const r = git(["worktree", "remove", target]);
  if (!r.ok) {
    // dirty worktree → fail-closed, no --force here
    throw new OpError("worktree_remove_failed", r.stderr || "git worktree remove failed (dirty?)", 409);
  }
  appendEvent("WORKTREE_REMOVED", "daemon", name, { branch: `work/${name}` });
  return { removed: name };
}
