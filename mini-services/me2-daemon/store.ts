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
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  spec TEXT NOT NULL,
  role TEXT,
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
  idempotency_key TEXT UNIQUE,
  cost INTEGER NOT NULL DEFAULT 0,
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
`);

// миграция: старая events-таблица без hash-колонок
const eventCols = (db.query(`PRAGMA table_info(events)`).all() as Array<{ name: string }>).map((c) => c.name);
if (!eventCols.includes("prev_hash")) db.exec(`ALTER TABLE events ADD COLUMN prev_hash TEXT`);
if (!eventCols.includes("hash")) db.exec(`ALTER TABLE events ADD COLUMN hash TEXT`);

export type AgentRow = {
  id: string; role: string; status: string; model: string; created_at: string; updated_at: string;
};
export type TaskRow = {
  id: string; title: string; spec: string; role: string | null; status: string;
  agent_id: string | null; max_steps: number; steps: number; result: string | null;
  error: string | null; created_at: string; updated_at: string;
};
export type EventRow = {
  seq: number; ts: string; type: string; agent_id: string | null; task_id: string | null; data: string;
  prev_hash: string | null; hash: string | null;
};
export type CommandRow = {
  id: string; action: string; lane: string; status: string; payload: string | null; result: string | null;
  idempotency_key: string | null; cost: number; created_at: string; leased_at: string | null;
  completed_at: string | null; error: string | null;
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

// ── agents ────────────────────────────────────────────────────────
export function createAgent(role: string, model: string): AgentRow {
  const a: AgentRow = { id: rid("ag"), role, status: "IDLE", model, created_at: nowIso(), updated_at: nowIso() };
  db.query(`INSERT INTO agents (id, role, status, model, created_at, updated_at) VALUES (?,?,?,?,?,?)`)
    .run(a.id, a.role, a.status, a.model, a.created_at, a.updated_at);
  return a;
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
export function createTask(t: Omit<TaskRow, "status" | "agent_id" | "steps" | "result" | "error" | "created_at" | "updated_at">): TaskRow {
  const row: TaskRow = { ...t, status: "READY", agent_id: null, steps: 0, result: null, error: null, created_at: nowIso(), updated_at: nowIso() };
  db.query(`INSERT INTO tasks (id,title,spec,role,status,agent_id,max_steps,steps,result,error,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(row.id, row.title, row.spec, row.role, row.status, row.agent_id, row.max_steps, row.steps, row.result, row.error, row.created_at, row.updated_at);
  return row;
}
export function listTasks(): TaskRow[] {
  return db.query(`SELECT * FROM tasks ORDER BY created_at DESC LIMIT 200`).all() as TaskRow[];
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

// ── command bus ───────────────────────────────────────────────────
export function budgetWindow(): { used: number; limit: number; window_ms: number; reset_hint: string } {
  const since = new Date(Date.now() - BUDGET_WINDOW_MS).toISOString();
  const r = db.query(
    `SELECT COALESCE(SUM(cost),0) AS used FROM commands WHERE created_at>=? AND status IN ('PENDING','RUNNING','COMPLETED') AND lane!='EMERGENCY'`,
  ).get(since) as { used: number };
  return { used: Number(r.used), limit: BUDGET_LIMIT, window_ms: BUDGET_WINDOW_MS, reset_hint: since };
}

export type EnqueueResult =
  | { ok: true; command: CommandRow; deduped: boolean }
  | { ok: false; error: string };

export function enqueueCommand(input: {
  action: string; lane?: string; payload?: Record<string, unknown>;
  idempotency_key?: string | null; cost?: number;
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

  const cost = input.cost ?? laneSpec.cost;
  if (lane !== "EMERGENCY") {
    const b = budgetWindow();
    if (b.used + cost > BUDGET_LIMIT) {
      insertCommand({ action, lane, status: "REJECTED", payload: input.payload ?? null, idempotency_key: input.idempotency_key ?? null, cost, error: "budget_exceeded" });
      return { ok: false, error: `budget_exceeded (used ${b.used}/${BUDGET_LIMIT} per ${BUDGET_WINDOW_MS / 1000}s)` };
    }
  }
  const cmd = insertCommand({ action, lane, status: "PENDING", payload: input.payload, idempotency_key: input.idempotency_key ?? null, cost, error: null });
  emit("COMMAND_ENQUEUED", { action, lane, cost, id: cmd.id }, null, null);
  return { ok: true, command: cmd, deduped: false };
}

function insertCommand(c: {
  action: string; lane: string; status: string; payload?: Record<string, unknown> | null;
  idempotency_key: string | null; cost: number; error: string | null;
}): CommandRow {
  const row: CommandRow = {
    id: rid("cmd"), action: c.action, lane: c.lane, status: c.status,
    payload: c.payload ? JSON.stringify(c.payload).slice(0, 8000) : null,
    result: null, idempotency_key: c.idempotency_key, cost: c.cost,
    created_at: nowIso(), leased_at: null, completed_at: null, error: c.error,
  };
  try {
    db.query(`INSERT INTO commands (id,action,lane,status,payload,result,idempotency_key,cost,created_at,leased_at,completed_at,error)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(row.id, row.action, row.lane, row.status, row.payload, row.result, row.idempotency_key, row.cost, row.created_at, row.leased_at, row.completed_at, row.error);
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
  if (action.endsWith("_RESET") || action.startsWith("FLUSH") || action.startsWith("FENCE")) return "EMERGENCY";
  if (action.endsWith("_CANCEL") || action.endsWith("_RETIRE") || action.endsWith("_PAUSE") || action.endsWith("_RESUME")) return "CONTROL";
  if (action.endsWith("_ENQUEUE") || action.endsWith("_SPAWN") || action.endsWith("_CREATE") || action.endsWith("_UPDATE") || action.endsWith("_DELETE")) return "MUTATION";
  return "READ_ONLY";
}

export function listCommands(limit = 100): CommandRow[] {
  return db.query(`SELECT * FROM commands ORDER BY created_at DESC LIMIT ?`).all(limit) as CommandRow[];
}
export function nextPendingCommands(limit = 8): CommandRow[] {
  return db.query(
    `SELECT * FROM commands WHERE status='PENDING'
     ORDER BY CASE lane WHEN 'EMERGENCY' THEN 0 WHEN 'CONTROL' THEN 1 WHEN 'MUTATION' THEN 5 ELSE 9 END, created_at
     LIMIT ?`,
  ).all(limit) as CommandRow[];
}
export function setCommandStatus(id: string, status: string, patch: { result?: string; error?: string } = {}) {
  const isFinal = status === "COMPLETED" || status === "FAILED" || status === "REJECTED";
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
/** workers без heartbeat > 90s считаются OFFLINE (как mesh 45s ×2 в старой системе) */
export function reapStaleWorkers(): number {
  const cutoff = new Date(Date.now() - 90_000).toISOString();
  const r = db.query(`UPDATE workers SET state='OFFLINE' WHERE state!='OFFLINE' AND heartbeat_at<?`).run(cutoff);
  return Number(r.changes);
}

// ── снапшот для консоли/WS ────────────────────────────────────────
export function snapshot() {
  const agents = listAgents();
  const tasks = listTasks();
  const workers = listWorkers();
  const commands = listCommands(50);
  return {
    ok: true,
    ts: nowIso(),
    agents,
    tasks,
    workers,
    commands,
    events: tailEvents(Math.max(0, lastSeq() - 60), 60),
    budget: budgetWindow(),
    stats: {
      agentsIdle: agents.filter((a) => a.status === "IDLE").length,
      agentsBusy: agents.filter((a) => a.status === "BUSY").length,
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
