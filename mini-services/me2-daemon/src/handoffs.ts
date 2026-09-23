/**
 * ME2 daemon — Handoffs (R28, пункт C2 из research/2026/R24-AUDIT-ROADMAP.md §7;
 * порт семантики Codex handoffs: структурированная передача работы между агентами).
 *
 * Правила (из роадмапа R24 §C2, сохранены буквально):
 *  - 47/47 инвариант: НОВОГО действия в шине нет — handoff исполняется как TASK_ENQUEUE
 *    с handoff-блоком («handoff = MEMORY-запись + TASK_ENQUEUE с parent»).
 *  - Протокол (Codex handoffs): done / in_flight / next / context / open_questions / artifacts.
 *    FAILS-CLOSED: без reason и protocol.next передача отклонена — «передача без
 *    "что делать дальше" бессмысленна», получатель не должен догадываться.
 *  - Линейность: continuation получает parent_id источника (lineage R25-веток);
 *    objective_id наследуется — задача не отрывается от миссии (C1 fails-closed);
 *    если цель уже не ACTIVE, TASK_ENQUEUE-валидация отклонит (objective_not_active).
 *  - Источник закрывается статусом HANDED_OFF — честная телеметрия: работа переехала,
 *    не провалилась и не отменена; retried источника запрещён (у него есть continuation).
 *  - Память: episodic-запись о передаче — получатель увидит контекст через memBlock.
 *  - work_graph: рёбра task_handoff — передачи видны в проекции Mission Control (C1).
 *
 * REST: GET /handoffs, POST /tasks/{id}/handoff (обёртка над шиной) — вне каталога (47/47).
 * Механика ME24.
 */
import { db, emit, nowIso } from "../store";
import { createTask, getTask, updateTask, type TaskRow } from "../store";
import { memWrite } from "./memory";
import { recordSpan } from "./otel";

export interface HandoffProtocol {
  done?: string;           // что уже сделано передатчиком
  in_flight?: string;      // что было посреди работы на момент передачи
  next: string;            // что делать дальше (ОБЯЗАТЕЛЬНО — fails-closed)
  context?: string;        // решения, файлы, ссылки — важный контекст
  open_questions?: string; // открытые вопросы (неизвестные)
  artifacts?: string;      // артефакты: пути/refs
}

export interface HandoffInput {
  from_task: string;
  to_role?: string | null;
  reason: string;
  protocol: HandoffProtocol;
  max_steps?: number;
  by?: string; // "operator" | "agent:<id>" | "system"
}

db.exec(`
CREATE TABLE IF NOT EXISTS handoffs (
  id TEXT PRIMARY KEY,
  from_task TEXT NOT NULL,
  to_task TEXT NOT NULL,
  from_agent TEXT,
  from_role TEXT,
  to_role TEXT,
  reason TEXT NOT NULL,
  protocol TEXT NOT NULL,
  by TEXT NOT NULL DEFAULT 'operator',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_handoffs_at ON handoffs(created_at);
`);

export interface HandoffRow {
  id: string; from_task: string; to_task: string; from_agent: string | null;
  from_role: string | null; to_role: string | null; reason: string; protocol: string;
  by: string; created_at: string;
}

/** Откуда можно передавать: живая работа или неудача (FAILED/CANCELLED — альтернатива ретраю
 *  с протоколом вместо рефлексии). COMPLETED — нечего передавать; ARCHIVED — не реанимируем. */
const HANDOFF_ALLOWED_FROM = new Set(["READY", "RUNNING", "FAILED", "CANCELLED"]);

