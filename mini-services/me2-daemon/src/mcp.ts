/**
 * ME2 daemon — MCP-сервер (R25, пункт A1 из research/2026/R24-AUDIT-ROADMAP.md §7).
 *
 * Зачем: главный стратегический вывод R24 — индустрия стандартизовала MCP; ME2 = MCP-сервер
 * превращает наш браузерный план (sense/act/obsv + fleet + memory + tasks) в инструмент
 * ВСЕЙ агентной экосистемы: VS Code, Codex, Claude Code подключаются стандартным клиентом.
 *
 * Реализация: Streamable HTTP (JSON-RPC 2.0 поверх POST /mcp) + stdio-адаптер (mcp-stdio.ts).
 * Зависимостей нет — MCP это просто JSON-RPC: initialize → tools/list → tools/call.
 * Инструменты (минимальный честный набор §7):
 *   browser_sense   — свежая aria-перцепция вкладки (senseNow)
 *   browser_act     — действие + effect-вердикт + auto-verify (senseAct)
 *   browser_obsv    — CDP network/console/exception сенсоры (obsvSnapshot)
 *   fleet_list      — реестр нод fleet + freshness + capacity
 *   memory_search   — эпизоды/семантика/процедуры (memSearch)
 *   task_enqueue    — постановка задачи через command bus (TASK_ENQUEUE)
 *   daemon_health   — версия/boot/mechanics-вердикт для быстрой диагностики
 *
 * Zero-authority: tools/call НЕ поднимает привилегий — всё через существующие публичные
 * функции daemon'а; никаких произвольных eval (arbitrary_eval=false инвариант сохранён).
 */

import { knownActions, runOne } from "../commands";
import { enqueueCommand, getMeta } from "../store";
import { senseNow, senseAct } from "./sense";
import { obsvStart, obsvSnapshot, obsvReset, obsvStop, obsvStatus } from "./obsv";
import { fleetList } from "./fleet";
import { memSearch } from "./memory";

export const MCP_PROTOCOL_VERSION = "2025-06-18";
export const MCP_SERVER_INFO = { name: "me2-daemon", title: "METAENGINE 2 browser runtime" };

interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const TOOLS: McpTool[] = [
  {
    name: "browser_sense",
    description: "Capture fresh aria-snapshot of a tab and return semantic targets (role/name/ref). Tree-first perception.",
    inputSchema: {
      type: "object",
      properties: { tab: { type: "string", description: "tab id; omit = active tab" } },
    },
  },
  {
    name: "browser_act",
    description: "Act on a semantic target (click/type/press by ref, exact name or unique substring) with effect epistemology verdict (CONFIRMED/NO_EFFECT_PROVEN/FAILED_PRE_EFFECT/FENCED/AMBIGUOUS) and auto-verify.",
    inputSchema: {
      type: "object",
      required: ["key", "action"],
      properties: {
        key: { type: "string", description: "ref (@e12), exact name or unique substring" },
        action: { type: "string", enum: ["click", "type", "press"] },
        text: { type: "string", description: "text for action=type" },
        tab: { type: "string" },
      },
    },
  },
  {
    name: "browser_obsv",
    description: "CDP network/console/exception events of the attached target (Chrome DevTools parity).",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "max events per stream (default 30)" },
        level: { type: "string", description: "console level filter: error|warning|log" },
        filter: { type: "string", description: "substring filter for url/text" },
        op: { type: "string", enum: ["attach", "reset", "stop"], description: "collector control" },
      },
    },
  },
  {
    name: "fleet_list",
    description: "Fleet registry: nodes, freshness, capacity, backlog, outcome river.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "memory_search",
    description: "Search ME2 memory (episodic/semantic/procedural rows).",
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string", description: "substring query" },
        kind: { type: "string", enum: ["episodic", "semantic", "procedural"] },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "task_enqueue",
    description: "Enqueue a task via the ME2 command bus (TASK_ENQUEUE; 47/47 invariant untouched).",
    inputSchema: {
      type: "object",
      required: ["title"],
      properties: {
        title: { type: "string" },
        spec: { type: "string" },
        role: { type: "string", description: "agent role, e.g. IMPLEMENTER" },
        idempotency_key: { type: "string" },
      },
    },
  },
  {
    name: "daemon_health",
    description: "ME2 daemon health: version, boot, actions, bus last_seq.",
    inputSchema: { type: "object", properties: {} },
  },
];

// статистика живости (для механики ME21): честный WORKS только после реального вызова
const stats = { initialized: 0, calls: 0, errors: 0, lastCallAt: 0, lastTool: "" };
export function mcpStatus() {
  return { ...stats, tools: TOOLS.length, protocol: MCP_PROTOCOL_VERSION };
}

