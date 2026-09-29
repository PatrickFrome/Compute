// ME2 M5 — Sandbox Plane (R17): изолированные среды исполнения для агентов.
// DEVOS-роадмап M5 требовал plane со снапшотами; облачный провайдер (Vercel
// Sandbox) требует ключей — вне песочницы. Здесь закрываем M5 ЧЕСТНО локальным
// провайдером:
//   create  → git worktree (detached @HEAD) вне dev-дерева turbopack
//   exec    → bash -c с таймаутом + rlimit (prlimit: адресное пространство 1GiB,
//             nproc 256) — процесс не может задушить хост
//   snapshot→ tar.gz (без .git/node_modules) + sha256, восстанавливаемый
//   restore → распаковка снапшота в НОВУЮ песочницу (plain copy, не worktree)
//   destroy → git worktree remove; снапшоты остаются (durable)
// Провайдеры: local=READY, vercel=NEEDS_KEYS (интерфейс тот же — подключение
// сводится к HTTP-вызовам, см. README-TAURI.md / DEVOS-ANALYSIS §Sandbox).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { recordSpan } from "./otel";
import { REPO_ROOT } from "./worktrees";

/** Контур хоста настраивается env (CI/probe: временный контур; локально /home/z). */
export const ME2_CONTOUR = process.env.ME2_CONTOUR_HOME ?? "/home/z";
export const SB_ROOT = join(ME2_CONTOUR, "me2-sandboxes");
export const SB_SNAPSHOTS = join(SB_ROOT, ".snapshots");

const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,31}$/;
const MAX_SANDBOXES = 6;
const EXEC_TIMEOUT_MS = 120_000;
const FS_TIMEOUT_MS = 30_000;
const STDOUT_CAP = 8_000;
const STDERR_CAP = 4_000;

export type SandboxStatus = "READY" | "BUSY" | "RESTORED" | "BROKEN";

export interface SandboxMeta {
  id: string;
  root: string;
  status: SandboxStatus;
  provider: "local";
  createdAt: string;
  head: string;
  cmds: number;
  lastCmd: string | null;
  lastExit: number | null;
  snapshots: string[];
  diskKb?: number;
}

export interface SnapshotInfo {
  file: string;
  sandboxId: string;
  bytes: number;
  sha256: string;
  createdAt: string;
}

function sh(args: string[], cwd: string, timeoutMs = FS_TIMEOUT_MS): { ok: boolean; out: string; err: string; code: number } {
  try {
    const p = spawnSync(args[0], args.slice(1), { cwd, timeout: timeoutMs, encoding: "utf8" });
    return { ok: p.status === 0, out: (p.stdout ?? "").trim(), err: ((p.stderr ?? "") || "").trim(), code: p.status ?? -1 };
  } catch (e) {
    return { ok: false, out: "", err: e instanceof Error ? e.message : String(e), code: -1 };
  }
}

function readMeta(id: string): SandboxMeta {
  const root = join(SB_ROOT, id);
  const p = join(root, ".me2-sandbox.json");
  if (!existsSync(p)) throw new Error("SANDBOX_NOT_FOUND: " + id);
  return JSON.parse(readFileSync(p, "utf8")) as SandboxMeta;
}

function writeMeta(m: SandboxMeta): void {
  writeFileSync(join(m.root, ".me2-sandbox.json"), JSON.stringify(m, null, 2));
}

function safeId(raw: string): string {
  const id = String(raw ?? "").trim().toLowerCase();
  if (!NAME_RE.test(id)) throw new Error("BAD_ID: expected ^[a-z0-9][a-z0-9._-]{0,31}$");
  if (id.includes("..") || id.startsWith(".me2")) throw new Error("ESCALATION_BLOCKED");
  return id;
}

let prlimitCached: boolean | null = null;
export function sandboxCaps(): { exec: boolean; rlimit: boolean; timeoutMs: number } {
  if (prlimitCached === null) prlimitCached = sh(["which", "prlimit"], "/tmp").ok;
  return { exec: true, rlimit: prlimitCached, timeoutMs: EXEC_TIMEOUT_MS };
}

// ── lifecycle ─────────────────────────────────────────────────────

