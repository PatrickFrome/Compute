import type { AopLease, Env, JsonObject } from "./types";

const ALLOWED_RPC = new Set([
  "h205f22_aop1_lease_run_v1",
  "h205f22_aop1_complete_run_v1",
  "h205f22_aop1_defer_run_v1",
  "h205f22_aop1_signal_v1",
  "h205f22_aop1_snapshot_v1",
  "h205f22_aop1_supervisor_adopt_active_claim_v1",
  "h205f22_aop1_supervisor_return_authority_v1",
  "h205f22_duel_lease_v1",
  "h205f22_duel_record_event_v1",
  "h205f22_duel_complete_v1",
  "h205f22_duel_snapshot_v1",
  "h205f22_duel_lease_lockstep_v2",
  "h205f22_duel_submit_pair_v2",
  "h205f22_duel_submit_pair_v3",
  "h205f22_duel_read_lockstep_v2",
  "h205f22_duel_complete_lockstep_v2",
]);

export async function rpc<T>(env: Env, fn: string, args: JsonObject = {}): Promise<T> {
  if (!ALLOWED_RPC.has(fn)) throw new Error(`rpc_not_allowed:${fn}`);
  const url = new URL(`/rest/v1/rpc/${fn}`, env.SUPABASE_URL);
  const res = await fetch(url, {
    method: "POST",
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`supabase_rpc_failed:${fn}:${res.status}:${text.slice(0, 1200)}`);
  return (text ? JSON.parse(text) : null) as T;
}

export async function leaseRun(env: Env, workerId: string): Promise<AopLease> {
  return rpc<AopLease>(env, "h205f22_aop1_lease_run_v1", { p_worker: workerId, p_role_key: null, p_lease_seconds: 300 });
}

export async function completeRun(env: Env, lease: AopLease, workerId: string, resultCode: string, output: JsonObject, githubSha?: string | null, wakeCondition?: string | null): Promise<JsonObject> {
  if (!lease.run_id || lease.lease_generation == null) throw new Error("invalid_lease");
  return rpc<JsonObject>(env, "h205f22_aop1_complete_run_v1", {
    p_run_id: lease.run_id, p_worker: workerId, p_lease_generation: lease.lease_generation,
    p_result_code: resultCode, p_output: output, p_github_sha: githubSha ?? null, p_wake_condition: wakeCondition ?? null,
  });
}

export async function deferRun(env: Env, lease: AopLease, workerId: string, condition: string, reason: JsonObject): Promise<JsonObject> {
  if (!lease.run_id || lease.lease_generation == null) throw new Error("invalid_lease");
  return rpc<JsonObject>(env, "h205f22_aop1_defer_run_v1", {
    p_run_id: lease.run_id, p_worker: workerId, p_lease_generation: lease.lease_generation, p_condition: condition, p_reason: reason,
  });
}

export async function supervisorAdoptClaim(env: Env, lease: AopLease, workerId: string): Promise<JsonObject> {
  if (!env.AOP_SUPERVISOR_TOKEN) throw new Error("supervisor_token_unavailable");
  if (!lease.run_id || lease.lease_generation == null) throw new Error("invalid_lease");
  return rpc<JsonObject>(env, "h205f22_aop1_supervisor_adopt_active_claim_v1", {
    p_run_id: lease.run_id, p_worker: workerId, p_lease_generation: lease.lease_generation, p_supervisor_token: env.AOP_SUPERVISOR_TOKEN,
    p_instructions: { automation_invariant: "NO_MANUAL_HANDOFF_V1", reason: "AUTHORITY_REBIND_REQUIRED", source: "cloudflare-aop1" }, p_ttl_minutes: 180,
  });
}

export async function supervisorReturnAuthority(env: Env, lease: AopLease, workerId: string, instructions: JsonObject): Promise<JsonObject> {
  if (!env.AOP_SUPERVISOR_TOKEN) throw new Error("supervisor_token_unavailable");
  if (!lease.run_id || lease.lease_generation == null) throw new Error("invalid_lease");
  return rpc<JsonObject>(env, "h205f22_aop1_supervisor_return_authority_v1", {
    p_run_id: lease.run_id, p_worker: workerId, p_lease_generation: lease.lease_generation, p_supervisor_token: env.AOP_SUPERVISOR_TOKEN,
    p_instructions: instructions, p_ttl_minutes: 180,
  });
}
