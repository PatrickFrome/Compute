// ── R63 P0-b «classifier tier»: Run Modes + классификатор пре-исполнения ──
//
// Гэп: R61-GAP-ANALYSIS §P0-1 (capability `core.run-modes` + `sec.auto-review-classifier`).
// Канон Cursor (корпус R61, трек D, D02/D35): порядок enforcement = allowlist →
// sandbox-ability → classifier; классификатор — агентная малая модель, ревьюит
// действия В КОНТЕКСТЕ до исполнения, вердикты let-proceed / require-approval / deny,
// объяснение возвращается агенту; честно «NOT a security boundary»; блокирует ~4%.
//
// ME2-реализация (честные различия задокументированы в r63-analogues.md):
//   tier-1 allowlist — exec.ts planExec (уже отработал: классификатор видит только
//                      команды из белого списка бинарей);
//   tier-2 sandbox-ability — prlimit as/nofile/core (есть); FS-конфайнмент = P0-2,
//                      поэтому канонический вердикт «sandbox» сегодня НЕ выдаётся —
//                      там, где Cursor отправил бы в сандбокс, ME2 честно просит
//                      оператора (ask). Fail-closed, не fail-open.
//   tier-3 classifier — (a) детерминированная эвристика (default, тестируемая) +
//                       (b) LLM-путь (opt-in через policy.json/конфиг; ≤3с,
//                       таймаут → ask — fail-closed к оператору, не к allow).
//
// Run Modes (канон Cursor run-modes): plan (без spawn) / auto (с классификатором) /
// ask-очередь (оператор одобряет из UI). Выключение тира — policy.json
// classifier.enabled=false (событие CLASSIFIER_CONFIG; честный режим "off" в статусе).
//
// Zero-authority как у reviewer (C3): классификатор НЕ пишет в шину 47/47 —
// отдельное REST-семейство /review; события CLASSIFIER_* в hash-chain через emit().
import { db, emit } from "../store";
import { chat } from "../providers";
import { loadPolicy, type ClassifierPolicy } from "./policy";
import { SB_ROOT } from "./sandbox";
import { WORKTREE_ROOT } from "./worktrees";
import { sandboxConfig, probeSandboxCaps } from "./sandbox2";

export const REVIEW_SCHEMA = "me2.review.v1";

export type ReviewVerdict = "allow" | "sandbox" | "ask" | "block";
export type ReviewEngine = "heuristic" | "llm" | "off";

export interface ReviewResult {
  verdict: ReviewVerdict;
  reason: string;
  rule?: string;
  engine: ReviewEngine;
  model?: string;
  ms: number;
  queue_id?: number;      // для ask: запись в очереди оператора
}

/** Улики классификации (канон Cursor: «reviews actions in context»). */
export interface ReviewInput {
  cmd: string;
  cwd: string;
  binaries: string[];
  segments: string[];
}

// ── конфигурация: policy.json (файл оператора) + runtime-override (POST /review op:config) ──
const CFG_DEFAULTS: ClassifierPolicy = { enabled: true, llm_enabled: false, timeout_ms: 3000, queue_max: 20, model: "zai" };
let runtimeOverride: Partial<ClassifierPolicy> | null = null;

export function classifierConfig(): ClassifierPolicy {
  const fromFile = loadPolicy().classifier ?? CFG_DEFAULTS;
  return { ...CFG_DEFAULTS, ...fromFile, ...(runtimeOverride ?? {}) };
}
export function classifierSetOverride(patch: Partial<ClassifierPolicy>): ClassifierPolicy {
  runtimeOverride = { ...(runtimeOverride ?? {}), ...patch };
  return classifierConfig();
}

// ── управляемые корни + честный белый список системных путей ──────────
// prlimit не даёт FS-конфайнмента; с R64 (P0-2) конфайнмент несёт OS-сандбокс
// (ns+seccomp, /sandbox): при sandbox.auto_sandbox=true риски из FS_RULES
// получают канонический вердикт «sandbox» (tier-2 реально гасит риск), иначе —
// как в R63 — честный ask оператору (fail-open к человеку, не к исполнению).
const SYS_READABLE = ["/usr", "/bin", "/sbin", "/lib", "/lib64", "/etc", "/proc", "/sys", "/var", "/opt", "/dev", "/tmp"];
const DEV_EXACT = new Set(["/dev/null", "/dev/stdout", "/dev/stderr", "/dev/urandom"]);

