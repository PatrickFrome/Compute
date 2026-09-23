/**
 * ME2 daemon — Mission Control plane (R27, пункт C1 из research/2026/R24-AUDIT-ROADMAP.md §7;
 * порт mission-control-projection легаси: objectives→tasks→agents→effects).
 *
 * Семантика легаси (сохранена):
 *  - FAILS-CLOSED: проекция НИКОГДА не утверждает успех сама. Цель закрывается
 *    (ACHIEVED/FAILED) только оператором; если данные неполны — это видно
 *    (derived_state: empty/stalled + attention), а не приукрашено.
 *  - ZERO-AUTHORITY: смена статуса цели — вне досягаемости агентов (только REST
 *    оператора; шина не получает такого действия — 47/47 инвариант).
 *  - work_graph: рёбра objective→task→agent строятся на чтении (проекция, не хранение) —
 *    значит, всегда консистентна с фактическим состоянием SQLite.
 *
 * Derived-состояния цели (вычисляются на чтении):
 *  - achieved/failed/parked — явный операторский статус;
 *  - on_track  — есть READY/RUNNING задачи;
 *  - stalled   — задачи все терминальны, но цель не закрыта (attention);
 *  - empty     — задач нет (attention).
 *
 * Orphan-задачи: READY/RUNNING без objective_id — attention-список (задача вне
 * миссии). Терминальные без цели не флaгаются (бытовые задачи легальны).
 *
 * REST: GET /objectives, POST /objectives {op:create|status}, GET /workgraph. Механика ME23.
 */
import { db, emit } from "../store";
import { listTasks, listAgents, type TaskRow } from "../store";
import { handoffEdges } from "./handoffs";
import { recordSpan } from "./otel";

export const OBJECTIVE_STATUSES = ["ACTIVE", "ACHIEVED", "FAILED", "PARKED"] as const;
export type ObjectiveStatus = (typeof OBJECTIVE_STATUSES)[number];

db.exec(`
CREATE TABLE IF NOT EXISTS objectives (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  spec TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  priority INTEGER NOT NULL DEFAULT 0,
  result TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_objectives_status ON objectives(status, created_at);
`);

export type ObjectiveRow = {
  id: string; title: string; spec: string; status: ObjectiveStatus; priority: number;
  result: string | null; created_at: string; updated_at: string;
};

export type DerivedState = "on_track" | "stalled" | "empty" | "achieved" | "failed" | "parked";