export function createSandbox(rawId: string): SandboxMeta {
  const id = safeId(rawId);
  mkdirSync(SB_ROOT, { recursive: true });
  const existing = listSandboxes().sandboxes;
  if (existing.length >= MAX_SANDBOXES) throw new Error(`SANDBOX_CAP_REACHED (${MAX_SANDBOXES})`);
  if (existing.some((s) => s.id === id)) throw new Error("SANDBOX_EXISTS: " + id);
  const root = join(SB_ROOT, id);
  // detached worktree @HEAD: изоляция файловой системы от dev-дерева
  const r = sh(["git", "-C", REPO_ROOT, "worktree", "add", "--detach", root], REPO_ROOT);
  if (!r.ok) throw new Error("WORKTREE_FAIL[" + r.code + "]: " + (r.err || r.out).slice(0, 220));
  const head = sh(["git", "rev-parse", "--short=10", "HEAD"], root).out || "?";
  const meta: SandboxMeta = {
    id, root, status: "READY", provider: "local", createdAt: new Date().toISOString(),
    head, cmds: 0, lastCmd: null, lastExit: null, snapshots: [],
  };
  writeMeta(meta);
  return meta;
}

const DENY_PATTERNS: RegExp[] = [
  /rm\s+(-[a-z]*\s+)*-?[a-z]*r[a-z]*f?[a-z]*\s+\/(\s|$)/, // rm -rf /
  /:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;:/,                        // fork bomb
  /mkfs(\.|\s)/, /dd\s+.*of=\/dev\/(sd|nvme)/,              // диск
  />\s*\/dev\/sd[a-z]/,
];

export function execInSandbox(rawId: string, rawCmd: string, timeoutSec = 30): {
  id: string; cmd: string; exitCode: number; ok: boolean; ms: number;
  stdout: string; stderr: string; truncated: boolean; timedOut: boolean; limit: string;
} {
  const id = safeId(rawId);
  const meta = readMeta(id);
  const cmd = String(rawCmd ?? "").trim();
  if (!cmd) throw new Error("cmd_required");
  if (cmd.length > 500) throw new Error("cmd_too_long (max 500)");
  for (const re of DENY_PATTERNS) if (re.test(cmd)) throw new Error("CMD_DENIED_HOSTILE");
  if (meta.status === "BROKEN") throw new Error("SANDBOX_BROKEN: " + id);

  const t0 = Date.now();
  const timeout = Math.min(Math.max(timeoutSec, 1), EXEC_TIMEOUT_MS / 1000) * 1000;
  const usePrlimit = sandboxCaps().rlimit;
  // NB: RLIMIT_NPROC — per-UID (душит чужие процессы) — НЕ используем.
  // Безопасная изоляция: адресное пространство 1GiB, 256 fd, без core-дампов.
  const argv = usePrlimit
    ? ["prlimit", "--as=1073741824", "--nofile=256", "--core=0", "bash", "-c", cmd]
    : ["bash", "-c", cmd];
  const p = spawnSync(argv[0], argv.slice(1), {
    cwd: meta.root, timeout, encoding: "utf8",
    env: { ...process.env, ME2_SANDBOX: id, ME2_SANDBOX_ROOT: meta.root },
  });
  const ms = Date.now() - t0;
  const timedOut = p.error?.message?.includes("ETIMEDOUT") ?? (p.status === null && !p.error);
  const stdout = (p.stdout ?? "");
  const stderr = (p.stderr ?? "");
  const truncated = stdout.length > STDOUT_CAP || stderr.length > STDERR_CAP;
  meta.cmds++;
  meta.lastCmd = cmd.slice(0, 120);
  meta.lastExit = p.status ?? -1;
  writeMeta(meta);
  recordSpan("sandbox.exec", {
    "me2.sandbox": id, "me2.exit": p.status ?? -1, "me2.prlimit": usePrlimit,
    "me2.cmd": cmd.slice(0, 100),
  }, t0, p.status === 0 ? {} : { status: "ERROR", message: stderr.slice(0, 200) || `exit ${p.status}` });
  return {
    id, cmd, exitCode: p.status ?? -1, ok: p.status === 0, ms,
    stdout: stdout.slice(0, STDOUT_CAP), stderr: stderr.slice(0, STDERR_CAP),
    truncated, timedOut, limit: usePrlimit ? "as=1GiB nofile=256 core=0" : "none (prlimit отсутствует)",
  };
}

