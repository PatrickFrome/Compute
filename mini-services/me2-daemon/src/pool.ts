/**
 * ME2 daemon — Executor Pool (R34, пункт E3 из research/2026/R32-EVIDENCE-ELINE-RESEARCH.md:
 * parallel live-GLM executor pool с честными lease).
 *
 * Директива оператора: «агенты — полноценные живые отдельные агенты GLM на последней версии,
 * работа не фальшивая» + «всё в замкнутый производственный контур».
 *
 * Что это: N слотов-исполнителей (POOL_MAX=4), каждый — РЕАЛЬНЫЙ агент реестра (agents)
 * с каноническим GLM-тегом (плоскость валюты glm.ts покрывает их автоматически: drift=0),
 * исполняющий задачи work_graph в СВОЁМ независимом GLM-контексте (runAgentTask строит
 * свежий контекст на задачу). Пул умножает контуры master-loop'а: K агентов = K параллельных
 * живых GLM-исполнений.
 *
 * Честные lease (ядро анти-фальши пула):
 *  - эксклюзивность: pool_leases.task_id UNIQUE — INSERT-гонка решает владение, второй
 *    работник физически не может взять ту же задачу;
 *  - heartbeat: живой демон продлевает lease (TTL 90s) каждые 10s;
 *  - reaper: просроченный lease = воркер мёртв (рестарт/зависание LLM) → задача честно
 *    FAILED "pool_lease_expired" + POOL_LEASE_REAPED; runAgentTask увидит leaseAlive=false
 *    и не перезапишет статус (урок R28 — гон completion↔handoff закрыт семантикой);
 *  - двойное исполнение невозможно: lease живёт до release, reaper не отдаёт задачу в READY.
 *
 * Универсальность: pool-исполнители берут ЛЮБУЮ READY-задачу (nextReadyTaskAny) — как
 * дежурная смена инженеров, а не ролевая матрица; чинит зависание узких ролей
 * (RESEARCHER/DEBUGGER задачи без агента-носителя висели READY вечно).
 *
 * Роли в контуре: workgraph (рёбра objective→task→pool-agent) → reviewer (C3 ревьюит
 * каждую COMPLETED задачу пула) → evidence (события POOL_* в hash-chain) → fleet
 * (liveness-битность слотов) → approvals (REST /pool вне шины 47/47).
 *
 * REST: GET /pool, POST /pool {op:scale|burn} — вне шины (47/47). Механика ME33.
 */
import { db, emit, nowIso, rid, getTask, updateTask, createTask, listAgents, setAgentPaused, setAgentStatus, type AgentRow, type TaskRow } from "../store";
import { agentTag, canonicalGlm } from "./glm";
import { fleetBeat } from "./fleet";
import { recordSpan } from "./otel";

export const POOL_MAX = 4;
export const POOL_LEASE_TTL_MS = Math.max(30_000, Number(process.env.ME2_POOL_LEASE_TTL_S ?? 90) * 1000);
const HB_EVERY_MS = 10_000;
const REAP_EVERY_MS = 5_000;
const LIVE_EVERY_MS = 15_000;

db.exec(`
CREATE TABLE IF NOT EXISTS pool_workers (
  slot INTEGER PRIMARY KEY,
  agent_id TEXT NOT NULL UNIQUE,
  mode TEXT NOT NULL DEFAULT 'live',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pool_leases (
  task_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  slot INTEGER NOT NULL,
  acquired_at TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  hb_at TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_pool_leases_exp ON pool_leases(done, expires_at);
`);

export interface PoolWorkerRow { slot: number; agent_id: string; mode: string; created_at: string }
export interface PoolLeaseRow { task_id: string; agent_id: string; slot: number; acquired_at: string; expires_at: number; hb_at: string; done: number }

function workerRows(): PoolWorkerRow[] {
  return db.query(`SELECT * FROM pool_workers ORDER BY slot`).all() as PoolWorkerRow[];
}
function leaseRows(done = 0): PoolLeaseRow[] {
  return db.query(`SELECT * FROM pool_leases WHERE done=? ORDER BY acquired_at`).all(done) as PoolLeaseRow[];
}

/** pool-агент? (авторитет — реестр pool_workers, не префикс id). */
export function isPoolAgent(agentId: string): boolean {
  return !!db.query(`SELECT 1 FROM pool_workers WHERE agent_id=?`).get(agentId);
}

