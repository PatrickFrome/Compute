/**
 * ME2 Daemon — ядро METAENGINE 2 (Фаза B «Стратификация»).
 * API-native agent runtime: агенты = контексты + инструменты, НЕ вкладки браузера.
 * Горячий путь: локальный SQLite + in-process шина. REST + socket.io на :3040.
 *
 * Запуск: bun run dev  (bun --hot index.ts)
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Server } from "socket.io";
import {
  createAgent, deleteAgent, listAgents, listTasks, createTask, getTask,
  cancelTask, emit, tailEvents, db,
} from "./store";
import { listProviders } from "./providers";
import { startMasterLoop } from "./worker";

const PORT = 3040;
const BOOT_TS = new Date().toISOString();

// ── REST ──────────────────────────────────────────────────────────
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

const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }

  try {
    if (path === "/health") {
      return json(res, 200, { ok: true, service: "me2-daemon", version: "0.1.0", boot: BOOT_TS, ts: new Date().toISOString() });
    }
    if (path === "/state" && req.method === "GET") {
      const agents = listAgents();
      const tasks = listTasks();
      const since = Number(url.searchParams.get("since") ?? 0);
      return json(res, 200, {
        ok: true, agents, tasks,
        events: tailEvents(since, 100),
        stats: {
          agentsIdle: agents.filter((a) => a.status === "IDLE").length,
          agentsBusy: agents.filter((a) => a.status === "BUSY").length,
          tasksReady: tasks.filter((t) => t.status === "READY").length,
          tasksRunning: tasks.filter((t) => t.status === "RUNNING").length,
          tasksCompleted: tasks.filter((t) => t.status === "COMPLETED").length,
          tasksFailed: tasks.filter((t) => t.status === "FAILED").length,
        },
      });
    }
    if (path === "/agents" && req.method === "POST") {
      const body = await readBody(req);
      const role = String(body.role ?? "IMPLEMENTER").toUpperCase().slice(0, 32);
      const model = String(body.model ?? "zai:default").slice(0, 64);
      const agent = createAgent(role, model);
      const ev = emit("AGENT_CREATED", { role, model }, agent.id, null);
      io.emit("event", ev);
      return json(res, 200, { ok: true, agent });
    }
    if (path.startsWith("/agents/") && req.method === "DELETE") {
      const id = path.split("/")[2];
      deleteAgent(id);
      const ev = emit("AGENT_RETIRED", { id }, id, null);
      io.emit("event", ev);
      return json(res, 200, { ok: true });
    }
    if (path === "/tasks" && req.method === "POST") {
      const body = await readBody(req);
      const title = String(body.title ?? "untitled").slice(0, 200);
      const spec = String(body.spec ?? "").slice(0, 20000);
      if (!spec) return json(res, 400, { ok: false, error: "spec_required" });
      const role = body.role ? String(body.role).toUpperCase().slice(0, 32) : null;
      const maxSteps = Math.min(Math.max(Number(body.max_steps ?? 8), 1), 24);
      const task = createTask({ id: `tk_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, title, spec, role, max_steps: maxSteps });
      const ev = emit("TASK_QUEUED", { title, role, max_steps: maxSteps }, null, task.id);
      io.emit("event", ev);
      return json(res, 200, { ok: true, task });
    }
    if (path.startsWith("/tasks/") && path.endsWith("/cancel") && req.method === "POST") {
      const id = path.split("/")[2];
      cancelTask(id);
      const ev = emit("TASK_CANCELLED", { id }, null, id);
      io.emit("event", ev);
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
      return json(res, 200, { ok: true, events: tailEvents(since, limit) });
    }
    if (path === "/providers" && req.method === "GET") {
      return json(res, 200, { ok: true, providers: await listProviders() });
    }
    if (path === "/reset" && req.method === "POST") {
      db.exec("DELETE FROM tasks; DELETE FROM events; DELETE FROM agents;");
      const ev = emit("ENVIRONMENT_RESET", { by: "operator" }, null, null);
      io.emit("event", ev);
      return json(res, 200, { ok: true });
    }
    return json(res, 404, { ok: false, error: `no route ${req.method} ${path}` });
  } catch (e) {
    return json(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// ── socket.io (path = '/', Caddy forwards via XTransformPort) ─────
const io = new Server(httpServer, {
  path: "/",
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 60_000,
  pingInterval: 25_000,
});

io.on("connection", (socket) => {
  socket.emit("hello", { service: "me2-daemon", boot: BOOT_TS });
  socket.on("subscribe", () => {
    const last = tailEvents(0, 1).pop();
    socket.emit("catchup", { since: last?.seq ?? 0 });
  });
});

startMasterLoop();
httpServer.listen(PORT, () => {
  console.log(`[me2-daemon] listening on :${PORT} (boot ${BOOT_TS})`);
});
