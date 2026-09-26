/**
 * ME2 G10 — Автопилот спроса: daemon-demand → create_chat.
 *
 * Идея (пользователь, G-линия): флот должен расти от СПРОСА САМОЙ СИСТЕМЫ, а не только
 * от оператора и супервизора. Демон измеряет живые сигналы перегрузки/голода и сам
 * создаёт профильного чат-агента (CODE/RESEARCH/DEBUG), назначает ему цель (механизм
 * G5) и даёт первый ход. Гистерезис: сигнал должен продержаться 2 тика подряд —
 * никакой дрожи от одиночных всплесков.
 *
 * Сигналы (все — из живого состояния, не синтетика):
 *   ready_backlog   — READY-задач больше N при насыщенном пуле (pool leases ≥ POOL_MAX)
 *                     → CODE-чат «разгреби бэклог»;
 *   research_hunger — READY-задачи с role=RESEARCH, а пул занят реализацией
 *                     → RESEARCH-чат;
 *   fail_storm      — ≥3 TASK_FAILED за 15м
 *                     → DEBUG-чат «разбери отказы».
 *
 * Ограничения (честная дисциплина, G11-aware):
 *   • гистерезис 2 тика на каждый сигнал;  • ME2_DEMAND_MAX активных чатов (default 8);
 *   • per-role cooldown 10м;              • при OPEN circuit-breaker создание ОТЛОЖЕНО
 *     (новый чат без LLM мёртв — автопилот уважает Governor);
 *   • глобальный потолок CHAT_CEILING из agentchat не превышается.
 *
 * Телеметрия: событие AGENT_CHAT_DEMAND (created|deferred|suppressed + причина) в
 * hash-chain — река и супервизор видят каждое решение автопилота, включая отказы.
 */
import { db, emit, listTasks, getMeta, setMeta } from "../store";
import { agentChatCreate, agentChatTurnAsync, chatSetObjective, chatInFlightCount } from "./agentchat";
import { poolStatus } from "./pool";
import { breakerStateForDemand } from "./governor";

const CHAT_CEILING = Number(process.env.ME2_CHAT_CEILING ?? 24); // тот же глобальный потолок, что у create_chat

export const DEMAND_TICK_MS = 60_000;
const DEMAND_MAX_DEFAULT = 8;
const ROLE_COOLDOWN_MS = 10 * 60_000;
const HYSTERESIS_TICKS = 2;
const READY_BACKLOG_MIN = 3;
const FAIL_STORM_MIN = 3;
const FAIL_STORM_WINDOW_MS = 15 * 60_000;

export type DemandSignal = "ready_backlog" | "research_hunger" | "fail_storm";

export interface DemandSnapshot {
  ready_count: number;
  ready_research: number;
  pool_leases: number;
  pool_max: number;
  fails_15m: number;
  active_chats: number;
  breaker_open: boolean;
}

export interface DemandDecision {
  ts: string;
  action: "created" | "deferred" | "suppressed" | "idle";
  signal: DemandSignal | null;
  role: string | null;
  session_id: string | null;
  detail: string;
}

const streak = new Map<DemandSignal, number>();   // гистерезис
const lastCreated = new Map<string, number>();    // role → ms
let lastDecision: DemandDecision | null = null;
let decisionLog: DemandDecision[] = [];
let tickCount = 0;

function cfgMax(): number {
  const v = Number(getMeta("demand_max") ?? "");
  return Number.isFinite(v) && v >= 1 ? v : DEMAND_MAX_DEFAULT;
}
function cfgEnabled(): boolean {
  return (getMeta("demand_enabled") ?? "1") !== "0";
}

export function demandConfig(): { enabled: boolean; max: number } {
  return { enabled: cfgEnabled(), max: cfgMax() };
}

export function demandConfigSet(patch: { enabled?: boolean; max?: number }): { enabled: boolean; max: number } {
  if (typeof patch.enabled === "boolean") setMeta("demand_enabled", patch.enabled ? "1" : "0");
  if (typeof patch.max === "number" && Number.isFinite(patch.max) && patch.max >= 1 && patch.max <= CHAT_CEILING) {
    setMeta("demand_max", String(Math.floor(patch.max)));
  }
  return demandConfig();
}