export function isPoolTask(taskId: string): boolean {
  return !!db.query(`SELECT 1 FROM pool_leases WHERE task_id=?`).get(taskId);
}

// — параллелизм: живой датчик одновременных lease (доказательство реальной параллельности) —
let maxConcurrent = 0;
export function concurrencyGauge(): { current: number; max_observed: number } {
  const current = leaseRows(0).length;
  if (current > maxConcurrent) maxConcurrent = current;
  return { current, max_observed: maxConcurrent };
}

/**
 * Масштабирование пула: слоты 1..n — live (агент существует, unpause, канонический тег),
 * слоты n+1..POOL_MAX — drain (paused=1, тек. задачи дорабатывают, новых не берёт).
 * Идемпотентно: повторный scale не плодит агентов (UNIQUE slot).
 */
export function poolScale(n: number, by = "operator"): { scale: number; live: number; created: number; drained: number } {
  const want = Math.min(Math.max(0, Math.floor(n) || 0), POOL_MAX);
  const tag = agentTag();
  let created = 0, drained = 0;
  const existing = new Map(workerRows().map((w) => [w.slot, w]));
  for (let slot = 1; slot <= POOL_MAX; slot++) {
    const cur = existing.get(slot);
    if (slot <= want) {
      if (!cur) {
        const a = createAgentForSlot(slot, tag);
        db.query(`INSERT INTO pool_workers (slot,agent_id,mode,created_at) VALUES (?,?,?,?)`).run(slot, a.id, "live", nowIso());
        created++;
        emit("POOL_WORKER_CREATED", { slot, agent_id: a.id, model: a.model }, a.id, null);
      } else {
        setAgentPaused(cur.agent_id, 0);
        db.query(`UPDATE pool_workers SET mode='live' WHERE slot=?`).run(slot);
        syncAgentModel(cur.agent_id, tag);
      }
    } else if (cur && cur.mode !== "drain") {
      setAgentPaused(cur.agent_id, 1);
      db.query(`UPDATE pool_workers SET mode='drain' WHERE slot=?`).run(slot);
      drained++;
    }
  }
  emit("POOL_SCALED", { want, created, drained, canonical: tag, by }, null, null);
  recordSpan("pool.scale", { "me2.scale": want, "me2.created": created, "me2.drained": drained, "me2.model": tag }, Date.now());
  return { scale: want, live: liveCount(), created, drained };
}

function createAgentForSlot(slot: number, model: string): AgentRow {
  const a = { id: rid("ag"), role: "EXECUTOR", status: "IDLE", model, paused: 0, created_at: nowIso(), updated_at: nowIso() };
  db.query(`INSERT INTO agents (id,role,status,model,paused,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`)
    .run(a.id, a.role, a.status, a.model, 0, a.created_at, a.updated_at);
  emit("AGENT_MODEL_SET", { id: a.id, role: a.role, from: "spawn", to: model, by: "pool_spawn_canonical" }, a.id, null);
  return a;
}

function syncAgentModel(agentId: string, tag: string): void {
  const a = db.query(`SELECT id, model FROM agents WHERE id=?`).get(agentId) as { id: string; model: string } | undefined;
  if (!a || a.model === tag) return;
  db.query(`UPDATE agents SET model=?, updated_at=? WHERE id=?`).run(tag, nowIso(), agentId);
  emit("AGENT_MODEL_SET", { id: agentId, from: a.model, to: tag, by: "pool_canonical_sync" }, agentId, null);
}

function liveCount(): number {
  return workerRows().filter((w) => w.mode === "live").length;
}

/** Восстановление пула после рестарта (boot): слоты из БД, канон-синк моделей.
 *  Зомби-lease прошлой инкарнации чистятся немедленно (урок R34: heartbeat в БД продлевал
 *  lease мёртвого воркера вечно → задача-зомби RUNNING). Исполнитель мёртв = lease мёртв:
 *  pool-задачи в RUNNING честно FAILED "pool_lease_expired", без ожидания watchdog'а. */
