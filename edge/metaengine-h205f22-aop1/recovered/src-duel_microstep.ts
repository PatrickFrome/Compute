var GPT = "openai/gpt-5.6-sol";
var GLM_CF = "@cf/zai-org/glm-5.2";
var GLM_VERCEL = "zai/glm-5.2";
var VOTES = /* @__PURE__ */ new Set(["WIN_GPT", "WIN_GLM", "SYNTHESIS", "NO_ACTION"]);
var CRITICAL_STEP_TYPES = /* @__PURE__ */ new Set(["SECURITY_VETO", "ARBITRATION", "STOP"]);
function asObj(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("duel_object_required");
  return v;
}
__name(asObj, "asObj");
function parseJson(text) {
  const s = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    return asObj(JSON.parse(s));
  } catch {
  }
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error(`duel_json_missing:${s.slice(0, 300)}`);
  return asObj(JSON.parse(s.slice(a, b + 1)));
}
__name(parseJson, "parseJson");
function responseText(body) {
  if (typeof body.output_text === "string") return body.output_text;
  const parts = [];
  for (const x of Array.isArray(body.output) ? body.output : []) {
    if (!x || typeof x !== "object" || Array.isArray(x)) continue;
    const c = x.content;
    if (!Array.isArray(c)) continue;
    for (const y of c) {
      if (y && typeof y === "object" && !Array.isArray(y) && typeof y.text === "string") {
        parts.push(String(y.text));
      }
    }
  }
  return parts.join("\n");
}
__name(responseText, "responseText");
var SYSTEM = `You are one of two equal adversarial engineering contenders in METAENGINE H205F22 MICROSTEP_LOCKSTEP_V2.
This is active co-development, not chat. Produce exactly ONE observable engineering step per invocation.
Private chain-of-thought is never shared; put all peer-relevant engineering rationale into the structured observable step.
Both actors start each tick from the exact same persisted checkpoint and causal history projection. You must explicitly address the peer's immediately previous event hash when one exists.
Do not optimize for agreement. Prefer falsifiable claims, executable patches/tests, concrete counterexamples, or security vetoes.
The assigned BUILD/BREAK lens rotates every tick to prevent permanent implementer/reviewer roles and premature argument collapse.
Never claim canonical authority, merge authority, VERIFIED, or live evidence absent from the ledger.
Return exactly one JSON object and no markdown.`;
function timeoutMs(env) {
  const n = Number(env.DUEL_MODEL_TIMEOUT_MS || 9e4);
  return Number.isFinite(n) ? Math.max(5e3, Math.min(n, 3e5)) : 9e4;
}
__name(timeoutMs, "timeoutMs");
function maxOutputTokens(env) {
  const n = Number(env.DUEL_MAX_OUTPUT_TOKENS || 1200);
  return Number.isFinite(n) ? Math.max(512, Math.min(n, 2400)) : 1200;
}
__name(maxOutputTokens, "maxOutputTokens");
function criticalShadowMs(env) {
  const n = Number(env.DUEL_CRITICAL_SHADOW_MS || 0);
  return Number.isFinite(n) ? Math.max(0, Math.min(n, 15e3)) : 0;
}
__name(criticalShadowMs, "criticalShadowMs");
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
__name(sleep, "sleep");
function classifyError(error) {
  const s = String(error);
  return s.includes("AbortError") || s.includes("duel_model_timeout") || s.includes("rail_loser") ? "TIMEOUT_OR_ABORT" : "PROVIDER_ERROR";
}
__name(classifyError, "classifyError");
function modelForRail(actor, lease, rail) {
  if (actor === "GPT") return lease.gpt_model || GPT;
  const configured = lease.glm_model || "";
  if (rail === "VERCEL_AI_GATEWAY") {
    if (configured.startsWith("@cf/zai-org/")) return `zai/${configured.slice("@cf/zai-org/".length)}`;
    if (configured.startsWith("zai/")) return configured;
    return GLM_VERCEL;
  }
  if (configured.startsWith("@cf/")) return configured;
  if (configured.startsWith("zai/")) return `@cf/zai-org/${configured.slice("zai/".length)}`;
  return GLM_CF;
}
__name(modelForRail, "modelForRail");
function availableRails(env) {
  const rails = [];
  if (env.VERCEL_AI_GATEWAY_API_KEY) rails.push("VERCEL_AI_GATEWAY");
  if (env.CF_ACCOUNT_ID && env.CF_AI_TOKEN) rails.push("CLOUDFLARE_AI");
  return rails;
}
__name(availableRails, "availableRails");
function recentPayloads(read, limit = 4) {
  const events = Array.isArray(read.events) ? read.events : [];
  const out = [];
  for (let i = events.length - 1; i >= 0 && out.length < limit; i--) {
    const e = events[i];
    if (!e || typeof e !== "object" || Array.isArray(e)) continue;
    const p = e.payload;
    if (p && typeof p === "object" && !Array.isArray(p)) out.push(p);
  }
  return out;
}
__name(recentPayloads, "recentPayloads");
function reasoningEffort(read) {
  if (Number(read.current_tick || 0) === 0) return "medium";
  for (const p of recentPayloads(read, 4)) {
    const stepType = typeof p.step_type === "string" ? p.step_type.toUpperCase() : "";
    if (CRITICAL_STEP_TYPES.has(stepType) || p.need_canary === true || p.ready_to_resolve === true || typeof p.terminal_vote === "string") {
      return "high";
    }
  }
  return "low";
}
__name(reasoningEffort, "reasoningEffort");
function assignedLens(actor, nextTick) {
  const parity = nextTick + (actor === "GPT" ? 0 : 1);
  return parity % 2 === 0 ? "BUILD" : "BREAK";
}
__name(assignedLens, "assignedLens");
async function vercel(env, model2, promptText, signal, effort) {
  if (!env.VERCEL_AI_GATEWAY_API_KEY) throw new Error("vercel_gateway_key_missing");
  const normalized = model2.startsWith("@cf/zai-org/") ? `zai/${model2.slice("@cf/zai-org/".length)}` : model2;
  const r = await fetch("https://ai-gateway.vercel.sh/v1/responses", {
    method: "POST",
    signal,
    headers: { authorization: `Bearer ${env.VERCEL_AI_GATEWAY_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: normalized,
      instructions: SYSTEM,
      input: promptText,
      reasoning: { effort },
      max_output_tokens: maxOutputTokens(env),
      providerOptions: { gateway: { sort: "ttft" } },
      store: false
    })
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`vercel_${normalized}:${r.status}:${t.slice(0, 800)}`);
  const out = responseText(asObj(JSON.parse(t)));
  if (!out) throw new Error(`vercel_${normalized}_empty`);
  return parseJson(out);
}
__name(vercel, "vercel");
async function gptCloudflare(env, model2, promptText, signal, effort) {
  if (!env.CF_ACCOUNT_ID || !env.CF_AI_TOKEN) throw new Error("cloudflare_ai_not_configured");
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/ai/v1/responses`, {
    method: "POST",
    signal,
    headers: {
      authorization: `Bearer ${env.CF_AI_TOKEN}`,
      "content-type": "application/json",
      ...env.AOP_AI_GATEWAY_ID ? { "cf-aig-gateway-id": env.AOP_AI_GATEWAY_ID } : {}
    },
    body: JSON.stringify({
      model: model2,
      instructions: SYSTEM,
      input: promptText,
      reasoning: { effort },
      max_output_tokens: maxOutputTokens(env),
      store: false
    })
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`cloudflare_gpt:${r.status}:${t.slice(0, 800)}`);
  const out = responseText(asObj(JSON.parse(t)));
  if (!out) throw new Error("cloudflare_gpt_empty");
  return parseJson(out);
}
__name(gptCloudflare, "gptCloudflare");
async function glmCloudflare(env, model2, promptText, signal, effort) {
  if (!env.CF_ACCOUNT_ID || !env.CF_AI_TOKEN) throw new Error("cloudflare_ai_not_configured");
  const m = model2.startsWith("@cf/") ? model2 : GLM_CF;
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/ai/run/${m}`, {
    method: "POST",
    signal,
    headers: {
      authorization: `Bearer ${env.CF_AI_TOKEN}`,
      "content-type": "application/json",
      "cf-aig-gateway-id": env.AOP_AI_GATEWAY_ID || "default"
    },
    body: JSON.stringify({
      messages: [{ role: "system", content: SYSTEM }, { role: "user", content: promptText }],
      max_completion_tokens: maxOutputTokens(env),
      reasoning_effort: effort,
      stream: false
    })
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`cloudflare_glm:${r.status}:${t.slice(0, 800)}`);
  const b = asObj(JSON.parse(t));
  const q = b.result && typeof b.result === "object" && !Array.isArray(b.result) ? b.result : b;
  let out = typeof q.response === "string" ? q.response : "";
  if (!out && Array.isArray(q.choices) && q.choices[0] && typeof q.choices[0] === "object") {
    const msg = q.choices[0].message;
    if (msg && typeof msg === "object" && !Array.isArray(msg) && typeof msg.content === "string") {
      out = String(msg.content);
    }
  }
  if (!out) throw new Error("cloudflare_glm_empty");
  return parseJson(out);
}
__name(glmCloudflare, "glmCloudflare");
async function callRail(env, actor, lease, promptText, rail, signal, effort) {
  const model2 = modelForRail(actor, lease, rail);
  if (rail === "VERCEL_AI_GATEWAY") return vercel(env, model2, promptText, signal, effort);
  return actor === "GPT" ? gptCloudflare(env, model2, promptText, signal, effort) : glmCloudflare(env, model2, promptText, signal, effort);
}
__name(callRail, "callRail");
function startRail(env, actor, lease, promptText, rail, effort, failures) {
  const controller = new AbortController();
  const started = Date.now();
  const model2 = modelForRail(actor, lease, rail);
  const timeout = setTimeout(() => controller.abort("duel_model_timeout"), timeoutMs(env));
  const promise = callRail(env, actor, lease, promptText, rail, controller.signal, effort).then((payload) => ({ rail, payload, latencyMs: Date.now() - started, model: model2 })).catch((error) => {
    const failure = {
      rail,
      latencyMs: Date.now() - started,
      model: model2,
      error: String(error).slice(0, 1200),
      errorClass: classifyError(error)
    };
    failures.push(failure);
    throw failure;
  }).finally(() => clearTimeout(timeout));
  return { rail, controller, promise };
}
__name(startRail, "startRail");
function criticalStep(payload) {
  const stepType = typeof payload.step_type === "string" ? payload.step_type.toUpperCase() : "";
  return CRITICAL_STEP_TYPES.has(stepType) || payload.ready_to_resolve === true || payload.need_canary === true || typeof payload.terminal_vote === "string";
}
__name(criticalStep, "criticalStep");
function failureJson(f) {
  return { rail: f.rail, model: f.model, latency_ms: f.latencyMs, error_class: f.errorClass, error: f.error };
}
__name(failureJson, "failureJson");
function successJson(s) {
  return { rail: s.rail, model: s.model, latency_ms: s.latencyMs, payload: s.payload };
}
__name(successJson, "successJson");
async function raceActor(env, actor, lease, promptText, effort) {
  const rails = availableRails(env);
  if (!rails.length) throw new Error("duel_no_inference_rail_configured");
  const failures = [];
  const tasks = rails.map((rail) => startRail(env, actor, lease, promptText, rail, effort, failures));
  let winner;
  try {
    winner = await Promise.any(tasks.map((t) => t.promise));
  } catch (error) {
    for (const t of tasks) t.controller.abort("all_rails_failed");
    const details = error instanceof AggregateError ? error.errors : failures;
    throw new Error(`duel_all_rails_failed:${actor}:${JSON.stringify(details).slice(0, 2200)}`);
  }
  const critical = criticalStep(winner.payload);
  let shadow = null;
  const alternate = tasks.find((t) => t.rail !== winner.rail);
  const shadowBudget = criticalShadowMs(env);
  if (critical && alternate && shadowBudget > 0) {
    const shadowResult = await Promise.race([
      alternate.promise.then((s) => ({ kind: "SUCCESS", success: s })).catch((e) => ({ kind: "ERROR", error: e })),
      sleep(shadowBudget).then(() => ({ kind: "TIMEOUT" }))
    ]);
    if (shadowResult.kind === "SUCCESS") shadow = { status: "SUCCESS", ...successJson(shadowResult.success) };
    else if (shadowResult.kind === "ERROR") shadow = { status: "ERROR", error: String(shadowResult.error).slice(0, 1200) };
    else shadow = { status: "TIMEOUT", wait_ms: shadowBudget };
  }
  for (const t of tasks) if (t.rail !== winner.rail) t.controller.abort("rail_loser");
  const executor = {
    mode: "DUAL_RAIL_RACE",
    winner_rail: winner.rail,
    winner_model: winner.model,
    winner_latency_ms: winner.latencyMs,
    rails_started: rails,
    failures_before_winner: failures.map(failureJson),
    critical_step: critical,
    critical_shadow: shadow,
    reasoning_effort: effort,
    vercel_provider_sort: "ttft"
  };
  return { ...winner.payload, _executor: executor };
}
__name(raceActor, "raceActor");
function visibleExecutorError(actor, error, peerHash) {
  return {
    step_type: "EXECUTOR_ERROR",
    summary: `${actor} execution slot did not return a model microstep on any configured rail`,
    evidence_used: [],
    peer_event_hash_addressed: peerHash,
    action: { kind: "BLOCKED_EXECUTOR", backend: "DUAL_RAIL_RACE" },
    falsifier: "A later exact-model invocation succeeds under the same immutable subject",
    risk_delta: "No model reasoning was fabricated; this is a SYSTEM-observed executor failure.",
    ready_to_resolve: false,
    terminal_vote: null,
    need_canary: false,
    resolution: null,
    synthetic: true,
    model_response: false,
    error_class: classifyError(error),
    error: String(error).slice(0, 2200),
    canonical: false,
    authority_effect: false
  };
}
__name(visibleExecutorError, "visibleExecutorError");
async function actorVisible(env, actor, lease, promptText, peerHash, effort) {
  try {
    return { payload: await raceActor(env, actor, lease, promptText, effort), executorError: false };
  } catch (error) {
    return { payload: visibleExecutorError(actor, error, peerHash), executorError: true };
  }
}
__name(actorVisible, "actorVisible");
function recentPeerHash(read, actorName) {
  const events = Array.isArray(read.events) ? read.events : [];
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (!e || typeof e !== "object" || Array.isArray(e)) continue;
    if (String(e.actor || "") !== actorName && typeof e.event_sha256 === "string") {
      return String(e.event_sha256);
    }
  }
  return null;
}
__name(recentPeerHash, "recentPeerHash");
function compactPayload(payload) {
  const keep = [
    "step_type",
    "summary",
    "evidence_used",
    "peer_event_hash_addressed",
    "action",
    "falsifier",
    "risk_delta",
    "ready_to_resolve",
    "terminal_vote",
    "need_canary",
    "resolution",
    "error_class",
    "synthetic",
    "model_response"
  ];
  const out = {};
  for (const key of keep) if (payload[key] !== void 0) out[key] = payload[key];
  return out;
}
__name(compactPayload, "compactPayload");
function compactReadback(read) {
  const events = (Array.isArray(read.events) ? read.events : []).map((raw) => {
    const e = asObj(raw);
    const payload = e.payload && typeof e.payload === "object" && !Array.isArray(e.payload) ? compactPayload(e.payload) : {};
    return {
      tick_no: e.tick_no ?? null,
      actor: e.actor ?? null,
      step_type: e.step_type ?? null,
      event_sha256: e.event_sha256 ?? null,
      payload_sha256: e.payload_sha256 ?? null,
      parent_checkpoint_sha256: e.parent_checkpoint_sha256 ?? null,
      payload
    };
  });
  const ticks = (Array.isArray(read.ticks) ? read.ticks : []).map((raw) => {
    const t = asObj(raw);
    return {
      tick_no: t.tick_no ?? null,
      input_checkpoint_sha256: t.input_checkpoint_sha256 ?? null,
      gpt_event_sha256: t.gpt_event_sha256 ?? null,
      glm_event_sha256: t.glm_event_sha256 ?? null,
      output_checkpoint_sha256: t.output_checkpoint_sha256 ?? null
    };
  });
  return {
    status: read.status ?? null,
    current_tick: read.current_tick ?? 0,
    current_checkpoint_sha256: read.current_checkpoint_sha256 ?? null,
    events,
    ticks
  };
}
__name(compactReadback, "compactReadback");
function prompt(actor, lease, read, effort) {
  const peer2 = recentPeerHash(read, actor);
  const nextTick = Number(read.current_tick || 0) + 1;
  const lens = assignedLens(actor, nextTick);
  const lensRule = lens === "BUILD" ? "BUILD: propose the smallest executable improvement and the evidence that would prove it works; still surface blockers." : "BREAK: actively search for a counterexample, race, security flaw, stale assumption, or cheaper falsifier; only agree if the competing design survives attack.";
  return `ACTOR=${actor}
DUEL=${lease.duel_key}
NEXT_TICK=${nextTick}
SEEN_CHECKPOINT=${String(read.current_checkpoint_sha256 || "")}
PEER_PREVIOUS_EVENT_HASH=${peer2 || "NONE"}
ROLE_LENS=${lens}
LENS_RULE=${lensRule}
REASONING_EFFORT=${effort}
SUBJECT=${JSON.stringify(lease.subject || {})}
BASE_SHA=${lease.base_github_sha}
CAUSAL_HISTORY=${JSON.stringify(compactReadback(read))}

Return keys: step_type, summary, evidence_used, peer_event_hash_addressed, action, falsifier, risk_delta, ready_to_resolve, terminal_vote, need_canary, resolution.
step_type examples: OBSERVE,HYPOTHESIS,COUNTEREXAMPLE,SQL_DESIGN,PATCH_DELTA,TEST_DESIGN,SECURITY_VETO,PERFORMANCE_NOTE,REBUTTAL,ARBITRATION,STOP.
If PEER_PREVIOUS_EVENT_HASH is not NONE, peer_event_hash_addressed MUST equal it. terminal_vote may be WIN_GPT,WIN_GLM,SYNTHESIS,NO_ACTION or null.`;
}
__name(prompt, "prompt");
function st(v) {
  const s = typeof v.step_type === "string" ? v.step_type.trim().toUpperCase() : "OBSERVE";
  return /^[A-Z0-9_]{2,48}$/.test(s) ? s : "OBSERVE";
}
__name(st, "st");
function vote(v) {
  const s = typeof v.terminal_vote === "string" ? v.terminal_vote : "";
  return VOTES.has(s) ? s : null;
}
__name(vote, "vote");
function peerAckOk(v, expected) {
  return !expected || v.peer_event_hash_addressed === expected;
}
__name(peerAckOk, "peerAckOk");
function executorMeta(v) {
  return v._executor && typeof v._executor === "object" && !Array.isArray(v._executor) ? v._executor : null;
}
__name(executorMeta, "executorMeta");
function eventPayload(event) {
  if (!event) throw new Error("duel_pair_event_missing");
  const payload = event.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("duel_pair_event_payload_missing");
  return payload;
}
__name(eventPayload, "eventPayload");
function eventIsExecutorError(event) {
  if (!event) return true;
  if (String(event.step_type || "") === "EXECUTOR_ERROR") return true;
  const payload = event.payload;
  return !!(payload && typeof payload === "object" && !Array.isArray(payload) && payload.model_response === false);
}
__name(eventIsExecutorError, "eventIsExecutorError");
function appendPersisted(read, receipt, tick, checkpoint) {
  if (receipt.persisted_readback !== true || !receipt.gpt_event || !receipt.glm_event || !receipt.tick) {
    throw new Error(`duel_pair_persisted_readback_required:${tick}`);
  }
  const events = [...Array.isArray(read.events) ? read.events : [], asObj(receipt.gpt_event), asObj(receipt.glm_event)].slice(-128);
  const ticks = [...Array.isArray(read.ticks) ? read.ticks : [], asObj(receipt.tick)].slice(-64);
  return { ...read, status: "RUNNING", current_tick: tick, current_checkpoint_sha256: checkpoint, events, ticks };
}
__name(appendPersisted, "appendPersisted");
async function replayReceiptIfCommitted(env, duelId, workerId, leaseGeneration, tick, checkpoint) {
  const read = await rpc(env, "h205f22_duel_read_lockstep_v2", { p_duel_id: duelId, p_after_tick: Math.max(0, tick - 1) });
  const current = Number(read.current_tick || 0);
  if (current < tick) return null;
  if (current > tick) throw new Error(`microstep_retry_tick_advanced:${current}:${tick}`);
  return rpc(env, "h205f22_duel_submit_pair_v3", {
    p_duel_id: duelId,
    p_worker: workerId,
    p_lease_generation: leaseGeneration,
    p_tick_no: tick,
    p_seen_checkpoint_sha256: checkpoint,
    p_gpt_step_type: "REPLAY",
    p_gpt_payload: {},
    p_glm_step_type: "REPLAY",
    p_glm_payload: {}
  });
}
__name(replayReceiptIfCommitted, "replayReceiptIfCommitted");
async function runMicrostepDuel(env, step, workerId, targetDuelId) {
  const targeted = typeof targetDuelId === "string" && /^[0-9a-f-]{36}$/.test(targetDuelId);
  const leaseText = await step.do(
    targeted ? "microstep-target-lease-read" : "microstep-lease",
    { retries: { limit: 4, delay: "1 second", backoff: "exponential" } },
    async () => JSON.stringify(await (targeted ? rpc(env, "h205f22_duel_lease_target_lockstep_v3", { p_duel_id: targetDuelId, p_worker: workerId, p_lease_seconds: 3600, p_after_tick: 0 }) : rpc(env, "h205f22_duel_lease_lockstep_v2", { p_worker: workerId, p_lease_seconds: 3600 })))
  );
  const lease = JSON.parse(leaseText);
  if (!lease.leased) return { status: "MICROSTEP_IDLE" };
  if (!lease.duel_id || lease.lease_generation == null || lease.protocol_version !== "LOCKSTEP_V2") throw new Error("microstep_bad_lease");
  const duelId = lease.duel_id;
  const leaseGeneration = lease.lease_generation;
  let checkpoint = String(lease.current_checkpoint_sha256 || "");
  let lastTick = Number(lease.current_tick || 0);
  const max = Math.min(Number(lease.max_ticks || 32), 64);
  let read;
  if (lease.readback && typeof lease.readback === "object" && !Array.isArray(lease.readback)) {
    read = lease.readback;
  } else {
    const initialText = await step.do(
      "microstep-read-initial",
      async () => JSON.stringify(await rpc(env, "h205f22_duel_read_lockstep_v2", { p_duel_id: duelId, p_after_tick: 0 }))
    );
    read = JSON.parse(initialText);
  }
  if (read.status !== "RUNNING") return { status: "MICROSTEP_TERMINAL", terminal_status: read.status };
  try {
    for (let tick = lastTick + 1; tick <= max; tick++) {
      if (Number(read.current_tick || 0) !== tick - 1) throw new Error(`microstep_local_readback_tick_drift:${read.current_tick}:${tick}`);
      checkpoint = String(read.current_checkpoint_sha256 || checkpoint);
      const effort = reasoningEffort(read);
      const gPrompt = prompt("GPT", lease, read, effort);
      const lPrompt = prompt("GLM", lease, read, effort);
      const gPeer = recentPeerHash(read, "GPT");
      const lPeer = recentPeerHash(read, "GLM");
      const gLens = assignedLens("GPT", tick);
      const lLens = assignedLens("GLM", tick);
      const receiptText = await step.do(
        `microstep-pair-${tick}`,
        { retries: { limit: 2, delay: 250, backoff: "exponential" }, timeout: "7 minutes" },
        async (ctx) => {
          if (ctx.attempt > 1) {
            const replay = await replayReceiptIfCommitted(env, duelId, workerId, leaseGeneration, tick, checkpoint);
            if (replay) return JSON.stringify(replay);
          }
          const pairStarted = Date.now();
          const [g, l] = await Promise.all([
            actorVisible(env, "GPT", lease, gPrompt, gPeer, effort),
            actorVisible(env, "GLM", lease, lPrompt, lPeer, effort)
          ]);
          const pairInferenceMs = Date.now() - pairStarted;
          if (!peerAckOk(g.payload, gPeer) || !peerAckOk(l.payload, lPeer)) throw new Error(`microstep_peer_hash_ack_failed:${tick}`);
          g.payload._lockstep = {
            tick_no: tick,
            assigned_lens: gLens,
            reasoning_effort: effort,
            pair_inference_ms: pairInferenceMs,
            context_mode: "FULL_HASHED_HISTORY_COMPACT_PROJECTION",
            lease_policy: targeted ? "TARGETED_WAKE_BOUND_LEASE_READ_V3" : "RECOVERY_GLOBAL_LEASE_V2"
          };
          l.payload._lockstep = {
            tick_no: tick,
            assigned_lens: lLens,
            reasoning_effort: effort,
            pair_inference_ms: pairInferenceMs,
            context_mode: "FULL_HASHED_HISTORY_COMPACT_PROJECTION",
            lease_policy: targeted ? "TARGETED_WAKE_BOUND_LEASE_READ_V3" : "RECOVERY_GLOBAL_LEASE_V2"
          };
          return JSON.stringify(await rpc(env, "h205f22_duel_submit_pair_v3", {
            p_duel_id: duelId,
            p_worker: workerId,
            p_lease_generation: leaseGeneration,
            p_tick_no: tick,
            p_seen_checkpoint_sha256: checkpoint,
            p_gpt_step_type: st(g.payload),
            p_gpt_payload: g.payload,
            p_glm_step_type: st(l.payload),
            p_glm_payload: l.payload
          }));
        }
      );
      const receipt = JSON.parse(receiptText);
      const gPayload = eventPayload(receipt.gpt_event);
      const lPayload = eventPayload(receipt.glm_event);
      checkpoint = String(receipt.output_checkpoint_sha256 || checkpoint);
      lastTick = tick;
      read = appendPersisted(read, receipt, tick, checkpoint);
      if (eventIsExecutorError(receipt.gpt_event) || eventIsExecutorError(receipt.glm_event)) {
        const result2 = {
          schema: "metaengine.compute.duel-microstep-result.h205f22.v3",
          outcome: "BLOCKED_EXECUTOR",
          inference_backend: "DUAL_RAIL_RACE",
          tick_durability: "ONE_DURABLE_TICK_V3",
          hot_path_readback: "DB_SELECTED_PAIR_RECEIPT",
          final_tick: tick,
          final_checkpoint_sha256: checkpoint,
          gpt_step: gPayload,
          glm_step: lPayload,
          canonical: false,
          authority_effect: false
        };
        return await step.do(`microstep-blocked-${tick}`, async () => JSON.stringify(await rpc(env, "h205f22_duel_complete_lockstep_v2", {
          p_duel_id: duelId,
          p_worker: workerId,
          p_lease_generation: leaseGeneration,
          p_status: "BLOCKED",
          p_result: result2
        })));
      }
      const gVote = vote(gPayload);
      const lVote = vote(lPayload);
      const ready = gPayload.ready_to_resolve === true && lPayload.ready_to_resolve === true;
      if (ready && gVote && lVote && gVote === lVote) {
        const result2 = {
          schema: "metaengine.compute.duel-microstep-result.h205f22.v3",
          outcome: "RESOLVED",
          winner: gVote,
          inference_backend: "DUAL_RAIL_RACE",
          tick_durability: "ONE_DURABLE_TICK_V3",
          hot_path_readback: "DB_SELECTED_PAIR_RECEIPT",
          final_tick: tick,
          final_checkpoint_sha256: checkpoint,
          gpt_executor: executorMeta(gPayload),
          glm_executor: executorMeta(lPayload),
          gpt_resolution: gPayload.resolution ?? null,
          glm_resolution: lPayload.resolution ?? null,
          canonical: false,
          authority_effect: false
        };
        return await step.do(`microstep-complete-${tick}`, async () => JSON.stringify(await rpc(env, "h205f22_duel_complete_lockstep_v2", {
          p_duel_id: duelId,
          p_worker: workerId,
          p_lease_generation: leaseGeneration,
          p_status: "RESOLVED",
          p_result: result2
        })));
      }
      if (gPayload.need_canary === true && lPayload.need_canary === true) {
        const result2 = {
          schema: "metaengine.compute.duel-microstep-result.h205f22.v3",
          outcome: "CANARY_REQUIRED",
          inference_backend: "DUAL_RAIL_RACE",
          tick_durability: "ONE_DURABLE_TICK_V3",
          hot_path_readback: "DB_SELECTED_PAIR_RECEIPT",
          final_tick: tick,
          final_checkpoint_sha256: checkpoint,
          gpt: gPayload,
          glm: lPayload,
          canonical: false,
          authority_effect: false
        };
        return await step.do(`microstep-canary-${tick}`, async () => JSON.stringify(await rpc(env, "h205f22_duel_complete_lockstep_v2", {
          p_duel_id: duelId,
          p_worker: workerId,
          p_lease_generation: leaseGeneration,
          p_status: "CANARY_REQUIRED",
          p_result: result2
        })));
      }
    }
    const result = {
      schema: "metaengine.compute.duel-microstep-result.h205f22.v3",
      outcome: "CANARY_REQUIRED",
      reason: "MAX_MICROSTEPS",
      inference_backend: "DUAL_RAIL_RACE",
      tick_durability: "ONE_DURABLE_TICK_V3",
      hot_path_readback: "DB_SELECTED_PAIR_RECEIPT",
      final_tick: lastTick,
      final_checkpoint_sha256: checkpoint,
      canonical: false,
      authority_effect: false
    };
    return await step.do("microstep-max", async () => JSON.stringify(await rpc(env, "h205f22_duel_complete_lockstep_v2", {
      p_duel_id: duelId,
      p_worker: workerId,
      p_lease_generation: leaseGeneration,
      p_status: "CANARY_REQUIRED",
      p_result: result
    })));
  } catch (error) {
    const result = {
      schema: "metaengine.compute.duel-microstep-result.h205f22.v3",
      outcome: "FAILED",
      error: String(error).slice(0, 3e3),
      inference_backend: "DUAL_RAIL_RACE",
      tick_durability: "ONE_DURABLE_TICK_V3",
      hot_path_readback: "DB_SELECTED_PAIR_RECEIPT",
      final_tick: lastTick,
      final_checkpoint_sha256: checkpoint,
      canonical: false,
      authority_effect: false
    };
    try {
      return await step.do("microstep-failed", async () => JSON.stringify(await rpc(env, "h205f22_duel_complete_lockstep_v2", {
        p_duel_id: duelId,
        p_worker: workerId,
        p_lease_generation: leaseGeneration,
        p_status: "FAILED",
        p_result: result
      })));
    } catch {
      throw error;
    }
  }
}
__name(runMicrostepDuel, "runMicrostepDuel");
