"use client";
/**
 * ME2 · общий WS-клиент daemon'а (R46, унификация).
 * Одна socket.io-связь на всё приложение: река рассуждений, операции флота,
 * снимки Mission Control — всё через один канал :3040 (gateway XTransformPort).
 *
 * R46: операции чат-агентов (create/turn/close/tick/send/objective/compact) переведены
 * с REST POST /agentchat на socket.io "agentchat:op" (ack) — REST-поверхность операций
 * снята постановкой оператора: вся работа идёт с открытыми чатами-агентами в браузере.
 */
import type { Socket } from "socket.io-client";

export const ME2_WS_OPTS = { path: "/", transports: ["websocket", "polling"], reconnectionDelay: 2000, timeout: 8000 } as const;

let sockPromise: Promise<Socket> | null = null;

/** Ленивая общая связь с daemon (:3040). Повторные вызовы возвращают тот же сокет. */
export function me2Socket(): Promise<Socket> {
  if (!sockPromise) {
    sockPromise = import("socket.io-client").then(
      ({ io: mk }) => mk("/?XTransformPort=3040", ME2_WS_OPTS) as Socket,
    );
  }
  return sockPromise;
}

export type AgentChatOp = {
  op: "create" | "turn" | "compact" | "close" | "tick" | "send" | "objective";
  id?: string;
  text?: string;
  title?: string;
  objective?: string;
  role?: string;
  agent_id?: string;
  by?: string;
  force?: boolean;
};

export type AgentChatOpResult = {
  ok: boolean;
  error?: string;
  session?: { id: string; [k: string]: unknown };
  id?: string;
  state?: string;
  kicked?: string[];
  supervisors?: number;
  in_flight?: number;
  [k: string]: unknown;
};

/**
 * Операция над флотом чат-агентов через socket.io ack.
 * Честный таймаут: если daemon офлайн — резолв ошибкой, а не вечное зависание UI.
 */
export async function agentChatOp(payload: AgentChatOp, timeoutMs = 10_000): Promise<AgentChatOpResult> {
  try {
    const s = await me2Socket();
    return await new Promise<AgentChatOpResult>((resolve) => {
      let settled = false;
      const done = (r: AgentChatOpResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(r ?? { ok: false, error: "no_ack" });
      };
      const timer = setTimeout(() => done({ ok: false, error: "daemon_unreachable" }), timeoutMs);
      s.emit("agentchat:op", payload, (res: AgentChatOpResult) => done(res));
    });
  } catch {
    return { ok: false, error: "daemon_unreachable" };
  }
}

// ── R47: vault токенов — socket-поверхность (list/set/delete) с ack ──
export type TokensOp = { op: "list" | "set" | "delete"; name?: string; value?: string; tier?: string; by?: string };
export type TokensOpResult = {
  ok: boolean;
  error?: string;
  tokens?: Array<{ name: string; tier: string; known: boolean; desc: string; source: string; masked: string; updated_at: string; updated_by: string }>;
  status?: { total?: number; known_missing?: string[]; last_ops?: Array<{ at: string; op: string; name: string; by: string; ok: boolean }>; [k: string]: unknown };
  [k: string]: unknown;
};

/** Операция vault'а токенов через socket.io ack (T0-плоскость; raw-значения не возвращаются). */
export async function tokensOp(payload: TokensOp, timeoutMs = 10_000): Promise<TokensOpResult> {
  try {
    const s = await me2Socket();
    return await new Promise<TokensOpResult>((resolve) => {
      let settled = false;
      const done = (r: TokensOpResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(r ?? { ok: false, error: "no_ack" });
      };
      const timer = setTimeout(() => done({ ok: false, error: "daemon_unreachable" }), timeoutMs);
      s.emit("tokens:op", payload, (res: TokensOpResult) => done(res));
    });
  } catch {
    return { ok: false, error: "daemon_unreachable" };
  }
}