export function poolRestore(): { restored: number; cleared: number; healed: number } {
  const rows = workerRows();
  const tag = agentTag();
  let restored = 0;
  let healed = 0;
  for (const w of rows) {
    // R35 урок: слот может указывать на УДАЛЁННОГО агента (чурн реестра) → model="?" в
    // статусе и вечный канон-FAIL. Самозаживление: агент реестра отсутствует → пересоздать
    // исполнителя слота с каноническим тегом (режим слота сохраняется: live/drain).
    const exists = !!db.query(`SELECT 1 FROM agents WHERE id=?`).get(w.agent_id);
    if (!exists) {
      db.query(`DELETE FROM pool_workers WHERE slot=?`).run(w.slot);
      const a = createAgentForSlot(w.slot, tag);
      if (w.mode === "drain") setAgentPaused(a.id, 1);
      db.query(`INSERT INTO pool_workers (slot,agent_id,mode,created_at) VALUES (?,?,?,?)`).run(w.slot, a.id, w.mode, nowIso());
      emit("POOL_WORKER_CREATED", { slot: w.slot, agent_id: a.id, model: a.model, heal: "missing_agent_recreated" }, a.id, null);
      healed++;
      if (w.mode === "live") restored++;
      continue;
    }
    if (w.mode === "live") {
      setAgentPaused(w.agent_id, 0);
      syncAgentModel(w.agent_id, tag);
      restored++;
    } else {
      setAgentPaused(w.agent_id, 1);
    }
  }
  // зомби-lease: done=0 из прошлой инкарнации — воркеры мертвы вместе с процессом
  const zombies = leaseRows(0);
  for (const l of zombies) {
    const t = getTask(l.task_id);
    if (t && t.status === "RUNNING") {
      updateTask(t.id, { status: "FAILED", error: "pool_lease_expired" });
      emit("POOL_LEASE_REAPED", { task_id: t.id, slot: l.slot, boot_clear: true }, l.agent_id, t.id);
      recordSpan("pool.boot_clear_lease", { "me2.task_id": t.id, "me2.slot": l.slot }, Date.now(), { status: "ERROR", message: "pool_lease_expired" });
    }
  }
  if (zombies.length) db.query(`DELETE FROM pool_leases WHERE done=0`).run();
  return { restored, cleared: zombies.length, healed };
}

/**
 * Эксклюзивный lease задачи pool-агентом. INSERT-гонка = владение: вторая попытка
 * на ту же задачу получает null (UNIQUE task_id). Вызывается master-loop'ом ПЕРЕД
 * запуском runAgentTask.
 */
export function poolAcquire(agentId: string, taskId: string): PoolLeaseRow | null {
  const w = db.query(`SELECT slot FROM pool_workers WHERE agent_id=?`).get(agentId) as { slot: number } | undefined;
  if (!w) return null;
  const now = Date.now();
  try {
    db.query(`INSERT INTO pool_leases (task_id,agent_id,slot,acquired_at,expires_at,hb_at,done) VALUES (?,?,?,?,?,?,0)`)
      .run(taskId, agentId, w.slot, nowIso(), now + POOL_LEASE_TTL_MS, nowIso());
  } catch {
    return null; // lease уже существует — эксклюзивность честно сработала
  }
  emit("POOL_LEASE_ACQUIRED", { task_id: taskId, slot: w.slot, ttl_s: Math.round(POOL_LEASE_TTL_MS / 1000) }, agentId, taskId);
  concurrencyGauge();
  return db.query(`SELECT * FROM pool_leases WHERE task_id=?`).get(taskId) as PoolLeaseRow;
}

/** Release после завершения (COMPLETED/FAILED/HANDED_OFF — любой финал lease). */
export function poolRelease(agentId: string, taskId: string, outcome: string): void {
  const r = db.query(`DELETE FROM pool_leases WHERE task_id=? AND agent_id=? AND done=0`).run(taskId, agentId);
  if (r.changes > 0) emit("POOL_LEASE_RELEASED", { task_id: taskId, outcome }, agentId, taskId);
}

/**
 * Reaper: просроченный lease = мёртвый работник. Задача, всё ещё RUNNING с мёртвым
 * lease, честно FAILED "pool_lease_expired" (двойное исполнение исключено — lease
 * удаляется, задача НЕ возвращается в READY).
 */
