import { DurableObject, WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import type { AopLease, AopWake, Env, JsonObject, MessageBatch, ModelOutcome, WorkflowParams } from "./types";
import { completeRun, deferRun, leaseRun, rpc, supervisorReturnAuthority } from "./supabase";
import { executeRole, executorReady } from "./executor";
import { githubAuthMode, githubWriteConfigured } from "./github";
import { runMicrostepDuel } from "./duel_microstep";
import { verifyDbDuelWake } from "./duel_db_wake";

function json(value: unknown, status = 200): Response { return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8" } }); }
async function safeEqual(a: string, b: string): Promise<boolean> {
  const ea = new TextEncoder().encode(a), eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0; for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i]; return diff === 0;
}
async function requireBearer(request: Request, secret: string): Promise<void> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token || !(await safeEqual(token, secret))) throw new Error("unauthorized");
}
async function verifyGithub(request: Request, secret: string, body: ArrayBuffer): Promise<boolean> {
  const sig = request.headers.get("x-hub-signature-256") ?? "";
  if (!sig.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, body));
  const hex = [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
  return safeEqual(sig, `sha256=${hex}`);
}
async function verifyGithub(request: Request, secret: string, body: ArrayBuffer): Promise<boolean> {
  const sig = request.headers.get("x-hub-signature-256") ?? "";
  if (!sig.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, body));
  const hex = [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
  return safeEqual(sig, `sha256=${hex}`);
}
function supervisorStub(env: Env) {
  const id = env.AOP_SUPERVISOR.idFromName("compute-fabric-roadmap-v1");
  return env.AOP_SUPERVISOR.get(id);
}
function workflowInstanceId(wake: AopWake): string {
  return `duel-${wake.id}`.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 100);
}

