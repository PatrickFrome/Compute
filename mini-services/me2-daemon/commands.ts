/**
 * ME2 Command Bus — единая точка записи состояния (single-writer principle).
 * REST/WS ставят команды; master loop или inline-вызов исполняет их.
 * Полосы: EMERGENCY(0) → CONTROL(1) → MUTATION(5) → READ_ONLY(9). Бюджет: 24 cost/60s.
 */
import {
  db, emit, nowIso, snapshot, createTask, cancelTask, createAgent, deleteAgent,
  tailEvents, eventsByTask, upsertWorker, listAgents, getTask, updateTask,
  setAgentPaused, getAgent, listWorkers, listCommands, enqueueCommand,
  searchEvents, setAgentModel, setMeta, budgetLimit,
  LANES, LANE_OF, COST_OF, type CommandRow, type TaskRow, type Lane,
} from "./store";
import { WORKSPACE_ROOT } from "./worker";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

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
    // data ужимаем до 1000 символов: выгрузка должна оставаться валидным JSON-результатом шины
    const events = tailEvents(0, limit).map((e) => ({ ...e, data: e.data.slice(0, 1000) }));
    return { exported_at: nowIso(), count: events.length, events };
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

  AGENT_PAUSE: (p) => {
    const id = String(p.id ?? "");
    const a = getAgent(id);
    if (!a) throw new Error(`agent_not_found_${id}`);
    setAgentPaused(id, 1);
    emit("AGENT_PAUSED", { role: a.role }, id, null);
    return { id, paused: true };
  },

  AGENT_RESUME: (p) => {
    const id = String(p.id ?? "");
    const a = getAgent(id);
    if (!a) throw new Error(`agent_not_found_${id}`);
    setAgentPaused(id, 0);
    emit("AGENT_RESUMED", { role: a.role }, id, null);
    return { id, paused: false };
  },

  /** Планировщик: ставит вложенную TASK_ENQUEUE-команду с run_after; дренаж исполнит её вовремя. */
  TASK_SCHEDULE: (p) => {
    const delaySec = Math.max(1, Math.min(Number(p.delay_sec ?? 0), 3600));
    const title = String(p.title ?? "scheduled").slice(0, 200);
    const spec = String(p.spec ?? "").slice(0, 20000);
    if (!spec) throw new Error("spec_required");
    const role = p.role ? String(p.role).toUpperCase().slice(0, 32) : null;
    const maxSteps = Math.min(Math.max(Number(p.max_steps ?? 8), 1), 24);
    const runAfter = Date.now() + delaySec * 1000;
    const r = enqueueCommand({
      action: "TASK_ENQUEUE",
      payload: { title, spec, role, max_steps: maxSteps },
      run_after: runAfter,
      idempotency_key: p.idempotency_key ? String(p.idempotency_key) : null,
    });
    if (!r.ok) throw new Error(r.error);
    emit("TASK_SCHEDULED", { title, delay_sec: delaySec, run_after: runAfter, command: r.command.id }, null, null);
    return { scheduled: true, command_id: r.command.id, run_after: runAfter };
  },

  COMMAND_CANCEL: (p) => {
    const id = String(p.id ?? "");
    const r = db.query(`UPDATE commands SET status='CANCELLED', error='cancelled_by_operator', completed_at=? WHERE id=? AND status='PENDING'`)
      .run(nowIso(), id);
    const cancelled = Number(r.changes) === 1;
    emit("COMMAND_CANCELLED", { id, cancelled }, null, null);
    if (!cancelled) throw new Error(`command_not_pending_${id}`);
    return { id, cancelled };
  },

  WORKERS_LIST: () => ({ workers: listWorkers() }),

  ACTIONS_LIST: () => ({ actions: actionCatalog() }),

  // ── v0.5.0: +6 действий к реестру 47 ───────────────────────────

  TASK_LIST: () => {
    const tasks = db.query(`SELECT id,title,status,role,steps,max_steps,created_at FROM tasks ORDER BY created_at DESC LIMIT 200`).all();
    emit("TASK_LISTED", { count: tasks.length, include_archived: true }, null, null);
    return { count: tasks.length, tasks };
  },

  TASK_ARCHIVE: (p) => {
    const id = String(p.id ?? "");
    const t = getTask(id);
    if (!t) throw new Error(`task_not_found_${id}`);
    if (t.status !== "COMPLETED" && t.status !== "FAILED" && t.status !== "CANCELLED") {
      throw new Error(`archive_allowed_only_for_terminal_states (now ${t.status})`);
    }
    updateTask(id, { status: "ARCHIVED" });
    emit("TASK_ARCHIVED", { id, title: t.title, prev_status: t.status }, null, id);
    return { id, archived: true, prev_status: t.status };
  },

  AGENT_MODEL: (p) => {
    const id = String(p.agent_id ?? p.id ?? "");
    const model = String(p.model ?? "").trim().slice(0, 64);
    if (!model) throw new Error("model_required");
    const a = getAgent(id);
    if (!a) throw new Error(`agent_not_found_${id}`);
    if (a.model === model) return { id, model, unchanged: true };
    setAgentModel(id, model);
    emit("AGENT_MODEL_SET", { id, role: a.role, from: a.model, to: model }, id, null);
    return { id, role: a.role, from: a.model, to: model };
  },

  WORKSPACE_SNAPSHOT: () => {
    const MAX_ENTRIES = 500;
    const files: Array<{ path: string; size: number; mtime: number }> = [];
    let totalBytes = 0;
    let truncated = false;
    const walk = (dir: string, rel: string, depth: number): void => {
      if (files.length >= MAX_ENTRIES) { truncated = true; return; }
      let entries: ReturnType<typeof readdirSync>;
      try { entries = readdirSync(dir); } catch { return; }
      for (const name of entries.sort()) {
        if (files.length >= MAX_ENTRIES) { truncated = true; return; }
        const r = rel ? `${rel}/${name}` : name;
        const full = join(dir, name);
        let isDir = false;
        try { isDir = statSync(full).isDirectory(); } catch { continue; }
        if (isDir) { if (depth < 4) walk(full, r, depth + 1); continue; }
        try {
          const st = statSync(full);
          files.push({ path: r, size: st.size, mtime: Math.round(st.mtimeMs) });
          totalBytes += st.size;
        } catch { /* файл исчез между readdir и stat — пропускаем */ }
      }
    };
    walk(WORKSPACE_ROOT, "", 0);
    emit("WORKSPACE_SNAPSHOT", { root: WORKSPACE_ROOT, entries: files.length, bytes: totalBytes, truncated }, null, null);
    return { root: WORKSPACE_ROOT, entries: files.length, total_bytes: totalBytes, truncated, files };
  },

  EVENTS_SEARCH: (p) => {
    const q = String(p.q ?? "").trim().slice(0, 100);
    if (!q) throw new Error("q_required");
    const limit = Math.min(Math.max(Number(p.limit ?? 50), 1), 200);
    const hits = searchEvents(q, limit).map((e) => ({ ...e, data: e.data.slice(0, 160) }));
    emit("EVENTS_SEARCHED", { q, hits: hits.length, limit }, null, null);
    return { q, count: hits.length, events: hits };
  },

  BUDGET_ADJUST: (p) => {
    const raw = Number(p.limit ?? p.limit_per_min ?? 0);
    if (!Number.isFinite(raw) || raw <= 0) throw new Error("limit_required");
    const lim = Math.min(Math.max(Math.round(raw), 6), 96);
    const prev = budgetLimit();
    setMeta("budget_limit", String(lim));
    emit("BUDGET_ADJUSTED", { from: prev, to: lim, by: "operator" }, null, null);
    return { from: prev, to: lim };
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

// ── реестр действий (цель — 47; сейчас 25) — источник для ⌘K и /actions ──
type ActionMeta = { action: string; lane: Lane; cost: number; desc: string; group: string; args?: string };
const CATALOG_EXTRA: ActionMeta[] = [
  { action: "TASK_ENQUEUE", lane: "MUTATION", cost: LANES.MUTATION.cost, desc: "поставить задачу в очередь (форма N)", group: "Задачи", args: "title, spec, role?, max_steps?" },
  { action: "TASK_SCHEDULE", lane: "MUTATION", cost: LANES.MUTATION.cost, desc: "отложенная постановка задачи (ETA)", group: "Задачи", args: "title, spec, delay_sec, role?, max_steps?" },
  { action: "AGENT_SPAWN", lane: "MUTATION", cost: LANES.MUTATION.cost, desc: "создать агента роли", group: "Флот", args: "role, model?" },
];
const DESC: Record<string, string> = {
  PING: "проверка живости шины",
  STATE_SNAPSHOT: "полный снапшот состояния",
  TASK_CANCEL: "отмена задачи (READY/RUNNING)",
  TASK_RETRY: "повтор FAILED/CANCELLED задачи (+2 шага)",
  BUDGET_FLUSH: "сброс очереди шины (EMERGENCY)",
  EVENTS_EXPORT: "выгрузка журнала событий JSON",
  AGENT_RETIRE: "уволить агента",
  AGENT_PAUSE: "пауза агента (не берёт задачи)",
  AGENT_RESUME: "снять паузу агента",
  COMMAND_CANCEL: "отменить PENDING-команду",
  WORKERS_LIST: "список внешних workers",
  ACTIONS_LIST: "реестр действий с полосами",
  EVENTS_TAIL: "хвост событий (since/limit)",
  WORKER_HEARTBEAT: "регистрация/пульс worker-а",
  FLEET_RECONCILE: "сверка и чистка флота",
  ENVIRONMENT_RESET: "полный сброс среды (EMERGENCY)",
  TASK_LIST: "сводка задач (id/title/status/steps)",
  TASK_ARCHIVE: "архивировать задачу в терминальном статусе",
  AGENT_MODEL: "сменить модель агента",
  WORKSPACE_SNAPSHOT: "манифест workspace (файлы/байты)",
  EVENTS_SEARCH: "поиск по событиям (type+data)",
  BUDGET_ADJUST: "лимит бюджета шины (6..96/60s)",
};
const GROUP_OF: Record<string, string> = {
  PING: "Диагностика", STATE_SNAPSHOT: "Диагностика", EVENTS_EXPORT: "Диагностика",
  EVENTS_TAIL: "Диагностика", WORKERS_LIST: "Диагностика", ACTIONS_LIST: "Диагностика", WORKER_HEARTBEAT: "Диагностика",
  WORKSPACE_SNAPSHOT: "Диагностика", EVENTS_SEARCH: "Диагностика",
  TASK_CANCEL: "Задачи", TASK_RETRY: "Задачи", TASK_LIST: "Задачи", TASK_ARCHIVE: "Задачи",
  AGENT_RETIRE: "Флот", AGENT_PAUSE: "Флот", AGENT_RESUME: "Флот", FLEET_RECONCILE: "Флот", AGENT_MODEL: "Флот",
  COMMAND_CANCEL: "Шина", BUDGET_ADJUST: "Шина",
  BUDGET_FLUSH: "Опасная зона", ENVIRONMENT_RESET: "Опасная зона",
};
export function actionCatalog(): ActionMeta[] {
  const built = knownActions().map((a) => {
    const lane = (LANE_OF[a]
      ?? (a.endsWith("_RESET") || a.startsWith("FLUSH") || a.endsWith("_FLUSH") || a.startsWith("FENCE")
        ? "EMERGENCY"
        : a.endsWith("_CANCEL") || a.endsWith("_RETIRE") || a.endsWith("_PAUSE") || a.endsWith("_RESUME")
          ? "CONTROL"
          : a.endsWith("_ENQUEUE") || a.endsWith("_SPAWN") || a.endsWith("_RETRY") || a.endsWith("_SCHEDULE")
            ? "MUTATION"
            : "READ_ONLY")) as Lane;
    const cost = COST_OF[a] ?? LANES[lane].cost;
    return { action: a, lane, cost, desc: DESC[a] ?? "—", group: GROUP_OF[a] ?? "Прочее" };
  });
  const seen = new Set(built.map((x) => x.action));
  return [...built, ...CATALOG_EXTRA.filter((x) => !seen.has(x.action))].sort((x, y) => x.group.localeCompare(y.group) || x.action.localeCompare(y.action));
}

/** Атомарный захват команды (защита от двойного исполнения REST-ом и master loop-ом). */
export function claimCommand(id: string): boolean {
  const r = db.query(`UPDATE commands SET status='RUNNING', leased_at=COALESCE(leased_at,?) WHERE id=? AND status='PENDING'`)
    .run(nowIso(), id);
  return Number(r.changes) === 1;
}

/** Результат команды храним КАК ВАЛИДНЫЙ JSON: длинные результаты режем честно-объектом
 *  (truncated+preview), иначе JSON.parse на чтении падал и клиент получал сырую строку (баг R4). */
const RESULT_CAP = 60_000;
function storeResult(result: unknown): string {
  const json = JSON.stringify(result ?? {});
  if (json.length <= RESULT_CAP) return json;
  return JSON.stringify({ truncated: true, original_bytes: json.length, preview: json.slice(0, 4000) });
}

async function runCommand(cmd: CommandRow): Promise<void> {
  emit("COMMAND_LEASED", { action: cmd.action, lane: cmd.lane, id: cmd.id }, null, null);
  try {
    const handler = handlers[cmd.action];
    if (!handler) throw new Error(`unknown_action_${cmd.action}`);
    const payload = cmd.payload ? (JSON.parse(cmd.payload) as Record<string, unknown>) : {};
    const result = await handler(payload);
    db.query(`UPDATE commands SET status='COMPLETED', result=?, completed_at=? WHERE id=?`)
      .run(storeResult(result), nowIso(), cmd.id);
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

/** Дренаж очереди (вызывается master loop каждый тик). run_after в будущем не исполняется. */
export async function drainCommands(max = 8): Promise<number> {
  const pending = db.query(
    `SELECT * FROM commands WHERE status='PENDING' AND (run_after IS NULL OR run_after<=?)
     ORDER BY CASE lane WHEN 'EMERGENCY' THEN 0 WHEN 'CONTROL' THEN 1 WHEN 'MUTATION' THEN 5 ELSE 9 END, created_at
     LIMIT ?`,
  ).all(Date.now(), max) as CommandRow[];
  let n = 0;
  for (const cmd of pending) {
    if (claimCommand(cmd.id)) { await runCommand(cmd); n++; }
  }
  return n;
}