export function poolReap(): { reaped: number; ids: string[] } {
  const now = Date.now();
  const dead = db.query(`SELECT * FROM pool_leases WHERE done=0 AND expires_at<?`).all(now) as PoolLeaseRow[];
  const ids: string[] = [];
  for (const l of dead) {
    db.query(`DELETE FROM pool_leases WHERE task_id=?`).run(l.task_id);
    const t = getTask(l.task_id);
    if (t && t.status === "RUNNING") {
      updateTask(t.id, { status: "FAILED", error: "pool_lease_expired" });
      emit("POOL_LEASE_REAPED", { task_id: t.id, slot: l.slot, expired_s: Math.round((now - l.expires_at) / 1000) }, l.agent_id, t.id);
      recordSpan("pool.reap_lease", { "me2.task_id": t.id, "me2.slot": l.slot }, Date.now(), { status: "ERROR", message: "pool_lease_expired" });
      try { setAgentStatus(l.agent_id, "IDLE"); } catch { /* агент мог быть удалён */ }
    } else {
      emit("POOL_LEASE_REAPED", { task_id: l.task_id, slot: l.slot, orphan: true }, l.agent_id, null);
    }
    ids.push(l.task_id);
  }
  return { reaped: ids.length, ids };
}

/** Liveness-битность живых слотов в fleet (kind=pool-executor, caps: slot+канон). */
export function poolLiveness(): number {
  const tag = agentTag();
  let beat = 0;
  for (const w of workerRows().filter((x) => x.mode === "live")) {
    try {
      fleetBeat({ id: w.agent_id, kind: "pool-executor", caps: { slot: w.slot, glm: tag }, meta: { pool: true } });
      beat++;
    } catch { /* fleet не роняет пул */ }
  }
  return beat;
}

let hbTimer: ReturnType<typeof setInterval> | null = null;
let reapTimer: ReturnType<typeof setInterval> | null = null;
let liveTimer: ReturnType<typeof setInterval> | null = null;

export function startPoolLoops(): void {
  if (!hbTimer) hbTimer = setInterval(() => {
    try {
      const n = Date.now() + POOL_LEASE_TTL_MS;
      db.query(`UPDATE pool_leases SET expires_at=?, hb_at=? WHERE done=0`).run(n, nowIso());
    } catch { /* heartbeat не роняет демон */ }
  }, HB_EVERY_MS);
  if (!reapTimer) reapTimer = setInterval(() => { try { poolReap(); } catch { /* noop */ } }, REAP_EVERY_MS);
  if (!liveTimer) liveTimer = setInterval(() => { try { poolLiveness(); } catch { /* noop */ } }, LIVE_EVERY_MS);
}

export interface PoolStatus {
  ok: true;
  canonical: string;
  scale: number; workers_total: number; live: number; ceiling: number;
  workers: Array<{
    slot: number; agent_id: string; state: string; paused: number; model: string;
    lease: { task_id: string; acquired_at: string; hb_age_s: number; expires_in_s: number } | null;
    agent_status: string;
  }>;
  queue: { ready: number; running: number };
  concurrency: { current: number; max_observed: number };
  leases: { active: number; reaped_total: number };
  throughput: { done_1h: number; failed_1h: number; avg_ms: number | null; p95_ms: number | null };
}