/** Живой снимок спроса — только факты из БД/пула/брейкера. */
export function demandSnapshot(): DemandSnapshot {
  const tasks = listTasks();
  const ready = tasks.filter((t) => t.status === "READY");
  const ps = poolStatus();
  const leases = ps.leases.active;
  const poolMax = ps.scale || ps.workers_total || 4;
  const since = new Date(Date.now() - FAIL_STORM_WINDOW_MS).toISOString();
  const fails = (db.query(`SELECT COUNT(*) AS c FROM events WHERE type='TASK_FAILED' AND ts>=?`).get(since) as { c: number }).c;
  const activeChats = (db.query(`SELECT COUNT(*) AS c FROM agent_sessions WHERE status='ACTIVE'`).get() as { c: number }).c;
  return {
    ready_count: ready.length,
    ready_research: ready.filter((t) => t.role === "RESEARCH").length,
    pool_leases: leases,
    pool_max: Number(poolMax) || 4,
    fails_15m: Number(fails) || 0,
    active_chats: activeChats,
    breaker_open: breakerStateForDemand(),
  };
}

function roleLastMs(role: string): number {
  const v = Number(getMeta(`demand_last_${role}`) ?? "0");
  return Number.isFinite(v) ? v : 0;
}
function roleLastSet(role: string): void {
  lastCreated.set(role, Date.now());
  setMeta(`demand_last_${role}`, String(Date.now())); // persist: cooldown живёт и через рестарт
}

function classify(s: DemandSnapshot): { signal: DemandSignal; role: string; objective: string } | null {
  if (s.fails_15m >= FAIL_STORM_MIN) {
    return {
      signal: "fail_storm", role: "DEBUG",
      objective: `Разобрать ${s.fails_15m} отказов задач за 15м: прочитай TASK_FAILED в событиях (list_events), диагностируй причины, исправь что в твоих силах, отчёт reply.`,
    };
  }
  if (s.ready_count >= READY_BACKLOG_MIN && s.pool_leases >= s.pool_max) {
    if (s.ready_research >= 2) {
      return {
        signal: "research_hunger", role: "RESEARCH",
        objective: `В бэклоге ${s.ready_research} RESEARCH-задач и пул насыщен (${s.pool_leases}/${s.pool_max}). Возьми research-задачу через create_task-механику: выбери из READY, исследуй, верни результат.`,
      };
    }
    return {
      signal: "ready_backlog", role: "CODE",
      objective: `Бэклог ${s.ready_count} READY-задач при насыщенном пуле (${s.pool_leases}/${s.pool_max}). Возьми задачу (list_chats/daemon_status покажут), выполни, отчитайся reply.`,
    };
  }
  return null;
}

function pushDecision(d: DemandDecision): void {
  lastDecision = d;
  decisionLog.unshift(d);
  if (decisionLog.length > 20) decisionLog.length = 20;
}

/**
 * Один тик автопилота. `opts.snapshot` — инъекция для eval (детерминизм без подмены БД).
 * Создание чата — реальное: agentChatCreate + цель (G5) + первый ход.
 */
