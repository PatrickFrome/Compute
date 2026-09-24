"use client";
// ── ME2 BUS: общий контракт данных daemon'а + command bus клиент (R74 rebuild) ──
// Инварианты: относительные пути + ?XTransformPort=3041 (REST) · socket.io "/?XTransformPort=3040".
// Секреты никогда не проходят через этот модуль (vault только через /tokens, значения маскированы).

import type { Socket } from "socket.io-client";

// ── типы (зеркало store.ts daemon) ──────────────────────────────────────────────
export type Agent = { id: string; role: string; status: string; model: string; paused: number; created_at: string; updated_at: string };
export type Task = {
  id: string; title: string; spec: string; role: string | null; parent_id: string | null; status: string;
  agent_id: string | null; max_steps: number; steps: number; result: string | null;
  error: string | null; reflection: string | null; not_before_ms?: number | null; park_count?: number;
  objective_id?: string | null; created_at: string; updated_at: string;
};
export type Worker = { id: string; role: string; kind: string; state: string; generation: number; created_at: string; heartbeat_at: string };
export type Command = {
  id: string; action: string; lane: string; status: string; cost: number;
  run_after: number | null; created_at: string; error: string | null; result: string | null;
};
export type Event = { seq: number; ts: string; type: string; agent_id: string | null; task_id: string | null; data: string };
export type ActionMeta = { action: string; lane: string; cost: number; desc: string; group: string; args?: string };
export type Mirror = { mode: string; pending: number; method: string | null; last_error: string | null; last_sent_seq: number; storage?: { ok: boolean; bucket: string; objects: number }; ddl?: { last_result: string | null; retry_every_min: number; next_retry_at: string | null; attempts_total: number } };
export type Snapshot = {
  ok: boolean; ts: string; agents: Agent[]; tasks: Task[]; archived?: Task[]; workers: Worker[];
  commands: Command[]; events: Event[];
  budget: { used: number; limit: number; window_ms: number };
  stats: Record<string, number>;
  meta: { version: string; boot: string };
};
export type BrowserTab = { id: string; title: string; url: string; active: boolean };
export type ToastPayload = { title: string; description?: string; variant?: "default" | "destructive" };

// ── константы стиля (перенос из legacy 1:1) ─────────────────────────────────────
export const WS_OPTS = { path: "/", transports: ["websocket", "polling"] as Array<"websocket" | "polling">, reconnectionDelay: 2000, timeout: 8000 };

export const EVENT_STYLE: Record<string, string> = {
  TASK_QUEUED: "text-emerald-400", TASK_LEASED: "text-amber-400", TASK_DONE: "text-emerald-300",
  TASK_COMPLETED: "text-emerald-300", TASK_FAILED: "text-rose-400", TASK_CANCELLED: "text-zinc-400",
  TASK_RETRIED: "text-amber-300", TASK_ARCHIVED: "text-zinc-400", TASK_LISTED: "text-zinc-500",
  TASK_SCHEDULED: "text-lime-300", TASK_HANDOFF: "text-violet-300", TASK_LEASE_VOID: "text-zinc-500",
  TASK_PARKED: "text-amber-300", TASK_REFLECTED: "text-violet-300", TASK_REVIEWED: "text-cyan-300", TASK_REWARD_HACK: "text-rose-300",
  GLM_PROBE: "text-cyan-400", GLM_LATEST_SET: "text-cyan-300",
  APPROVAL_REQUESTED: "text-amber-400", APPROVAL_APPROVED: "text-emerald-300", APPROVAL_DENIED: "text-rose-300", APPROVAL_CONSUMED: "text-emerald-400", APPROVAL_POLICY_SET: "text-amber-300",
  DB_HYGIENE: "text-teal-300", MEMORY_ECONOMY: "text-teal-300",
  POOL_SCALED: "text-cyan-300", POOL_WORKER_CREATED: "text-cyan-400", POOL_BURN: "text-lime-300",
  POOL_LEASE_ACQUIRED: "text-amber-300", POOL_LEASE_RELEASED: "text-emerald-400", POOL_LEASE_REAPED: "text-rose-300",
  AGENT_CREATED: "text-amber-300", AGENT_RETIRED: "text-zinc-500",
  AGENT_PAUSED: "text-amber-400", AGENT_RESUMED: "text-lime-400", AGENT_MODEL_SET: "text-cyan-300",
  COMMAND_ENQUEUED: "text-fuchsia-400", COMMAND_LEASED: "text-fuchsia-300",
  COMMAND_COMPLETED: "text-emerald-400", COMMAND_FAILED: "text-rose-400", COMMAND_CANCELLED: "text-zinc-400",
  BUDGET_FLUSHED: "text-rose-300", BUDGET_ADJUSTED: "text-fuchsia-300",
  WORKSPACE_SNAPSHOT: "text-cyan-400", EVENTS_SEARCHED: "text-cyan-400",
  STEP_START: "text-zinc-500", STEP_DONE: "text-zinc-500",
  TOOL_CALL: "text-cyan-300", TOOL_RESULT: "text-cyan-500",
  ENVIRONMENT_RESET: "text-rose-300", FLEET_RECONCILED: "text-amber-400",
  AGENT_CHAT_CREATED: "text-violet-300", AGENT_CHAT_STEP: "text-zinc-400", AGENT_CHAT_MSG: "text-zinc-300",
  AGENT_CHAT_OUTCOME: "text-emerald-300", AGENT_CHAT_DEGRADED: "text-amber-300", AGENT_CHAT_COMPACTED: "text-violet-300",
  FLEET_STEP: "text-zinc-400", HOOK_PING: "text-lime-300", GIT_PUSH: "text-emerald-300",
  LLM_FAILOVER: "text-amber-300", GOVERNOR_BREAKER: "text-rose-300", CI_RUN_FINISHED: "text-cyan-300",
  WORKER_HEARTBEAT: "text-zinc-500", WORKER_REAP: "text-rose-300", MESH_HEARTBEAT: "text-zinc-600",
};

