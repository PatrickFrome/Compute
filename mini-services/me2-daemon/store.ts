/**
 * ME2 Store v2 — локальный SQLite (WAL). Горячий путь рантайма.
 * Один автор состояния: master loop в worker.ts. Консоль/облако — подписчики.
 *
 * v2 (M1 spec, DB-AUDIT §4):
 *  - events: hash-chain (prev_hash → hash), актёр/субъект
 *  - commands: command bus с 4 полосами, бюджетом 24 cost/60s, idempotency_key UNIQUE
 *  - workers: внешний реестр (API|PLATFORM) с heartbeat
 *  - meta: key-value (seed-флаги, версии, generation floor)
 */
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = join(dirname(fileURLToPath(import.meta.url)), "data");
mkdirSync(HERE, { recursive: true });

export const db = new Database(join(HERE, "me2.db"));
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA synchronous = NORMAL;");
db.exec("PRAGMA busy_timeout = 5000;");

db.exec(`
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'IDLE',
  model TEXT NOT NULL DEFAULT 'zai:default',
  paused INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  spec TEXT NOT NULL,
  role TEXT,
  parent_id TEXT,
  status TEXT NOT NULL DEFAULT 'READY',
  agent_id TEXT,
  max_steps INTEGER NOT NULL DEFAULT 8,
  steps INTEGER NOT NULL DEFAULT 0,
  result TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  type TEXT NOT NULL,
  agent_id TEXT,
  task_id TEXT,
  data TEXT,
  prev_hash TEXT,
  hash TEXT
);
CREATE TABLE IF NOT EXISTS commands (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  lane TEXT NOT NULL DEFAULT 'READ_ONLY',
  status TEXT NOT NULL DEFAULT 'PENDING',
  payload TEXT,
  result TEXT,
  idempotency_key UNIQUE,
  cost INTEGER NOT NULL DEFAULT 0,
  run_after INTEGER,
  created_at TEXT NOT NULL,
  leased_at TEXT,
  completed_at TEXT,
  error TEXT
);
CREATE TABLE IF NOT EXISTS workers (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'API',
  state TEXT NOT NULL DEFAULT 'IDLE',
  generation INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  heartbeat_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE INDEX IF NOT EXISTS idx_commands_status ON commands(status, lane, created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status, created_at);
CREATE INDEX IF NOT EXISTS idx_events_seq ON events(seq);
CREATE INDEX IF NOT EXISTS idx_events_task ON events(task_id);
`);

// миграции старых схем (events без hash, agents без paused, commands без run_after)
const eventCols = (db.query(`PRAGMA table_info(events)`).all() as Array<{ name: string }>).map((c) => c.name);
if (!eventCols.includes("prev_hash")) db.exec(`ALTER TABLE events ADD COLUMN prev_hash TEXT`);
if (!eventCols.includes("hash")) db.exec(`ALTER TABLE events ADD COLUMN hash TEXT`);
const agentCols = (db.query(`PRAGMA table_info(agents)`).all() as Array<{ name: string }>).map((c) => c.name);
if (!agentCols.includes("paused")) db.exec(`ALTER TABLE agents ADD COLUMN paused INTEGER NOT NULL DEFAULT 0`);
const cmdCols = (db.query(`PRAGMA table_info(commands)`).all() as Array<{ name: string }>).map((c) => c.name);
if (!cmdCols.includes("run_after")) db.exec(`ALTER TABLE commands ADD COLUMN run_after INTEGER`);
// v0.7.0: lineage задач для merge-линий ВЕТКИ (TASK_RETRY ставит parent_id)
const taskCols = (db.query(`PRAGMA table_info(tasks)`).all() as Array<{ name: string }>).map((c) => c.name);
if (!taskCols.includes("parent_id")) db.exec(`ALTER TABLE tasks ADD COLUMN parent_id TEXT`);
// v0.9.0: рефлексия провала (паттерн Reflexion) — детерминированный диагноз, child-ретрай читает как эпизодическую память
if (!taskCols.includes("reflection")) db.exec(`ALTER TABLE tasks ADD COLUMN reflection TEXT`);
// R27 C1: Mission Control — проекция objectives→tasks→agents→effects (fails-closed, zero-authority)
if (!taskCols.includes("objective_id")) db.exec(`ALTER TABLE tasks ADD COLUMN objective_id TEXT`);
// R29 C3: reviewer-agent — LLM-ревью результата против спека (антифальшь, директива оператора)
if (!taskCols.includes("review")) db.exec(`ALTER TABLE tasks ADD COLUMN review TEXT`);

