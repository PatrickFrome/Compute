/**
 * ME2 Autonomy Monitors (H-линия, R38) — машинно-проверяемое ядро мандата v4.
 *
 * Верхний принцип v4: AUTONOMY MUST BE BOTH SAFE AND LIVE.
 *   Система, которая не нарушает инварианты, но перестала продвигаться — неисправна.
 *   Система, которая продвигается, обходя инварианты — неисправна.
 *
 * Пять read-only плоскостей (анализ: research/2026/R38-MANDATE-V4-MAPPING.md):
 *   P2+P3 liveness  — прогресс/голодание + deadlock (циклы handoff-графа) + livelock
 *                     (осцилляция статусов задач без завершения). verdict LIVE/STALLED.
 *   P7   budget     — cumulative blast-radius: взвешенные деструктивные события за 24ч,
 *                     пороги OK/WARN/BREACH (rate-limit ≠ risk-limit).
 *   P1   non_bypass — Policy Enforcement Completeness: POST-маршруты, извлечённые
 *                     регэкспом из ИСХОДНИКА index.ts (не из рукописного манифеста —
 *                     аудитора нельзя обмануть рассинхроном), покрываются
 *                     enforcement-семействами; новый неучтённый маршрут = UNKNOWN_ROUTE.
 *   P5   recovery   — иерархия L0–L5: retry → watchdog/incarnation → supervisor rebirth
 *                     → selfupdate → bootstrap(git) → operator kill-switch.
 *   P4+P8 independence — verifier-independence: reviewer не пишет статусы (source-scan),
 *                     hash-chain верифицируется, evidence производит runtime (emit на
 *                     местах действий), а не исполнитель.
 *
 * Все мониторы read-only: ни одного emit/INSERT/UPDATE — аудит не мутирует аудируемое.
 * REST: GET /autonomy (read-only, вне шины 47/47). Supervisor видит liveness в
 * daemon_status на каждом тике (замыкание контура «detect → diagnose»).
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { db, getMeta } from "../store";
import { verifyChain } from "../evidence";

const REPO = "/home/z/my-project";
const INDEX_TS = join(REPO, "mini-services/me2-daemon/index.ts");
const REVIEWER_TS = join(REPO, "mini-services/me2-daemon/src/reviewer.ts");
const RUNNING_OVERRUN_MS = 10 * 60_000;   // TASK_HARD_DEADLINE воркера: дольше = watchdog обязан был вмешаться
const REVIEWER_BACKLOG_MS = 15 * 60_000;  // COMPLETED без review дольше → reviewer-голодание
const REVIEWER_BACKLOG_MAX = 10;
const READY_WARN_MS = 30 * 60_000;        // возраст старейшей READY (warn-only)
const OSCILLATION_WINDOW_MS = 60 * 60_000;
const OSCILLATION_MAX = 4;                // TASK_FAILED одной задачи за окно → livelock
const BUDGET_WINDOW_MS = 24 * 60_000 * 60_000;
const BUDGET_WARN = Number(process.env.ME2_RISK_BUDGET_WARN ?? 40);
const BUDGET_BREACH = Number(process.env.ME2_RISK_BREACH ?? 80);
const BUDGET_WEIGHTS: Record<string, number> = {
  TASK_FAILED: 1, POOL_LEASE_REAPED: 2, AGENT_CHAT_TURN_FAILED: 1,
  AGENT_CHAT_DEGRADED: 3, TASK_REWARD_HACK: 5, EVAL_FAIL: 2, COMMAND_DENIED: 2,
};

// ── P2+P3: liveness / deadlock / livelock ─────────────────────────
export interface LivenessCheck { id: string; ok: boolean; stall: boolean; detail: string }
export function livenessStatus(): {
  verdict: "LIVE" | "STALLED"; checks: LivenessCheck[]; stalled_reasons: string[];
} {
  const checks: LivenessCheck[] = [];
  const now = Date.now();

  // 1) RUNNING-перерасход: задача RUNNING дольше hard deadline → watchdog обязан был вмешаться
  const running = db.query("SELECT id, title, updated_at FROM tasks WHERE status='RUNNING'").all() as
    Array<{ id: string; title: string; updated_at: string }>;
  const overrun = running.filter((t) => now - Date.parse(t.updated_at) > RUNNING_OVERRUN_MS);
  checks.push({
    id: "running_overrun", ok: overrun.length === 0, stall: true,
    detail: overrun.length ? `RUNNING дольше ${Math.round(RUNNING_OVERRUN_MS / 60000)}м: ${overrun.map((t) => t.id.slice(-8)).join(",")}` : `running=${running.length}, перерасходов=0`,
  });

  // 2) Deadlock: цикл в графе передач (A→B→A) — DFS с раскраской
  const edges = db.query("SELECT from_task, to_task FROM handoffs").all() as Array<{ from_task: string; to_task: string }>;
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (!adj.has(e.from_task)) adj.set(e.from_task, []);
    adj.get(e.from_task)!.push(e.to_task);
  }
  const cycle = findCycle(adj);
  checks.push({
    id: "wait_cycles", ok: cycle === null, stall: true,
    detail: cycle ? `ЦИКЛ ОЖИДАНИЯ: ${cycle.join(" → ")}` : `handoff-рёбер=${edges.length}, циклов=0`,
  });

  // 3) Reviewer-голодание: COMPLETED без review старше порога
  const backlog = (db.query(
    `SELECT COUNT(*) c FROM tasks WHERE status='COMPLETED' AND review IS NULL AND updated_at < ?`,
  ).get(new Date(now - REVIEWER_BACKLOG_MS).toISOString()) as { c: number }).c;
  checks.push({
    id: "reviewer_backlog", ok: backlog <= REVIEWER_BACKLOG_MAX, stall: backlog > REVIEWER_BACKLOG_MAX * 2,
    detail: `завершено без review=${backlog} (порог голодания ${REVIEWER_BACKLOG_MAX * 2})`,
  });

  // 4) Livelock: осцилляция — одна задача падает ≥OSCILLATION_MAX раз за окно без завершения
  const since = new Date(now - OSCILLATION_WINDOW_MS).toISOString();
  const fails = db.query(
    `SELECT task_id, COUNT(*) c FROM events WHERE type='TASK_FAILED' AND ts>=? AND task_id IS NOT NULL GROUP BY task_id HAVING c>=?`,
  ).all(since, OSCILLATION_MAX) as Array<{ task_id: string; c: number }>;
  checks.push({
    id: "oscillation", ok: fails.length === 0, stall: false, // livelock = warn (ретраи легальны до порога стратегии)
    detail: fails.length ? `осцилляция: ${fails.map((f) => `${f.task_id.slice(-8)}×${f.c}`).join(", ")}` : "осцилляций=0",
  });

  // 5) Supervisor жив (мандат «вечно-живущий»): chats активны, а супервизора нет → STALL
  const sups = (db.query(
    `SELECT COUNT(*) c FROM agent_sessions s JOIN agents a ON a.id=s.agent_id WHERE s.status='ACTIVE' AND a.role='SUPERVISOR'`,
  ).get() as { c: number }).c;
  const chats = (db.query("SELECT COUNT(*) c FROM agent_sessions WHERE status='ACTIVE'").get() as { c: number }).c;
  checks.push({
    id: "supervisor_alive", ok: sups > 0, stall: sups === 0,
    detail: `супервизоров=${sups}, активных чатов=${chats}`,
  });

  // 6) Прогресс-факт: система вообще делает что-то за последний час (warn-only)
  const hourAgo = new Date(now - 3_600_000).toISOString();
  const progress = (db.query("SELECT COUNT(*) c FROM events WHERE ts>=? AND type IN ('TASK_DONE','TASK_LEASED','AGENT_CHAT_STEP','FLEET_STEP','AGENT_CHAT_TURN')").get(hourAgo) as { c: number }).c;
  checks.push({ id: "recent_progress", ok: true, stall: false, detail: `живых событий за 1ч=${progress}` });

  // 7) Возраст старейшей READY (warn-only: очередь может легально ждать слот)
  const oldestReady = db.query("SELECT MIN(created_at) m FROM tasks WHERE status='READY'").get() as { m: string | null };
  const readyAgeMs = oldestReady.m ? now - Date.parse(oldestReady.m) : 0;
  checks.push({
    id: "ready_age", ok: true, stall: false,
    detail: oldestReady.m ? `старейшая READY ${(readyAgeMs / 60000).toFixed(0)}м${readyAgeMs > READY_WARN_MS ? " ⚠" : ""}` : "очередь пуста",
  });

  const stalled_reasons = checks.filter((c) => !c.ok && c.stall).map((c) => `${c.id}: ${c.detail}`);
  return { verdict: stalled_reasons.length ? "STALLED" : "LIVE", checks, stalled_reasons };
}

function findCycle(adj: Map<string, string[]>): string[] | null {
  const color = new Map<string, number>(); // 0=white 1=gray 2=black
  const stack: string[] = [];
  const visit = (n: string): string[] | null => {
    color.set(n, 1);
    stack.push(n);
    for (const m of adj.get(n) ?? []) {
      const c = color.get(m) ?? 0;
      if (c === 1) { const i = stack.indexOf(m); return [...stack.slice(i), m]; }
      if (c === 0) { const r = visit(m); if (r) return r; }
    }
    color.set(n, 2);
    stack.pop();
    return null;
  };
  for (const n of adj.keys()) {
    if ((color.get(n) ?? 0) === 0) {
      const r = visit(n);
      if (r) return r;
    }
  }
  return null;
}

/** Краткая liveness-строка для supervisor daemon_status (замыкание detect→diagnose). */
export function livenessBrief(): string {
  try {
    const l = livenessStatus();
    return `автономность: ${l.verdict}${l.stalled_reasons.length ? ` (${l.stalled_reasons[0].slice(0, 80)})` : ""}`;
  } catch { return "автономность: n/a"; }
}

