// Read-only Supabase control-plane client (service role key stays server-side,
// NEVER exposed to the browser). Curated snapshot fields only.
import { readFileSync, existsSync } from "node:fs";
import { OpError } from "./errors";
import { appendEvent } from "./eventlog";
import { MIRROR_ANCHOR } from "./eventlog";
import { VERSION } from "./version";

const ENV_FILE = "/home/z/.a2/supabase-cloud.env";

function loadCreds(): { url: string; key: string } {
  if (!existsSync(ENV_FILE)) {
    throw new OpError("controlplane_secrets_missing", `${ENV_FILE} not found`, 503);
  }
  const txt = readFileSync(ENV_FILE, "utf8");
  const url = /^SUPABASE_URL=(.+)$/m.exec(txt)?.[1]?.trim();
  const key = /^SUPABASE_SERVICE_ROLE_KEY=(.+)$/m.exec(txt)?.[1]?.trim();
  if (!url || !key) throw new OpError("controlplane_secrets_invalid", "SUPABASE_URL/SERVICE_ROLE_KEY missing", 503);
  return { url, key };
}

async function supa(path: string, init?: RequestInit): Promise<unknown> {
  const { url, key } = loadCreds();
  const res = await fetch(`${url}${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init?.headers as Record<string, string> | undefined),
    },
    signal: AbortSignal.timeout(12_000),
  });
  const body = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const code = (body as { code?: string } | null)?.code ?? `http_${res.status}`;
    throw new OpError(`controlplane_${code}`, JSON.stringify(body).slice(0, 300), 502);
  }
  return body;
}

export interface SupervisorSnapshot {
  ok: true;
  fetched_at: string;
  client_id: string;
  last_seen_at: string;
  heartbeat_age_s: number;
  extension_version: string;
  operator_runtime: string;
  supervisor_mode: string;
  operator_mode: string;
  armed: boolean;
  compute_state: string;
  sentinel: { lifecycle: string; worker_health: string; worker_heartbeat_age_ms: number };
  dev_plane: { state: string; ref: string; head: string };
  keepalive: {
    state: string;
    cycle_seq: number;
    last_completed_cycle_at: string | null;
    stale_completed_s: number | null;
    rollover_reason: string | null;
    ambiguous_history_count: number;
    queued_wake_count: number;
    updated_at: string;
  };
  cognitive: {
    state: string;
    stream_id: string | null;
    sent_events: number;
    acknowledged_through_sequence: number;
    resync_count: number;
    last_success_at: string | null;
  };
  p0_flags: string[];
}

type Any = Record<string, any>;

function pick(o: Any, path: string): Any | null {
  let cur: any = o;
  for (const k of path.split(".")) {
    if (cur == null || typeof cur !== "object") return null;
    cur = cur[k];
  }
  return cur ?? null;
}

let cache: { at: number; data: unknown } | null = null;
const CACHE_TTL_MS = 10_000;

export async function supervisorSnapshot(fresh = false): Promise<SupervisorSnapshot> {
  if (!fresh && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.data as SupervisorSnapshot;
  }
  const rows = (await supa(
    "/rest/v1/compute_fabric_a2_browser_supervisor_state_h205f22?select=client_id,last_seen_at,extension_version,operator_runtime,supervisor_mode,operator_mode,armed,state&order=last_seen_at.desc&limit=1"
  )) as Any[];
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new OpError("controlplane_no_rows", "supervisor state table empty", 404);
  }
  const r = rows[0];
  const st = (r.state ?? {}) as Any;
  const now = Date.now();
  const age = (iso: string | null | undefined): number | null =>
    iso ? Math.round((now - Date.parse(iso)) / 1000) : null;
  const keepalive = pick(st, "supervisor_lifecycle.keepalive") ?? {};
  const lastCompleted = keepalive.last_completed_cycle_at ?? null;
  const stale = age(lastCompleted);
  const p0: string[] = [];
  if (keepalive.state && keepalive.state !== "ACTIVE") p0.push(`SUPERVISOR_KEEPALIVE_${keepalive.state}`);
  if (stale != null && stale > 3600) p0.push("SUPERVISOR_CYCLE_STALE_GT_1H");
  const cognitive = pick(st, "control_latency.cognitive_delta_transport") ?? {};
  if (cognitive.state && cognitive.state !== "CONVERGED") p0.push(`COGNITIVE_${cognitive.state}`);
  const devPlane = pick(st, "development_plane") ?? {};
  const repoModel = pick(st, "development_plane.devos_repo_read_model") ?? {};
  const sentinel = pick(st, "host_resilience.sentinel") ?? {};
  const snap: SupervisorSnapshot = {
    ok: true,
    fetched_at: new Date().toISOString(),
    client_id: r.client_id,
    last_seen_at: r.last_seen_at,
    heartbeat_age_s: age(r.last_seen_at) ?? -1,
    extension_version: r.extension_version,
    operator_runtime: r.operator_runtime,
    supervisor_mode: r.supervisor_mode,
    operator_mode: r.operator_mode,
    armed: !!r.armed,
    compute_state: pick(st, "compute.state") ?? "UNKNOWN",
    sentinel: {
      lifecycle: sentinel.lifecycle ?? "UNKNOWN",
      worker_health: sentinel.worker_health ?? "UNKNOWN",
      worker_heartbeat_age_ms: sentinel.worker_heartbeat_age_ms ?? -1,
    },
    dev_plane: {
      state: devPlane.state ?? "UNKNOWN",
      ref: repoModel.ref ?? "UNKNOWN",
      head: repoModel.head ?? "UNKNOWN",
    },
    keepalive: {
      state: keepalive.state ?? "UNKNOWN",
      cycle_seq: keepalive.cycle_seq ?? -1,
      last_completed_cycle_at: lastCompleted,
      stale_completed_s: stale,
      rollover_reason: keepalive.rollover_reason ?? null,
      ambiguous_history_count: keepalive.ambiguous_history_count ?? -1,
      queued_wake_count: keepalive.queued_wake_count ?? -1,
      updated_at: keepalive.updated_at ?? "UNKNOWN",
    },
    cognitive: {
      state: cognitive.state ?? "UNKNOWN",
      stream_id: cognitive.stream_id ?? null,
      sent_events: cognitive.sent_events ?? -1,
      acknowledged_through_sequence: cognitive.acknowledged_through_sequence ?? -1,
      resync_count: cognitive.resync_count ?? -1,
      last_success_at: cognitive.last_success_at ?? null,
    },
    p0_flags: p0,
  };
  cache = { at: Date.now(), data: snap };
  return snap;
}

export async function mirrorTail(): Promise<{ events: Any[] }> {
  const rows = (await supa(
    "/rest/v1/me2_event_mirror_h205f22?select=seq,ts,type,actor,subject,prev_hash,hash,daemon_version&order=seq.desc&limit=5"
  )) as Any[];
  return { events: rows ?? [] };
}

export async function runtimeCapabilities(): Promise<Any> {
  return (await supa("/rest/v1/rpc/devos_runtime_capabilities_v1", { method: "POST", body: "{}" })) as Any;
}

// Explicit, operator-triggered single anchor write into the evidence mirror.
// Continues the old seq space (anchor.seq + 1) and chains from anchor.hash.
// PGRST205-style errors are reported, never retried in a loop (protocol lesson).
export async function writeMirrorAnchor(): Promise<Any> {
  const ev = appendEvent(
    "MIRROR_ANCHOR_WRITE",
    "daemon",
    `mirror_seq_${MIRROR_ANCHOR.seq + 1}`,
    {
      note: "R81-PHASE0 recovery anchor: new daemon chain (local) registered against Supabase mirror tail",
      anchored_to: { seq: MIRROR_ANCHOR.seq, hash: MIRROR_ANCHOR.hash },
      daemon_version: VERSION,
    }
  );
  const row = {
    seq: MIRROR_ANCHOR.seq + 1,
    ts: ev.ts,
    type: ev.type,
    actor: ev.actor,
    subject: ev.subject,
    payload: JSON.stringify(ev.payload),
    prev_hash: MIRROR_ANCHOR.hash,
    hash: ev.hash,
    daemon_version: VERSION,
    mirrored_at: new Date().toISOString(),
  };
  const res = (await supa("/rest/v1/me2_event_mirror_h205f22", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(row),
  })) as Any;
  return { written: Array.isArray(res) ? res.length > 0 : !!res, row };
}
