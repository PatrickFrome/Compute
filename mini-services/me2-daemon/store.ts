/**
 * ME2 Store — локальный SQLite (WAL). Горячий путь рантайма.
 * Один автор состояния: master loop в worker.ts. Консоль/облако — подписчики.
 */
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = join(dirname(fileURLToPath(import.meta.url)), "data");
mkdirSync(HERE, { recursive: true });

export const db = new Database(join(HERE, "me2.db"));
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA synchronous = NORMAL;");

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
  data TEXT
);
`);

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
};

export function nowIso() { return new Date().toISOString(); }
export function rid(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
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

// ── events ────────────────────────────────────────────────────────
export function emit(type: string, data: Record<string, unknown>, agentId?: string | null, taskId?: string | null): EventRow {
  const e: EventRow = { seq: 0, ts: nowIso(), type, agent_id: agentId ?? null, task_id: taskId ?? null, data: JSON.stringify(data).slice(0, 8000) };
  const res = db.query(`INSERT INTO events (ts,type,agent_id,task_id,data) VALUES (?,?,?,?,?)`)
    .run(e.ts, e.type, e.agent_id, e.task_id, e.data);
  e.seq = Number(res.lastInsertRowid);
  return e;
}
export function tailEvents(since = 0, limit = 200): EventRow[] {
  return db.query(`SELECT * FROM events WHERE seq>? ORDER BY seq ASC LIMIT ?`).all(since, limit) as EventRow[];
}