// ── P7: cumulative autonomy/risk budget ───────────────────────────
export function budgetStatus(): {
  state: "OK" | "WARN" | "BREACH"; score: number; warn: number; breach: number; window_h: number;
  contributors: Array<{ type: string; count: number; weight: number; subtotal: number }>;
} {
  const since = new Date(Date.now() - BUDGET_WINDOW_MS).toISOString();
  const rows = db.query(
    `SELECT type, COUNT(*) c FROM events WHERE ts>=? AND type IN (${Object.keys(BUDGET_WEIGHTS).map(() => "?").join(",")}) GROUP BY type`,
  ).all(since, ...Object.keys(BUDGET_WEIGHTS)) as Array<{ type: string; c: number }>;
  const contributors = rows.map((r) => ({ type: r.type, count: r.c, weight: BUDGET_WEIGHTS[r.type] ?? 1, subtotal: r.c * (BUDGET_WEIGHTS[r.type] ?? 1) }))
    .sort((a, b) => b.subtotal - a.subtotal);
  const score = contributors.reduce((a, c) => a + c.subtotal, 0);
  const state = score >= BUDGET_BREACH ? "BREACH" : score >= BUDGET_WARN ? "WARN" : "OK";
  return { state, score, warn: BUDGET_WARN, breach: BUDGET_BREACH, window_h: 24, contributors };
}

