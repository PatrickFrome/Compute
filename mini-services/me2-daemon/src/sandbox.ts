// Sandboxed command execution.
// R17 lesson: RLIMIT_NPROC is per-UID — never use it in a multi-process env.
// Isolation here: prlimit --as=1GiB --nofile=256 --core=0, exact-match whitelist,
// 10s timeout, 256 KiB output cap.
import { spawnSync } from "node:child_process";
import { OpError } from "./errors";
import { appendEvent } from "./eventlog";
import { REPO_ROOT } from "./worktrees";

type Cmd = string[];

const WHITELIST: Cmd[] = [
  ["bun", "--version"],
  ["node", "--version"],
  ["python3", "--version"],
  ["git", "status", "--short"],
  ["git", "rev-parse", "HEAD"],
  ["git", "log", "--oneline", "-5"],
  ["git", "worktree", "list"],
  ["echo", "me2-sandbox-proof"],
];

const LIMITS = ["--as=1073741824", "--nofile=256", "--core=0"];

export interface ExecResult {
  cmd: Cmd;
  ok: boolean;
  exit_code: number | null;
  stdout: string;
  stderr: string;
  elapsed_ms: number;
  limits: string[];
}

export function whitelist(): string[] {
  return WHITELIST.map((c) => c.join(" "));
}

export function execWhitelisted(cmd: Cmd, opts?: { silent?: boolean }): ExecResult {
  if (!Array.isArray(cmd) || cmd.length === 0 || !cmd.every((x) => typeof x === "string")) {
    throw new OpError("sandbox_cmd_invalid", "cmd must be a non-empty array of strings");
  }
  const allowed = WHITELIST.some((w) => w.length === cmd.length && w.every((x, i) => x === cmd[i]));
  if (!allowed) {
    throw new OpError("sandbox_cmd_not_whitelisted", `not in whitelist: ${cmd.join(" ")}`, 403);
  }
  const t0 = Date.now();
  const r = spawnSync("prlimit", [...LIMITS, "--", ...cmd], {
    cwd: REPO_ROOT,
    timeout: 10_000,
    maxBuffer: 262144,
    encoding: "utf8",
  });
  const elapsed_ms = Date.now() - t0;
  const timedOut = (r.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";
  if (r.error && !timedOut) {
    throw new OpError("sandbox_spawn_failed", String(r.error), 500);
  }
  // R81 lesson: internal probes (verdicts) must stay silent — operator-triggered
  // execs are the only ones that belong in the evidence log (no event spam).
  if (!opts?.silent) {
    appendEvent("SANDBOX_EXEC", "daemon", cmd.join(" "), {
      ok: r.status === 0,
      exit_code: r.status,
      elapsed_ms,
      timed_out: timedOut,
    });
  }
  return {
    cmd,
    ok: r.status === 0 && !timedOut,
    exit_code: timedOut ? null : r.status,
    stdout: (r.stdout || "").slice(0, 65536),
    stderr: (r.stderr || "").slice(0, 65536),
    elapsed_ms,
    limits: LIMITS,
  };
}

export function probe(): ExecResult & { proof: string } {
  const r = execWhitelisted(["bun", "--version"], { silent: true });
  return { ...r, proof: `prlimit-isolated bun exec ok in ${r.elapsed_ms}ms` };
}