export function demandTick(opts: { snapshot?: DemandSnapshot; kick?: boolean } = {}): DemandDecision {
  tickCount++;
  const s = opts.snapshot ?? demandSnapshot();
  if (!cfgEnabled()) {
    const d: DemandDecision = { ts: new Date().toISOString(), action: "idle", signal: null, role: null, session_id: null, detail: "автопилот выключен оператором" };
    pushDecision(d);
    return d;
  }
  const need = classify(s);
  if (!need) {
    for (const k of streak.keys()) streak.set(k, 0);
    const d: DemandDecision = { ts: new Date().toISOString(), action: "idle", signal: null, role: null, session_id: null, detail: "спроса нет (бэклог/пул/отказы в норме)" };
    pushDecision(d);
    return d;
  }
  // гистерезис
  const n = (streak.get(need.signal) ?? 0) + 1;
  streak.set(need.signal, n);
  for (const [k, v] of streak) if (k !== need.signal) streak.set(k, 0);
  if (n < HYSTERESIS_TICKS) {
    const d: DemandDecision = { ts: new Date().toISOString(), action: "deferred", signal: need.signal, role: need.role, session_id: null, detail: `гистерезис ${n}/${HYSTERESIS_TICKS} тика` };
    pushDecision(d);
    return d;
  }
  streak.set(need.signal, 0);
  // дисциплина отказов
  const sup = (detail: string): DemandDecision => ({ ts: new Date().toISOString(), action: "suppressed", signal: need.signal, role: need.role, session_id: null, detail });
  if (s.breaker_open) {
    const d = sup("circuit-breaker OPEN (G11) — создание отложено: новый чат без LLM мёртв");
    pushDecision(d);
    emit("AGENT_CHAT_DEMAND", { ...d, signal: need.signal }, null, null);
    return d;
  }
  if (s.active_chats >= cfgMax()) {
    const d = sup(`лимит автопилота: активных чатов ${s.active_chats}/${cfgMax()}`);
    pushDecision(d);
    emit("AGENT_CHAT_DEMAND", { ...d, signal: need.signal }, null, null);
    return d;
  }
  if (s.active_chats >= CHAT_CEILING) {
    const d = sup(`глобальный потолок чатов ${s.active_chats}/${CHAT_CEILING}`);
    pushDecision(d);
    emit("AGENT_CHAT_DEMAND", { ...d, signal: need.signal }, null, null);
    return d;
  }
  const lc = roleLastMs(need.role);
  if (Date.now() - lc < ROLE_COOLDOWN_MS) {
    const d = sup(`cooldown роли ${need.role}: ещё ${Math.ceil((ROLE_COOLDOWN_MS - (Date.now() - lc)) / 60_000)}м`);
    pushDecision(d);
    return d;
  }
  // СОЗДАНИЕ — живое
  const title = `Demand·${need.role}`;
  const sess = agentChatCreate({ role: need.role, title, model: "zai:glm-5.3" });
  const obj = chatSetObjective(sess.id, need.objective);
  roleLastSet(need.role);
  const d: DemandDecision = {
    ts: new Date().toISOString(), action: "created", signal: need.signal, role: need.role,
    session_id: sess.id, detail: `${title} создан по сигналу ${need.signal} (цель: ${obj.ok ? "назначена" : "не назначена"})`,
  };
  pushDecision(d);
  emit("AGENT_CHAT_DEMAND", { ...d, active_chats: s.active_chats + 1, max: cfgMax() }, sess.agent_id, null);
  // первый ход — если есть LLM-слоты (иначе чат подхватит супервизорский тик)
  if (opts.kick !== false && chatInFlightCount() < 4) {
    try {
      agentChatTurnAsync(sess.id, `Ты создан автопилотом спроса G10 по сигналу «${need.signal}». Твоя цель уже назначена — начни с её выполнения: изучи контекст (daemon_status, list_chats), действуй, отчитайся reply.`);
    } catch { /* ход не критичен: супервизор-тик подхватит */ }
  }
  return d;
}

export function demandStatus(): {
  config: { enabled: boolean; max: number };
  ticks: number;
  last_decision: DemandDecision | null;
  decisions: DemandDecision[];
  snapshot: DemandSnapshot;
} {
  return { config: demandConfig(), ticks: tickCount, last_decision: lastDecision, decisions: [...decisionLog], snapshot: demandSnapshot() };
}

export function demandTestReset(): void {
  streak.clear(); tickCount = 0; lastDecision = null; decisionLog = [];
  // полная изоляция eval-прогонов: снести и персист-кулдауны (eval создаёт реальные чаты —
  // без этого следующий прогон упрётся в cooldown предыдущего)
  for (const role of ["CODE", "RESEARCH", "DEBUG"]) {
    lastCreated.set(role, 0);
    try { db.query(`DELETE FROM meta WHERE key=?`).run(`demand_last_${role}`); } catch { /* таблица meta всегда есть */ }
  }
}
