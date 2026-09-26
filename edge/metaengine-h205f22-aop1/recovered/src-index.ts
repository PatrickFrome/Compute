function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}
__name(json, "json");
async function safeEqual2(a, b) {
  const ea = new TextEncoder().encode(a), eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}
__name(safeEqual2, "safeEqual");
async function requireBearer(request, secret) {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token || !await safeEqual2(token, secret)) throw new Error("unauthorized");
}
__name(requireBearer, "requireBearer");
async function verifyGithub(request, secret, body) {
  const sig = request.headers.get("x-hub-signature-256") ?? "";
  if (!sig.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, body));
  const hex = [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
  return safeEqual2(sig, `sha256=${hex}`);
}
__name(verifyGithub, "verifyGithub");
function supervisorStub(env) {
  const id = env.AOP_SUPERVISOR.idFromName("compute-fabric-roadmap-v1");
  return env.AOP_SUPERVISOR.get(id);
}
__name(supervisorStub, "supervisorStub");
function workflowInstanceId(wake) {
  return `duel-${wake.id}`.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 100);
}
__name(workflowInstanceId, "workflowInstanceId");
function v4Path(pathname) {
  const match = pathname.match(/^\/v4\/duels\/([0-9a-f-]{36})(?:\/(decision))?$/i);
  return match ? { duelId: match[1], tail: match[2] } : null;
}
__name(v4Path, "v4Path");
var ComputeFabricSupervisor = class extends DurableObject {
  static {
    __name(this, "ComputeFabricSupervisor");
  }
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS wake_ledger (wake_id TEXT PRIMARY KEY, reason TEXT NOT NULL, accepted_at INTEGER NOT NULL)`);
  }
  async wake(message) {
    const found = [...this.ctx.storage.sql.exec("SELECT wake_id FROM wake_ledger WHERE wake_id = ?", message.id)];
    if (found.length) return { accepted: false };
    this.ctx.storage.sql.exec("INSERT INTO wake_ledger(wake_id, reason, accepted_at) VALUES(?, ?, ?)", message.id, message.reason, Date.now());
    await this.env.AOP_RUN_WORKFLOW.create({ id: `aop-${message.id}`.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 100), params: { wake: message, workerId: `cf-workflow:${message.id}` } });
    return { accepted: true };
  }
};
var AopRunWorkflow = class extends WorkflowEntrypoint {
  static {
    __name(this, "AopRunWorkflow");
  }
  async run(event, step) {
    const { workerId, wake } = event.payload;
    if (wake.reason === "DUEL_RECONCILE" || wake.reason === "DUEL_START" || wake.reason === "DUEL_DB_INSERT") {
      const targetDuelId = typeof wake.payload?.duel_id === "string" ? String(wake.payload.duel_id) : void 0;
      if (wake.reason === "DUEL_RECONCILE" && !targetDuelId) {
        const peerJson = await step.do("autonomous-peer-relay-v4", { retries: { limit: 1, delay: "15 seconds", backoff: "exponential" }, timeout: "10 minutes" }, async () => JSON.stringify(await completeAutonomousPeerRelaysV4(this.env, workerId)));
        const legacy = await runMicrostepDuel(this.env, step, workerId, targetDuelId);
        return { status: "DUEL_RECONCILE_COMPLETE", peer_relay_v4: JSON.parse(peerJson), legacy };
      }
      return runMicrostepDuel(this.env, step, workerId, targetDuelId);
    }
    const leaseJson = await step.do("lease-aop-run", { retries: { limit: 5, delay: "5 seconds", backoff: "exponential" } }, async () => JSON.stringify(await leaseRun(this.env, workerId)));
    const lease = JSON.parse(leaseJson);
    if (!lease.leased) return { status: "IDLE" };
    const readiness = executorReady(this.env, lease);
    if (!readiness.ready) {
      const deferredJson = await step.do("defer-unavailable-executor", async () => JSON.stringify(await deferRun(this.env, lease, workerId, "EXECUTOR_AVAILABLE", { reason: readiness.reason ?? "UNKNOWN", role_key: lease.role_key ?? null })));
      return JSON.parse(deferredJson);
    }
    const outcomeJson = await step.do("execute-role", { retries: { limit: 2, delay: "15 seconds", backoff: "exponential" }, timeout: "15 minutes" }, async () => JSON.stringify(await executeRole(this.env, lease, workerId)));
    const outcome = JSON.parse(outcomeJson);
    if (lease.role_kind === "SUPERVISOR" && outcome.result_code === "RETURN") {
      const status = lease.roadmap_status;
      const current = status?.milestones?.find((m) => m.milestone_key === lease.milestone_key)?.effective_status;
      if (current === "EVIDENCE_READY") {
        await step.do("apply-supervisor-return-authority", async () => JSON.stringify(await supervisorReturnAuthority(this.env, lease, workerId, outcome.output)));
      }
    }
    const completedJson = await step.do("complete-aop-run", { retries: { limit: 4, delay: "5 seconds", backoff: "exponential" } }, async () => JSON.stringify(await completeRun(this.env, lease, workerId, outcome.result_code, outcome.output, outcome.github_sha, outcome.wake_condition)));
    const completed = JSON.parse(completedJson);
    await step.do("wake-next-run", async () => {
      await this.env.AOP_WAKE_QUEUE.send({ id: crypto.randomUUID(), reason: "RUN_COMPLETED", source: "workflow", payload: { run_id: lease.run_id ?? null, result_code: outcome.result_code } });
    });
    return { status: "COMPLETED", run_id: lease.run_id, result_code: outcome.result_code, completed };
  }
};
async function enqueueWake(env, reason, source, payload = {}) {
  const message = { id: crypto.randomUUID(), reason, source, payload };
  await env.AOP_WAKE_QUEUE.send(message);
  return message;
}
__name(enqueueWake, "enqueueWake");
var index_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (request.method === "GET" && url.pathname === "/v4/health") {
        return json({
          status: "ok",
          protocol: "SAME_POINT_DUEL_V4",
          mode: "CONTROL_ONLY",
          executor: "FENCED",
          peer_completion: env.VERCEL_AI_GATEWAY_API_KEY ? "REGISTERED_RELAY_AUTONOMOUS" : "UNAVAILABLE",
          peer_models: { GPT: "openai/gpt-5.6-sol", GLM: "zai/glm-5.3" },
          critical_path: false
        });
      }
      if (request.method === "POST" && url.pathname === "/v4/duels") {
        await requireBearer(request, env.AOP_WAKE_SECRET);
        const input = await request.json();
        const duelKey = typeof input.duel_key === "string" ? input.duel_key : "";
        const milestone = typeof input.milestone_key === "string" ? input.milestone_key : "";
        const baseSha = typeof input.base_github_sha === "string" ? input.base_github_sha : "";
        const subject = input.subject && typeof input.subject === "object" && !Array.isArray(input.subject) ? input.subject : {};
        const policy = typeof input.execution_policy === "string" ? input.execution_policy : "SOVEREIGN_ONLY";
        const gptModel = typeof input.gpt_model === "string" ? input.gpt_model : "openai/gpt-oss-20b";
        const glmModel = typeof input.glm_model === "string" ? input.glm_model : "zai-org/GLM-4.7-Flash";
        if (policy === "HOSTED_ONLY") return json({ error: "hosted_v4_executor_not_implemented" }, 409);
        if (!duelKey || !milestone || !/^[0-9a-f]{40}$/i.test(baseSha)) return json({ error: "invalid_v4_duel_request" }, 400);
        const created = await rpc(env, "h205f22_duel_create_same_point_v4", {
          p_duel_key: duelKey,
          p_milestone_key: milestone,
          p_base_github_sha: baseSha,
          p_subject: subject,
          p_execution_policy: policy,
          p_gpt_model: gptModel,
          p_glm_model: glmModel
        });
        return json({ control_plane: "CLOUDFLARE_OPTIONAL", critical_path: false, duel: created }, 201);
      }
      const v4 = v4Path(url.pathname);
      if (request.method === "GET" && v4?.duelId) {
        await requireBearer(request, env.AOP_WAKE_SECRET);
        const full = await rpc(env, "h205f22_duel_read_same_point_v4", { p_duel_id: v4.duelId });
        if (v4.tail === "decision") return json({ duel_id: v4.duelId, decision: full.decision ?? null, status: full.status ?? null });
        return json(full);
      }
      if (request.method === "GET" && url.pathname === "/health") {
        const [snapshot, duel] = await Promise.all([
          rpc(env, "h205f22_aop1_snapshot_v1", {}),
          rpc(env, "h205f22_duel_snapshot_v1", {})
        ]);
        const cloudflareRail = Boolean(env.CF_ACCOUNT_ID && env.CF_AI_TOKEN);
        const vercelRail = Boolean(env.VERCEL_AI_GATEWAY_API_KEY);
        return json({
          status: "ok",
          invariant: "NO_MANUAL_HANDOFF_V1+MICROSTEP_LOCKSTEP_V2+DUAL_RAIL_RACE_V1+ONE_DURABLE_TICK_V3+TARGETED_LEASE_READ_V3+SAME_POINT_DUEL_V4_CONTROL+AUTONOMOUS_PEER_RELAY_V4",
          executor_configured: Boolean(env.CF_ACCOUNT_ID && env.CF_AI_TOKEN && env.AOP_MODEL),
          duel_executor_configured: cloudflareRail || vercelRail,
          duel_vercel_rail_configured: vercelRail,
          duel_protocol: "MICROSTEP_LOCKSTEP_V2",
          same_point_v4_control_api: true,
          same_point_v4_executor: false,
          same_point_v4_executor_policy: "FENCED_CONTROL_ONLY",
          same_point_v4_peer_completion: vercelRail,
          same_point_v4_peer_completion_policy: "REGISTERED_RELAY_ONLY+CURRENT_SEMANTIC_HEAD+GITHUB_BASE_SHA_MATCH+DB_LEASE_GENERATION",
          same_point_v4_peer_models: { GPT: "openai/gpt-5.6-sol", GLM: "zai/glm-5.3" },
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
          duel_model_timeout_ms: Number(env.DUEL_MODEL_TIMEOUT_MS || 9e4),
          duel_max_output_tokens: Number(env.DUEL_MAX_OUTPUT_TOKENS || 1200),
          duel_rails: { vercel_ai_gateway: vercelRail, cloudflare_ai: cloudflareRail },
          duel_models: { gpt: "openai/gpt-5.6-sol", glm: { vercel: "zai/glm-5.2", cloudflare: "@cf/zai-org/glm-5.2" } },
          github_configured: githubWriteConfigured(env),
          github_auth_mode: githubAuthMode(env),
          supervisor_capability_configured: Boolean(env.AOP_SUPERVISOR_TOKEN),
          snapshot,
          duel
        });
      }
      if (request.method === "GET" && url.pathname === "/duel") {
        return json(await rpc(env, "h205f22_duel_snapshot_v1", {}));
      }
      if (request.method === "POST" && url.pathname === "/duel/db-wake") {
        const wake = await verifyDbDuelWake(request, env.AOP_WAKE_SECRET);
        const created = await env.AOP_RUN_WORKFLOW.createBatch([{ id: workflowInstanceId(wake), params: { wake, workerId: `cf-workflow:${wake.id}` } }]);
        return json({ accepted: created.length > 0, duplicate: created.length === 0, wake_id: wake.id, reason: wake.reason, transport: "DIRECT_IDEMPOTENT_WORKFLOW" }, 202);
      }
      if (request.method === "POST" && url.pathname === "/wake") {
        await requireBearer(request, env.AOP_WAKE_SECRET);
        const input = await request.json();
        const wake = await enqueueWake(env, input.reason ?? "EXTERNAL_WAKE", input.source ?? "http", input.payload ?? {});
        return json({ accepted: true, wake }, 202);
      }
      if (request.method === "POST" && url.pathname === "/signal") {
        await requireBearer(request, env.AOP_WAKE_SECRET);
        const input = await request.json();
        if (!input.condition) return json({ error: "condition_required" }, 400);
        const signal = await rpc(env, "h205f22_aop1_signal_v1", { p_condition: input.condition, p_payload: input.payload ?? {} });
        const wake = await enqueueWake(env, "CONDITION_SIGNAL", "http", { condition: input.condition });
        return json({ signal, wake }, 202);
      }
      if (request.method === "POST" && url.pathname === "/github/webhook") {
        if (!env.GITHUB_WEBHOOK_SECRET) return json({ error: "github_webhook_not_configured" }, 503);
        const body = await request.arrayBuffer();
        if (!await verifyGithub(request, env.GITHUB_WEBHOOK_SECRET, body)) return json({ error: "invalid_signature" }, 401);
        const event = request.headers.get("x-github-event") ?? "unknown";
        const delivery = request.headers.get("x-github-delivery") ?? crypto.randomUUID();
        const payload = JSON.parse(new TextDecoder().decode(body));
        await env.AOP_WAKE_QUEUE.send({ id: `github:${delivery}`, reason: `GITHUB_${event.toUpperCase()}`, source: "github", payload: { action: payload.action ?? null } });
        return json({ accepted: true }, 202);
      }
      return json({ error: "not_found" }, 404);
    } catch (error) {
      if (String(error).includes("unauthorized") || String(error).includes("duel_db_wake_signature")) return json({ error: "unauthorized" }, 401);
      return json({ error: "internal_error", detail: String(error).slice(0, 1e3) }, 500);
    }
  },
  async queue(batch, env) {
    const stub = supervisorStub(env);
    for (const message of batch.messages) {
      try {
        await stub.wake(message.body);
        message.ack();
      } catch {
        message.retry({ delaySeconds: 15 });
      }
    }
  },
  async scheduled(_controller, env) {
    await Promise.all([
      enqueueWake(env, "PERIODIC_RECONCILE", "cron"),
      enqueueWake(env, "DUEL_RECONCILE", "cron-recovery")
    ]);
  }
};
export {
  AopRunWorkflow,
  ComputeFabricSupervisor,
  index_default as default
};
//# sourceMappingURL=index.js.map