export const STATUS_BADGE: Record<string, string> = {
  READY: "bg-zinc-700 text-zinc-200", RUNNING: "bg-amber-500/90 text-black",
  COMPLETED: "bg-emerald-600 text-white", FAILED: "bg-rose-600 text-white",
  CANCELLED: "bg-zinc-600 text-zinc-300", PENDING: "bg-zinc-700 text-zinc-300",
  LEASED: "bg-amber-500/80 text-black", REJECTED: "bg-rose-800 text-rose-200",
  HANDED_OFF: "bg-violet-700 text-violet-100", PARKED: "bg-amber-800 text-amber-100",
  BUSY: "bg-amber-500/90 text-black", IDLE: "bg-emerald-700 text-emerald-100",
  OFFLINE: "bg-zinc-800 text-zinc-500", PAUSED: "bg-amber-700 text-amber-100",
  ARCHIVED: "bg-zinc-800 text-zinc-400", THINKING: "bg-violet-600 text-violet-50",
  ACTIVE: "bg-emerald-700 text-emerald-100", CLOSED: "bg-zinc-700 text-zinc-300",
};

export const MODEL_OPTIONS = ["zai:default", "zai:glm-4.6", "zai:glm-4.5-air", "zai:glm-4-flash"];

export type BranchTabKey = "ALL" | "ACTIVE" | "DONE" | "CANCELLED" | "ARCHIVE";
export const BRANCH_TABS: { key: BranchTabKey; label: string; dot: string; match: (s: string) => boolean }[] = [
  { key: "ALL", label: "Все", dot: "bg-emerald-400", match: () => true },
  { key: "ACTIVE", label: "Активные", dot: "bg-amber-400", match: (s) => s === "READY" || s === "RUNNING" },
  { key: "DONE", label: "Завершённые", dot: "bg-emerald-500", match: (s) => s === "COMPLETED" || s === "FAILED" },
  { key: "CANCELLED", label: "Отменённые", dot: "bg-zinc-400", match: (s) => s === "CANCELLED" },
  { key: "ARCHIVE", label: "Архив", dot: "bg-zinc-600", match: (s) => s === "ARCHIVED" },
];
export const BRANCH_COLOR: Record<string, string> = {
  RUNNING: "#fbbf24", COMPLETED: "#34d399", FAILED: "#fb7185", CANCELLED: "#f59e0b",
  READY: "#d4d4d8", SCHEDULED: "#a3e635", ARCHIVED: "#71717a", HANDED_OFF: "#a78bfa", PARKED: "#fbbf24",
};

export const EVENT_FILTERS: { key: string; label: string; prefix: string }[] = [
  { key: "ALL", label: "все", prefix: "" },
  { key: "TASK", label: "задачи", prefix: "TASK_" },
  { key: "TOOL", label: "инструменты", prefix: "TOOL_" },
  { key: "STEP", label: "шаги", prefix: "STEP_" },
  { key: "AGENT", label: "флот", prefix: "AGENT_" },
  { key: "COMMAND", label: "шина", prefix: "COMMAND_" },
];