// ── P1: Proof-of-Non-Bypass (Policy Enforcement Completeness) ─────
/** Enforcement-семейства: каждый write-маршрут обязан принадлежать одному из них.
 *  Список = ТОЧНОЕ множество POST-маршрутов index.ts (eval v14 ассертит равенство
 *  множеств в обе стороны: маршрут без записи здесь → UNKNOWN_ROUTE → аудит красный;
 *  запись без маршрута → манифест сгнил → тоже FAIL).
 *  Это сознательная классификация: добавить путь мимо принуждения нельзя молча. */
export const ENFORCED_WRITE_FAMILIES: Record<string, string> = {
  "/commands": "ШИНА (главный enforcement): enqueueCommand → полосы EMERGENCY/CONTROL/MUTATION/READ_ONLY + бюджет 24cost/60s + idempotency",
  "/reset": "EMERGENCY kill-switch оператора (полоса 0): ENVIRONMENT_RESET — всегда доступен, root of trust",
  // R46: "/agentchat" снят — операции флота переехали на socket.io "agentchat:op" (ack),
  // POST-маршрут удалён из исходника; манифест обязан отражать исходник (двустороннее равенство P1).
  "/demand": "G10 автопилот спроса: op tick|config, гистерезис+cooldown+капы (ME2_DEMAND_MAX/CHAT_CEILING)+breaker-aware, решения в hash-chain (AGENT_CHAT_DEMAND)",
  "/policy": "H2 (R44) policy-файл T0/T1/T2: op reload — перечитывание policy.json, запреты с ledger-полями (POLICY_DENIED в chain)",
  "/cron": "G7 (R44) cron из чатов: op cancel|fire|tick, капы policy.json (crons_per_chat/global/min_minutes), AGENT_CHAT_CRON в chain",
  "/tokens": "R47 vault токенов: op set|delete (REST POST /tokens + socket.io tokens:op, T0-плоскость), валидация имени/значения/тира, TOKENS_SET/TOKENS_DELETED в chain, raw-значения наружу не выходят (маска)",
  "/pool": "REST-семейство E3: lease-плоскость (UNIQUE-эксклюзивность) + потолок POOL_MAX + POOL_* в chain",
  "/evidence": "REST-семейство E1: mirror-плоскость, honest-статусы, cap'ы outbox",
  "/memory": "REST-семейство E5: экономная доставка, cap журнала, MEMORY_ECONOMY в chain",
  "/glm": "REST-семейство валюты моделей: канон + drift-проверка, AGENT_MODEL_SET в chain",
  "/eval/run": "eval-харнес: versioned dataset (EVAL_DATASET_VERSION), результаты в eval_runs",
  "/approvals": "ГЕЙТ C4 (policy-плоскость): gateCheck с формальными предикатами + expiry",
  "/objectives": "objective-плоскость: валидация статусов (OBJECTIVE_STATUSES), события в chain",
  "/reviews/run": "C3 reviewer: zero-authority вердикты (никогда не пишет статус задачи)",
  "/tasks": "task-плоскость: enqueue через шину/воркера, статусы канонические",
  "/agents": "реестр агентов: создание/модель через канон (AGENT_MODEL_SET в chain)",
  "/workers/heartbeat": "worker-plane liveness: идентичность воркера, без мутаций домена",
  "/fleet/beat": "fleet-heartbeat: Outcome River тик, read-агрегаты",
  "/brain/think": "brain-плоскость: reasoning-запись (предложение ≠ исполнение — гейты отдельно)",
  "/browser/sense/act": "browser-плоскость ACT: one-attempt + TargetInfo/generation/incarnation + fence + 5 вердиктов",
  "/browser/effect": "effect-вердикты: 5 статусов epistemологии, CONFIRMED требует доказательства",
  "/browser/obsv": "obsv-канал: append-only кольца наблюдений",
  "/sandbox": "sandbox-плоскость: worktree + prlimit (as/nofile/core) + белые списки имён",
  "/worktrees/rerere": "rerere-плоскость: переиспользование разрешений конфликтов",
  "/codegraph/scan": "codegraph: скан исходников (read-анализ, отчёт в БД)",
  "/rsi": "RSI-ledger: adopt/reject/rollback — adopt только через approval-гейт rsi_adopt",
  "/selfupdate": "self-update: verify→apply→health→rollback, ff-only барьер, подпись",
  "/db/hygiene": "DB-гигиена: WAL checkpoint/PRAGMA, без деструктива домена",
  "/mcp": "MCP-шлюз: JSON-RPC поверх тех же REST-семейств (отдельного пути нет)",
};
export function nonBypassAudit(): {
  verdict: "NO_BYPASS" | "UNKNOWN_ROUTE"; post_routes: string[]; classified: number;
  unknown: string[]; note: string;
} {
  let src = "";
  try { src = readFileSync(INDEX_TS, "utf8"); } catch { src = ""; }
  // извлечение ВСЕХ POST-маршрутов из исходника (маршруты могут добавляться,
  // манифест — нет: рассинхрон = красный аудит, это желаемое свойство)
  const routes = new Set<string>();
  const re = /path\.startsWith\("([^"]+)"\)\s*&&\s*req\.method === "POST"|path === "([^"]+)"\s*&&\s*req\.method === "POST"/g;
  for (const m of src.matchAll(re)) {
    const p = m[1] ?? m[2];
    if (p) routes.add(p.startsWith("/") ? p : `/${p}`);
  }
  const unknown = [...routes].filter((r) => !(r in ENFORCED_WRITE_FAMILIES));
  const laneOk = src.includes('enqueueCommand') && src.includes('EMERGENCY');
  return {
    verdict: unknown.length === 0 && laneOk ? "NO_BYPASS" : "UNKNOWN_ROUTE",
    post_routes: [...routes].sort(), classified: [...routes].length - unknown.length,
    unknown,
    note: laneOk
      ? "все POST-маршруты ∈ enforcement-семействам (шина с полосами/бюджетом | именованные REST-семейства с валидацией+evidence | гейты policy-плоскости)"
      : "шина/kill-switch не найдены в исходнике — маршрут принуждения сломан",
  };
}

// ── P5: Recovery Hierarchy (L0–L5) ────────────────────────────────
export function recoveryHierarchy(): Array<{ level: string; component: string; status: string; recovers: string }> {
  const rows: Array<{ level: string; component: string; status: string; recovers: string }> = [];
  // L0: retry-контуры (backoff LLM-вызовов за 1ч)
  const backoffs = (db.query("SELECT COUNT(*) c FROM events WHERE type='LLM_BACKOFF' AND ts>=?").get(new Date(Date.now() - 3_600_000).toISOString()) as { c: number }).c;
  rows.push({ level: "L0", component: "local retry/backoff", status: `backoff-циклов за 1ч=${backoffs} (контур жив)`, recovers: "транзиентные отказы вызовов" });
  // L1: watchdog + incarnation guard
  let l1 = "n/a";
  try {
    const lock = readFileSync("/tmp/me2-daemon.lock", "utf8").trim();
    const pid = Number(lock.split(/\s+/)[0]);
    process.kill(pid, 0);
    l1 = `lock жив (pid ${pid}), инкарнация единственная`;
  } catch { l1 = "lock-файл не читается/pid мёртв — watchdog перезапустит"; }
  rows.push({ level: "L1", component: "watchdog + incarnation guard", status: l1, recovers: "падение/дубль процесса daemon" });
  // L2: supervisor rebirth
  const rebirths = (db.query(`SELECT COUNT(*) c FROM events WHERE type='AGENT_CREATED' AND data LIKE '%"role":"SUPERVISOR"%'`).get() as { c: number }).c;
  const sups = (db.query(`SELECT COUNT(*) c FROM agent_sessions s JOIN agents a ON a.id=s.agent_id WHERE s.status='ACTIVE' AND a.role='SUPERVISOR'`).get() as { c: number }).c;
  rows.push({ level: "L2", component: "supervisor rebirth", status: `супервизоров=${sups}, рождений всего=${rebirths}`, recovers: "смерть координатора флота" });
  // L3: self-update плоскость (последние SELFUPDATE_* события)
  const su = db.query("SELECT type, ts FROM events WHERE type LIKE 'SELFUPDATE%' OR type LIKE 'SELF_UPDATE%' ORDER BY seq DESC LIMIT 1").get() as { type: string; ts: string } | undefined;
  rows.push({ level: "L3", component: "self-update control plane", status: su ? `последнее: ${su.type} @ ${su.ts.slice(11, 19)}` : "применений не было (стартовое состояние)", recovers: "деградация версии daemon (verify→apply→health→rollback)" });
  // L4: immutable bootstrap — git HEAD (источник истины вне живого процесса)
  let l4 = "n/a";
  try {
    const head = execFileSync("git", ["log", "-1", "--format=%h %s"], { cwd: REPO, timeout: 4000 }).toString().trim();
    l4 = head.slice(0, 80);
  } catch { l4 = "git недоступен из runtime (bootstrap только через клон ветки)"; }
  rows.push({ level: "L4", component: "bootstrap: ветка sandbox/me2-os (GitHub)", status: l4, recovers: "полная потеря песочницы (env-recovery из капсулы/ветки)" });
  // L5: operator kill-switch
  const emergency = (db.query(`SELECT COUNT(*) c FROM commands WHERE lane='EMERGENCY'`).get() as { c: number }).c;
  rows.push({ level: "L5", component: "operator kill-switch (EMERGENCY lane)", status: `полоса EMERGENCY в шине, команд было=${emergency}, /reset доступен`, recovers: "любое неконтролируемое поведение (полный сброс среды)" });
  return rows;
}

// ── P4+P8: independence / meta-audit ──────────────────────────────
export function independenceProof(): {
  reviewer_writes_status: boolean; reviewer_guarded: boolean; chain_ok: boolean; chain_checked: number;
  evidence_producer: string; meta_note: string;
} {
  let src = "";
  try { src = readFileSync(REVIEWER_TS, "utf8"); } catch { src = ""; }
  const writesStatus = /UPDATE\s+tasks\s+SET\s+status/i.test(src);
  const guarded = src.includes("review IS NULL");
  let chain_ok = false, chain_checked = 0;
  try {
    const r = verifyChain(undefined, undefined, 200);
    chain_ok = r.ok; chain_checked = r.checked;
  } catch { /* цепь не блокирует independence */ }
  return {
    reviewer_writes_status: writesStatus,
    reviewer_guarded: guarded,
    chain_ok, chain_checked,
    evidence_producer: "runtime: emit() на местах действий (worker/agentchat/pool), исполнитель не пишет собственное доказательство",
    meta_note: "meta-audit: классы дефектов, невидимые этому аудиту, — статические (не-runtime) баги логики; полная процедура двухпроходного аудита — H4 (маппинг §5)",
  };
}

export function autonomyStatus(): {
  liveness: ReturnType<typeof livenessStatus>;
  budget: ReturnType<typeof budgetStatus>;
  non_bypass: ReturnType<typeof nonBypassAudit>;
  recovery: ReturnType<typeof recoveryHierarchy>;
  independence: ReturnType<typeof independenceProof>;
  version_meta: string;
} {
  return {
    liveness: livenessStatus(),
    budget: budgetStatus(),
    non_bypass: nonBypassAudit(),
    recovery: recoveryHierarchy(),
    independence: independenceProof(),
    version_meta: String(getMeta("version") ?? ""),
  };
}