export class ComputeFabricSupervisor extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS wake_ledger (wake_id TEXT PRIMARY KEY, reason TEXT NOT NULL, accepted_at INTEGER NOT NULL)`);
  }
  async wake(message: AopWake): Promise<{ accepted: boolean }> {
    const found = [...this.ctx.storage.sql.exec("SELECT wake_id FROM wake_ledger WHERE wake_id = ?", message.id)];
    if (found.length) return { accepted: false };
    this.ctx.storage.sql.exec("INSERT INTO wake_ledger(wake_id, reason, accepted_at) VALUES(?, ?, ?)", message.id, message.reason, Date.now());
    await this.env.AOP_RUN_WORKFLOW.create({ id: `aop-${message.id}`.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 100), params: { wake: message, workerId: `cf-workflow:${message.id}` } });
    return { accepted: true };
  }
}

export class AopRunWorkflow extends WorkflowEntrypoint<Env, WorkflowParams> {
  async run(event: WorkflowEvent<WorkflowParams>, step: WorkflowStep): Promise<unknown> {
    const { workerId, wake } = event.payload;
    if (wake.reason === "DUEL_RECONCILE" || wake.reason === "DUEL_START" || wake.reason === "DUEL_DB_INSERT") {
      const targetDuelId = typeof wake.payload?.duel_id === "string" ? String(wake.payload.duel_id) : undefined;
      return runMicrostepDuel(this.env, step, workerId, targetDuelId);
    }

    const leaseJson = await step.do("lease-aop-run", { retries: { limit: 5, delay: "5 seconds", backoff: "exponential" } }, async () => JSON.stringify(await leaseRun(this.env, workerId)));
    const lease = JSON.parse(leaseJson) as AopLease;
    if (!lease.leased) return { status: "IDLE" };

    const readiness = executorReady(this.env, lease);
    if (!readiness.ready) {
      const deferredJson = await step.do("defer-unavailable-executor", async () => JSON.stringify(await deferRun(this.env, lease, workerId, "EXECUTOR_AVAILABLE", { reason: readiness.reason ?? "UNKNOWN", role_key: lease.role_key ?? null })));
      return JSON.parse(deferredJson) as JsonObject;
    }

    const outcomeJson = await step.do("execute-role", { retries: { limit: 2, delay: "15 seconds", backoff: "exponential" }, timeout: "15 minutes" }, async () => JSON.stringify(await executeRole(this.env, lease, workerId)));
    const outcome = JSON.parse(outcomeJson) as ModelOutcome;

    if (lease.role_kind === "SUPERVISOR" && outcome.result_code === "RETURN") {
      const status = lease.roadmap_status as { milestones?: Array<{ milestone_key?: string; effective_status?: string }> } | undefined;
      const current = status?.milestones?.find((m) => m.milestone_key === lease.milestone_key)?.effective_status;
      if (current === "EVIDENCE_READY") {
        await step.do("apply-supervisor-return-authority", async () => JSON.stringify(await supervisorReturnAuthority(this.env, lease, workerId, outcome.output)));
      }
    }

    const completedJson = await step.do("complete-aop-run", { retries: { limit: 4, delay: "5 seconds", backoff: "exponential" } }, async () => JSON.stringify(await completeRun(this.env, lease, workerId, outcome.result_code, outcome.output, outcome.github_sha, outcome.wake_condition)));
    const completed = JSON.parse(completedJson) as JsonObject;
    await step.do("wake-next-run", async () => { await this.env.AOP_WAKE_QUEUE.send({ id: crypto.randomUUID(), reason: "RUN_COMPLETED", source: "workflow", payload: { run_id: lease.run_id ?? null, result_code: outcome.result_code } }); });
    return { status: "COMPLETED", run_id: lease.run_id, result_code: outcome.result_code, completed };
  }
}

async function enqueueWake(env: Env, reason: string, source: string, payload: JsonObject = {}): Promise<AopWake> {
  const message: AopWake = { id: crypto.randomUUID(), reason, source, payload }; await env.AOP_WAKE_QUEUE.send(message); return message;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.method === "GET" && url.pathname === "/health") {
        const [snapshot, duel] = await Promise.all([
          rpc<JsonObject>(env, "h205f22_aop1_snapshot_v1", {}),
          rpc<JsonObject>(env, "h205f22_duel_snapshot_v1", {}),
        ]);
        const cloudflareRail = Boolean(env.CF_ACCOUNT_ID && env.CF_AI_TOKEN);
        const vercelRail = Boolean(env.VERCEL_AI_GATEWAY_API_KEY);
        return json({
          status: "ok",
          invariant: "NO_MANUAL_HANDOFF_V1+MICROSTEP_LOCKSTEP_V2+DUAL_RAIL_RACE_V1+ONE_DURABLE_TICK_V3+TARGETED_LEASE_READ_V3",
          executor_configured: Boolean(env.CF_ACCOUNT_ID && env.CF_AI_TOKEN && env.AOP_MODEL),
          duel_executor_configured: cloudflareRail || vercelRail,
          duel_vercel_rail_configured: vercelRail,
          duel_protocol: "MICROSTEP_LOCKSTEP_V2",
          duel_transport: "DB_WEBHOOK+DIRECT_IDEMPOTENT_WORKFLOW+ATOMIC_DB_PAIR+DUAL_RAIL_RACE",
          duel_latency_policy: "FIRST_VALID_EXACT_MODEL_RESPONSE_WINS",
          duel_start_path: "DIRECT_WORKFLOW_CREATE_BATCH_NO_QUEUE_NO_DO",
          duel_hot_path_readback: "TARGETED_LEASE_READ_THEN_DB_SELECTED_PAIR_RECEIPT",
          duel_lease_policy: "TARGETED_WAKE_BOUND_LEASE_READ_V3",
          duel_tick_durability: "ONE_DURABLE_TICK_V3",
          duel_context_mode: "FULL_HASHED_HISTORY_COMPACT_PROJECTION",
          duel_reasoning_policy: "ADAPTIVE_LOW_MEDIUM_HIGH_V1",
          duel_lens_policy: "ROTATING_BUILD_BREAK_V1",
          duel_vercel_provider_sort: "ttft",
          duel_critical_shadow_ms: Number(env.DUEL_CRITICAL_SHADOW_MS || 0),
          duel_model_timeout_ms: Number(env.DUEL_MODEL_TIMEOUT_MS || 90000),
          duel_max_output_tokens: Number(env.DUEL_MAX_OUTPUT_TOKENS || 1200),
          duel_rails: { vercel_ai_gateway: vercelRail, cloudflare_ai: cloudflareRail },
          duel_models: { gpt: "openai/gpt-5.6-sol", glm: { vercel: "zai/glm-5.2", cloudflare: "@cf/zai-org/glm-5.2" } },
          github_configured: githubWriteConfigured(env),
          github_auth_mode: githubAuthMode(env),
          supervisor_capability_configured: Boolean(env.AOP_SUPERVISOR_TOKEN),
          snapshot,
          duel,
        });
      }
      if (request.method === "GET" && url.pathname === "/duel") {
        return json(await rpc<JsonObject>(env, "h205f22_duel_snapshot_v1", {}));
      }
      if (request.method === "POST" && url.pathname === "/duel/db-wake") {
        const wake = await verifyDbDuelWake(request, env.AOP_WAKE_SECRET);
        const created = await env.AOP_RUN_WORKFLOW.createBatch([{ id: workflowInstanceId(wake), params: { wake, workerId: `cf-workflow:${wake.id}` } }]);
        return json({ accepted: created.length > 0, duplicate: created.length === 0, wake_id: wake.id, reason: wake.reason, transport: "DIRECT_IDEMPOTENT_WORKFLOW" }, 202);
      }
      if (request.method === "POST" && url.pathname === "/wake") {
        await requireBearer(request, env.AOP_WAKE_SECRET);
        const input = (await request.json()) as Partial<AopWake>;
        const wake = await enqueueWake(env, input.reason ?? "EXTERNAL_WAKE", input.source ?? "http", input.payload ?? {});
        return json({ accepted: true, wake }, 202);
      }
      if (request.method === "POST" && url.pathname === "/signal") {
        await requireBearer(request, env.AOP_WAKE_SECRET);
        const input = (await request.json()) as { condition?: string; payload?: JsonObject };
        if (!input.condition) return json({ error: "condition_required" }, 400);
        const signal = await rpc<JsonObject>(env, "h205f22_aop1_signal_v1", { p_condition: input.condition, p_payload: input.payload ?? {} });
        const wake = await enqueueWake(env, "CONDITION_SIGNAL", "http", { condition: input.condition });
        return json({ signal, wake }, 202);
      }
      if (request.method === "POST" && url.pathname === "/github/webhook") {
        if (!env.GITHUB_WEBHOOK_SECRET) return json({ error: "github_webhook_not_configured" }, 503);
        const body = await request.arrayBuffer();
        if (!(await verifyGithub(request, env.GITHUB_WEBHOOK_SECRET, body))) return json({ error: "invalid_signature" }, 401);
        const event = request.headers.get("x-github-event") ?? "unknown";
        const delivery = request.headers.get("x-github-delivery") ?? crypto.randomUUID();
        const payload = JSON.parse(new TextDecoder().decode(body)) as JsonObject;
        await env.AOP_WAKE_QUEUE.send({ id: `github:${delivery}`, reason: `GITHUB_${event.toUpperCase()}`, source: "github", payload: { action: payload.action ?? null } });
        return json({ accepted: true }, 202);
      }
      return json({ error: "not_found" }, 404);
    } catch (error) {
      if (String(error).includes("unauthorized") || String(error).includes("duel_db_wake_signature")) return json({ error: "unauthorized" }, 401);
      return json({ error: "internal_error", detail: String(error).slice(0, 1000) }, 500);
    }
  },
  async queue(batch: MessageBatch<AopWake>, env: Env): Promise<void> {
    const stub = supervisorStub(env);
    for (const message of batch.messages) { try { await stub.wake(message.body); message.ack(); } catch { message.retry({ delaySeconds: 15 }); } }
  },
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    // Recovery-only. Normal duel start is DB webhook -> direct idempotent Workflow binding.
    await Promise.all([
      enqueueWake(env, "PERIODIC_RECONCILE", "cron"),
      enqueueWake(env, "DUEL_RECONCILE", "cron-recovery"),
    ]);
  },
};
