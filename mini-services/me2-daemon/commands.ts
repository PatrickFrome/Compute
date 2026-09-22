/**
 * ME2 Command Bus — единая точка записи состояния (single-writer principle).
 * REST/WS ставят команды; master loop или inline-вызов исполняет их.
 * Полосы: EMERGENCY(0) → CONTROL(1) → MUTATION(5) → READ_ONLY(9). Бюджет: 24 cost/60s.
 */
import {
  db, emit, nowIso, snapshot, createTask, cancelTask, createAgent, deleteAgent,
  tailEvents, eventsByTask, upsertWorker, listAgents, getTask, updateTask,
  type CommandRow, type TaskRow,
} from "./store";

type Handler = (payload: Record<string, unknown>) => Promise<Record<string, unknown>> | Record<string, unknown>;

const handlers: Record<string, Handler> = {
  PING: () => ({ pong: true, ts: nowIso() }),

  STATE_SNAPSHOT: () => snapshot() as unknown as Record<string, unknown>,

  TASK_ENQUEUE: (p) => {
    const title = String(p.title ?? "untitled").slice(0, 200);
    const spec = String(p.spec ?? "").slice(0, 20000);
    if (!spec) throw new Error("spec_required");
    const role = p.role ? String(p.role).toUpperCase().slice(0, 32) : null;
    const maxSteps = Math.min(Math.max(Number(p.max_steps ?? 8), 1), 24);
    const task = createTask({
      id: `tk_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      title, spec, role, max_steps: maxSteps,
    });
    emit("TASK_QUEUED", { title, role, max_steps: maxSteps, via: "command_bus" }, null, task.id);
    return { task };
  },

  TASK_CANCEL: (p) => {
    const id = String(p.id ?? "");
    cancelTask(id);
    emit("TASK_CANCELLED", { id }, null, id);
    return { id };
  },

  TASK_RETRY: (p) => {
    const id = String(p.id ?? "");
    const orig = getTask(id);
    if (!orig) throw new Error(`task_not_found_${id}`);
    if (orig.status !== "FAILED" && orig.status !== "CANCELLED") {
      throw new Error(`retry_allowed_only_for_FAILED_or_CANCELLED (now ${orig.status})`);
    }
    // политика ретрая: +2 шага (parse-retry и осмотр могут съесть бюджет)
    const maxSteps = Math.min(orig.max_steps + 2, 24);
    const task = createTask({
      id: `tk_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      title: `${orig.title.slice(0, 180)} ·retry`,
      spec: orig.spec, role: orig.role, max_steps: maxSteps,
    });
    emit("TASK_RETRIED", { from: id, to: task.id, title: task.title, max_steps: maxSteps }, null, task.id);
    return { task };
  },

  BUDGET_FLUSH: () => {
    const r = db.query(`UPDATE commands SET status='REJECTED', error='budget_flushed_by_operator', completed_at=? WHERE status='PENDING'`)
      .run(nowIso());
    const flushed = Number(r.changes);
    emit("BUDGET_FLUSHED", { flushed, by: "operator" }, null, null);
    return { flushed };
  },

  EVENTS_EXPORT: (p) => {
    const limit = Math.min(Math.max(Number(p.limit ?? 500), 1), 1000);
    return { exported_at: nowIso(), count: limit, events: tailEvents(0, limit) };
  },

  AGENT_SPAWN: (p) => {
    const role = String(p.role ?? "IMPLEMENTER").toUpperCase().slice(0, 32);
    const model = String(p.model ?? "zai:default").slice(0, 64);
    const agent = createAgent(role, model);
    emit("AGENT_CREATED", { role, model }, agent.id, null);
    return { agent };
  },

  AGENT_RETIRE: (p) => {
    const id = String(p.id ?? "");
    deleteAgent(id);
    emit("AGENT_RETIRED", { id }, id, null);
    return { id };
  },

  EVENTS_TAIL: (p) => ({
    events: tailEvents(Number(p.since ?? 0), Math.min(Number(p.limit ?? 100), 500)),
  }),

  WORKER_HEARTBEAT: (p) => {
    const w = upsertWorker({
      id: p.id ? String(p.id) : undefined,
      role: String(p.role ?? "console").slice(0, 64),
      kind: String(p.kind ?? "API").toUpperCase().slice(0, 16),
      state: p.state ? String(p.state).toUpperCase().slice(0, 16) : undefined,
    });
    return { worker: w };
  },

  FLEET_RECONCILE: () => {
    const agents = listAgents();
    let retired = 0;
    for (const a of agents) {
      if (a.role === "__RETIRED__") { deleteAgent(a.id); retired++; }
    }
    emit("FLEET_RECONCILED", { total: agents.length, retired }, null, null);
    return { total: agents.length, retired };
  },

  ENVIRONMENT_RESET: () => {
    db.exec("DELETE FROM tasks; DELETE FROM agents; DELETE FROM commands;");
    emit("ENVIRONMENT_RESET", { by: "operator", via: "command_bus" }, null, null);
    return { reset: true };
  },
};

export function knownActions(): string[] { return Object.keys(handlers); }

/** Атомарный захват команды (защита от двойного исполнения REST-ом и master loop-ом). */
export function claimCommand(id: string): boolean {
  const r = db.query(`UPDATE commands SET status='RUNNING', leased_at=COALESCE(leased_at,?) WHERE id=? AND status='PENDING'`)
    .run(nowIso(), id);
  return Number(r.changes) === 1;
}

async function runCommand(cmd: CommandRow): Promise<void> {
  emit("COMMAND_LEASED", { action: cmd.action, lane: cmd.lane, id: cmd.id }, null, null);
  try {
    const handler = handlers[cmd.action];
    if (!handler) throw new Error(`unknown_action_${cmd.action}`);
    const payload = cmd.payload ? (JSON.parse(cmd.payload) as Record<string, unknown>) : {};
    const result = await handler(payload);
    db.query(`UPDATE commands SET status='COMPLETED', result=?, completed_at=? WHERE id=?`)
      .run(JSON.stringify(result ?? {}).slice(0, 4000), nowIso(), cmd.id);
    emit("COMMAND_COMPLETED", { action: cmd.action, id: cmd.id }, null, null);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    db.query(`UPDATE commands SET status='FAILED', error=?, completed_at=? WHERE id=?`)
      .run(msg.slice(0, 500), nowIso(), cmd.id);
    emit("COMMAND_FAILED", { action: cmd.action, id: cmd.id, error: msg.slice(0, 200) }, null, null);
  }
}

/** Исполнить одну команду сразу (для синхронных REST-мутаций). */
export async function runOne(cmd: CommandRow): Promise<CommandRow> {
  if (claimCommand(cmd.id)) await runCommand(cmd);
  return (db.query(`SELECT * FROM commands WHERE id=?`).get(cmd.id) as CommandRow) ?? cmd;
}

/** Дренаж очереди (вызывается master loop каждый тик). */
export async function drainCommands(max = 8): Promise<number> {
  const pending = db.query(
    `SELECT * FROM commands WHERE status='PENDING'
     ORDER BY CASE lane WHEN 'EMERGENCY' THEN 0 WHEN 'CONTROL' THEN 1 WHEN 'MUTATION' THEN 5 ELSE 9 END, created_at
     LIMIT ?`,
  ).all(max) as CommandRow[];
  let n = 0;
  for (const cmd of pending) {
    if (claimCommand(cmd.id)) { await runCommand(cmd); n++; }
  }
  return n;
}
