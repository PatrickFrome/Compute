/**
 * ME2 Daemon — ядро METAENGINE 2 (M1).
 * API-native agent runtime: агенты = контексты + инструменты, НЕ вкладки браузера.
 * Горячий путь: локальный SQLite + command bus (single-writer).
 *
 * Порты (через gateway XTransformPort):
 *   :3040 — socket.io, path '/' (WS-канал: snapshot push + события + команды)
 *   :3041 — REST API (health/state/commands/tasks/agents/workers/budget/reset)
 *
 * Запуск long-run: setsid nohup bun index.ts > daemon.log 2>&1 &
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Server } from "socket.io";
import {
  listAgents, listTasks, getTask, tailEvents, eventsByTask, db, emit, snapshot,
  enqueueCommand, budgetWindow, listCommands, listWorkers, upsertWorker,
  getMeta, setMeta, reapStaleWorkers, lastSeq, onEvent,
  createAgent, createTask, nowIso,
} from "./store";
import { listProviders } from "./providers";
import { startMasterLoop } from "./worker";
import { drainCommands, runOne, knownActions, actionCatalog } from "./commands";
import { initEvidence, evidenceStatus } from "./evidence";

const WS_PORT = 3040;
const REST_PORT = 3041;
const VERSION = "0.5.0";
const BOOT_TS = nowIso();
setMeta("boot", BOOT_TS);
setMeta("version", VERSION);

// ── seed (однократно) ─────────────────────────────────────────────
function seed() {
  if (getMeta("seeded") === "1") return;
  const a1 = createAgent("IMPLEMENTER", "zai:default");
  const a2 = createAgent("RESEARCHER", "zai:default");
  emit("AGENT_CREATED", { role: "IMPLEMENTER", model: "zai:default", seed: true }, a1.id, null);
  emit("AGENT_CREATED", { role: "RESEARCHER", model: "zai:default", seed: true }, a2.id, null);

  const t1 = createTask({
    id: `tk_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    title: "ME2 smoke: осмотреть workspace, создать hello.txt с версией daemon",
    spec: "Это smoke-задача рантайма ME2. Шаги: 1) list_dir . 2) write_file hello.txt с текстом 'ME2 daemon v0.3.0 live at <текущая дата>' 3) finish с результатом.",
    role: "IMPLEMENTER", max_steps: 4,
  });
  const t2 = createTask({
    id: `tk_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    title: "Ресёрч: 3 ключевых тренда agent-runtime 2026",
    spec: "Используй web_search по запросу 'agent runtime trends 2026'. Сделай саммари из 3 пунктов (по 1-2 предложения). Заверши через finish.",
    role: "RESEARCHER", max_steps: 5,
  });
  const t3 = createTask({
    id: `tk_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    title: "Создать структуру docs/: index.md и architecture.md (заглушки)",
    spec: "В workspace: write_file docs/index.md ('# ME2 Docs') и docs/architecture.md ('# Architecture: daemon + console'). finish после создания.",
    role: "IMPLEMENTER", max_steps: 4,
  });
  emit("TASK_QUEUED", { seed: true, title: t1.title }, null, t1.id);
  emit("TASK_QUEUED", { seed: true, title: t2.title }, null, t2.id);
  emit("TASK_QUEUED", { seed: true, title: t3.title }, null, t3.id);
  setMeta("seeded", "1");
  console.log("[seed] agents: 2, tasks: 3");
}
seed();

// ── REST API (:3041) ──────────────────────────────────────────────
function json(res: ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(body));
}
async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>; }
  catch { return {}; }
}

const restServer = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${REST_PORT}`);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }

  try {
    if (path === "/health") {
      return json(res, 200, {
        ok: true, service: "me2-daemon", version: VERSION, boot: BOOT_TS,
        last_seq: lastSeq(), actions: knownActions().length, ts: nowIso(),
      });
    }
    if (path === "/state" && req.method === "GET") return json(res, 200, snapshot());
    if (path === "/budget" && req.method === "GET") return json(res, 200, { ok: true, ...budgetWindow() });
    if (path === "/actions" && req.method === "GET") return json(res, 200, { ok: true, count: actionCatalog().length, total_target: 47, actions: actionCatalog() });
    if (path === "/evidence" && req.method === "GET") return json(res, 200, evidenceStatus());
    if (path === "/providers" && req.method === "GET") return json(res, 200, { ok: true, providers: await listProviders() });

    // ── command bus: единственная точка мутаций ──
    if (path === "/commands" && req.method === "POST") {
      const body = await readBody(req);
      const r = enqueueCommand({
        action: String(body.action ?? ""),
        lane: body.lane ? String(body.lane) : undefined,
        payload: (body.payload ?? {}) as Record<string, unknown>,
        idempotency_key: body.idempotency_key ? String(body.idempotency_key) : null,
        cost: body.cost !== undefined ? Number(body.cost) : undefined,
        run_after: body.run_after !== undefined ? Number(body.run_after) : undefined,
      });
      if (!r.ok) return json(res, 429, { ok: false, error: r.error });
      // отложенная команда не исполняется синхронно — её подберёт дренаж, когда время придёт
      const cmd = (r.deduped || (r.command.run_after && r.command.run_after > Date.now())) ? r.command : await runOne(r.command);
      let result: unknown = null;
      try { result = cmd.result ? JSON.parse(cmd.result) : null; } catch { result = cmd.result; }
      return json(res, r.deduped ? 200 : 201, { ok: true, deduped: r.deduped, command: cmd, result });
    }
    if (path === "/commands" && req.method === "GET") return json(res, 200, { ok: true, commands: listCommands(100) });

    // ── workers ──
    if (path === "/workers" && req.method === "GET") return json(res, 200, { ok: true, workers: listWorkers() });
    if (path === "/workers/heartbeat" && req.method === "POST") {
      const body = await readBody(req);
      const w = upsertWorker({
        id: body.id ? String(body.id) : undefined,
        role: String(body.role ?? "console"),
        kind: String(body.kind ?? "API"),
        state: body.state ? String(body.state) : undefined,
      });
      return json(res, 200, { ok: true, worker: w });
    }

    // ── удобные обёртки (внутри всё равно command bus) ──
    if (path === "/agents" && req.method === "GET") return json(res, 200, { ok: true, agents: listAgents() });
    if (path === "/agents" && req.method === "POST") {
      const body = await readBody(req);
      const r = enqueueCommand({ action: "AGENT_SPAWN", payload: { role: body.role, model: body.model }, idempotency_key: body.idempotency_key ? String(body.idempotency_key) : null });
      if (!r.ok) return json(res, 429, { ok: false, error: r.error });
      const cmd = await runOne(r.command);
      return json(res, 201, { ok: true, result: cmd.result ? JSON.parse(cmd.result) : null });
    }
    if (path.startsWith("/agents/") && req.method === "DELETE") {
      const id = path.split("/")[2];
      const r = enqueueCommand({ action: "AGENT_RETIRE", lane: "CONTROL", payload: { id } });
      if (!r.ok) return json(res, 429, { ok: false, error: r.error });
      await runOne(r.command);
      return json(res, 200, { ok: true });
    }
    if (path === "/tasks" && req.method === "GET") return json(res, 200, { ok: true, tasks: listTasks() });
    if (path === "/tasks" && req.method === "POST") {
      const body = await readBody(req);
      const r = enqueueCommand({
        action: "TASK_ENQUEUE",
        payload: { title: body.title, spec: body.spec, role: body.role, max_steps: body.max_steps },
        idempotency_key: body.idempotency_key ? String(body.idempotency_key) : null,
      });
      if (!r.ok) return json(res, 429, { ok: false, error: r.error });
      const cmd = await runOne(r.command);
      const parsed = cmd.result ? (JSON.parse(cmd.result) as { task?: unknown }) : null;
      return json(res, 201, { ok: true, task: parsed?.task ?? null, command: cmd.id });
    }
    if (path.startsWith("/tasks/") && path.endsWith("/cancel") && req.method === "POST") {
      const id = path.split("/")[2];
      const r = enqueueCommand({ action: "TASK_CANCEL", lane: "CONTROL", payload: { id } });
      if (!r.ok) return json(res, 429, { ok: false, error: r.error });
      await runOne(r.command);
      return json(res, 200, { ok: true });
    }
    if (path.startsWith("/tasks/") && req.method === "GET") {
      const id = path.split("/")[2];
      const t = getTask(id);
      return t ? json(res, 200, { ok: true, task: t }) : json(res, 404, { ok: false, error: "not_found" });
    }
    if (path === "/events" && req.method === "GET") {
      const since = Number(url.searchParams.get("since") ?? 0);
      const limit = Math.min(Number(url.searchParams.get("limit") ?? 200), 500);
      const task = url.searchParams.get("task");
      return json(res, 200, { ok: true, events: task ? eventsByTask(task, limit) : tailEvents(since, limit) });
    }
    if (path === "/reset" && req.method === "POST") {
      const r = enqueueCommand({ action: "ENVIRONMENT_RESET", lane: "EMERGENCY", payload: { by: "operator" } });
      if (!r.ok) return json(res, 429, { ok: false, error: r.error });
      await runOne(r.command);
      return json(res, 200, { ok: true });
    }
    return json(res, 404, { ok: false, error: `no route ${req.method} ${path}` });
  } catch (e) {
    return json(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// ── socket.io (:3040, path '/' — требование gateway) ──────────────
const wsHttpServer = createServer();
const io = new Server(wsHttpServer, {
  path: "/",
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 60_000,
  pingInterval: 25_000,
});

onEvent((e) => { io.emit("event", e); });

io.on("connection", (socket) => {
  socket.emit("hello", { service: "me2-daemon", boot: BOOT_TS, last_seq: lastSeq() });
  socket.emit("snapshot", snapshot());

  // heartbeat консоли → workers
  socket.on("heartbeat", (p: { role?: string; state?: string } = {}, ack?: (r: unknown) => void) => {
    const w = upsertWorker({
      id: `wk_console_${socket.id.slice(0, 8)}`,
      role: String(p.role ?? "console"),
      kind: "API",
      state: p.state ?? "IDLE",
    });
    ack?.({ ok: true, worker: w });
  });

  // команды через WS (request/response семантика)
  socket.on("command", async (p: { action: string; payload?: Record<string, unknown>; idempotency_key?: string; lane?: string; run_after?: number }, ack?: (r: unknown) => void) => {
    try {
      const r = enqueueCommand({
        action: String(p?.action ?? ""),
        lane: p?.lane,
        payload: p?.payload ?? {},
        idempotency_key: p?.idempotency_key ?? null,
        run_after: p?.run_after,
      });
      if (!r.ok) { ack?.({ ok: false, error: r.error }); return; }
      const cmd = (r.deduped || (r.command.run_after && r.command.run_after > Date.now())) ? r.command : await runOne(r.command);
      let result: unknown = null;
      try { result = cmd.result ? JSON.parse(cmd.result) : null; } catch { result = cmd.result; }
      ack?.({ ok: true, deduped: r.deduped, command: cmd, result });
    } catch (e) {
      ack?.({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });
});

// периодический snapshot push + дренаж команд + reaper
setInterval(() => {
  try { io.emit("snapshot", snapshot()); } catch { /* console может быть offline */ }
}, 2000);
setInterval(() => {
  try { void drainCommands(8); } catch (e) { console.error(`[drain] ${String(e)}`); }
}, 1000);
setInterval(() => {
  try { reapStaleWorkers(); } catch { /* noop */ }
}, 30_000);

startMasterLoop();
initEvidence();
wsHttpServer.listen(WS_PORT, () => console.log(`[me2-daemon] v${VERSION} WS on :${WS_PORT} (path '/')`));
restServer.listen(REST_PORT, () => console.log(`[me2-daemon] v${VERSION} REST on :${REST_PORT}`));
console.log(`[me2-daemon] lanes: EMERGENCY/CONTROL/MUTATION/READ_ONLY, budget 24/60s, actions: ${knownActions().length} (boot ${BOOT_TS})`);