export type AgentRow = {
  id: string; role: string; status: string; model: string; paused: number; created_at: string; updated_at: string;
};
export type TaskRow = {
  id: string; title: string; spec: string; role: string | null; parent_id: string | null; status: string;
  agent_id: string | null; max_steps: number; steps: number; result: string | null;
  error: string | null; reflection: string | null; objective_id: string | null; review: string | null; created_at: string; updated_at: string;
};
export type EventRow = {
  seq: number; ts: string; type: string; agent_id: string | null; task_id: string | null; data: string;
  prev_hash: string | null; hash: string | null;
};
export type CommandRow = {
  id: string; action: string; lane: string; status: string; payload: string | null; result: string | null;
  idempotency_key: string | null; cost: number; run_after: number | null; created_at: string;
  leased_at: string | null; completed_at: string | null; error: string | null;
};
export type WorkerRow = {
  id: string; role: string; kind: string; state: string; generation: number;
  created_at: string; heartbeat_at: string;
};

// ── полосы и бюджет (spec: EMERGENCY 0 / CONTROL 1 / MUTATION 5 / READ_ONLY 9; бюджет 24 cost/60s) ──
export const LANES = {
  EMERGENCY: { priority: 0, cost: 0 },
  CONTROL: { priority: 1, cost: 1 },
  MUTATION: { priority: 5, cost: 2 },
  READ_ONLY: { priority: 9, cost: 0 },
} as const;
export type Lane = keyof typeof LANES;
export const BUDGET_LIMIT = 24;
export const BUDGET_WINDOW_MS = 60_000;

/** Явное сопоставление действий полосам, когда суффикс-эвристика недостаточна (v0.5.0). */
export const LANE_OF: Record<string, Lane> = {
  TASK_LIST: "READ_ONLY",
  TASK_ARCHIVE: "MUTATION",
  AGENT_MODEL: "MUTATION",
  WORKSPACE_SNAPSHOT: "READ_ONLY",
  EVENTS_SEARCH: "READ_ONLY",
  BUDGET_ADJUST: "CONTROL",
  // v0.6.0: браузерная группа + обслуживание
  BROWSER_TABS: "READ_ONLY",
  BROWSER_OPEN: "MUTATION",
  BROWSER_SNAPSHOT: "READ_ONLY",
  BROWSER_SCREENSHOT: "READ_ONLY",
  BROWSER_CLOSE: "CONTROL",
  WORKER_REAP: "CONTROL",
  DB_STATS: "READ_ONLY",
  TASK_PURGE: "EMERGENCY",
  // v0.7.0: браузерная навигация/актuation + workspace-операции (финиш 47/47)
  BROWSER_NAVIGATE: "MUTATION",
  BROWSER_BACK: "MUTATION",
  BROWSER_FORWARD: "MUTATION",
  BROWSER_RELOAD: "MUTATION",
  BROWSER_CLICK: "MUTATION",
  BROWSER_TYPE: "MUTATION",
  BROWSER_PRESS: "MUTATION",
  BROWSER_SCROLL: "MUTATION",
  BROWSER_SELECT_TAB: "CONTROL",
  BROWSER_URL: "READ_ONLY",
  BROWSER_TITLE: "READ_ONLY",
  BROWSER_TEXT: "READ_ONLY",
  WORKSPACE_READ: "READ_ONLY",
  WORKSPACE_WRITE: "MUTATION",
};
/** Индивидуальные cost для действий, чей тариф отличается от дефолта полосы (spec R4). */
export const COST_OF: Record<string, number> = {
  WORKSPACE_SNAPSHOT: 1,
  EVENTS_SEARCH: 1,
  TASK_ARCHIVE: 1,
  AGENT_MODEL: 1,
  BROWSER_OPEN: 1,
  BROWSER_SNAPSHOT: 1,
  BROWSER_SCREENSHOT: 1,
  BROWSER_CLOSE: 1,
  WORKER_REAP: 1,
  BROWSER_CLICK: 2,
  BROWSER_TYPE: 2,
  BROWSER_TEXT: 2,
  WORKSPACE_WRITE: 2,
};

/** Лимит бюджета шины — оператор настраивает через BUDGET_ADJUST (meta: budget_limit, clamp 6..96). */
export function budgetLimit(): number {
  const v = Number(getMeta("budget_limit"));
  return Number.isFinite(v) && v >= 6 && v <= 96 ? Math.round(v) : BUDGET_LIMIT;
}