// ── утилиты ─────────────────────────────────────────────────────────────────────
export function age(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.max(1, Math.floor(ms / 1000))}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}м`;
  return `${Math.floor(ms / 3_600_000)}ч`;
}
export function hhmmss(iso: string): string {
  return new Date(iso).toLocaleTimeString("ru-RU", { hour12: false });
}
export function toastBus(p: ToastPayload): void {
  try { window.dispatchEvent(new CustomEvent<ToastPayload>("me2:toast", { detail: p })); } catch { /* SSR */ }
}

// ── REST fetch (без store, относительный путь уже с XTransformPort) ─────────────
export async function me2Fetch<T = unknown>(path: string, init?: RequestInit): Promise<T | null> {
  try {
    const r = await fetch(path, { cache: "no-store", ...init });
    return r.ok ? ((await r.json()) as T) : null;
  } catch { return null; }
}

// ── socket.io singleton (:3040) с подписчиками ──────────────────────────────────
type BusHandlers = {
  onConnect?: () => void;
  onDisconnect?: () => void;
  onSnapshot?: (s: Snapshot) => void;
  onEvent?: (e: Event) => void;
};
let socket: Socket | null = null;
let connecting: Promise<Socket | null> | null = null;
let handlers: BusHandlers = {};

export function setBusHandlers(h: BusHandlers): void { handlers = h; }

export async function getSocket(): Promise<Socket | null> {
  if (socket?.connected) return socket;
  if (connecting) return connecting;
  connecting = (async () => {
    try {
      const { io: mk } = await import("socket.io-client");
      socket = mk("/?XTransformPort=3040", WS_OPTS) as Socket;
      socket.on("connect", () => { socket?.emit("subscribe"); handlers.onConnect?.(); });
      socket.on("disconnect", () => handlers.onDisconnect?.());
      socket.on("snapshot", (d: Snapshot) => { if (d?.ok) handlers.onSnapshot?.(d); });
      socket.on("event", (e: Event) => { if (e?.seq) handlers.onEvent?.(e); });
      return socket;
    } catch {
      socket = null; connecting = null; return null;
    }
  })();
  return connecting;
}

export function isSocketConnected(): boolean { return !!socket?.connected; }

// heartbeat консоли — регистрирует wk_console_* в реестре воркеров
let hbTimer: ReturnType<typeof setInterval> | null = null;
export function startHeartbeat(): void {
  if (hbTimer) return;
  hbTimer = setInterval(() => { socket?.emit("heartbeat", { role: "console", state: "IDLE" }, () => { /* ack */ }); }, 15_000);
}

// ── command bus: socket ack → REST fallback (контракт legacy 1:1) ───────────────
export type SendOpts = { lane?: string; quiet?: boolean; successMsg?: string };
export async function sendCommand(
  action: string,
  payload: Record<string, unknown> = {},
  opts: SendOpts = {},
): Promise<unknown | null> {
  const idem = `${action.toLowerCase()}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const viaWs = (): Promise<{ ok: boolean; error?: string; result?: unknown } | null> => new Promise((resolve) => {
    if (!socket?.connected) return resolve(null);
    const t = setTimeout(() => resolve(null), 8000);
    socket.emit("command", { action, payload, idempotency_key: idem, lane: opts.lane }, (r: { ok: boolean; error?: string; result?: unknown }) => {
      clearTimeout(t); resolve(r);
    });
  });
  let res = await viaWs();
  if (!res) {
    try {
      const r = await fetch("/commands?XTransformPort=3041", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, payload, idempotency_key: idem, lane: opts.lane }),
      });
      res = await r.json();
    } catch { res = null; }
  }
  const ok = !!res?.ok;
  if (!opts.quiet) {
    toastBus({
      title: ok ? `${action} ✓` : `${action} ✗`,
      description: ok ? (opts.successMsg ?? "команда исполнена шиной") : String(res?.error ?? "ошибка"),
      variant: ok ? "default" : "destructive",
    });
  }
  if (!ok) return null;
  // результат шины может прийти строкой (давний урезанный JSON) — пробуем восстановить объект
  let out: unknown = res?.result ?? res;
  if (typeof out === "string") { try { out = JSON.parse(out); } catch { out = null; } }
  if (out && typeof out === "object" && (out as { truncated?: boolean }).truncated) out = null;
  return out;
}

// ── частые команды (переиспользуются страницами и палитрой) ─────────────────────
export async function spawnAgent(role: string): Promise<void> {
  await sendCommand("AGENT_SPAWN", { role, model: "zai:default" }, { successMsg: `агент ${role} создан` });
}
export async function loadBrowserTabs(): Promise<BrowserTab[]> {
  const r = (await sendCommand("BROWSER_TABS", {}, { quiet: true })) as { tabs?: BrowserTab[] } | null;
  return r?.tabs ?? [];
}
export async function taskAction(action: "TASK_CANCEL" | "TASK_RETRY" | "TASK_ARCHIVE", id: string): Promise<void> {
  const msgs: Record<string, string> = {
    TASK_CANCEL: "задача отменена", TASK_RETRY: "задача пере-поставлена в очередь", TASK_ARCHIVE: "задача убрана в архив",
  };
  await sendCommand(action, { id }, { lane: action === "TASK_CANCEL" ? "CONTROL" : undefined, successMsg: msgs[action] });
}
export async function eventsSearch(q: string, limit: number): Promise<{ count: number; events: Event[] } | null> {
  const r = (await sendCommand("EVENTS_SEARCH", { q, limit }, { quiet: true })) as { count?: number; events?: Event[] } | null;
  if (!r) { toastBus({ title: "EVENTS_SEARCH ✗", description: "поиск не удался (q обязателен)", variant: "destructive" }); return null; }
  return { count: r.count ?? (r.events?.length ?? 0), events: r.events ?? [] };
}
export async function environmentReset(): Promise<void> {
  await sendCommand("ENVIRONMENT_RESET", { by: "operator" }, { lane: "EMERGENCY", successMsg: "среда сброшена (EMERGENCY)" });
}
export async function budgetFlush(): Promise<void> {
  await sendCommand("BUDGET_FLUSH", {}, { lane: "EMERGENCY", successMsg: "очередь шины сброшена" });
}