let reapedTotal = 0;
export function poolStatus(): PoolStatus {
  const workers = workerRows();
  const agents = new Map(listAgents().map((a) => [a.id, a]));
  const leases = new Map(leaseRows(0).map((l) => [l.agent_id, l]));
  const now = Date.now();
  const poolAgentIds = new Set(workers.map((w) => w.agent_id));
  const tasks = db.query(`SELECT agent_id,status,updated_at FROM tasks WHERE agent_id IN (${[...poolAgentIds].map(() => "?").join(",") || "''"}) ORDER BY updated_at DESC LIMIT 400`)
    .all(...poolAgentIds) as Array<{ agent_id: string; status: string; updated_at: string }>;
  const hourAgo = now - 3_600_000;
  const recent = tasks.filter((t) => Date.parse(t.updated_at) >= hourAgo);
  // длительность lease честно из hash-chain: POOL_LEASE_ACQUIRED → POOL_LEASE_RELEASED по task_id
  const durs: number[] = [];
  const acq = new Map<string, number>();
  for (const e of db.query(`SELECT task_id,type,ts FROM events WHERE (type='POOL_LEASE_ACQUIRED' OR type='POOL_LEASE_RELEASED') AND ts>=? ORDER BY seq`).all(new Date(hourAgo).toISOString()) as Array<{ task_id: string | null; type: string; ts: string }>) {
    if (!e.task_id) continue;
    if (e.type === "POOL_LEASE_ACQUIRED") acq.set(e.task_id, Date.parse(e.ts));
    else { const a = acq.get(e.task_id); if (a !== undefined) { const d = Date.parse(e.ts) - a; if (Number.isFinite(d) && d >= 0) durs.push(d); acq.delete(e.task_id); } }
  }
  durs.sort((a, b) => a - b);
  const reaped = (db.query(`SELECT COUNT(*) c FROM events WHERE type='POOL_LEASE_REAPED'`).get() as { c: number }).c;
  reapedTotal = Math.max(reapedTotal, reaped);
  const ready = (db.query(`SELECT COUNT(*) c FROM tasks WHERE status='READY'`).get() as { c: number }).c;
  const running = (db.query(`SELECT COUNT(*) c FROM tasks WHERE status='RUNNING'`).get() as { c: number }).c;
  return {
    ok: true,
    canonical: canonicalGlm(),
    scale: liveCount(), workers_total: workers.length, live: liveCount(), ceiling: POOL_MAX,
    workers: workers.map((w) => {
      const a = agents.get(w.agent_id);
      const l = leases.get(w.agent_id);
      return {
        slot: w.slot, agent_id: w.agent_id,
        state: w.mode === "live" ? (l ? "RUNNING" : "IDLE") : "DRAIN",
        paused: a?.paused ?? 1, model: a?.model ?? "?", agent_status: a?.status ?? "?",
        lease: l ? { task_id: l.task_id, acquired_at: l.acquired_at, hb_age_s: Math.round((now - Date.parse(l.hb_at)) / 1000), expires_in_s: Math.max(0, Math.round((l.expires_at - now) / 1000)) } : null,
      };
    }),
    queue: { ready, running },
    concurrency: concurrencyGauge(),
    leases: { active: leaseRows(0).length, reaped_total: reaped },
    throughput: {
      done_1h: recent.filter((t) => t.status === "COMPLETED").length,
      failed_1h: recent.filter((t) => t.status === "FAILED").length,
      avg_ms: durs.length ? Math.round(durs.reduce((s, x) => s + x, 0) / durs.length) : null,
      p95_ms: durs.length ? durs[Math.min(durs.length - 1, Math.floor(durs.length * 0.95))] : null,
    },
  };
}

/**
 * burn — живая дымовая проверка пула: n РЕАЛЬНЫХ задач (role EXECUTOR), исполняемых
 * живыми GLM-работниками через стандартный tool-loop. Это НЕ симуляция: задачи проходят
 * весь контур (lease → GLM-шаги → write_file → COMPLETED → reviewer). Ограничение ≤3.
 */
export function poolBurn(n: number): { created: Array<{ id: string; title: string }> } {
  const k = Math.min(Math.max(1, Math.floor(n) || 1), 3);
  const created: Array<{ id: string; title: string }> = [];
  for (let i = 1; i <= k; i++) {
    const title = `Pool smoke #${i}: файл с отчётом исполнителя`;
    // спека минимальна (урок R34: сложная спека → parse_fails по JSON-протоколу,
    // tier-1 reflection честно ловит protocol_violation — но дымовая задача должна мерить пул, не модель)
    const t = createTask({
      id: rid("task"), title,
      spec: `Создай файл pool-smoke-${i}.txt с единственной строкой POOL-SMOKE ${i} OK. Затем сразу вызови finish.`,
      role: "EXECUTOR", max_steps: 8,
    } as Parameters<typeof createTask>[0]);
    created.push({ id: t.id, title: t.title });
  }
  emit("POOL_BURN", { count: created.length, tasks: created.map((c) => c.id) }, null, null);
  return { created };
}

/** Утилита для eval: синтетический просроченный lease + reap (анти-двойное-исполнение). */
export function poolEvalLeaseCycle(taskId: string, agentId: string): { acquired: boolean; second_attempt: boolean; reaped: boolean } {
  const l1 = poolAcquire(agentId, taskId);
  const l2 = poolAcquire(agentId, taskId); // UNIQUE → null
  updateTask(taskId, { status: "RUNNING" }); // симуляция исполнения под lease (reap действует на RUNNING)
  db.query(`UPDATE pool_leases SET expires_at=? WHERE task_id=?`).run(Date.now() - 1000, taskId);
  const r = poolReap();
  const t = getTask(taskId);
  return {
    acquired: !!l1,
    second_attempt: l2 === null,
    reaped: r.ids.includes(taskId) && t?.status === "FAILED" && t.error === "pool_lease_expired",
  };
}
