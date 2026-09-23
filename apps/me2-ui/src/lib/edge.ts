/**
 * Local edge function client (canonical a2-browser-native-supervisor-v1
 * running via bun mini-service on port 3031 — round EDGE-LOCAL-RUNTIME-004).
 * Server-to-server fetches: no gateway XTransformPort needed.
 */
export const EDGE_BASE = "http://127.0.0.1:3031/a2-browser-native-supervisor-v1";

export interface EdgeHealth {
  ok?: boolean;
  schema?: string;
  backend_transport?: string;
  command_wait_batch?: string;
  approval_enrollment?: boolean;
  emergency_wait_route?: boolean;
  postgres_notify_wake?: boolean;
  agent_tool_issue?: boolean;
  agent_tool_issue_allowlist?: string[];
  effect_intent_binding_schemas?: string[];
  [k: string]: unknown;
}

export async function edgeHealth(timeoutMs = 4000): Promise<{ ok: boolean; ms: number; data: EdgeHealth | null; error?: string }> {
  const started = Date.now();
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${EDGE_BASE}/health`, { signal: controller.signal, cache: "no-store" });
    clearTimeout(t);
    const data = (await res.json()) as EdgeHealth;
    return { ok: res.ok && data?.ok === true, ms: Date.now() - started, data };
  } catch (e) {
    return { ok: false, ms: Date.now() - started, data: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Canonical route inventory (from edge source, round 004/005 enumeration). */
export const EDGE_ROUTES: { group: string; path: string; method: string; auth: boolean }[] = [
  { group: "core", path: "/health", method: "GET", auth: false },
  { group: "core", path: "/status", method: "GET", auth: true },
  { group: "device", path: "/v1/device/enrollment/request", method: "POST", auth: false },
  { group: "device", path: "/v1/device/enrollment/status", method: "POST", auth: false },
  { group: "commands", path: "/v1/commands/next-batch", method: "POST", auth: true },
  { group: "commands", path: "/v1/commands/wait-emergency", method: "POST", auth: true },
  { group: "toolbelt", path: "/v1/toolbelt/issue", method: "POST", auth: true },
  { group: "devos", path: "/v1/devos/cycle", method: "POST", auth: true },
  { group: "devos", path: "/v1/devos/complete", method: "POST", auth: true },
  { group: "devos", path: "/v1/devos/mark-running", method: "POST", auth: true },
  { group: "devos", path: "/v1/devos/reconcile-ambiguous", method: "POST", auth: true },
  { group: "devos", path: "/v1/devos/resume-admission", method: "POST", auth: true },
  { group: "meta", path: "/v1/meta/objective", method: "POST", auth: true },
  { group: "meta", path: "/v1/meta/activate-plan", method: "POST", auth: true },
  { group: "meta", path: "/v1/meta/admit-task", method: "POST", auth: true },
  { group: "meta", path: "/v1/meta/admit-frontier", method: "POST", auth: true },
  { group: "meta", path: "/v1/meta/authoritative-inputs", method: "POST", auth: true },
  { group: "cognitive", path: "/v1/cognitive-delta/*", method: "POST", auth: true },
  { group: "promotion", path: "/v1/devos-promotion/*", method: "POST", auth: true },
  { group: "inspect", path: "/v1/db-inspect/*", method: "GET", auth: true },
];

export async function jsonError(message: string, status = 500, extra: Record<string, unknown> = {}) {
  return Response.json({ ok: false, error: message, ...extra }, { status });
}
