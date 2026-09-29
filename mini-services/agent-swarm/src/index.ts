/**
 * ME2 CHAT-SWARM v1.4.0 — index.ts
 * Входная точка: HTTP REST + socket.io. Порт 3046 ( gateway: /?XTransformPort=3046).
 * v1.4.0 (директивы оператора): без временных лимитов (governor/cooldown/таймауты
 * удалены), разведка лучших AI-моделей (model-scout.ts), МУЛЬТИ-РЕЕСТР Colab
 * GPU-узлов (colab.ts, до 8 узлов — под 5 ноутбуков оператора + запас).
 * Рой запускается генезисом и живёт непрерывно.
 */
import { createServer } from "http";
import { Server } from "socket.io";
import {
  genesis, listAgents, swarmStats, spawnChild,
  retireAgent, setMuted, operatorSay, setEmitter, getAgent, findAgentByName, reviveLoops,
} from "./agent";
import { addMessage, kvGet, kvSet, db, recentMessages, recentLessons } from "./memory";
import { llmProviderStats, llmChainStats } from "./llm";
import { registerColab, unregisterColab, colabStatus, startColabProbeLoop } from "./colab";
import { scoutStatus, runScoutNow, startScoutLoop } from "./model-scout";
import { SWARM_VERSION } from "./agent";
const PORT = 3046;   // REST (curl/Next API-прокси)
const WS_PORT = 3047; // socket.io, path '/' (gateway: /?XTransformPort=3047)
const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const json = (code: number, body: unknown) => {
    res.writeHead(code, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify(body));
  };
  let body = "";
  for await (const chunk of req) body += chunk;
  try {
    if (url.pathname === "/health") return json(200, { ok: true, service: "me2-agent-swarm", llmProviders: llmProviderStats(), llmChain: llmChainStats(), colab: colabStatus(), scout: scoutStatus(), ...swarmStats() });
    if (url.pathname === "/state") {
      const agents = listAgents().map((a) => ({
        id: a.id, name: a.name, role: a.role, generation: a.generation, parent_id: a.parent_id,
        state: a.state, cycles: a.cycles, born: a.born, last_seen: a.last_seen, muted: !!a.muted,
        improvements: JSON.parse(a.improvements || "[]") as string[],
      }));
      const nodes = agents.map((a) => ({ id: a.id, name: a.name, parentId: a.parent_id, generation: a.generation, role: a.role, state: a.state, cycles: a.cycles, muted: a.muted }));
      const edges = agents.filter((a) => a.parent_id).map((a) => ({ from: a.parent_id, to: a.id }));
      return json(200, { ok: true, agents, lineage: { nodes, edges }, goals: JSON.parse(kvGet("goals") ?? "[]"), ...swarmStats() });
    }
    if (url.pathname === "/messages") {
      const limit = Math.min(Number(url.searchParams.get("limit") ?? 120), 500);
      return json(200, { ok: true, messages: recentMessages(limit).reverse() });
    }
    if (url.pathname === "/memory") {
      const lessons = recentLessons(60);
      const memories = db.query(`SELECT id,ts,agent_id,agent_name,text,kind FROM memories ORDER BY id DESC LIMIT 80`).all();
      return json(200, { ok: true, lessons, memories });
    }
    if (url.pathname === "/proposals") {
      const rows = db.query(`SELECT ts, type, payload FROM events WHERE type IN ('swarm_improve','self_improve','goal_set') ORDER BY id DESC LIMIT 60`).all();
      return json(200, { ok: true, proposals: rows });
    }
    if (req.method === "POST") {
      const p = JSON.parse(body || "{}") as Record<string, unknown>;
      if (url.pathname === "/spawn") {
        const parent = p.parentId ? getAgent(String(p.parentId)) : (p.parentName ? findAgentByName(String(p.parentName)) : findQueen());
        const a = spawnChild(parent ?? null, String(p.role ?? "agent").slice(0, 60), String(p.name ?? `Дитя-${Date.now() % 1000}`).slice(0, 48), String(p.intent ?? "Рождён оператором").slice(0, 500));
        return json(200, { ok: true, agent: { id: a.id, name: a.name, role: a.role, generation: a.generation } });
      }
      if (url.pathname === "/chat") { operatorSay(String(p.text ?? "").slice(0, 2000)); return json(200, { ok: true }); }
      if (url.pathname === "/broadcast") { addMessage({ from_id: null, from_name: "ОПЕРАТОР", kind: "broadcast", channel: "#all", text: String(p.text ?? "").slice(0, 2000) }); return json(200, { ok: true }); }
      if (url.pathname === "/goal") { kvSet("goals", JSON.stringify([...(JSON.parse(kvGet("goals") ?? "[]") as string[]), String(p.text ?? "").slice(0, 300)].slice(-12))); return json(200, { ok: true }); }
      if (url.pathname === "/mute") { const ok = setMuted(String(p.agentId), !!p.muted); return json(ok ? 200 : 404, { ok }); }
      if (url.pathname === "/kill") { const ok = retireAgent(String(p.agentId)); return json(ok ? 200 : 404, { ok }); }
      if (url.pathname === "/colab/register") {
        const r = await registerColab(String(p.url ?? ""), p.model ? String(p.model) : undefined, p.name ? String(p.name) : undefined);
        return json(r.ok ? 200 : 400, { ok: r.ok, detail: r.detail, node: r.node, colab: colabStatus(), chain: llmChainStats() });
      }
      if (url.pathname === "/colab/unregister") {
        const r = unregisterColab(String(p.key ?? p.name ?? p.url ?? ""), String(p.reason ?? "оператор"));
        return json(r.ok ? 200 : 404, { ok: r.ok, detail: r.reason, colab: colabStatus(), chain: llmChainStats() });
      }
      if (url.pathname === "/scout/run") {
        const s = await runScoutNow();
        return json(200, { ok: true, scout: s, chain: llmChainStats() });
      }
      return json(404, { ok: false, error: "unknown op" });
    }
    if (url.pathname === "/colab/status") return json(200, { ok: true, colab: colabStatus(), chain: llmChainStats() });
    if (url.pathname === "/scout/status") return json(200, { ok: true, scout: scoutStatus(), chain: llmChainStats() });
    return json(404, { ok: false, error: "not found" });
  } catch (e) {
    return json(500, { ok: false, error: String(e).slice(0, 200) });
  }
});
function findQueen() {
  return listAgents().find((a) => a.role === "queen") ?? listAgents()[0] ?? null;
}
// socket.io на отдельном сервере (паттерн me2-daemon: REST и WS на разных портах)
const wsHttpServer = createServer();
const io = new Server(wsHttpServer, {
  // Путь менять нельзя — используется Caddy для маршрутизации через XTransformPort
  path: "/",
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 60000,
  pingInterval: 25000,
});
setEmitter((event, data) => io.emit(event, data));
io.on("connection", (socket) => {
  socket.emit("swarm_event", { type: "state", data: swarmStats(), ts: new Date().toISOString() });
  socket.on("operator_chat", (p: { text?: string }) => { if (p?.text) operatorSay(String(p.text).slice(0, 2000)); });
  socket.on("operator_broadcast", (p: { text?: string }) => {
    if (p?.text) addMessage({ from_id: null, from_name: "ОПЕРАТОР", kind: "broadcast", channel: "#all", text: String(p.text).slice(0, 2000) });
  });
});
// Вечная жизнь против EADDRINUSE: если порт занят (гонка при hot-reload) — рой не умирает,
// а терпеливо повторяет биндинг каждые 3с, пока порт не освободится.
function listenForever(server: { listen: (p: number, cb: () => void) => void; on: (ev: string, cb: (e: { code?: string }) => void) => void }, port: number, label: string, onUp: () => void) {
  const attempt = (delay = 0) => {
    setTimeout(() => {
      server.once?.("error", function thisErr(e: { code?: string }) {
        server.removeListener?.("error", thisErr);
        if (e?.code === "EADDRINUSE" || e?.code === "EACCES") {
          console.warn(`[me2-agent-swarm] ${label} :${port} занят (${e.code}) — повтор через 3с`);
          attempt(3000);
        }
      });
      server.listen(port, () => {
        console.log(`[me2-agent-swarm] ${label} :${port} поднят`);
        onUp();
      });
    }, delay);
  };
  attempt();
}
listenForever(httpServer as never, PORT, "REST", () => {
  console.log(`[me2-agent-swarm] v${SWARM_VERSION} REST :${PORT} — no budgets, no limits, no timeouts. Continuous life.`);
  genesis();
  startColabProbeLoop(); // фоновый зонд Colab-узла (см. colab.ts)
  startScoutLoop();      // разведка лучших AI-моделей + миграция цепочки (см. model-scout.ts)
  // Watchdog «вечной жизни»: раз в 60с проверяем, что рой дышит; замёрзшие петли пересобирает reviveLoops()
  setInterval(() => {
    try { reviveLoops(); } catch (e) { console.error(`[swarm] watchdog error: ${String(e).slice(0, 120)}`); }
  }, 60_000);
});
listenForever(wsHttpServer as never, WS_PORT, "WS", () => {
  console.log(`[me2-agent-swarm] v${SWARM_VERSION} WS :${WS_PORT} (socket.io path /)`);
});