/** Риски, которые РЕАЛЬНО гасит OS-сандбокс (канон tier-2 между allowlist и classifier). */
export const FS_RULES: ReadonlySet<string> = new Set(["redirect_outside_roots", "path_outside_roots", "var_expansion_path"]);

/** Канон D02: sandbox-ability резolves до classifier — элегибельность вердикта «sandbox» (чистая, eval). */
export function sandboxEligible(rule: string | undefined, autoSandbox: boolean, capsVerdict: string): boolean {
  return autoSandbox && !!rule && FS_RULES.has(rule) && capsVerdict === "sandboxable";
}

function pathInsideManaged(p: string): boolean {
  if (DEV_EXACT.has(p)) return true;
  if (SYS_READABLE.some((r) => p === r || p.startsWith(r + "/"))) return true;
  for (const r of [SB_ROOT + "/", WORKTREE_ROOT + "/"]) {
    if (p === r.slice(0, -1) || p.startsWith(r)) return true;
  }
  return false;
}

// ── ЭВРИСТИКА (tier-3a): детерминированная, тестируемая, офлайн ───────
interface Rule { re: RegExp; verdict: ReviewVerdict; rule: string; reason: string }

const RULES: Rule[] = [
  { re: /\bgit\s+push\b[^;&|\n]*--force\b(?!\s*--with-lease)/, verdict: "block", rule: "force_push", reason: "git push --force переписывает чужую историю — необратимо; для легального force есть оператор" },
  { re: /\b(npm|pnpm|yarn|bun)\s+(publish|login|adduser)\b/, verdict: "block", rule: "registry_egress", reason: "публикация/логин в внешний реестр уводит артефакты/креды за периметр" },
  { re: /\bgit\s+push\b/, verdict: "ask", rule: "external_state", reason: "git push меняет внешнее состояние (GitHub) — канон Cursor: require approval" },
  { re: /\b(npm|npx|pnpm|yarn|bun)\s+(install|i|add|remove|uninstall|update|link)\b/, verdict: "ask", rule: "supply_chain", reason: "установка/удаление пакетов — supply-chain риск (канон terminalAllowlist: npm:install* под одобрением)" },
  { re: /\bgit\s+reset\s+--hard\b/, verdict: "ask", rule: "destructive_local", reason: "git reset --hard необратимо теряет незакоммиченные изменения" },
  { re: /\bgit\s+clean\s+-[a-zA-Z]*[fdx]/, verdict: "ask", rule: "destructive_local", reason: "git clean -f/-d/-x необратимо удаляет файлы вне git-индекса" },
  { re: /\bgit\s+(branch|tag)\s+(-[a-zA-Z]*[dD])/, verdict: "ask", rule: "destructive_local", reason: "удаление веток/тегов — деструктив истории репозитория" },
  { re: /\bchmod\s+(-[a-zA-Z]*\s+)*777\b/, verdict: "ask", rule: "permissive_chmod", reason: "chmod 777 делает цель общедоступной на запись" },
];

/** Редиректы bash: > >> 2> &>> и склеенные формы — цель обязана быть внутри корней. */
const REDIR_RE = /(?:\d?>|>>)\s*([^\s;&|><]+)/g;