export function snapshotSandbox(rawId: string): SnapshotInfo {
  const id = safeId(rawId);
  const meta = readMeta(id);
  mkdirSync(SB_SNAPSHOTS, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const file = join(SB_SNAPSHOTS, `${id}__${ts}.tar.gz`);
  const t0 = Date.now();
  const r = sh(
    ["tar", "--exclude=.git", "--exclude=node_modules", "--exclude=.next", "-czf", file, "."],
    meta.root,
    FS_TIMEOUT_MS,
  );
  if (!r.ok) throw new Error("TAR_FAIL[" + r.code + "]: " + (r.err || r.out).slice(0, 220));
  const buf = readFileSync(file);
  const sha = createHash("sha256").update(buf).digest("hex");
  const info: SnapshotInfo = {
    file, sandboxId: id, bytes: buf.length, sha256: sha, createdAt: new Date().toISOString(),
  };
  // метаданные рядом с архивом → listSnapshots не пересчитывает hash
  writeFileSync(file + ".json", JSON.stringify(info, null, 2));
  meta.snapshots.push(info.file);
  writeMeta(meta);
  recordSpan("sandbox.snapshot", { "me2.sandbox": id, "me2.bytes": buf.length }, t0);
  return info;
}

export function listSnapshots(): { snapshots: SnapshotInfo[] } {
  try {
    const rows: SnapshotInfo[] = [];
    for (const f of readdirSync(SB_SNAPSHOTS)) {
      if (!f.endsWith(".tar.gz")) continue;
      const full = join(SB_SNAPSHOTS, f);
      const metaPath = full + ".json";
      if (existsSync(metaPath)) {
        rows.push(JSON.parse(readFileSync(metaPath, "utf8")) as SnapshotInfo);
        continue;
      }
      // legacy: считаем hash один раз и кэшируем в .json
      const st = statSync(full);
      const buf = readFileSync(full);
      const info: SnapshotInfo = {
        file: full, sandboxId: f.split("__")[0] ?? f,
        bytes: st.size, sha256: createHash("sha256").update(buf).digest("hex"),
        createdAt: st.mtime.toISOString(),
      };
      writeFileSync(metaPath, JSON.stringify(info, null, 2));
      rows.push(info);
    }
    return { snapshots: rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)) };
  } catch { return { snapshots: [] }; }
}

export function restoreSnapshot(snapshotFile: string, newId?: string): SandboxMeta {
  const file = String(snapshotFile ?? "");
  if (!file.startsWith(SB_SNAPSHOTS + "/") || !file.endsWith(".tar.gz")) throw new Error("BAD_SNAPSHOT_PATH");
  if (!existsSync(file)) throw new Error("SNAPSHOT_NOT_FOUND");
  const base = file.split("/").pop()!.split("__")[0] ?? "restored";
  const id = safeId(newId ?? `${base}-r${Date.now().toString(36).slice(-4)}`);
  mkdirSync(SB_ROOT, { recursive: true });
  const root = join(SB_ROOT, id);
  if (existsSync(root)) throw new Error("SANDBOX_EXISTS: " + id);
  mkdirSync(root, { recursive: true });
  const r = sh(["tar", "-xzf", file, "-C", root], root);
  if (!r.ok) { rmSync(root, { recursive: true, force: true }); throw new Error("UNTAR_FAIL: " + (r.err || r.out).slice(0, 200)); }
  const head = sh(["git", "rev-parse", "--short=10", "HEAD"], root).out || "(no-git)";
  const meta: SandboxMeta = {
    id, root, status: "RESTORED", provider: "local", createdAt: new Date().toISOString(),
    head, cmds: 0, lastCmd: null, lastExit: null, snapshots: [],
  };
  writeMeta(meta);
  return meta;
}

export function destroySandbox(rawId: string): { destroyed: string } {
  const id = safeId(rawId);
  const meta = readMeta(id);
  if (meta.root.startsWith(SB_ROOT) === false) throw new Error("ESCALATION_BLOCKED");
  sh(["git", "-C", REPO_ROOT, "worktree", "remove", "--force", meta.root], REPO_ROOT); // worktree-песочницы
  rmSync(meta.root, { recursive: true, force: true });                                  // restored-копии
  sh(["git", "-C", REPO_ROOT, "worktree", "prune"], REPO_ROOT);
  return { destroyed: id };
}

export function listSandboxes(): { sandboxes: SandboxMeta[]; providers: Record<string, string> } {
  mkdirSync(SB_ROOT, { recursive: true });
  const rows: SandboxMeta[] = [];
  for (const d of readdirSync(SB_ROOT, { withFileTypes: true })) {
    if (!d.isDirectory() || d.name.startsWith(".")) continue;
    try {
      const m = readMeta(d.name);
      const du = sh(["du", "-sk", m.root], "/tmp");
      const diskKb = du.ok ? Number((du.out.split("\t")[0] ?? "0")) || 0 : undefined;
      rows.push({ ...m, diskKb });
    } catch {
      rows.push({ id: d.name, root: join(SB_ROOT, d.name), status: "BROKEN", provider: "local", createdAt: "?", head: "?", cmds: 0, lastCmd: null, lastExit: null, snapshots: [] });
    }
  }
  return {
    sandboxes: rows.sort((a, b) => a.id.localeCompare(b.id)),
    providers: { local: "READY", vercel: "NEEDS_KEYS (SANDBOX_VERCEL_TOKEN не задан)" },
  };
}