export function nowIso() { return new Date().toISOString(); }
export function rid(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// ── живая трансляция событий (index.ts подписывает socket.io) ─────
type EventListener = (e: EventRow) => void;
const eventListeners = new Set<EventListener>();
export function onEvent(fn: EventListener) { eventListeners.add(fn); return () => eventListeners.delete(fn); }

// ── meta ──────────────────────────────────────────────────────────
export function getMeta(key: string): string | null {
  const r = db.query(`SELECT value FROM meta WHERE key=?`).get(key) as { value: string } | null;
  return r?.value ?? null;
}
export function setMeta(key: string, value: string) {
  db.query(`INSERT INTO meta (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
    .run(key, value);
}

// ── events (hash-chain) ───────────────────────────────────────────
function chainHash(prev: string | null, ts: string, type: string, actor: string | null, subject: string | null, data: string): string {
  return createHash("sha256").update(`${prev ?? "GENESIS"}|${ts}|${type}|${actor ?? "-"}|${subject ?? "-"}|${data}`).digest("hex");
}
export function lastEventHash(): string | null {
  const r = db.query(`SELECT hash FROM events ORDER BY seq DESC LIMIT 1`).get() as { hash: string | null } | null;
  return r?.hash ?? null;
}
export function emit(type: string, data: Record<string, unknown>, agentId?: string | null, taskId?: string | null): EventRow {
  const e: EventRow = {
    seq: 0, ts: nowIso(), type, agent_id: agentId ?? null, task_id: taskId ?? null,
    data: JSON.stringify(data).slice(0, 8000), prev_hash: null, hash: null,
  };
  const prev = lastEventHash();
  e.prev_hash = prev;
  e.hash = chainHash(prev, e.ts, e.type, e.agent_id, e.task_id, e.data);
  const res = db.query(`INSERT INTO events (ts,type,agent_id,task_id,data,prev_hash,hash) VALUES (?,?,?,?,?,?,?)`)
    .run(e.ts, e.type, e.agent_id, e.task_id, e.data, e.prev_hash, e.hash);
  e.seq = Number(res.lastInsertRowid);
  for (const fn of eventListeners) { try { fn(e); } catch { /* listener error не роняет emit */ } }
  return e;
}
export function tailEvents(since = 0, limit = 200): EventRow[] {
  return db.query(`SELECT * FROM events WHERE seq>? ORDER BY seq ASC LIMIT ?`).all(since, limit) as EventRow[];
}
export function eventsByTask(taskId: string, limit = 300): EventRow[] {
  return db.query(`SELECT * FROM events WHERE task_id=? ORDER BY seq ASC LIMIT ?`).all(taskId, limit) as EventRow[];
}

// ── agents ────────────────────────────────────────────────────────
export function createAgent(role: string, model: string): AgentRow {
  const a: AgentRow = { id: rid("ag"), role, status: "IDLE", model, paused: 0, created_at: nowIso(), updated_at: nowIso() };
  db.query(`INSERT INTO agents (id, role, status, model, paused, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`)
    .run(a.id, a.role, a.status, a.model, a.paused, a.created_at, a.updated_at);
  return a;
}
export function setAgentPaused(id: string, paused: number) {
  db.query(`UPDATE agents SET paused=?, updated_at=? WHERE id=?`).run(paused ? 1 : 0, nowIso(), id);
}
export function getAgent(id: string): AgentRow | null {
  return (db.query(`SELECT * FROM agents WHERE id=?`).get(id) as AgentRow | null) ?? null;
}
export function listAgents(): AgentRow[] {
  return db.query(`SELECT * FROM agents ORDER BY created_at`).all() as AgentRow[];
}
export function setAgentStatus(id: string, status: string) {
  db.query(`UPDATE agents SET status=?, updated_at=? WHERE id=?`).run(status, nowIso(), id);
}
export function deleteAgent(id: string) {
  db.query(`DELETE FROM agents WHERE id=?`).run(id);
}

// ── tasks ─────────────────────────────────────────────────────────
export type NewTask = Omit<TaskRow, "status" | "agent_id" | "steps" | "result" | "error" | "reflection" | "created_at" | "updated_at" | "parent_id" | "objective_id"> & { parent_id?: string | null; objective_id?: string | null; reflection?: string | null };
export function createTask(t: NewTask): TaskRow {
  const row: TaskRow = { ...t, parent_id: t.parent_id ?? null, objective_id: t.objective_id ?? null, status: "READY", agent_id: null, steps: 0, result: null, error: null, reflection: t.reflection ?? null, created_at: nowIso(), updated_at: nowIso() };
  db.query(`INSERT INTO tasks (id,title,spec,role,parent_id,status,agent_id,max_steps,steps,result,error,reflection,objective_id,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(row.id, row.title, row.spec, row.role, row.parent_id, row.status, row.agent_id, row.max_steps, row.steps, row.result, row.error, row.reflection, row.objective_id, row.created_at, row.updated_at);
  return row;
}
export function listTasks(opts: { includeArchived?: boolean } = {}): TaskRow[] {
  return db.query(
    opts.includeArchived
      ? `SELECT * FROM tasks ORDER BY created_at DESC LIMIT 200`
      : `SELECT * FROM tasks WHERE status!='ARCHIVED' ORDER BY created_at DESC LIMIT 200`,
  ).all() as TaskRow[];
}
export function getTask(id: string): TaskRow | null {
  return (db.query(`SELECT * FROM tasks WHERE id=?`).get(id) as TaskRow | null) ?? null;
}
export function nextReadyTask(agentRole: string): TaskRow | null {
  return (db.query(
    `SELECT * FROM tasks WHERE status='READY' AND (role IS NULL OR role='' OR role=?) ORDER BY created_at LIMIT 1`,
  ).get(agentRole) as TaskRow | null) ?? null;
}
export function updateTask(id: string, patch: Partial<TaskRow>) {
  const cols = Object.keys(patch);
  if (!cols.length) return;
  const set = cols.map((c) => `${c}=?`).join(",");
  db.query(`UPDATE tasks SET ${set}, updated_at=? WHERE id=?`).run(...(Object.values(patch) as unknown[]), nowIso(), id);
}
export function cancelTask(id: string) {
  const t = getTask(id);
  if (t && (t.status === "READY" || t.status === "RUNNING")) updateTask(id, { status: "CANCELLED", agent_id: null });
}
/** tier-2 LLM-рефлексия: обогащение tasks.reflection полем llm (не через шину — это enrichment, не агентская команда). */
export function setTaskReflectionLlm(id: string, llm: { lesson: string; fix?: string; model?: string; source?: string }) {
  const t = getTask(id);
  if (!t) throw new Error("task_not_found");
  let base: Record<string, unknown> = {};
  if (t.reflection) {
    try { base = JSON.parse(t.reflection) as Record<string, unknown>; } catch { base = {}; }
  }
  base.llm = { ...llm, at: nowIso() };
  updateTask(id, { reflection: JSON.stringify(base).slice(0, 8000) });
  return emit("TASK_REFLECTED", { task_id: id, has_llm: true, model: llm.model ?? null, source: llm.source ?? "operator" }, null, id);
}
export function setAgentModel(id: string, model: string) {
  db.query(`UPDATE agents SET model=?, updated_at=? WHERE id=?`).run(model.slice(0, 64), nowIso(), id);
}
/** Поиск по событиям (подстрока в type+data); ESCAPE-экранирование % и _. */
export function searchEvents(q: string, limit = 50): EventRow[] {
  const like = `%${q.replace(/[%_]/g, "!$&")}%`;
  return db.query(
    `SELECT * FROM events WHERE type LIKE ?1 ESCAPE '!' OR data LIKE ?1 ESCAPE '!' ORDER BY seq DESC LIMIT ?2`,
  ).all(like, limit) as EventRow[];
}

// ── command bus ───────────────────────────────────────────────────
export function budgetWindow(): { used: number; limit: number; window_ms: number; reset_hint: string } {
  const since = new Date(Date.now() - BUDGET_WINDOW_MS).toISOString();
  const r = db.query(
    `SELECT COALESCE(SUM(cost),0) AS used FROM commands WHERE created_at>=? AND status IN ('PENDING','RUNNING','COMPLETED') AND lane!='EMERGENCY'`,
  ).get(since) as { used: number };
  return { used: Number(r.used), limit: budgetLimit(), window_ms: BUDGET_WINDOW_MS, reset_hint: since };
}

export type EnqueueResult =
  | { ok: true; command: CommandRow; deduped: boolean }
  | { ok: false; error: string };

export function enqueueCommand(input: {
  action: string; lane?: string; payload?: Record<string, unknown>;
  idempotency_key?: string | null; cost?: number; run_after?: number | null;
}): EnqueueResult {
  const action = String(input.action ?? "").toUpperCase().slice(0, 64);
  if (!action) return { ok: false, error: "action_required" };

  const lane = (String(input.lane ?? "").toUpperCase() || inferLane(action)) as Lane;
  if (!(lane in LANES)) return { ok: false, error: `unknown_lane_${lane}` };
  const laneSpec = LANES[lane];

  // idempotency: повтор с тем же ключом возвращает исходную команду
  if (input.idempotency_key) {
    const dup = db.query(`SELECT * FROM commands WHERE idempotency_key=?`).get(input.idempotency_key) as CommandRow | undefined;
    if (dup) return { ok: true, command: dup, deduped: true };
  }

  const cost = input.cost ?? COST_OF[action] ?? laneSpec.cost;
  if (lane !== "EMERGENCY") {
    const b = budgetWindow();
    if (b.used + cost > b.limit) {
      insertCommand({ action, lane, status: "REJECTED", payload: input.payload ?? null, idempotency_key: input.idempotency_key ?? null, cost, error: "budget_exceeded" });
      return { ok: false, error: `budget_exceeded (used ${b.used}/${b.limit} per ${BUDGET_WINDOW_MS / 1000}s)` };
    }
  }
  const runAfter = input.run_after ?? null;
  const cmd = insertCommand({ action, lane, status: "PENDING", payload: input.payload, idempotency_key: input.idempotency_key ?? null, cost, error: null, run_after: runAfter });
  emit("COMMAND_ENQUEUED", { action, lane, cost, id: cmd.id, ...(runAfter ? { run_after: runAfter, scheduled: true } : {}) }, null, null);
  return { ok: true, command: cmd, deduped: false };
}

function insertCommand(c: {
  action: string; lane: string; status: string; payload?: Record<string, unknown> | null;
  idempotency_key: string | null; cost: number; error: string | null; run_after?: number | null;
}): CommandRow {
  const row: CommandRow = {
    id: rid("cmd"), action: c.action, lane: c.lane, status: c.status,
    payload: c.payload ? JSON.stringify(c.payload).slice(0, 8000) : null,
    result: null, idempotency_key: c.idempotency_key, cost: c.cost, run_after: c.run_after ?? null,
    created_at: nowIso(), leased_at: null, completed_at: null, error: c.error,
  };
  try {
    db.query(`INSERT INTO commands (id,action,lane,status,payload,result,idempotency_key,cost,run_after,created_at,leased_at,completed_at,error)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(row.id, row.action, row.lane, row.status, row.payload, row.result, row.idempotency_key, row.cost, row.run_after, row.created_at, row.leased_at, row.completed_at, row.error);
  } catch (e) {
    // UNIQUE idempotency_key — гонка двух одинаковых команд: вернуть существующую
    if (c.idempotency_key) {
      const dup = db.query(`SELECT * FROM commands WHERE idempotency_key=?`).get(c.idempotency_key) as CommandRow | undefined;
      if (dup) return dup;
    }
    throw e;
  }
  return row;
}

function inferLane(action: string): Lane {
  if (LANE_OF[action]) return LANE_OF[action]; // явные переопределения реестра v0.5.0
  if (action.endsWith("_RESET") || action.startsWith("FLUSH") || action.endsWith("_FLUSH") || action.startsWith("FENCE")) return "EMERGENCY";
  if (action.endsWith("_CANCEL") || action.endsWith("_RETIRE") || action.endsWith("_PAUSE") || action.endsWith("_RESUME")) return "CONTROL";
  if (action.endsWith("_ENQUEUE") || action.endsWith("_SPAWN") || action.endsWith("_RETRY") || action.endsWith("_CREATE") || action.endsWith("_UPDATE") || action.endsWith("_DELETE")) return "MUTATION";
  return "READ_ONLY";
}

export function listCommands(limit = 100): CommandRow[] {
  return db.query(`SELECT * FROM commands ORDER BY created_at DESC LIMIT ?`).all(limit) as CommandRow[];
}
export function nextPendingCommands(limit = 8): CommandRow[] {
  return db.query(
    `SELECT * FROM commands WHERE status='PENDING' AND (run_after IS NULL OR run_after<=?)
     ORDER BY CASE lane WHEN 'EMERGENCY' THEN 0 WHEN 'CONTROL' THEN 1 WHEN 'MUTATION' THEN 5 ELSE 9 END, created_at
     LIMIT ?`,
  ).all(Date.now(), limit) as CommandRow[];
}
export function setCommandStatus(id: string, status: string, patch: { result?: string; error?: string } = {}) {
  const isFinal = status === "COMPLETED" || status === "FAILED" || status === "REJECTED" || status === "CANCELLED";
  if (isFinal) {
    db.query(`UPDATE commands SET status=?, result=?, error=?, completed_at=? WHERE id=?`)
      .run(status, patch.result ?? null, patch.error ?? null, nowIso(), id);
  } else {
    db.query(`UPDATE commands SET status=?, leased_at=COALESCE(leased_at,?) WHERE id=?`).run(status, nowIso(), id);
  }
}

// ── workers (внешние: консоль-сессии, будущие API-воркеры) ────────
export function upsertWorker(w: { id?: string; role: string; kind: string; state?: string }): WorkerRow {
  const id = w.id ?? rid("wk");
  const existing = db.query(`SELECT * FROM workers WHERE id=?`).get(id) as WorkerRow | undefined;
  if (existing) {
    db.query(`UPDATE workers SET state=?, heartbeat_at=? WHERE id=?`).run(w.state ?? existing.state, nowIso(), id);
    return { ...existing, state: w.state ?? existing.state, heartbeat_at: nowIso() };
  }
  const row: WorkerRow = {
    id, role: w.role, kind: w.kind, state: w.state ?? "IDLE", generation: 1,
    created_at: nowIso(), heartbeat_at: nowIso(),
  };
  db.query(`INSERT INTO workers (id,role,kind,state,generation,created_at,heartbeat_at) VALUES (?,?,?,?,?,?,?)`)
    .run(row.id, row.role, row.kind, row.state, row.generation, row.created_at, row.heartbeat_at);
  return row;
}
export function listWorkers(): WorkerRow[] {
  return db.query(`SELECT * FROM workers ORDER BY created_at`).all() as WorkerRow[];
}
/** workers без heartbeat > 90s считаются OFFLINE (как mesh 45s ×2 в старой системе);
 *  OFFLINE-воркеры старше 30 минут удаляются совсем, чтобы список не рос бесконечно. */
export function reapStaleWorkers(): number {
  const cutoff = new Date(Date.now() - 90_000).toISOString();
  const r = db.query(`UPDATE workers SET state='OFFLINE' WHERE state!='OFFLINE' AND heartbeat_at<?`).run(cutoff);
  const gcCutoff = new Date(Date.now() - 30 * 60_000).toISOString();
  db.query(`DELETE FROM workers WHERE state='OFFLINE' AND heartbeat_at<?`).run(gcCutoff);
  return Number(r.changes);
}

// ── снапшот для консоли/WS ────────────────────────────────────────
export function snapshot() {
  const agents = listAgents();
  const allTasks = listTasks({ includeArchived: true });
  const tasks = allTasks.filter((t) => t.status !== "ARCHIVED");
  const archived = allTasks.filter((t) => t.status === "ARCHIVED");
  const workers = listWorkers();
  const commands = listCommands(50);
  return {
    ok: true,
    ts: nowIso(),
    agents,
    tasks,
    archived,
    workers,
    commands,
    events: tailEvents(Math.max(0, lastSeq() - 60), 60),
    budget: budgetWindow(),
    stats: {
      agentsIdle: agents.filter((a) => a.status === "IDLE").length,
      agentsBusy: agents.filter((a) => a.status === "BUSY").length,
      agentsPaused: agents.filter((a) => a.paused === 1).length,
      tasksReady: tasks.filter((t) => t.status === "READY").length,
      tasksRunning: tasks.filter((t) => t.status === "RUNNING").length,
      tasksCompleted: tasks.filter((t) => t.status === "COMPLETED").length,
      tasksFailed: tasks.filter((t) => t.status === "FAILED").length,
      commandsPending: commands.filter((c) => c.status === "PENDING").length,
      commandsRejected: commands.filter((c) => c.status === "REJECTED").length,
      workersOnline: workers.filter((w) => w.state !== "OFFLINE").length,
    },
    meta: { version: getMeta("version") ?? "?", boot: getMeta("boot") ?? "?" },
  };
}
export function lastSeq(): number {
  const r = db.query(`SELECT seq FROM events ORDER BY seq DESC LIMIT 1`).get() as { seq: number } | null;
  return Number(r?.seq ?? 0);
}
