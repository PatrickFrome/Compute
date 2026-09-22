/**
 * Cloud Supabase client — server-side ONLY (service_role JWT never reaches the browser).
 * Canonical source of credentials: /home/z/.a2/supabase-cloud.env (operator-managed),
 * with process.env override (SUPABASE_URL / SUPABASE_SERVICE_ROLE_JWT).
 *
 * Live browser supervisor plane:
 *   state   → compute_fabric_a2_browser_supervisor_state_h205f22  (latest row = live heartbeat)
 *   command → RPC h205f22_a2_browser_supervisor_issue_native_v1   (operator lane, zero-authority receipts)
 */
import fs from "node:fs";

const A2_ENV_PATH = "/home/z/.a2/supabase-cloud.env";

let cached: { url: string; jwt: string } | null = null;

function loadCloudEnv(): { url: string; jwt: string } {
  if (cached) return cached;
  let url = process.env.SUPABASE_URL ?? "";
  let jwt = process.env.SUPABASE_SERVICE_ROLE_JWT ?? "";
  if (!url || !jwt) {
    try {
      const raw = fs.readFileSync(A2_ENV_PATH, "utf8");
      for (const line of raw.split("\n")) {
        const m = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
        if (!m) continue;
        const val = m[2].replace(/^["']|["']$/g, "");
        if (m[1] === "SUPABASE_URL" && !url) url = val;
        if (m[1] === "SUPABASE_SERVICE_ROLE_JWT" && !jwt) jwt = val;
      }
    } catch {
      // file unreadable — creds stay empty, callers degrade gracefully
    }
  }
  cached = { url: url.replace(/\/+$/, ""), jwt };
  return cached;
}

export function cloudConfigured(): boolean {
  const { url, jwt } = loadCloudEnv();
  return Boolean(url && jwt);
}

export const LIVE_BROWSER_CLIENT_ID = "2a60d6a2-c7c2-4dcc-b4c9-99de768443c9";

export const CLOUD_STATE_TABLE = "compute_fabric_a2_browser_supervisor_state_h205f22";
export const CLOUD_COMMAND_TABLE = "compute_fabric_a2_browser_supervisor_command_h205f22";
export const CLOUD_ISSUE_RPC = "rpc/h205f22_a2_browser_supervisor_issue_native_v1";

export interface CloudStateRow {
  client_id: string;
  last_seen_at: string;
  state: Record<string, unknown> | null;
}

function headers(json = false): Record<string, string> {
  const { jwt } = loadCloudEnv();
  const h: Record<string, string> = { apikey: jwt, Authorization: `Bearer ${jwt}` };
  if (json) h["Content-Type"] = "application/json";
  return h;
}

async function cloudFetch(path: string, init: RequestInit & { json?: boolean }, timeoutMs = 8000): Promise<Response> {
  const { url } = loadCloudEnv();
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${url}/rest/v1${path}`, { ...init, signal: controller.signal, cache: "no-store" });
  } finally {
    clearTimeout(t);
  }
}

/** Latest live supervisor state row (ordered by last_seen_at desc). */
export async function cloudLatestState(clientId = LIVE_BROWSER_CLIENT_ID): Promise<CloudStateRow | null> {
  const res = await cloudFetch(
    `/${CLOUD_STATE_TABLE}?select=client_id,state,last_seen_at&client_id=eq.${encodeURIComponent(clientId)}&order=last_seen_at.desc&limit=1`,
    { method: "GET", headers: headers() },
  );
  if (!res.ok) throw new Error(`cloud state HTTP ${res.status}`);
  const rows = (await res.json()) as CloudStateRow[];
  return rows[0] ?? null;
}

export interface IssuedCommand {
  command_id: string;
  status?: string;
  [k: string]: unknown;
}

/** Issue an operator command through the canonical native supervisor RPC. */
export async function cloudIssueCommand(opts: {
  clientId?: string;
  action: string;
  payload: Record<string, unknown>;
  ttlSeconds?: number;
  issuedBy?: string;
  idempotencyKey: string;
  platform?: string;
}): Promise<IssuedCommand> {
  const body = {
    p_client_id: opts.clientId ?? LIVE_BROWSER_CLIENT_ID,
    p_action: opts.action,
    p_payload: opts.payload,
    p_ttl_seconds: opts.ttlSeconds ?? 90,
    p_issued_by: opts.issuedBy ?? "MISSION_CONTROL_CONSOLE",
    p_idempotency_key: opts.idempotencyKey,
    ...(opts.platform ? { p_platform: opts.platform } : {}),
  };
  const res = await cloudFetch(`/${CLOUD_ISSUE_RPC}`, {
    method: "POST",
    headers: { ...headers(true), Prefer: "return=representation" },
    body: JSON.stringify(body),
  }, 12000);
  const text = await res.text();
  if (!res.ok) throw new Error(`issue ${opts.action} HTTP ${res.status}: ${text.slice(0, 240)}`);
  try {
    return JSON.parse(text) as IssuedCommand;
  } catch {
    throw new Error(`issue ${opts.action}: non-JSON RPC response: ${text.slice(0, 160)}`);
  }
}

export interface CommandReceipt {
  command_id: string;
  status: string;
  receipt: Record<string, unknown> | null;
  completed_at: string | null;
}

/** Read back a command row (status + receipt). */
export async function cloudCommandReceipt(commandId: string): Promise<CommandReceipt | null> {
  const res = await cloudFetch(
    `/${CLOUD_COMMAND_TABLE}?select=command_id,status,receipt,completed_at&command_id=eq.${encodeURIComponent(commandId)}&limit=1`,
    { method: "GET", headers: headers() },
  );
  if (!res.ok) throw new Error(`receipt HTTP ${res.status}`);
  const rows = (await res.json()) as { command_id: string; status: string; receipt: Record<string, unknown> | null; completed_at: string | null }[];
  const r = rows[0];
  return r ? { command_id: r.command_id, status: r.status, receipt: r.receipt, completed_at: r.completed_at } : null;
}

/** DevOS fleet execution plane (cloud) — the plane the live browser leases from. */
export const CLOUD_FLEET_WORKSPACE = "2de9f84b-7c0a-4091-911c-894ff1d6eaf4";

export interface CloudFleetSnapshot {
  schema?: string;
  workspace_id?: string;
  active_tasks?: Record<string, unknown>[];
  active_claims?: Record<string, unknown>[];
  recent_events?: Record<string, unknown>[];
  authority_effect?: boolean;
}

/**
 * Call a PostgREST RPC on the cloud database (service_role, server-side ONLY).
 * The live browser is cloud-first: its supervisor cycle leases DevOS tasks
 * from THIS database, not from the local Pigsty contour — any operator-side
 * enqueue that wants real fleet execution MUST land here.
 */
export async function cloudRpc<T = Record<string, unknown>>(
  name: string,
  body: Record<string, unknown>,
  timeoutMs = 10000,
): Promise<T> {
  const res = await cloudFetch(
    `/rpc/${encodeURIComponent(name)}`,
    { method: "POST", headers: headers(true), body: JSON.stringify(body) },
    timeoutMs,
  );
  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 200);
    try {
      const parsed = JSON.parse(text) as { message?: string; code?: string };
      detail = `${parsed.code ?? res.status}: ${parsed.message ?? detail}`;
    } catch { /* keep raw detail */ }
    throw new Error(`cloud rpc ${name} failed — ${detail}`);
  }
  return (text ? JSON.parse(text) : null) as T;
}

/** Cloud DevOS fleet snapshot (active tasks/claims + recent events). */
export async function cloudFleetSnapshot(
  workspace = CLOUD_FLEET_WORKSPACE,
): Promise<CloudFleetSnapshot> {
  return cloudRpc<CloudFleetSnapshot>("devos_fleet_snapshot_v1", { p_workspace: workspace });
}
