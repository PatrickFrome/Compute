// ── R64 P0-2 «OS-sandbox»: fs/syscall-конфайнмент агентных команд ──
//
// Гэп: R61-GAP-ANALYSIS §P0-2 (capability `sec.sandbox-os` + `sec.network-deny`
// + `sec.sandbox-config`). Канон Cursor (корпус R61, трек D): sandbox блокирует
// несанкционированный доступ к файлам и сеть; Linux = Landlock+seccomp;
// default-deny сеть с allowlist; конфигурация как данные (policy.json).
//
// ЖИВЫЕ ПРОБЫ R64-0 (evidence, ядро 5.10.134 этого хоста):
//   • Landlock → ENOSYS (появился в 5.13) — риск из GAP-ANALYSIS сработал live;
//   • userns доступен (max_user_namespaces=462, unprivileged_userns_clone=1);
//   • seccomp filter-mode разрешён (Seccomp: 2);
//   • bun многопоточен → прямой unshare(CLONE_NEWUSER) = EINVAL (threads=5) →
//     цепочка через util-linux unshare (живая проба R64-1: все маунты ok).
//
// СЛОИСТЫЙ ДИЗАЙН (честный):
//   слой "landlock" — ядро ≥5.13 (код в launcher, ABI-проба, тут skip);
//   слой "ns" (ЭТОТ ХОСТ) — userns+mountns: RO-вид корня, RW-rebind управляемых
//     корней, приватный tmpfs /tmp, tmpfs-RO поверх секретов (/home/z/.a2);
//   слой "seccomp" — BPF deny-лист (mount/pivot/bpf/ptrace/unshare/io_uring/
//     clone3…) + default-deny INET при net=deny (src/seccomp-filter.ts —
//     единый источник для launcher и eval);
//   слой "none" — честный unsandboxed → классификатор ask (fail-closed, R63).
//
// STRICT FAIL-CLOSED: команда исполняется в сандбоксе ТОЛЬКО при всех
// обязательных слоях (ro_root + rw_rebinds + secrets_hidden + rlimits +
// seccomp); отсутствие/нечитаемость verdict-файла = sandbox_failed, ребёнок
// не считается исполненным. SANDBOX_ESCAPE — событие blast-radius (вес 3).
//
// Zero-authority: отдельное REST-семейство /sandbox (вне шины 47/47); tier-1
// planExec обязателен для ЛЮБОЙ команды через эту плоскость (non-bypass).
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "node:net";
import { db, emit, VERSION } from "../store";
import { recordSpan } from "./otel";
import { SB_ROOT } from "./sandbox";
import { REPO_ROOT, WORKTREE_ROOT } from "./worktrees";
import { planExec } from "./exec";
import { loadPolicy, type SandboxPolicy } from "./policy";
import { buildSeccompFilter, type NetMode } from "./seccomp-filter";

export const SANDBOX2_SCHEMA = "me2.sandbox2.v1";
const S2_DIR = join(SB_ROOT, ".sandbox2");
const LAUNCHER_PATH = join(import.meta.dir, "sandbox2-launcher.ts");
const STDOUT_CAP = 8_000;
const STDERR_CAP = 4_000;
const PROBE_TIMEOUT_MS = 15_000;

// секреты хоста — единственный обязательный hide (vault $CONTOUR/.a2)
const DEFAULT_HIDE = [join(process.env.ME2_CONTOUR_HOME ?? "/home/z", ".a2")];
export const SECRETS_HIDE = DEFAULT_HIDE[0];

try { mkdirSync(S2_DIR, { recursive: true }); } catch { /* probe-режим */ }

/** util-linux unshare: единственный способ userns из многопоточного bun (R64-1). */
function unshareBin(): string {
  for (const p of ["/usr/bin/unshare", "/bin/unshare"]) if (existsSync(p)) return p;
  return "/usr/bin/unshare";
}