export function createObjective(title: string, spec: string, priority = 0): ObjectiveRow {
  const t = title.trim().slice(0, 200);
  if (!t) throw new Error("title_required");
  const id = `obj_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();
  const row: ObjectiveRow = {
    id, title: t, spec: (spec ?? "").slice(0, 20000),
    status: "ACTIVE", priority: Math.max(0, Math.min(9, Math.round(priority))),
    result: null, created_at: now, updated_at: now,
  };
  db.query(`INSERT INTO objectives (id,title,spec,status,priority,result,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`)
    .run(row.id, row.title, row.spec, row.status, row.priority, row.result, row.created_at, row.updated_at);
  emit("OBJECTIVE_CREATED", { id, title: row.title, priority: row.priority }, null, null);
  return row;
}

export function listObjectives(): ObjectiveRow[] {
  return db.query(`SELECT * FROM objectives ORDER BY priority DESC, created_at ASC LIMIT 200`).all() as ObjectiveRow[];
}

export function getObjective(id: string): ObjectiveRow | null {
  return (db.query(`SELECT * FROM objectives WHERE id=?`).get(id) as ObjectiveRow | undefined) ?? null;
}

/** Смена статуса — ТОЛЬКО оператор (zero-authority: у агентов/шины такого действия нет). */
export function setObjectiveStatus(id: string, status: ObjectiveStatus, result?: string): ObjectiveRow {
  const cur = getObjective(id);
  if (!cur) throw new Error("objective_not_found");
  if (!OBJECTIVE_STATUSES.includes(status)) throw new Error("bad_status");
  db.query(`UPDATE objectives SET status=?, result=?, updated_at=? WHERE id=?`)
    .run(status, result ? String(result).slice(0, 2000) : cur.result, new Date().toISOString(), id);
  emit("OBJECTIVE_STATUS_CHANGED", { id, from: cur.status, to: status, by: "operator" }, null, null);
  recordSpan("objective.status", { "me2.from": cur.status, "me2.to": status }, Date.now());
  return getObjective(id)!;
}

export function deleteObjective(id: string): boolean {
  const r = db.query(`DELETE FROM objectives WHERE id=?`).run(id);
  const ok = Number(r.changes) > 0;
  if (ok) emit("OBJECTIVE_DELETED", { id }, null, null);
  return ok;
}

const TERMINAL = new Set(["COMPLETED", "FAILED", "REJECTED", "CANCELLED", "ARCHIVED", "HANDED_OFF"]);

function tasksOf(objectiveId: string, tasks: TaskRow[]): TaskRow[] {
  return tasks.filter((t) => t.objective_id === objectiveId);
}

function derivedOf(obj: ObjectiveRow, tasks: TaskRow[]): { state: DerivedState; attention: string | null; counts: { total: number; active: number; done: number; failed: number; handed: number } } {
  if (obj.status === "ACHIEVED") return { state: "achieved", attention: null, counts: countsOf(tasks) };
  if (obj.status === "FAILED") return { state: "failed", attention: null, counts: countsOf(tasks) };
  if (obj.status === "PARKED") return { state: "parked", attention: null, counts: countsOf(tasks) };
  const c = countsOf(tasks);
  if (c.total === 0) return { state: "empty", attention: "нет задач — цель не обеспечена работой", counts: c };
  if (c.active > 0) return { state: "on_track", attention: null, counts: c };
  return { state: "stalled", attention: "задачи терминальны, но цель не закрыта оператором", counts: c };
}

function countsOf(tasks: TaskRow[]) {
  return {
    total: tasks.length,
    active: tasks.filter((t) => t.status === "READY" || t.status === "RUNNING").length,
    done: tasks.filter((t) => t.status === "COMPLETED").length,
    failed: tasks.filter((t) => t.status === "FAILED" || t.status === "REJECTED").length,
    // R28 C2: работа переехала в continuation (HANDED_OFF) — считаем отдельно:
    // это не провал и не готово; продолжение наследует цель, поэтому цель честно on_track,
    // пока continuation жив (READY/RUNNING), иначе — stalled (fails-closed видит обрыв).
    handed: tasks.filter((t) => t.status === "HANDED_OFF").length,
  };
}

export interface WorkGraph {
  ok: true;
  generated_at: string;
  fails_closed: true;
  objectives: Array<ObjectiveRow & { derived_state: DerivedState; attention: string | null; counts: { total: number; active: number; done: number; failed: number; handed: number } }>;
  tasks: Array<{ id: string; title: string; status: string; objective_id: string | null; agent_id: string | null; steps: number; max_steps: number }>;
  orphan_tasks: Array<{ id: string; title: string; status: string }>;
  agents: Array<{ id: string; role: string; status: string; model: string }>;
  edges: Array<{ from: string; to: string; kind: "objective_task" | "task_agent" | "task_handoff" }>;
  stats: {
    objectives_total: number; objectives_active: number; objectives_achieved: number; objectives_failed: number; objectives_parked: number;
    attention_objectives: number; tasks_linked: number; tasks_orphan: number; agents_total: number; edges: number; handoffs: number;
  };
}

/** Проекция work_graph: цели→задачи→агенты. Считается на чтении — всегда честна SQLite. */
export function workGraph(): WorkGraph {
  const t0 = Date.now();
  const objs = listObjectives();
  const tasks = listTasks();
  const agents = listAgents();

  const objectives = objs.map((o) => {
    const linked = tasksOf(o.id, tasks);
    const d = derivedOf(o, linked);
    return { ...o, derived_state: d.state, attention: d.attention, counts: d.counts };
  });

  const objIds = new Set(objs.map((o) => o.id));
  const linkedTasks = tasks.filter((t) => t.objective_id !== null && objIds.has(t.objective_id as string));
  const orphanTasks = tasks.filter((t) => !t.objective_id && (t.status === "READY" || t.status === "RUNNING"));

  const edges: WorkGraph["edges"] = [];
  for (const t of linkedTasks) {
    edges.push({ from: `obj:${t.objective_id}`, to: `task:${t.id}`, kind: "objective_task" });
    if (t.agent_id) edges.push({ from: `task:${t.id}`, to: `agent:${t.agent_id}`, kind: "task_agent" });
  }
  // R28 C2: рёбра handoff — передачи работы (источник→continuation) видны в проекции
  const hEdges = handoffEdges();
  for (const he of hEdges) edges.push({ from: he.from, to: he.to, kind: "task_handoff" });

  const byState = (s: DerivedState) => objectives.filter((o) => o.derived_state === s).length;
  const stats = {
    objectives_total: objs.length,
    objectives_active: objs.filter((o) => o.status === "ACTIVE").length,
    objectives_achieved: objs.filter((o) => o.status === "ACHIEVED").length,
    objectives_failed: objs.filter((o) => o.status === "FAILED").length,
    objectives_parked: objs.filter((o) => o.status === "PARKED").length,
    attention_objectives: objectives.filter((o) => o.attention).length,
    tasks_linked: linkedTasks.length,
    tasks_orphan: orphanTasks.length,
    agents_total: agents.length,
    edges: edges.length,
    handoffs: hEdges.length,
  };

  recordSpan("mc.workgraph", { "me2.objectives": objs.length, "me2.tasks_linked": linkedTasks.length, "me2.edges": edges.length, "me2.ms": Date.now() - t0 }, t0);
  return {
    ok: true,
    generated_at: new Date().toISOString(),
    fails_closed: true,
    objectives,
    tasks: linkedTasks.map((t) => ({ id: t.id, title: t.title, status: t.status, objective_id: t.objective_id, agent_id: t.agent_id, steps: t.steps, max_steps: t.max_steps })),
    orphan_tasks: orphanTasks.map((t) => ({ id: t.id, title: t.title, status: t.status })),
    agents: agents.map((a) => ({ id: a.id, role: a.role, status: a.status, model: a.model })),
    edges,
    stats,
  };
}

/** Вердикт для механики ME23. */
export function objectivesVerdict(): { verdict: "WORKS" | "CAVEAT"; evidence: string } {
  try {
    const g = workGraph();
    if (g.stats.objectives_total === 0) {
      return { verdict: "CAVEAT", evidence: "целей нет (создай: POST /objectives {op:create}) — проекция готова, но пуста" };
    }
    const s = g.stats;
    return {
      verdict: "WORKS",
      evidence: `objectives=${s.objectives_total} (active=${s.objectives_active}, achieved=${s.objectives_achieved}, attention=${s.attention_objectives}), tasks_linked=${s.tasks_linked}, orphan=${s.tasks_orphan}, edges=${s.edges}; fails-closed, GET /workgraph`,
    };
  } catch (e) {
    return { verdict: "CAVEAT", evidence: `проекция сломана: ${e instanceof Error ? e.message : String(e)}`.slice(0, 180) };
  }
}