export function handoffCreate(input: HandoffInput): { task: TaskRow; handoff: HandoffRow } {
  const fromId = String(input.from_task ?? "").trim();
  if (!fromId) throw new Error("from_task_required");
  const from = getTask(fromId);
  if (!from) throw new Error(`task_not_found: ${fromId.slice(0, 40)}`);
  if (!HANDOFF_ALLOWED_FROM.has(from.status)) {
    throw new Error(`handoff_not_allowed_from_${from.status}`);
  }
  const reason = String(input.reason ?? "").trim().slice(0, 500);
  if (!reason) throw new Error("reason_required");
  const p = input.protocol ?? ({} as HandoffProtocol);
  const next = String(p.next ?? "").trim().slice(0, 4000);
  if (!next) throw new Error("protocol_next_required");
  const toRole = input.to_role ? String(input.to_role).toUpperCase().slice(0, 32) : (from.role ?? null);
  const maxSteps = Math.min(Math.max(Number(input.max_steps ?? from.max_steps), 1), 24);

  // Протокол компилируется в spec продолжения: получатель читает его как бриф,
  // а не собирает контекст по кускам (семантика Codex handoffs).
  const specParts: string[] = [`[HANDOFF от ${from.id}] причина: ${reason}`];
  if (p.done) specParts.push(`Сделано: ${p.done}`);
  if (p.in_flight) specParts.push(`В работе на момент передачи: ${p.in_flight}`);
  specParts.push(`Дальше: ${next}`);
  if (p.context) specParts.push(`Контекст: ${p.context}`);
  if (p.open_questions) specParts.push(`Открытые вопросы: ${p.open_questions}`);
  if (p.artifacts) specParts.push(`Артефакты: ${p.artifacts}`);
  const spec = specParts.join("\n").slice(0, 20000);

  const task = createTask({
    id: `tk_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    title: `${from.title.slice(0, 170)} ·handoff`,
    spec, role: toRole, max_steps: maxSteps, parent_id: from.id, objective_id: from.objective_id,
  });

  const row: HandoffRow = {
    id: `hf_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    from_task: from.id, to_task: task.id, from_agent: from.agent_id,
    from_role: from.role, to_role: toRole, reason,
    protocol: JSON.stringify({
      done: p.done ?? undefined, in_flight: p.in_flight ?? undefined, next,
      context: p.context ?? undefined, open_questions: p.open_questions ?? undefined, artifacts: p.artifacts ?? undefined,
    }),
    by: String(input.by ?? "operator").slice(0, 60), created_at: nowIso(),
  };
  db.query(`INSERT INTO handoffs (id,from_task,to_task,from_agent,from_role,to_role,reason,protocol,by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(row.id, row.from_task, row.to_task, row.from_agent, row.from_role, row.to_role, row.reason, row.protocol, row.by, row.created_at);

  // Источник закрывается честно: работа переехала в continuation (не FAILED, не CANCELLED).
  updateTask(from.id, { status: "HANDED_OFF" });

  emit("TASK_HANDOFF", {
    handoff: row.id, from_task: from.id, to_task: task.id,
    from_role: row.from_role, to_role: toRole, reason, by: row.by, objective_id: from.objective_id,
  }, from.agent_id, task.id);

  // Память: эпизод о передаче — memBlock донесёт контекст до получателя в промпте.
  try {
    memWrite({
      kind: "episodic", key: `handoff:${row.id}`,
      content: `[HANDOFF] ${from.title.slice(0, 120)} → ${toRole ?? "любой"}: ${reason.slice(0, 160)}; next: ${next.slice(0, 200)}`,
      tags: ["handoff", "task"], importance: 0.75,
    });
  } catch { /* память не ломает передачу */ }

  recordSpan("task.handoff", { "me2.from_task": from.id, "me2.to_task": task.id, "me2.to_role": toRole ?? "?", "me2.by": row.by }, Date.now());
  return { task, handoff: row };
}

export interface HandoffListRow extends HandoffRow {
  protocol_parsed: HandoffProtocol;
  from_title: string | null; to_title: string | null; to_status: string | null;
}

export function handoffList(limit = 20): HandoffListRow[] {
  const rows = db.query(`SELECT * FROM handoffs ORDER BY created_at DESC LIMIT ?`)
    .all(Math.min(Math.max(1, limit), 100)) as HandoffRow[];
  return rows.map((r) => {
    let pp: HandoffProtocol = { next: "" };
    try { pp = { next: "", ...(JSON.parse(r.protocol) as HandoffProtocol) }; } catch { /* битый протокол — next пуст */ }
    const ft = getTask(r.from_task); const tt = getTask(r.to_task);
    return { ...r, protocol_parsed: pp, from_title: ft?.title ?? null, to_title: tt?.title ?? null, to_status: tt?.status ?? null };
  });
}

export function handoffStats(): {
  total: number; last_24h: number; by_to_role: Record<string, number>;
  last: { id: string; to_role: string | null; created_at: string } | null;
} {
  const total = Number((db.query(`SELECT COUNT(*) AS n FROM handoffs`).get() as { n: number }).n);
  const last24 = Number((db.query(`SELECT COUNT(*) AS n FROM handoffs WHERE created_at >= ?`)
    .get(new Date(Date.now() - 86_400_000).toISOString()) as { n: number }).n);
  const byRole: Record<string, number> = {};
  for (const r of db.query(`SELECT to_role, COUNT(*) AS n FROM handoffs GROUP BY to_role`).all() as Array<{ to_role: string | null; n: number }>) {
    byRole[r.to_role ?? "(any)"] = Number(r.n);
  }
  const last = db.query(`SELECT id, to_role, created_at FROM handoffs ORDER BY created_at DESC LIMIT 1`)
    .get() as { id: string; to_role: string; created_at: string } | undefined;
  return { total, last_24h: last24, by_to_role: byRole, last: last ?? null };
}

/** Рёбра task_handoff для work_graph (C1-проекция читает факты, не копии). */
export function handoffEdges(): Array<{ from: string; to: string }> {
  return (db.query(`SELECT from_task, to_task FROM handoffs`).all() as Array<{ from_task: string; to_task: string }>)
    .map((h) => ({ from: `task:${h.from_task}`, to: `task:${h.to_task}` }));
}

/** Вердикт для механики ME24: WORKS только при наличии реальной передачи. */
export function handoffsVerdict(): { verdict: "WORKS" | "CAVEAT"; evidence: string } {
  try {
    const t = db.query(`SELECT name FROM sqlite_master WHERE type='table' AND name='handoffs'`).get();
    if (!t) return { verdict: "CAVEAT", evidence: "таблица handoffs отсутствует" };
    const s = handoffStats();
    if (s.total === 0) {
      return { verdict: "CAVEAT", evidence: "передач ещё не было — POST /tasks/{id}/handoff {to_role, reason, protocol:{next}} (протокол Codex handoffs готов)" };
    }
    return {
      verdict: "WORKS",
      evidence: `handoffs=${s.total} (24h=${s.last_24h}, to=${JSON.stringify(s.by_to_role)}), last=${s.last?.id ?? "?"}→${s.last?.to_role ?? "?"}; протокол done/in_flight/next/context; GET /handoffs`,
    };
  } catch (e) {
    return { verdict: "CAVEAT", evidence: `handoffs сломаны: ${e instanceof Error ? e.message : String(e)}`.slice(0, 180) };
  }
}