// ── управляемые корни (те же, что tier-1 exec: единственный источник правды) ──
export function sandboxRoots(): string[] {
  return [SB_ROOT + "/", WORKTREE_ROOT + "/"];
}

// ── конфигурация: policy.json sandbox + runtime-override (POST /sandbox op:config) ──
const CFG_DEFAULTS: SandboxPolicy = { auto_sandbox: false, net: "deny", extra_hide: [], strict: true, tmp_size: "64m" };
let runtimeOverride: Partial<SandboxPolicy> | null = null;

export function sandboxConfig(): SandboxPolicy {
  const fromFile = loadPolicy().sandbox ?? CFG_DEFAULTS;
  return { ...CFG_DEFAULTS, ...fromFile, ...(runtimeOverride ?? {}) };
}
export function sandboxSetOverride(patch: Partial<SandboxPolicy>): SandboxPolicy {
  runtimeOverride = { ...(runtimeOverride ?? {}), ...patch };
  return sandboxConfig();
}

// ── живая проба ядра/бинарей (без restrict_self — daemon не ограничиваем) ──
export interface SandboxCaps {
  landlock_abi: number;        // -1 = ENOSYS (ядро <5.13)
  userns_max: number;          // /proc/sys/user/max_user_namespaces
  unshare_bin: boolean;        // util-linux unshare
  seccomp_mode: number;        // /proc/self/status Seccomp:
  fs_confinement: "ns" | "landlock" | "none";
  layers_available: string[];
  verdict: "sandboxable" | "unsandboxed";
}

let capsCache: { at: number; caps: SandboxCaps } | null = null;

export function probeSandboxCaps(): SandboxCaps {
  if (capsCache && Date.now() - capsCache.at < 30_000) return capsCache.caps;
  let landlockAbi = -1;
  try {
    const { dlopen, FFIType } = require("bun:ffi") as typeof import("bun:ffi");
    const libc = dlopen("libc.so.6", {
      syscall: { args: [FFIType.i64, FFIType.u64, FFIType.u64, FFIType.u64, FFIType.u64], returns: FFIType.i64 },
    });
    landlockAbi = Number(libc.symbols.syscall(444, 0, 0, 1 << 0, 0, 0)); // VERSION flag
  } catch { landlockAbi = -1; }
  let usernsMax = 0;
  try { usernsMax = Number(readFileSync("/proc/sys/user/max_user_namespaces", "utf8").trim()); } catch { usernsMax = 0; }
  let seccompMode = 0;
  try {
    seccompMode = Number((readFileSync("/proc/self/status", "utf8").match(/Seccomp:\s+(\d+)/) ?? [])[1] ?? 0);
  } catch { seccompMode = 0; }
  const unshareBin = existsSync("/usr/bin/unshare") || existsSync("/bin/unshare");
  const fsConfinement: SandboxCaps["fs_confinement"] = landlockAbi >= 1 ? "landlock" : usernsMax > 0 && unshareBin ? "ns" : "none";
  const layers = ["seccomp"];
  if (fsConfinement === "landlock") layers.unshift("landlock");
  if (fsConfinement === "ns") layers.unshift("ns");
  const caps: SandboxCaps = {
    landlock_abi: landlockAbi,
    userns_max: usernsMax,
    unshare_bin: unshareBin,
    seccomp_mode: seccompMode,
    fs_confinement: fsConfinement,
    layers_available: layers,
    verdict: fsConfinement === "none" || seccompMode === 0 ? "unsandboxed" : "sandboxable",
  };
  capsCache = { at: Date.now(), caps };
  return caps;
}

