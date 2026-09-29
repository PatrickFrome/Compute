/**
 * ME2 CHAT-SWARM v1.0.0 — memory.ts
 * Постоянная память роя (bun:sqlite). Без бюджетов и лимитов: память неограничена,
 * хранится всё (сообщения, эпизоды, уроки, родословная, события браузера).
 */
import { Database } from "bun:sqlite";
import { join } from "path";

const STATE_DIR = join(import.meta.dir, "..", "state");
export const db = new Database(join(STATE_DIR, "swarm.db"));
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA busy_timeout = 5000;");

db.exec(`
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  generation INTEGER NOT NULL DEFAULT 0,
  parent_id TEXT,
  state TEXT NOT NULL DEFAULT 'living',
  prompt TEXT NOT NULL DEFAULT '',
  improvements TEXT NOT NULL DEFAULT '[]',
  sleep_ms INTEGER NOT NULL DEFAULT 4000,
  alive INTEGER NOT NULL DEFAULT 1,
  muted INTEGER NOT NULL DEFAULT 0,
  born TEXT NOT NULL,
  cycles INTEGER NOT NULL DEFAULT 0,
  last_seen TEXT
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  from_id TEXT,
  from_name TEXT NOT NULL,
  kind TEXT NOT NULL,             -- say | broadcast | direct | system | user | spawn | lesson | browser | meta
  to_id TEXT,
  channel TEXT NOT NULL DEFAULT '#general',
  text TEXT NOT NULL,
  generation INTEGER
);
CREATE INDEX IF NOT EXISTS idx_messages_ts ON messages(ts DESC);
CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  text TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'episodic'
);
CREATE INDEX IF NOT EXISTS idx_memories_agent ON memories(agent_id, id DESC);
CREATE TABLE IF NOT EXISTS lessons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  by_id TEXT NOT NULL,
  by_name TEXT NOT NULL,
  text TEXT NOT NULL,
  generation INTEGER
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

export const nowIso = () => new Date().toISOString();

export function kvGet(key: string): string | null {
  const r = db.query(`SELECT value FROM kv WHERE key=?`).get(key) as { value: string } | null;
  return r?.value ?? null;
}
export function kvSet(key: string, value: string) {
  db.query(`INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(key, value);
}

export interface AgentRow {
  id: string; name: string; role: string; generation: number; parent_id: string | null;
  state: string; prompt: string; improvements: string; sleep_ms: number; alive: number;
  muted: number; born: string; cycles: number; last_seen: string | null;
}

export function insertAgent(a: AgentRow) {
  db.query(`INSERT INTO agents (id,name,role,generation,parent_id,state,prompt,improvements,sleep_ms,alive,muted,born,cycles,last_seen)
    VALUES ($id,$name,$role,$generation,$parent_id,$state,$prompt,$improvements,$sleep_ms,$alive,$muted,$born,$cycles,$last_seen)`).run({
    $id: a.id, $name: a.name, $role: a.role, $generation: a.generation, $parent_id: a.parent_id,
    $state: a.state, $prompt: a.prompt, $improvements: a.improvements, $sleep_ms: a.sleep_ms,
    $alive: a.alive, $muted: a.muted, $born: a.born, $cycles: a.cycles, $last_seen: a.last_seen,
  });
}

export function addMessage(m: { from_id: string | null; from_name: string; kind: string; to_id?: string | null; channel?: string; text: string; generation?: number | null }) {
  db.query(`INSERT INTO messages (ts,from_id,from_name,kind,to_id,channel,text,generation) VALUES (?,?,?,?,?,?,?,?)`)
    .run(nowIso(), m.from_id, m.from_name, m.kind, m.to_id ?? null, m.channel ?? "#general", m.text, m.generation ?? null);
}

export function recentMessages(limit = 60): unknown[] {
  return db.query(`SELECT * FROM messages ORDER BY id DESC LIMIT ?`).all(limit);
}

export function addMemory(agent_id: string, agent_name: string, text: string, kind = "episodic") {
  db.query(`INSERT INTO memories (ts,agent_id,agent_name,text,kind) VALUES (?,?,?,?,?)`).run(nowIso(), agent_id, agent_name, text, kind);
}

export function agentMemories(agentId: string, limit = 10): string[] {
  const rows = db.query(`SELECT text FROM memories WHERE agent_id=? ORDER BY id DESC LIMIT ?`).all(agentId, limit) as Array<{ text: string }>;
  return rows.map((r) => r.text);
}

export function addLesson(by_id: string, by_name: string, text: string, generation: number | null) {
  db.query(`INSERT INTO lessons (ts,by_id,by_name,text,generation) VALUES (?,?,?,?,?)`).run(nowIso(), by_id, by_name, text, generation);
}

export function recentLessons(limit = 14): Array<{ id: number; ts: string; by_name: string; text: string; generation: number | null }> {
  return db.query(`SELECT id,ts,by_name,text,generation FROM lessons ORDER BY id DESC LIMIT ?`).all(limit) as Array<{ id: number; ts: string; by_name: string; text: string; generation: number | null }>;
}

export function addEvent(type: string, payload: unknown) {
  db.query(`INSERT INTO events (ts,type,payload) VALUES (?,?,?)`).run(nowIso(), type, JSON.stringify(payload));
}

/** Физика песочницы: защита диска — старые эпизоды периодически усечём (это не бюджет-механика,
 *  а гигиена хранилища; уроки/сообщения/родословная хранятся полностью). */
export function pruneMemories(keep = 4000) {
  try {
    db.query(`DELETE FROM memories WHERE id <= (SELECT MAX(id) FROM memories) - ?`).run(keep);
  } catch { /* не критично */ }
}