/** ЧИСТЫЙ эвристический классификатор (без spawn/LLM/FS) — инварианты eval. */
export function reviewPlan(input: ReviewInput): ReviewResult {
  const t0 = Date.now();
  const cmd = String(input.cmd ?? "");
  const allow = (rule: string, reason: string): ReviewResult => ({ verdict: "allow", reason, rule, engine: "heuristic", ms: Date.now() - t0 });
  const ask = (rule: string, reason: string): ReviewResult => ({ verdict: "ask", reason, rule, engine: "heuristic", ms: Date.now() - t0 });

  for (const r of RULES) {
    if (r.re.test(cmd)) return r.verdict === "block" ? { verdict: "block", reason: r.reason, rule: r.rule, engine: "heuristic", ms: Date.now() - t0 } : ask(r.rule, r.reason);
  }

  // подстановка переменных внутри пути — путь скрыт от лексического анализа
  if (/\$\{[^}]*\/[^}]*\}/.test(cmd)) {
    return ask("var_expansion_path", "путь построен через ${…} — лексический анализ его не видит (подтверди вручную)");
  }

  // редиректы
  for (const m of cmd.matchAll(REDIR_RE)) {
    const target = m[1]!.replace(/^["']|["']$/g, "");
    if (target.startsWith("/") && !pathInsideManaged(target)) {
      return ask("redirect_outside_roots", `редирект «> ${target}» пишет вне управляемых корней (prlimit не ограничивает ФС до P0-2)`);
    }
  }

  // абсолютные пути в токенах (аргументы/опции --opt=/path) — чтение ИЛИ запись вне корней
  for (const rawToken of cmd.split(/\s+/)) {
    const token = rawToken.replace(/^["']|["']$/g, "");
    for (const cand of [token, token.includes("=") ? token.slice(token.indexOf("=") + 1) : ""]) {
      if (cand && cand.startsWith("/") && !pathInsideManaged(cand)) {
        return ask("path_outside_roots", `путь «${cand.slice(0, 80)}» вне управляемых корней и системного белого списка — доступ к чужим данным (например, /home/z/my-project или /home/z/.a2) требует оператора`);
      }
    }
  }

  return allow("no_risk_flags", "команда белого списка без рисковых паттернов");
}

// ── LLM-путь (tier-3b): агентная малая модель, opt-in, ≤timeout_ms, таймаут → ask ──
function llmPrompt(input: ReviewInput, recent: string[]): Array<{ role: "system" | "user"; content: string }> {
  const sys = [
    "Ты — классификатор пре-исполнения ME2 (аналог Auto-review Cursor).",
    "Ты НЕ security boundary: твой вердикт — рекомендация; tier-1 (allowlist бинарей) и prlimit уже отработали.",
    "Оцени команду агента В КОНТЕКСТЕ и ответь СТРОГО одним JSON-объектом без markdown:",
    '{"verdict":"allow|ask|block","reason":"кратко по-русски, <=200 символов"}',
    "allow — обычная рабочая команда в управляемом корне (тесты, git status, сборка);",
    "ask — риск, требующий человека (внешние состояния, установка пакетов, пути вне корня, деструктив);",
    "block — очевидно враждебное/необратимое (force-push, публикация реестра, уничтожение данных).",
  ].join(" ");
  const usr = JSON.stringify({ cmd: input.cmd, cwd: input.cwd, binaries: input.binaries, recent_runs: recent });
  return [{ role: "system", content: sys }, { role: "user", content: usr }];
}

function recentRuns(n: number): string[] {
  try {
    const rows = db.query(`SELECT cmd, ok, exit_code FROM exec_runs ORDER BY at DESC LIMIT ?`).all(n) as Array<{ cmd: string; ok: number; exit_code: number | null }>;
    return rows.map((r) => `$ ${r.cmd.slice(0, 80)} → ${r.ok ? "exit 0" : `exit ${r.exit_code}`}`);
  } catch { return []; }
}

async function llmClassify(input: ReviewInput, cfg: ClassifierPolicy): Promise<ReviewResult> {
  const t0 = Date.now();
  const fallback: ReviewResult = { verdict: "ask", reason: "классификатор LLM недоступен/таймаут — fail-closed к оператору (не к allow)", rule: "llm_unavailable", engine: "llm", model: cfg.model, ms: Date.now() - t0 };
  try {
    const res = await Promise.race([
      chat(cfg.model, llmPrompt(input, recentRuns(3)), { temperature: 0, lane: "P2" }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("classifier_timeout")), Math.max(500, cfg.timeout_ms))),
    ]);
    const m = String(res).match(/\{[\s\S]*\}/);
    if (!m) return fallback;
    const j = JSON.parse(m[0]) as { verdict?: string; reason?: string };
    const v = j.verdict === "block" ? "block" : j.verdict === "allow" ? "allow" : "ask"; // невалидный → ask (fail-closed)
    return { verdict: v as ReviewVerdict, reason: String(j.reason ?? "без объяснения").slice(0, 200), rule: "llm_classifier", engine: "llm", model: cfg.model, ms: Date.now() - t0 };
  } catch {
    return fallback;
  }
}

// ── очередь одобрений (SQLite; данные оператора, не шина) ─────────────
db.exec(`
CREATE TABLE IF NOT EXISTS review_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cmd TEXT NOT NULL,
  cwd TEXT NOT NULL,
  timeout_ms INTEGER NOT NULL,
  verdict TEXT NOT NULL,
  reason TEXT NOT NULL,
  engine TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  run_ok INTEGER,
  run_exit INTEGER,
  run_ms INTEGER,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_review_queue_status ON review_queue (status);
`);

export function queuePending(): Array<{ id: number; cmd: string; cwd: string; timeout_ms: number; reason: string; engine: string; created_at: number }> {
  return db.query(`SELECT id, cmd, cwd, timeout_ms, reason, engine, created_at FROM review_queue WHERE status='pending' ORDER BY id DESC LIMIT 50`).all() as never;
}

export function queueTake(id: number): { cmd: string; cwd: string; timeout_ms: number } | null {
  const row = db.query(`SELECT cmd, cwd, timeout_ms FROM review_queue WHERE id=? AND status='pending'`).get(id) as { cmd: string; cwd: string; timeout_ms: number } | null;
  if (!row) return null;
  db.query(`UPDATE review_queue SET status='approved', resolved_at=? WHERE id=?`).run(Date.now(), id);
  return row;
}

export function queueResolve(id: number, ok: boolean, exit: number | null, ms: number): void {
  db.query(`UPDATE review_queue SET status=?, run_ok=?, run_exit=?, run_ms=? WHERE id=?`).run(ok ? "executed" : "failed", ok ? 1 : 0, exit, ms, id);
}

export function queueDeny(id: number): boolean {
  const r = db.query(`UPDATE review_queue SET status='denied', resolved_at=? WHERE id=? AND status='pending'`).run(Date.now(), id);
  return Number(r.changes) > 0;
}

export function queueRecent(n: number): Array<{ id: number; cmd: string; status: string; verdict: string; engine: string; run_ok: number | null; run_exit: number | null; created_at: number; resolved_at: number | null }> {
  return db.query(`SELECT id, cmd, status, verdict, engine, run_ok, run_exit, created_at, resolved_at FROM review_queue ORDER BY id DESC LIMIT ?`).all(n) as never;
}

// ── гейт: интеграция в /exec (вызывается exec.ts ПОСЛЕ planExec, ДО spawn) ──
export async function classifyGate(
  input: ReviewInput,
  rawTimeout: number | undefined,
): Promise<{ verdict: ReviewVerdict; result: ReviewResult }> {
  const cfg = classifierConfig();
  const off: ReviewResult = { verdict: "allow", reason: "классификатор выключен политикой (classifier.enabled=false)", engine: "off", ms: 0 };
  if (!cfg.enabled) return { verdict: "allow", result: off };

  let result = cfg.llm_enabled
    ? await llmClassify(input, cfg)
    : reviewPlan(input);

  // R64 P0-2: канон D02 — tier-2 sandbox-ability резolves ДО tier-3 ask:
  // fs-риски (redirect/path/var вне корней) при sandbox.auto_sandbox=true и
  // живом сандбоксе получают вердикт «sandbox» (исполнение в ns+seccomp) —
  // оператора не дёргаем тем, что конфайнмент гасит честно.
  if (result.verdict === "ask" && sandboxEligible(result.rule, sandboxConfig().auto_sandbox, probeSandboxCaps().verdict)) {
    result = { ...result, verdict: "sandbox", reason: `${result.reason} — исполняется В САНДБОКСЕ (ns+seccomp, net=${sandboxConfig().net})` };
    try { emit("CLASSIFIER_SANDBOX", { cmd: input.cmd.slice(0, 120), rule: result.rule, engine: result.engine }, null, null); } catch { /* шина */ }
    return { verdict: "sandbox", result };
  }

  if (result.verdict === "ask") {
    // ask → очередь оператора (кап queue_max; переполнение = block, fail-closed)
    const pending = (db.query(`SELECT COUNT(*) c FROM review_queue WHERE status='pending'`).get() as { c: number }).c;
    if (pending >= cfg.queue_max) {
      result = { ...result, verdict: "block", reason: `очередь одобрений переполнена (${pending}/${cfg.queue_max}) — fail-closed`, rule: "queue_full" };
    } else {
      const timeout = Math.min(Math.max(Number(rawTimeout) || 20000, 1000), 60000);
      const ins = db.query(`INSERT INTO review_queue (cmd, cwd, timeout_ms, verdict, reason, engine, created_at) VALUES (?,?,?,?,?,?,?)`)
        .run(input.cmd.slice(0, 200), input.cwd.slice(0, 200), timeout, "ask", result.reason.slice(0, 200), result.engine, Date.now());
      result = { ...result, queue_id: Number(ins.lastInsertRowid) };
      try { emit("CLASSIFIER_ASK", { cmd: input.cmd.slice(0, 120), cwd: input.cwd.slice(0, 120), reason: result.reason.slice(0, 160), rule: result.rule, engine: result.engine, queue_id: result.queue_id }, null, null); } catch { /* шина не критична */ }
      return { verdict: "ask", result };
    }
  }

  if (result.verdict === "block") {
    try { emit("CLASSIFIER_BLOCK", { cmd: input.cmd.slice(0, 120), cwd: input.cwd.slice(0, 120), reason: result.reason.slice(0, 160), rule: result.rule, engine: result.engine }, null, null); } catch { /* шина */ }
  }
  return { verdict: result.verdict, result };
}

// ── сухая классификация (POST /review op:classify): без spawn и БЕЗ очереди;
// как в гейте — LLM-путь, если включён (честная симуляция тира-3 для eval/UI) ──
export async function classifyDry(input: ReviewInput): Promise<ReviewResult> {
  const cfg = classifierConfig();
  if (!cfg.enabled) return { verdict: "allow", reason: "классификатор выключен политикой (classifier.enabled=false)", engine: "off", ms: 0 };
  if (cfg.llm_enabled) return llmClassify(input, cfg);
  return reviewPlan(input);
}

// ── статус / статистика (распределение вердиктов за 24ч — evidence §24) ──
export function reviewStatus(): {
  ok: true;
  schema: string;
  config: ClassifierPolicy;
  override: Partial<ClassifierPolicy> | null;
  tier_order: string[];
  honest_limits: string[];
  stats_24h: Record<string, number>;
  queue: { pending: Array<{ id: number; cmd: string; cwd: string; timeout_ms: number; reason: string; engine: string; created_at: number }>; recent: Array<{ id: number; cmd: string; status: string; verdict: string; engine: string; run_ok: number | null; run_exit: number | null; created_at: number; resolved_at: number | null }> };
} {
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const rows = db.query(`SELECT type, COUNT(*) c FROM events WHERE ts>=? AND type IN ('CLASSIFIER_BLOCK','CLASSIFIER_ASK','CLASSIFIER_APPROVED','CLASSIFIER_DENIED') GROUP BY type`).all(since) as Array<{ type: string; c: number }>;
  const stats: Record<string, number> = { CLASSIFIER_BLOCK: 0, CLASSIFIER_ASK: 0, CLASSIFIER_APPROVED: 0, CLASSIFIER_DENIED: 0 };
  for (const r of rows) stats[r.type] = r.c;
  return {
    ok: true, schema: REVIEW_SCHEMA,
    config: classifierConfig(), override: runtimeOverride,
    tier_order: ["allowlist (planExec, сегменты бинарей)", "sandbox-ability (R64 P0-2: ns+seccomp конфайнмент /sandbox; Landlock ≥5.13)", "classifier (heuristic | llm, ask → очередь оператора)"],
    honest_limits: [
      "классификатор НЕ security boundary (канон Cursor; security = tier-1 + prlimit + OS-сандбокс P0-2)",
      "вердикт «sandbox» выдаётся только при sandbox.auto_sandbox=true и живом конфайнменте; иначе канонический ask",
      "LLM-путь ≤3с; таймаут/невалидный ответ → ask (fail-closed к оператору)",
    ],
    stats_24h: stats,
    queue: { pending: queuePending(), recent: queueRecent(20) },
  };
}