// ── ЧИСТЫЙ планировщик: профиль + argv БЕЗ spawn (eval/CI-инварианты) ──
export interface SandboxPlan {
  ok: boolean;
  reason?: string;
  detail?: string;
  profile?: {
    verdict_path: string;
    cmd: string[];
    cwd: string;
    rw: string[];
    hide: string[];
    net: NetMode;
    tmp_size: string;
    landlock: boolean;
    rlimits: { as: number; nofile: number; core: number };
    env: Record<string, string>;
  };
  argv?: string[];             // полная команда spawn (bun launcher … bash -c cmd)
  seccomp?: { len: number; deny_syscalls: string[]; net: NetMode }; // целостность BPF-программы (один источник)
  timeout_ms?: number;
}

const CMD_MAX_LEN = 1000;
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_TIMEOUT_MS = 60_000;
const RLIMIT_AS_4GIB = 4_294_967_296; // канон R62: V8 CodeRange резервирует VA

export function planSandbox(
  rawCmd: string,
  rawCwd: string,
  opts: { net?: NetMode; timeout?: number; hide?: string[] } = {},
): SandboxPlan {
  const cmd = String(rawCmd ?? "").trim();
  const cwd = String(rawCwd ?? "").trim();
  if (!cmd) return { ok: false, reason: "cmd_required" };
  if (cmd.length > CMD_MAX_LEN) return { ok: false, reason: "cmd_too_long", detail: `max ${CMD_MAX_LEN}` };
  if (!cwd) return { ok: false, reason: "cwd_required" };
  // tier-1 НЕ скипается (non-bypass): sandbox запускает только команды из белого списка
  const tier1 = planExec(cmd, cwd, opts.timeout);
  if (!tier1.ok) return { ok: false, reason: tier1.reason, detail: tier1.detail };

  const cfg = sandboxConfig();
  const caps = probeSandboxCaps();
  if (caps.verdict === "unsandboxed") {
    return { ok: false, reason: "sandbox_unavailable", detail: `fs_confinement=${caps.fs_confinement} seccomp_mode=${caps.seccomp_mode} — честный unsandboxed; канонический ask (P0-2)` };
  }
  const net: NetMode = opts.net === "allow" ? "allow" : (cfg.net === "allow" ? "allow" : "deny");
  const hide = [...DEFAULT_HIDE, ...cfg.extra_hide, ...(opts.hide ?? [])];
  for (const h of hide) {
    // канон fail-closed: мусор в hide не фильтруем молча — отклоняем план
    if (!h.startsWith("/") || h.includes("..") || h.length > 200) {
      return { ok: false, reason: "hide_invalid", detail: h.slice(0, 120) };
    }
  }
  const ts = Date.now();
  const nonce = Math.random().toString(36).slice(2, 8);
  const profile: NonNullable<SandboxPlan["profile"]> = {
    verdict_path: join(S2_DIR, `verdict-${ts}-${nonce}.json`),
    cmd: ["/bin/bash", "-c", cmd],
    cwd: tier1.cwd!,
    rw: sandboxRoots().filter((r) => existsSync(r.replace(/\/+$/, ""))), // отсутствующие корни не реbind'им (честный слой по факту)
    hide,
    net,
    tmp_size: cfg.tmp_size,
    landlock: caps.fs_confinement === "landlock",
    rlimits: { as: RLIMIT_AS_4GIB, nofile: 256, core: 0 },
    // env-белый-список как tier-1 (exec.ts): строится с нуля, секретов нет по построению
    env: {
      PATH: "/home/z/.bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      HOME: "/tmp",
      TMPDIR: "/tmp",
      LANG: "C.UTF-8",
      TERM: "dumb",
      ME2_EXEC: "1",
      ME2_SANDBOX: "1",
      ME2_SANDBOX_LAYERS: caps.layers_available.join("+"),
      ME2_HOST_VERSION: VERSION,
    },
  };
  const bunPath = process.execPath || "bun";
  const argv = [bunPath, LAUNCHER_PATH, argvProfilePath(profile), "--", ...profile.cmd];
  const timeout = Math.min(Math.max(Number(opts.timeout) || DEFAULT_TIMEOUT_MS, 1_000), MAX_TIMEOUT_MS);
  // BPF-программа строится тем же билдером, что установит launcher — инвариант единого источника
  const prog = buildSeccompFilter(net);
  return {
    ok: true,
    profile,
    argv,
    seccomp: { len: prog.len, deny_syscalls: prog.deny_syscalls, net: prog.net },
    timeout_ms: timeout,
  };
}