type JsonRpcId = string | number | null;
interface JsonRpcReq { jsonrpc?: string; id?: JsonRpcId; method?: string; params?: Record<string, unknown> }

function rpcResult(id: JsonRpcId, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}
function rpcError(id: JsonRpcId, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function textContent(data: unknown) {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "browser_sense":
      return textContent(await senseNow(args.tab ? String(args.tab) : undefined));
    case "browser_act": {
      const action = String(args.action ?? "");
      if (action !== "click" && action !== "type" && action !== "press")
        throw new Error("action_must_be_click_type_press");
      return textContent(await senseAct({
        key: String(args.key ?? ""), action,
        text: args.text ? String(args.text) : undefined,
        tab: args.tab ? String(args.tab) : undefined,
      }));
    }
    case "browser_obsv": {
      const op = args.op ? String(args.op) : null;
      if (op === "attach") { obsvStart(); return textContent({ ok: true, ...obsvStatus() }); }
      if (op === "reset") { obsvReset(); return textContent({ ok: true, ...obsvStatus() }); }
      if (op === "stop") { obsvStop(); return textContent({ ok: true, ...obsvStatus() }); }
      return textContent(obsvSnapshot({
        limit: args.limit ? Number(args.limit) : undefined,
        level: args.level ? String(args.level) : undefined,
        filter: args.filter ? String(args.filter) : undefined,
      }));
    }
    case "fleet_list":
      return textContent(fleetList());
    case "memory_search":
      return textContent(memSearch({
        q: args.q ? String(args.q) : undefined,
        kind: args.kind ? String(args.kind) : undefined,
        limit: args.limit ? Number(args.limit) : undefined,
      }));
    case "task_enqueue": {
      const r = enqueueCommand({
        action: "TASK_ENQUEUE",
        payload: { title: args.title, spec: args.spec, role: args.role },
        idempotency_key: args.idempotency_key ? String(args.idempotency_key) : null,
      });
      if (!r.ok) throw new Error(r.error);
      const cmd = await runOne(r.command);
      const parsed = cmd.result ? (JSON.parse(cmd.result) as { task?: unknown }) : null;
      return textContent({ ok: true, task: parsed?.task ?? null, command: cmd.id });
    }
    case "daemon_health":
      return textContent({
        ok: true, service: "me2-daemon", actions: knownActions().length,
        mcp: mcpStatus(),
      });
    default:
      throw new Error(`unknown_tool: ${name}`);
  }
}

/** Обработка одного JSON-RPC запроса (или batch). Возвращает тело ответа или null (notification). */
export async function mcpHandle(body: unknown): Promise<{ status: number; json: unknown } | null> {
  const requests: JsonRpcReq[] = Array.isArray(body) ? (body as JsonRpcReq[]) : [body as JsonRpcReq];
  const responses: unknown[] = [];
  for (const req of requests) {
    const method = String(req?.method ?? "");
    const id = req?.id ?? null;
    const isNotification = req?.id === undefined || req?.id === null;
    try {
      if (method === "initialize") {
        stats.initialized++;
        const clientProto = String((req.params as { protocolVersion?: string } | undefined)?.protocolVersion ?? "");
        responses.push(rpcResult(id, {
          protocolVersion: clientProto || MCP_PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { ...MCP_SERVER_INFO, version: getMeta("version") ?? "0.23.0" },
        }));
      } else if (method === "notifications/initialized" || method.startsWith("notifications/")) {
        // уведомления не отвечают (Streamable HTTP: 202 Accepted)
        continue;
      } else if (method === "ping") {
        responses.push(rpcResult(id, {}));
      } else if (method === "tools/list") {
        responses.push(rpcResult(id, { tools: TOOLS }));
      } else if (method === "tools/call") {
        const p = (req.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
        const name = String(p.name ?? "");
        stats.calls++; stats.lastTool = name; stats.lastCallAt = Date.now();
        try {
          const out = await callTool(name, p.arguments ?? {});
          responses.push(rpcResult(id, out));
        } catch (e) {
          stats.errors++;
          // tool ошибки в MCP — это result с isError, не protocol error
          responses.push(rpcResult(id, {
            content: [{ type: "text", text: String(e instanceof Error ? e.message : e) }],
            isError: true,
          }));
        }
      } else if (isNotification) {
        continue;
      } else {
        responses.push(rpcError(id, -32601, `method_not_found: ${method}`));
      }
    } catch (e) {
      stats.errors++;
      responses.push(rpcError(id, -32603, String(e instanceof Error ? e.message : e)));
    }
  }
  if (!responses.length) return null; // чистые notifications → HTTP 202 без тела
  return { status: 200, json: Array.isArray(body) ? responses : responses[0] };
}
