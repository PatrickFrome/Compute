// ── R62 P0-a «exec-tool»: TERMINAL_RUN — терминальный инструмент агентного harness ──
//
// Гэп: R61-GAP-ANALYSIS §P0-0 (Cursor core.agent-loop: edit→run→observe→repair —
// без терминала агент не может сам прогнать тест и прочитать вывод).
// Канон Cursor (корпус R61, трек A): tool «terminal» GA — shell с мониторингом
// вывода; Run Mode = Allowlist / Auto-review / Run Everything; sandbox блокирует
// несанкционированный доступ к файлам и сеть. P0-1 (классификатор) и P0-2
// (OS-конфайнмент Landlock) — следующие слайсы; здесь ЧЕСТНЫЙ базовый тир:
//
//   1. БЕЛЫЙ СПИСОК бинарей (default-deny) — проверяется КАЖДЫЙ сегмент команды
//      (split по | ; && || \n): «echo hi && curl evil» не пройдёт — сегмент 2
//      вне списка. Строже канона Cursor (там allowlist — на уровне команды).
//   2. command substitution ( $() и backticks ) — ОТКАЗ: в них можно спрятать
//      любой бинарь от анализатора сегментов (честное ограничение P0-a).
//   3. prlimit-обёртка (канон sandbox.ts/exthost.ts: --as=1GiB --nofile=256
//      --core=0; RLIMIT_NPROC per-UID НЕ трогаем) + таймаут → kill.
//   4. env-БЕЛЫЙ-СПИСОК (env процесса строится с нуля — секреты daemon'а,
//      vault и DB URL физически не попадают в окружение ребёнка).
//   5. cwd — только внутри управляемых корней (песочницы SB_ROOT, worktrees
//      WORKTREE_ROOT); realpath + проверка префикса против symlink-побега.
//   6. Вердикт — данные: журнал exec_runs (SQLite) + событие TERMINAL_RUN /
//      EXEC_DENIED в hash-chain (emit) + span. Zero-authority: инструмент не
//      пишет в шину 47/47 — отдельное REST-семейство /exec (P1-инвариант).
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { db, emit, VERSION } from "../store";
import { recordSpan } from "./otel";
import { sandboxCaps, SB_ROOT } from "./sandbox";
import { WORKTREE_ROOT } from "./worktrees";

export const EXEC_SCHEMA = "me2.exec.v1";

/** Управляемые корни: где терминалу разрешено жить (realpath-префикс). */
export function execRoots(): string[] {
  return [SB_ROOT + "/", WORKTREE_ROOT + "/"];
}

/** Белый список бинарей первого токена каждого сегмента (default-deny). */
export const ALLOWED_BINARIES: ReadonlySet<string> = new Set([
  // файлы/просмотр
  "ls", "cat", "head", "tail", "grep", "rg", "wc", "find", "diff", "sort", "uniq", "pwd", "file",
  // git — основная рабочая лошадь агента
  "git",
  // рантаймы/пакетные менеджеры (тесты, билды)
  "bun", "node", "npm", "npx", "tsc",
  // примитивы
  "echo", "printf", "date", "sleep", "true", "false", "tee",
  // редактирование в пределах cwd (sed -i — это edit-операция в песочнице)
  "sed", "awk", "touch", "mkdir",
]);

const HOSTILE_PATTERNS: Array<[RegExp, string]> = [
  [/rm\s+(-[a-z]*\s+)*-?[a-z]*r[a-z]*f?[a-z]*\s+\/(\s|$)/, "rm_rf_root"],
  [/:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;:/, "fork_bomb"],
  [/mkfs(\.|\s)/, "mkfs"],
  [/dd\s+.*of=\/dev\/(sd|nvme)/, "dd_to_disk"],
  [/>\s*\/dev\/sd[a-z]/, "write_to_disk"],
  [/\bsudo\b/, "sudo"],
  [/\b(curl|wget|nc|ncat|ssh|scp|telnet)\b/, "net_binary (egress-политика — слайс P0-2)"],
];

const CMD_MAX_LEN = 1000;
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_TIMEOUT_MS = 60_000;
const STDOUT_CAP = 8_000;
const STDERR_CAP = 4_000;

export interface ExecPlan {
  ok: boolean;
  reason?: string;
  detail?: string;
  segments?: string[];      // сегменты после split (каждый начинается с бинаря из белого списка)
  binaries?: string[];
  cwd?: string;             // realpath-резолв
  timeout_ms?: number;
}