// профиль кладём рядом с verdict — launcher читает его ДО маунтов (сами файлы
// в SB_ROOT/.sandbox2: внутри RW-корня; launcher читает профиль до RO-вида)
function argvProfilePath(profile: NonNullable<SandboxPlan["profile"]>): string {
  return profile.verdict_path.replace(/verdict-(\d+)-(\w+)\.json$/, "profile-$1-$2.profile.json");
}

// ── журнал: exec_runs (sandboxed=1, source="sandbox") — единый журнал прогонов ──
function journal(cmd: string, cwd: string, ok: boolean, exitCode: number | null, reason: string | null, ms: number, timedOut: boolean, out: string | null, err: string | null): void {
  try {
    db.query(`INSERT INTO exec_runs (cmd, cwd, ok, exit_code, reason, ms, timed_out, sandboxed, source, stdout_excerpt, stderr_excerpt, at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(cmd.slice(0, 200), cwd.slice(0, 200), ok ? 1 : 0, exitCode, reason, ms, timedOut ? 1 : 0, 1, "sandbox", out?.slice(0, 400) ?? null, err?.slice(0, 400) ?? null, Date.now());
  } catch { /* журнал не критичен */ }
}

export interface SandboxVerdict {
  ok: boolean;
  schema: string;
  cmd: string;
  cwd: string;
  exit: number | null;
  stdout_tail: string;
  stderr_tail: string;
  duration: number;
  timed_out: boolean;
  sandboxed: true;
  sandbox: {
    strict_ok: boolean;
    required_failed: string[];
    layers: Record<string, string | boolean>;
    net: NetMode;
  };
  env_keys: string[];
  reason?: string;
  detail?: string;
}

/** Обязательные слои strict-режима: без НИХ ребёнок не запускается (fail-closed). */
export function strictCheck(layers: Record<string, string | boolean> | null, net: NetMode, strict: boolean): { ok: boolean; failed: string[] } {
  if (!layers) return { ok: false, failed: ["verdict_file_missing"] };
  const failed: string[] = [];
  if (layers.make_private !== true) failed.push("make_private");
  if (layers.ro_root !== true) failed.push("ro_root");
  if (layers.rw_rebinds !== true) failed.push("rw_rebinds");
  if (layers.secrets_hidden !== true) failed.push("secrets_hidden");
  if (layers.seccomp !== "installed") failed.push("seccomp");
  if (layers.rlimit_as !== true || layers.rlimit_nofile !== true || layers.rlimit_core !== true) failed.push("rlimits");
  if (net === "deny" && layers.net !== "deny") failed.push("net_mode");
  // нестрогий режим: только seccomp+verdict обязательны (fs-слои деградировали честно)
  if (!strict) {
    const soft = failed.filter((f) => f === "seccomp" || f === "verdict_file_missing");
    return { ok: soft.length === 0, failed: soft.length === 0 ? [] : soft };
  }
  return { ok: failed.length === 0, failed };
}

function killTree(child: ReturnType<typeof spawn>): void {
  try { child.kill("SIGTERM"); } catch { /* уже мёртв */ }
  setTimeout(() => { try { if (child.exitCode === null && !child.killed) child.kill("SIGKILL"); } catch { /* гонка */ } }, 800).unref();
}

let counters = { runs: 0, failed: 0, escapes: 0 };

/** Запуск В САНДБОКСЕ: planSandbox → spawn(argv) → verdict-файл → strict fail-closed. */
export async function runSandboxedAsync(
  rawCmd: string,
  rawCwd: string,
  opts: { net?: NetMode; timeout?: number; source?: string; hide?: string[] } = {},
): Promise<SandboxVerdict> {
  const t0 = Date.now();
  const source = opts.source ?? "sandbox";
  const cfg = sandboxConfig();
  const plan = planSandbox(rawCmd, rawCwd, opts);
  const fail = (reason: string, detail?: string, exit: number | null = null): SandboxVerdict => {
    counters.failed++;
    journal(rawCmd, rawCwd, false, exit, reason, Date.now() - t0, false, null, detail ?? null);
    try { emit("SANDBOX_FAILED", { cmd: rawCmd.slice(0, 120), reason, detail: detail?.slice(0, 160), source }, null, null); } catch { /* шина */ }
    try { recordSpan("sandbox.run", { "me2.sandbox.ok": 0, "me2.sandbox.reason": reason }, t0, { status: "ERROR", message: reason }); } catch { /* телеметрия */ }
    return {
      ok: false, schema: SANDBOX2_SCHEMA, cmd: rawCmd.slice(0, 200), cwd: rawCwd.slice(0, 200),
      exit, stdout_tail: "", stderr_tail: detail?.slice(0, STDERR_CAP) ?? "", duration: Date.now() - t0, timed_out: false,
      sandboxed: true, sandbox: { strict_ok: false, required_failed: [reason], layers: {}, net: (opts.net ?? cfg.net) as NetMode },
      env_keys: [], reason, detail,
    };
  };
  if (!plan.ok) return fail(plan.reason ?? "plan_denied", plan.detail);

  const profilePath = argvProfilePath(plan.profile!);
  try {
    writeFileSync(profilePath, JSON.stringify(plan.profile), { mode: 0o600 });
  } catch (e) {
    return fail("profile_write_failed", String(e).slice(0, 120));
  }

  // unshare-цепочка: bun многопоточен → прямой unshare(CLONE_NEWUSER) невозможен
  // (живая проба R64-1) → util-linux unshare создаёт ns и exec'ает launcher;
  // для fs_confinement=landlock (ядро ≥5.13) launcher запускается напрямую
  const caps = probeSandboxCaps();
  const argv = caps.fs_confinement === "ns"
    ? [unshareBin(), "--user", "--map-root-user", "--mount", "--propagation", "private", "--", ...plan.argv!]
    : plan.argv!;

  const verdict = await new Promise<SandboxVerdict>((resolve) => {
    let settled = false;
    let out = "", err = "", timedOut = false;
    const child = spawn(argv[0]!, argv.slice(1), { cwd: plan.profile!.cwd, env: plan.profile!.env });
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      killTree(child);
      const ms = Date.now() - t0;
      // verdict-файл: launcher пишет ПОСЛЕ маунтов+seccomp, ДО exec ребёнка
      let layers: Record<string, string | boolean> | null = null;
      try {
        layers = JSON.parse(readFileSync(plan.profile!.verdict_path, "utf8")).layers;
      } catch { layers = null; }
      const strict = strictCheck(layers, plan.profile!.net, cfg.strict);
      counters.runs++;
      const ok = strict.ok && code === 0 && !timedOut;
      journal(rawCmd, plan.profile!.cwd, ok, code, ok ? null : timedOut ? "timeout" : strict.ok ? `exit_${code}` : "sandbox_failed", ms, timedOut, out.slice(0, 400), err.slice(0, 400));
      const sandboxBlock = {
        strict_ok: strict.ok,
        required_failed: strict.failed,
        layers: layers ?? {},
        net: plan.profile!.net,
      };
      try {
        if (!strict.ok) emit("SANDBOX_FAILED", { cmd: rawCmd.slice(0, 120), required_failed: strict.failed, exit: code, source }, null, null);
        else emit("SANDBOX_APPLIED", { cmd: rawCmd.slice(0, 120), layers: Object.keys(sandboxBlock.layers), net: sandboxBlock.net, exit: code, ms, source }, null, null);
      } catch { /* шина не критична */ }
      try { recordSpan("sandbox.run", { "me2.sandbox.ok": ok ? 1 : 0, "me2.sandbox.strict": strict.ok ? 1 : 0, "me2.exit": code ?? -1, "me2.ms": ms, "me2.net": sandboxBlock.net }, t0, ok ? {} : { status: "ERROR", message: (err || `exit ${code}`).slice(0, 200) }); } catch { /* телеметрия */ }
      resolve({
        ok, schema: SANDBOX2_SCHEMA, cmd: rawCmd.slice(0, 200), cwd: plan.profile!.cwd,
        exit: code, stdout_tail: out.slice(0, STDOUT_CAP), stderr_tail: err.slice(0, STDERR_CAP),
        duration: ms, timed_out: timedOut, sandboxed: true, sandbox: sandboxBlock,
        env_keys: Object.keys(plan.profile!.env),
        ...(strict.ok ? {} : { reason: "sandbox_failed", detail: `обязательные слои не применены: ${strict.failed.join(",")} — fail-closed` }),
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

  // cleanup профиля/вердикта (verdict уже распарсен; файлы не должны копиться)
  try { rmSync(profilePath, { force: true }); } catch { /* не критично */ }
  try { rmSync(plan.profile!.verdict_path, { force: true }); } catch { /* не критично */ }
  return verdict;
}

// ── PROBE: живая верификация конфайнмента (позитив + 2 негатива + контроль) ──
export interface ProbeResult {
  ok: boolean;                    // все проверки в ожидаемых состояниях
  escape: boolean;                // НАРУШЕНИЕ конфайнмента (blast-radius!)
  checks: {
    write_inside: { ok: boolean; exit: number | null; detail: string };
    write_outside_denied: { ok: boolean; exit: number | null; detail: string };
    net_denied: { ok: boolean; exit: number | null; detail: string };
    net_allow_control: { ok: boolean; exit: number | null; detail: string };
  };
  caps: SandboxCaps;
  ms: number;
}

const PROBE_TS = () => Date.now();

export async function sandboxProbe(source = "sandbox-probe"): Promise<ProbeResult> {
  const t0 = Date.now();
  const caps = probeSandboxCaps();
  const ts = PROBE_TS();
  const insideFile = join(S2_DIR, `probe-ok-${ts}.txt`);
  const outsideFile = "/home/z/.a2/probe-should-fail.txt";

  // 1) ПОЗИТИВ: запись внутри RW-корня — обязана работать
  const inRes = await runSandboxedAsync(`echo probe64 > ${insideFile}`, SB_ROOT, { timeout: PROBE_TIMEOUT_MS, source });
  let insideOk = inRes.exit === 0;
  try { insideOk = insideOk && existsSync(insideFile); } catch { insideOk = false; }
  try { unlinkSync(insideFile); } catch { /* не критично */ }

  // 2) НЕГАТИВ: запись в секретный каталог (tmpfs-RO поверх) — обязана ПАДАТЬ
  const outRes = await runSandboxedAsync(`echo probe64 > ${outsideFile}`, SB_ROOT, { timeout: PROBE_TIMEOUT_MS, source });
  let outsideOk = outRes.exit !== 0; // ожидаем отказ
  try { outsideOk = outsideOk && !existsSync(outsideFile); } catch { /* ls = escape */ }
  let escaped = existsSync(outsideFile);
  try { unlinkSync(outsideFile); } catch { /* файла нет — норма */ }

  // 3) НЕГАТИВ: INET-подключение при net=deny — обязано быть EPERM
  const listener = createServer(() => { /* соединение = escape */ });
  const port = await new Promise<number>((resolve) => listener.listen(0, "127.0.0.1", () => resolve((listener.address() as { port: number }).port)));
  let listenerHits = 0;
  listener.on("connection", () => { listenerHits++; });
  // NB канон R62: сегмент-сплитер режет по ; | && внутри кавычек → скрипт ОДНО
  // выражение без разделителей: EPERM → error event → exit 7; соединение → exit 0
  const netScript = `require('net').createConnection({port:${port},host:'127.0.0.1'}).on('error',e=>process.exit(7)).on('connect',()=>process.exit(0))`;
  const netRes = await runSandboxedAsync(`node -e "${netScript}"`, SB_ROOT, { timeout: PROBE_TIMEOUT_MS, source, net: "deny" });
  const netDeniedOk = netRes.exit === 7 && listenerHits === 0 && !/CONNECTED/.test(netRes.stdout_tail);
  if (/CONNECTED/.test(netRes.stdout_tail) || listenerHits > 0) escaped = true;

  // 4) КОНТРОЛЬ: тот же listener при net=allow — обязан соединиться
  //    (доказывает: отказ в п.3 — фильтр, а не недоступность сети)
  const allowRes = await runSandboxedAsync(`node -e "${netScript}"`, SB_ROOT, { timeout: PROBE_TIMEOUT_MS, source, net: "allow" });
  // соединение засчитывает и exit 0, и живой hit на listener (двойное доказательство)
  const allowOk = (allowRes.exit === 0 || listenerHits >= 1);

  await new Promise<void>((resolve) => listener.close(() => resolve()));

  if (escaped) {
    counters.escapes++;
    try { emit("SANDBOX_ESCAPE", { probe: "R64", detail: "конфайнмент нарушен — проверь ядро/слои", source }, null, null); } catch { /* шина */ }
  }
  const result: ProbeResult = {
    ok: insideOk && outsideOk && netDeniedOk && allowOk && !escaped,
    escape: escaped,
    checks: {
      write_inside: { ok: insideOk, exit: inRes.exit, detail: inRes.ok ? "rw-корень доступен" : (inRes.reason ?? inRes.stderr_tail.slice(0, 120)) },
      write_outside_denied: { ok: outsideOk, exit: outRes.exit, detail: outsideOk ? `запись ${outsideFile} отклонена (tmpfs-RO)` : `ЭСКАПИРОВАНО: файл создан` },
      net_denied: { ok: netDeniedOk, exit: netRes.exit, detail: netDeniedOk ? `socket(AF_INET) → EPERM (exit 7, listener-хитов 0)` : `подключение ПРОШЛО (exit=${netRes.exit}, хитов ${listenerHits})` },
      net_allow_control: { ok: allowOk, exit: allowRes.exit, detail: allowOk ? `контроль: net=allow соединяется (hit=${listenerHits > 0 ? "yes" : "exit0"}) — отказ в п.3 это фильтр` : `контроль не прошёл (exit=${allowRes.exit}) ${allowRes.stderr_tail.slice(0, 80)}` },
    },
    caps,
    ms: Date.now() - t0,
  };
  try { emit("SANDBOX_PROBE", { ok: result.ok, escape: result.escape, checks: Object.fromEntries(Object.entries(result.checks).map(([k, v]) => [k, v.ok])) }, null, null); } catch { /* шина */ }
  return result;
}

// ── статус (GET /sandbox) ─────────────────────────────────────────────
export function sandboxStatus(): {
  ok: true;
  schema: string;
  version: string;
  caps: SandboxCaps;
  config: SandboxPolicy;
  override: Partial<SandboxPolicy> | null;
  strict_layers: string[];
  honest_limits: string[];
  counters: { runs: number; failed: number; escapes: number };
  recent: Array<{ id: number; cmd: string; ok: boolean; exit: number | null; reason: string | null; ms: number | null; at: number }>;
} {
  let recent: Array<{ id: number; cmd: string; ok: boolean; exit: number | null; reason: string | null; ms: number | null; at: number }> = [];
  try {
    const rows = db.query(`SELECT id, cmd, ok, exit_code, reason, ms, at FROM exec_runs WHERE sandboxed=1 ORDER BY at DESC LIMIT 10`).all() as Array<{ id: number; cmd: string; ok: number; exit_code: number | null; reason: string | null; ms: number | null; at: number }>;
    for (const r of rows) recent.push({ id: r.id, cmd: r.cmd, ok: r.ok === 1, exit: r.exit_code, reason: r.reason, ms: r.ms, at: r.at });
  } catch { /* журнал может отсутствовать */ }
  const caps = probeSandboxCaps();
  return {
    ok: true, schema: SANDBOX2_SCHEMA, version: VERSION,
    caps,
    config: sandboxConfig(),
    override: runtimeOverride,
    strict_layers: ["make_private", "ro_root", "rw_rebinds", "secrets_hidden", "seccomp", "rlimits"],
    honest_limits: [
      "Landlock недоступен на ядре 5.10 (ENOSYS) — fs-конфайнмент слоем ns (userns+mountns), Landlock-путь сохранён для ≥5.13",
      "default-deny сети: socket(AF_INET/AF_INET6) → EPERM; доменный allowlist+SSRF-блок = P1 egress-modes (честный PARTIAL)",
      "io_uring закрыт (io_uring_setup/enter/register → EPERM): операции io_uring ядро 5.10 не проводит через seccomp submit-потока",
      "strict fail-closed: обязательные слои не применились → команда НЕ исполняется (sandbox_failed)",
      "не security boundary против root/ядро — канон Cursor «sandbox blocks unauthorized access» на уровне uid/ns/syscall",
    ],
    counters: { ...counters },
    recent,
  };
}

/** Офлайн-проба для eval: plan-инварианты без spawn (канон R25). */
export function sandboxProbeOffline(): { ok: boolean; mode: "probe_offline"; negatives: number; plan_ok: number; seccomp_integrity: boolean } {
  const negatives = [
    planSandbox("", SB_ROOT),
    planSandbox("curl https://example.com", SB_ROOT),   // tier-1: вне белого списка
    planSandbox("ls", REPO_ROOT),                       // cwd вне корней (SB/WT)
    planSandbox("ls", SB_ROOT, { hide: ["relative/path"] }), // hide не абсолютный
  ].filter((p) => !p.ok).length;
  const good = planSandbox("echo ok > probe.txt", SB_ROOT);
  const capsHere = probeSandboxCaps();
  const planOk = capsHere.verdict === "unsandboxed"
    ? !good.ok && good.reason === "sandbox_unavailable" // честный fail-closed: план отказал (канон P0-2)
    : good.ok && good.argv!.includes("/bin/bash") && good.argv!.includes("-c") && good.seccomp!.net === "deny"
    && good.seccomp!.deny_syscalls.includes("mount")
    && good.seccomp!.deny_syscalls.includes("unshare")
    && good.seccomp!.deny_syscalls.includes("io_uring_setup")
    && good.seccomp!.deny_syscalls.includes("ptrace");
  const strictMatrix =
    strictCheck({ make_private: true, ro_root: true, rw_rebinds: true, secrets_hidden: true, seccomp: "installed", rlimit_as: true, rlimit_nofile: true, rlimit_core: true, net: "deny" }, "deny", true).ok === true &&
    strictCheck({ make_private: false, ro_root: true, rw_rebinds: true, secrets_hidden: true, seccomp: "installed", rlimit_as: true, rlimit_nofile: true, rlimit_core: true, net: "deny" }, "deny", true).ok === false &&
    strictCheck(null, "deny", true).ok === false;
  return { ok: negatives === 4 && planOk && strictMatrix, mode: "probe_offline", negatives, plan_ok: planOk ? 1 : 0, seccomp_integrity: planOk && strictMatrix };
}
