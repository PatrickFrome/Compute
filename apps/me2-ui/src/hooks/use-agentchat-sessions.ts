"use client";

import { useSyncExternalStore } from "react";
import { me2Fetch } from "@/lib/me2-bus";

export type AgentChatSession = {
  id: string;
  agent_id: string;
  title: string;
  status: "ACTIVE" | "CLOSED";
  state: "IDLE" | "THINKING";
  summary: string;
  compactions: number;
  turns_ok: number;
  turns_fail: number;
  fail_streak: number;
  last_error: string | null;
  model: string;
  objective: string;
  created_at: string;
  updated_at: string;
  outcome_status: string | null;
  outcome_proof: string | null;
  outcome_at: string | null;
  role: string;
};

export type AgentChatStatus = {
  total: number;
  active: number;
  thinking: number;
  supervisors: number;
  turns_ok: number;
  turns_fail: number;
  compactions: number;
  degraded: number;
  in_flight: number;
};

type AgentChatSnapshot = {
  sessions: AgentChatSession[];
  status: AgentChatStatus | null;
  loading: boolean;
  error: string | null;
  updatedAt: number;
};

let snapshot: AgentChatSnapshot = {
  sessions: [],
  status: null,
  loading: false,
  error: null,
  updatedAt: 0,
};
const listeners = new Set<() => void>();
let intervalId: number | null = null;
let inFlight = false;
const AGENTCHAT_FETCH_TIMEOUT_MS = 8_000;

function emit() {
  for (const listener of listeners) listener();
}

async function loadAgentChat() {
  if (inFlight) return;
  inFlight = true;
  snapshot = { ...snapshot, loading: snapshot.updatedAt === 0, error: null };
  emit();
  try {
    const data = await me2Fetch<{ sessions?: AgentChatSession[]; status?: AgentChatStatus }>(
      "/agentchat?XTransformPort=3041",
      { signal: AbortSignal.timeout(AGENTCHAT_FETCH_TIMEOUT_MS) },
    );
    if (!data) {
      snapshot = { ...snapshot, loading: false, error: "daemon unavailable", updatedAt: Date.now() };
    } else {
      snapshot = {
        sessions: data.sessions ?? [],
        status: data.status ?? null,
        loading: false,
        error: null,
        updatedAt: Date.now(),
      };
    }
  } catch {
    snapshot = { ...snapshot, loading: false, error: "daemon unavailable", updatedAt: Date.now() };
  } finally {
    inFlight = false;
    emit();
  }
}

function start() {
  if (intervalId != null) return;
  void loadAgentChat();
  intervalId = window.setInterval(() => {
    if (document.visibilityState === "visible") void loadAgentChat();
  }, 5_000);
}

function stop() {
  if (intervalId == null || listeners.size > 0) return;
  window.clearInterval(intervalId);
  intervalId = null;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  start();
  return () => {
    listeners.delete(listener);
    stop();
  };
}

function getSnapshot() {
  return snapshot;
}

const serverSnapshot: AgentChatSnapshot = {
  sessions: [],
  status: null,
  loading: false,
  error: null,
  updatedAt: 0,
};

export function useAgentChatSessions() {
  const state = useSyncExternalStore(subscribe, getSnapshot, () => serverSnapshot);
  return { ...state, refresh: loadAgentChat };
}