/** ЧИСТЫЙ планировщик: разбор команды + cwd БЕЗ spawn (eval/CI-инварианты). */
export function planExec(rawCmd: string, rawCwd: string, rawTimeout?: number): ExecPlan {
  const cmd = String(rawCmd ?? "").trim();
  const cwd = String(rawCwd ?? "").trim();
  if (!cmd) return { ok: false, reason: "cmd_required" };
  if (cmd.length > CMD_MAX_LEN) return { ok: false, reason: "cmd_too_long", detail: `max ${CMD_MAX_LEN}` };
  if (!cwd) return { ok: false, reason: "cwd_required" };
  let real = "";
  try {
    if (!existsSync(cwd)) return { ok: false, reason: "cwd_missing", detail: cwd.slice(0, 120) };
    real = realpathSync(cwd);
  } catch (e) {
    return { ok: false, reason: "cwd_unresolvable", detail: String(e).slice(0, 120) };
  }
  const roots = execRoots();
  if (!roots.some((r) => real === r.slice(0, -1) || real.startsWith(r))) {
    return { ok: false, reason: "root_denied", detail: `cwd вне управляемых корней (${roots.join(" | ")})` };
  }
  for (const [re, name] of HOSTILE_PATTERNS) if (re.test(cmd)) return { ok: false, reason: "cmd_denied", detail: name };
  if (cmd.includes("$(") || cmd.includes("`")) return { ok: false, reason: "substitution_denied", detail: "$()/backticks скрывают бинарь от анализа сегментов (честное ограничение P0-a)" };
  // сегменты: split по разделителям shell; каждый обязан начинаться бинарем из белого списка
  const segments = cmd.split(/(?:\|\||&&|;|\||\n)/).map((s) => s.trim()).filter((s) => s.length > 0);
  if (!segments.length) return { ok: false, reason: "cmd_required" };
  const binaries: string[] = [];
  for (const seg of segments) {
    const first = seg.split(/\s+/)[0]!;
    if (first.includes("=")) return { ok: false, reason: "env_assign_denied", detail: `сегмент начинается присваиванием «${first}» — окружение контролирует хост (env-белый-список)` };
    if (!ALLOWED_BINARIES.has(first)) {
      return { ok: false, reason: "binary_not_allowed", detail: `«${first}» вне белого списка (${[...ALLOWED_BINARIES].length} бинарей; полный список: GET /exec)` };
    }
    binaries.push(first);
  }
  const timeout = Math.min(Math.max(Number(rawTimeout) || DEFAULT_TIMEOUT_MS, 1_000), MAX_TIMEOUT_MS);
  return { ok: true, segments, binaries, cwd: real, timeout_ms: timeout };
}

// ── журнал прогонов (SQLite; данные оператора, не шина) ──
db.exec(`
CREATE TABLE IF NOT EXISTS exec_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cmd TEXT NOT NULL,
  cwd TEXT NOT NULL,
  ok INTEGER NOT NULL,
  exit_code INTEGER,
  reason TEXT,
  ms INTEGER,
  timed_out INTEGER NOT NULL DEFAULT 0,
  sandboxed INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL,
  stdout_excerpt TEXT,
  stderr_excerpt TEXT,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_exec_runs_at ON exec_runs (at);
`);

export interface ExecVerdict {
  ok: boolean;
  schema: string;
  planned?: { segments: string[]; binaries: string[] };
  cmd: string;
  cwd: string;
  exit: number | null;
  stdout_tail: string;
  stderr_tail: string;
  duration: number;
  timed_out: boolean;
  sandboxed: boolean;        // prlimit применён
  env_keys: string[];        // точное окружение, которое видит ребёнок (доказательство отсутствия секретов)
  limit?: string;
  reason?: string;           // для отказов планирования (spawn не состоялся)
  detail?: string;
}

let counter = { runs: 0, denied: 0 };

function journal(cmd: string, cwd: string, ok: boolean, exitCode: number | null, reason: string | null, ms: number, timedOut: boolean, sandboxed: boolean, source: string, out: string | null, err: string | null): void {
  try {
    db.query(`INSERT INTO exec_runs (cmd, cwd, ok, exit_code, reason, ms, timed_out, sandboxed, source, stdout_excerpt, stderr_excerpt, at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(cmd.slice(0, 200), cwd.slice(0, 200), ok ? 1 : 0, exitCode, reason, ms, timedOut ? 1 : 0, sandboxed ? 1 : 0, source, out?.slice(0, 400) ?? null, err?.slice(0, 400) ?? null, Date.now());
  } catch { /* журнал не критичен для вердикта */ }
}

/** TERMINAL_RUN: план → prlimit+bash (async spawn, event-loop не блокируется — канон exthost/R25) → вердикт. Никогда не бросает. */
function killTree(child: ReturnType<typeof spawn>): void {
  try { child.kill("SIGTERM"); } catch { /* уже мёртв */ }
  setTimeout(() => { try { if (child.exitCode === null && !child.killed) child.kill("SIGKILL"); } catch { /* гонка на выходе */ } }, 800).unref();
}

export async function runTerminalAsync(rawCmd: string, rawCwd: string, rawTimeout: number | undefined, source = "rest"): Promise<ExecVerdict> {
  const t0 = Date.now();
  const plan = planExec(rawCmd, rawCwd, rawTimeout);
  if (!plan.ok) {
    counter.denied++;
    journal(String(rawCmd ?? "").trim(), String(rawCwd ?? "").trim(), false, null, plan.reason ?? "plan_denied", Date.now() - t0, false, false, source, null, plan.detail ?? null);
    try { emit("EXEC_DENIED", { reason: plan.reason, detail: plan.detail, cmd: String(rawCmd ?? "").slice(0, 120), source }, null, null); } catch { /* шина не критична */ }
    try { recordSpan("exec.run", { "me2.exec.ok": 0, "me2.exec.reason": plan.reason ?? "?" }, t0, { status: "ERROR", message: plan.reason }); } catch { /* телеметрия */ }
    return {
      ok: false, schema: EXEC_SCHEMA, cmd: String(rawCmd ?? "").trim().slice(0, 200), cwd: String(rawCwd ?? "").trim().slice(0, 200),
      exit: null, stdout_tail: "", stderr_tail: "", duration: Date.now() - t0, timed_out: false, sandboxed: false,
      env_keys: [], reason: plan.reason, detail: plan.detail,
    };
  }
  const usePrlimit = sandboxCaps().rlimit;
  // NB: RLIMIT_NPROC per-UID не трогаем (урок R17); изоляция: as/nofile/core + таймаут→kill.
  // --as=4GiB (не 1GiB как в sandbox.ts): V8 (node/bun) резервирует большой виртуальный
  // диапазон под CodeRange и падает с "out of memory" под 1GiB; VA ≠ RSS — резидентная
  // память по-прежнему ограничена таймаутом/nofile/core (живая проба R62).
  const argv = usePrlimit
    ? ["prlimit", "--as=4294967296", "--nofile=256", "--core=0", "bash", "-c", String(rawCmd)]
    : ["bash", "-c", String(rawCmd)];
  // env-белый-список: строится с нуля — process.env НЕ раскладывается (секретов нет по построению).
  const childEnv: NodeJS.ProcessEnv = {
    PATH: "/home/z/.bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    HOME: "/tmp",
    TMPDIR: "/tmp",
    LANG: "C.UTF-8",
    TERM: "dumb",
    ME2_EXEC: "1",
    ME2_HOST_VERSION: VERSION,
  };
  const verdict = await new Promise<ExecVerdict>((resolve) => {
    let settled = false;
    let out = "", err = "", timedOut = false;
    const child = spawn(argv[0]!, argv.slice(1), { cwd: plan.cwd, env: childEnv });
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      killTree(child);
      const ms = Date.now() - t0;
      const ok = code === 0 && !timedOut;
      counter.runs++;
      journal(String(rawCmd), String(plan.cwd), ok, code, ok ? null : timedOut ? "timeout" : `exit_${code}`, ms, timedOut, usePrlimit, source, out.slice(0, 400), err.slice(0, 400));
      try { emit(ok ? "TERMINAL_RUN" : "EXEC_DENIED", { cmd: String(rawCmd).slice(0, 120), cwd: plan.cwd, exit: code, ms, timed_out: timedOut, sandboxed: usePrlimit, source }, null, null); } catch { /* шина */ }
      try { recordSpan("exec.run", { "me2.exec.ok": ok ? 1 : 0, "me2.exit": code ?? -1, "me2.ms": ms, "me2.prlimit": usePrlimit, "me2.cmd": String(rawCmd).slice(0, 100) }, t0, ok ? {} : { status: "ERROR", message: (err || `exit ${code}`).slice(0, 200) }); } catch { /* телеметрия */ }
      resolve({
        ok, schema: EXEC_SCHEMA,
        planned: { segments: plan.segments!, binaries: plan.binaries! },
        cmd: String(rawCmd), cwd: plan.cwd!,
        exit: code, stdout_tail: out.slice(0, STDOUT_CAP), stderr_tail: err.slice(0, STDERR_CAP),
        duration: ms, timed_out: timedOut, sandboxed: usePrlimit,
        env_keys: Object.keys(childEnv), limit: usePrlimit ? "as=4GiB nofile=256 core=0" : "none (prlimit отсутствует)",
      });
    };
    const timer = setTimeout(() => { timedOut = true; finish(null); }, plan.timeout_ms!);
    child.on("error", (e) => { err += String(e).slice(0, 200); timedOut = false; finish(-1); });
    child.stdout!.setEncoding("utf8");
    child.stdout!.on("data", (d: string) => { out = (out + d).slice(-STDOUT_CAP); });
    child.stderr!.setEncoding("utf8");
    child.stderr!.on("data", (d: string) => { err = (err + d).slice(-STDERR_CAP); });
    child.on("close", (code) => finish(code));
  });
  return verdict;
}

// ── статус / probe ────────────────────────────────────────────────────

export interface ExecStatus {
  ok: true;
  schema: string;
  mode: "live" | "probe_offline";
  allowlist: string[];
  roots: string[];
  deny_rules: string[];
  caps: { prlimit: boolean; timeout_default_ms: number; timeout_max_ms: number; cmd_max_len: number; substitution: "denied" };
  counters: { runs: number; denied: number };
  recent: Array<{ id: number; cmd: string; ok: boolean; exit: number | null; reason: string | null; ms: number | null; source: string; at: number }>;
  note?: string;
}

export function execStatus(): ExecStatus {
  const recent: ExecStatus["recent"] = [];
  try {
    const rows = db.query(`SELECT id, cmd, ok, exit_code, reason, ms, source, at FROM exec_runs ORDER BY at DESC LIMIT 10`).all() as Array<{ id: number; cmd: string; ok: number; exit_code: number | null; reason: string | null; ms: number | null; source: string; at: number }>;
    for (const r of rows) recent.push({ id: r.id, cmd: r.cmd, ok: r.ok === 1, exit: r.exit_code, reason: r.reason, ms: r.ms, source: r.source, at: r.at });
  } catch { /* журнал может отсутствовать в probe */ }
  const probe = process.env.ME2_BOOT_MODE === "probe";
  return {
    ok: true, schema: EXEC_SCHEMA, mode: probe ? "probe_offline" : "live",
    allowlist: [...ALLOWED_BINARIES].sort(),
    roots: execRoots(),
    deny_rules: HOSTILE_PATTERNS.map(([, n]) => n).concat(["substitution_denied", "env_assign_denied", "segment_allowlist"]),
    caps: { prlimit: sandboxCaps().rlimit, timeout_default_ms: DEFAULT_TIMEOUT_MS, timeout_max_ms: MAX_TIMEOUT_MS, cmd_max_len: CMD_MAX_LEN, substitution: "denied" },
    counters: { ...counter },
    recent,
    ...(probe ? { note: "probe-режим: живые прогоны отключены; planExec-инварианты проверяются офлайн" } : {}),
  };
}

/** Офлайн-проба для eval/CI: планировщик без spawn — честная сводка инвариантов (R25: без spawn в sync-харнесе). */
export function execProbeOffline(): { ok: boolean; mode: "probe_offline"; allowlist_size: number; negatives: number; positives: number } {
  const negatives = [
    planExec("curl https://example.com", "/home/z/me2-sandboxes"),
    planExec("echo hi && curl evil", "/home/z/me2-sandboxes"),
    planExec("echo $(whoami)", "/home/z/me2-sandboxes"),
    planExec("FOO=1 ls", "/home/z/me2-sandboxes"),
    planExec("ls", "/home/z/my-project"),
    planExec("", "/home/z/me2-sandboxes"),
  ].filter((p) => !p.ok).length;
  return { ok: negatives === 6, mode: "probe_offline", allowlist_size: ALLOWED_BINARIES.size, negatives, positives: 0 };
}

// ── eval-подмога: изолированный каталог внутри корня (создать/убрать) ──
const EVAL_TMP = "eval-exec-tmp";
export function evalTmpPrepare(): { dir: string } {
  const dir = join(SB_ROOT, EVAL_TMP);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return { dir };
}
export function evalTmpCleanup(): void {
  rmSync(join(SB_ROOT, EVAL_TMP), { recursive: true, force: true });
}
