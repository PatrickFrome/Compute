import type { WorkflowStep } from "cloudflare:workers";
import type { Env, JsonObject } from "./types";
import { rpc } from "./supabase";

type DuelLease = {
  schema: string;
  leased: boolean;
  duel_id?: string;
  duel_key?: string;
  milestone_key?: string;
  checkpoint_id?: string;
  payload_root_sha256?: string;
  base_github_sha?: string;
  subject?: JsonObject;
  gpt_model?: string;
  glm_model?: string;
  lease_generation?: number;
  lease_expires_at?: string;
};

type DuelActor = "GPT" | "GLM";
type DuelTerminal = "RESOLVED" | "CANARY_REQUIRED" | "BLOCKED" | "FAILED";

const MAX_CONTEXT_BYTES = 260_000;
const MAX_FILE_BYTES = 72_000;
const GPT_DEFAULT = "openai/gpt-5.6-sol";
const GLM_DEFAULT = "@cf/zai-org/glm-5.2";

function jsonObject(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("duel_json_object_required");
  return value as JsonObject;
}

function extractJson(text: string): JsonObject {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try { return jsonObject(JSON.parse(trimmed)); } catch {}
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error(`duel_model_json_missing:${trimmed.slice(0, 400)}`);
  return jsonObject(JSON.parse(trimmed.slice(start, end + 1)));
}

function gptOutputText(body: JsonObject): string {
  if (typeof body.output_text === "string") return body.output_text;
  const output = Array.isArray(body.output) ? body.output : [];
  const chunks: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const rec = item as JsonObject;
    if (!Array.isArray(rec.content)) continue;
    for (const c of rec.content) {
      if (!c || typeof c !== "object" || Array.isArray(c)) continue;
      const cc = c as JsonObject;
      if (typeof cc.text === "string") chunks.push(cc.text);
    }
  }
  return chunks.join("\n");
}

async function callGpt(env: Env, model: string, system: string, prompt: string): Promise<JsonObject> {
  if (!env.CF_ACCOUNT_ID || !env.CF_AI_TOKEN) throw new Error("duel_cloudflare_ai_not_configured");
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/ai/v1/responses`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.CF_AI_TOKEN}`,
      "content-type": "application/json",
      ...(env.AOP_AI_GATEWAY_ID ? { "cf-aig-gateway-id": env.AOP_AI_GATEWAY_ID } : {}),
    },
    body: JSON.stringify({
      model,
      instructions: system,
      input: prompt,
      reasoning: { effort: "high" },
      max_output_tokens: 9000,
      store: false,
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`duel_gpt_failed:${res.status}:${text.slice(0, 1200)}`);
  const body = jsonObject(JSON.parse(text));
  const out = gptOutputText(body);
  if (!out) throw new Error("duel_gpt_empty_output");
  return extractJson(out);
}

async function callGlm(env: Env, model: string, system: string, prompt: string): Promise<JsonObject> {
  if (!env.CF_ACCOUNT_ID || !env.CF_AI_TOKEN) throw new Error("duel_cloudflare_ai_not_configured");
  const endpointModel = model.startsWith("@cf/") ? model : GLM_DEFAULT;
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/ai/run/${endpointModel}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.CF_AI_TOKEN}`,
      "content-type": "application/json",
      "cf-aig-gateway-id": env.AOP_AI_GATEWAY_ID || "default",
    },
    body: JSON.stringify({
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      max_completion_tokens: 9000,
      reasoning_effort: "high",
      stream: false,
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`duel_glm_failed:${res.status}:${text.slice(0, 1200)}`);
  const body = jsonObject(JSON.parse(text));
  const result = body.result && typeof body.result === "object" && !Array.isArray(body.result) ? body.result as JsonObject : body;
  let out = typeof result.response === "string" ? result.response : "";
  if (!out && Array.isArray(result.choices) && result.choices.length) {
    const first = result.choices[0];
    if (first && typeof first === "object" && !Array.isArray(first)) {
      const msg = (first as JsonObject).message;
      if (msg && typeof msg === "object" && !Array.isArray(msg) && typeof (msg as JsonObject).content === "string") out = String((msg as JsonObject).content);
    }
  }
  if (!out) throw new Error(`duel_glm_empty_output:${text.slice(0, 600)}`);
  return extractJson(out);
}

async function callActor(env: Env, actor: DuelActor, lease: DuelLease, system: string, prompt: string): Promise<JsonObject> {
  return actor === "GPT"
    ? callGpt(env, lease.gpt_model || GPT_DEFAULT, system, prompt)
    : callGlm(env, lease.glm_model || GLM_DEFAULT, system, prompt);
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "user-agent": "metaengine-h205f22-duel/1" } });
  if (!res.ok) return `FETCH_FAILED ${res.status} ${url}`;
  const text = await res.text();
  return text.length > MAX_FILE_BYTES ? `${text.slice(0, MAX_FILE_BYTES)}\n...[TRUNCATED]` : text;
}

async function collectContext(env: Env, lease: DuelLease): Promise<JsonObject> {
  const subject = lease.subject ?? {};
  const repo = typeof subject.repository === "string" ? subject.repository : "PatrickFrome/Compute";
  const prNumber = typeof subject.pr_number === "number" ? subject.pr_number : null;
  const paths = Array.isArray(subject.paths) ? subject.paths.filter((x): x is string => typeof x === "string").slice(0, 10) : [];
  const baseSha = lease.base_github_sha || "";
  const context: JsonObject = {
    duel_key: lease.duel_key ?? null,
    milestone_key: lease.milestone_key ?? null,
    checkpoint_id: lease.checkpoint_id ?? null,
    payload_root_sha256: lease.payload_root_sha256 ?? null,
    base_github_sha: baseSha,
    subject,
    supervisor_snapshot: await rpc<JsonObject>(env, "h205f22_aop1_snapshot_v1", {}),
  };
  if (prNumber) context.pull_request = extractJson(await fetchText(`https://api.github.com/repos/${repo}/pulls/${prNumber}`));
  const files: JsonObject = {};
  for (const path of paths) {
    files[path] = await fetchText(`https://raw.githubusercontent.com/${repo}/${baseSha}/${path}`);
  }
  context.files = files;
  let serialized = JSON.stringify(context);
  if (serialized.length > MAX_CONTEXT_BYTES) {
    context.files = { note: "context files omitted because serialized context exceeded limit; rely on subject + PR metadata" };
    serialized = JSON.stringify(context);
    if (serialized.length > MAX_CONTEXT_BYTES) throw new Error("duel_context_limit_exceeded");
  }
  return context;
}

const COMMON_SYSTEM = `You are one of two equal adversarial engineering contenders in METAENGINE H205F22 DUEL_SYNC_V1.
This is an ACTIVE co-development protocol, not a conversational review relay. Both contenders receive the same immutable checkpoint and exact Git base.
Your output is non-authority: canonical=false and authority_effect=false. Never claim roadmap VERIFIED, merge authority, or live evidence you did not actually observe.
Truth laws: caller-controlled labels are not provenance; FETCHED != VERIFIED; self-consistent hashes of caller data are not provenance; read credentials must not be forge-capable writers; expired evidence is historical only.
Return exactly one JSON object and no markdown fences.`;

function proposalPrompt(actor: DuelActor, context: JsonObject): string {
  return `${COMMON_SYSTEM}\n\nACTOR=${actor}. PHASE=PROPOSE.\nIndependently design the strongest next mutation for the shared checkpoint. Do not optimize for agreement.\nReturn JSON with keys: phase, actor, thesis, invariant_closure, mutation_plan, tests, live_evidence_plan, rollback, risks, alternatives_rejected.\nmutation_plan must be an array; when code/SQL changes are proposed, each item should name an exact path/object and enough concrete content or pseudodiff to implement it.\nShared context:\n${JSON.stringify(context)}`;
}

function attackPrompt(actor: DuelActor, context: JsonObject, own: JsonObject, opponent: JsonObject): string {
  return `${COMMON_SYSTEM}\n\nACTOR=${actor}. PHASE=ATTACK.\nAttack the opponent proposal as if a critical trust-boundary bypass exists until disproven. Find concrete counterexamples, incorrect SQL/runtime semantics, hidden dependencies, privilege amplification, races, stale evidence, rollback gaps and implementation infeasibility. Also identify anything genuinely stronger than your own proposal.\nReturn JSON with keys: phase, actor, target_actor, blocking_findings, nonblocking_findings, opponent_strengths, decisive_canaries, provisional_score.\nShared context:\n${JSON.stringify(context)}\nOWN_PROPOSAL:\n${JSON.stringify(own)}\nOPPONENT_PROPOSAL:\n${JSON.stringify(opponent)}`;
}

function rebuttalPrompt(actor: DuelActor, context: JsonObject, own: JsonObject, opponentAttack: JsonObject): string {
  return `${COMMON_SYSTEM}\n\nACTOR=${actor}. PHASE=REBUT.\nRespond to the opponent attack. Concede valid findings. Revise your design instead of defending a broken idea.\nReturn JSON with keys: phase, actor, concessions, rejected_attacks, revised_thesis, revised_mutation_plan, revised_tests, remaining_risks, decisive_canary.\nShared context:\n${JSON.stringify(context)}\nORIGINAL_PROPOSAL:\n${JSON.stringify(own)}\nOPPONENT_ATTACK:\n${JSON.stringify(opponentAttack)}`;
}

function arbitrationPrompt(actor: DuelActor, context: JsonObject, bundle: JsonObject): string {
  return `${COMMON_SYSTEM}\n\nACTOR=${actor}. PHASE=ARBITRATE.\nJudge the resulting action by evidence, not model identity. Scores: safety/privilege separation 30, correctness/invariant closure 25, live verifiability 20, reversibility 10, simplicity 10, performance/cost 5. Any critical trust-boundary failure is an automatic veto.\nChoose exactly one winner: WIN_GPT, WIN_GLM, SYNTHESIS, or NO_ACTION.\nReturn JSON with keys: phase, actor, winner, critical_vetoes, score_gpt, score_glm, rationale, resolution_plan, decisive_canary_if_split. score_gpt and score_glm must each contain the six dimensions and total. resolution_plan must be concrete enough to implement.\nShared context:\n${JSON.stringify(context)}\nDUEL_BUNDLE:\n${JSON.stringify(bundle)}`;
}

function convergencePrompt(actor: DuelActor, context: JsonObject, bundle: JsonObject, gptArb: JsonObject, glmArb: JsonObject): string {
  return `${COMMON_SYSTEM}\n\nACTOR=${actor}. PHASE=CONVERGENCE. The first arbitration split. Re-evaluate after seeing both votes. Do not preserve your prior vote for identity reasons.\nChoose exactly one winner: WIN_GPT, WIN_GLM, SYNTHESIS, or NO_ACTION. If a safe decisive canary is required instead, choose NO_ACTION and specify it.\nReturn JSON with keys: phase, actor, winner, rationale, resolution_plan, decisive_canary.\nShared context:\n${JSON.stringify(context)}\nDUEL_BUNDLE:\n${JSON.stringify(bundle)}\nGPT_ARBITRATION:\n${JSON.stringify(gptArb)}\nGLM_ARBITRATION:\n${JSON.stringify(glmArb)}`;
}

function winnerOf(value: JsonObject): string {
  const w = typeof value.winner === "string" ? value.winner : "";
  return ["WIN_GPT", "WIN_GLM", "SYNTHESIS", "NO_ACTION"].includes(w) ? w : "NO_ACTION";
}

async function record(env: Env, lease: DuelLease, workerId: string, phase: string, actor: string, payload: JsonObject): Promise<void> {
  if (!lease.duel_id || lease.lease_generation == null) throw new Error("duel_invalid_lease");
  await rpc<JsonObject>(env, "h205f22_duel_record_event_v1", {
    p_duel_id: lease.duel_id,
    p_worker: workerId,
    p_lease_generation: lease.lease_generation,
    p_phase: phase,
    p_actor: actor,
    p_payload: payload,
  });
}

async function complete(env: Env, lease: DuelLease, workerId: string, status: DuelTerminal, result: JsonObject): Promise<JsonObject> {
  if (!lease.duel_id || lease.lease_generation == null) throw new Error("duel_invalid_lease");
  return rpc<JsonObject>(env, "h205f22_duel_complete_v1", {
    p_duel_id: lease.duel_id,
    p_worker: workerId,
    p_lease_generation: lease.lease_generation,
    p_status: status,
    p_result: result,
  });
}

export async function runDuelWorkflow(env: Env, step: WorkflowStep, workerId: string): Promise<unknown> {
  const leaseText = await step.do("duel-lease", { retries: { limit: 4, delay: "5 seconds", backoff: "exponential" } }, async () => JSON.stringify(await rpc<DuelLease>(env, "h205f22_duel_lease_v1", { p_worker: workerId, p_lease_seconds: 1800 })));
  const lease = JSON.parse(leaseText) as DuelLease;
  if (!lease.leased) return { status: "DUEL_IDLE" };

  try {
    const contextText = await step.do("duel-context", async () => JSON.stringify(await collectContext(env, lease)));
    const context = JSON.parse(contextText) as JsonObject;

    const [gptProposalText, glmProposalText] = await Promise.all([
      step.do("duel-gpt-proposal", { retries: { limit: 2, delay: "10 seconds", backoff: "exponential" }, timeout: "15 minutes" }, async () => JSON.stringify(await callActor(env, "GPT", lease, COMMON_SYSTEM, proposalPrompt("GPT", context)))),
      step.do("duel-glm-proposal", { retries: { limit: 2, delay: "10 seconds", backoff: "exponential" }, timeout: "15 minutes" }, async () => JSON.stringify(await callActor(env, "GLM", lease, COMMON_SYSTEM, proposalPrompt("GLM", context)))),
    ]);
    const gptProposal = JSON.parse(gptProposalText) as JsonObject;
    const glmProposal = JSON.parse(glmProposalText) as JsonObject;
    await step.do("duel-record-proposals", async () => {
      await Promise.all([record(env, lease, workerId, "PROPOSE", "GPT", gptProposal), record(env, lease, workerId, "PROPOSE", "GLM", glmProposal)]);
      return true;
    });

    const [gptAttackText, glmAttackText] = await Promise.all([
      step.do("duel-gpt-attack", { retries: { limit: 2, delay: "10 seconds", backoff: "exponential" }, timeout: "15 minutes" }, async () => JSON.stringify(await callActor(env, "GPT", lease, COMMON_SYSTEM, attackPrompt("GPT", context, gptProposal, glmProposal)))),
      step.do("duel-glm-attack", { retries: { limit: 2, delay: "10 seconds", backoff: "exponential" }, timeout: "15 minutes" }, async () => JSON.stringify(await callActor(env, "GLM", lease, COMMON_SYSTEM, attackPrompt("GLM", context, glmProposal, gptProposal)))),
    ]);
    const gptAttack = JSON.parse(gptAttackText) as JsonObject;
    const glmAttack = JSON.parse(glmAttackText) as JsonObject;
    await step.do("duel-record-attacks", async () => {
      await Promise.all([record(env, lease, workerId, "ATTACK", "GPT", gptAttack), record(env, lease, workerId, "ATTACK", "GLM", glmAttack)]);
      return true;
    });

    const [gptRebuttalText, glmRebuttalText] = await Promise.all([
      step.do("duel-gpt-rebuttal", { retries: { limit: 2, delay: "10 seconds", backoff: "exponential" }, timeout: "15 minutes" }, async () => JSON.stringify(await callActor(env, "GPT", lease, COMMON_SYSTEM, rebuttalPrompt("GPT", context, gptProposal, glmAttack)))),
      step.do("duel-glm-rebuttal", { retries: { limit: 2, delay: "10 seconds", backoff: "exponential" }, timeout: "15 minutes" }, async () => JSON.stringify(await callActor(env, "GLM", lease, COMMON_SYSTEM, rebuttalPrompt("GLM", context, glmProposal, gptAttack)))),
    ]);
    const gptRebuttal = JSON.parse(gptRebuttalText) as JsonObject;
    const glmRebuttal = JSON.parse(glmRebuttalText) as JsonObject;
    await step.do("duel-record-rebuttals", async () => {
      await Promise.all([record(env, lease, workerId, "REBUT", "GPT", gptRebuttal), record(env, lease, workerId, "REBUT", "GLM", glmRebuttal)]);
      return true;
    });

    const bundle: JsonObject = { gpt_proposal: gptProposal, glm_proposal: glmProposal, gpt_attack: gptAttack, glm_attack: glmAttack, gpt_rebuttal: gptRebuttal, glm_rebuttal: glmRebuttal };
    const [gptArbText, glmArbText] = await Promise.all([
      step.do("duel-gpt-arbitration", { retries: { limit: 2, delay: "10 seconds", backoff: "exponential" }, timeout: "15 minutes" }, async () => JSON.stringify(await callActor(env, "GPT", lease, COMMON_SYSTEM, arbitrationPrompt("GPT", context, bundle)))),
      step.do("duel-glm-arbitration", { retries: { limit: 2, delay: "10 seconds", backoff: "exponential" }, timeout: "15 minutes" }, async () => JSON.stringify(await callActor(env, "GLM", lease, COMMON_SYSTEM, arbitrationPrompt("GLM", context, bundle)))),
    ]);
    let gptArb = JSON.parse(gptArbText) as JsonObject;
    let glmArb = JSON.parse(glmArbText) as JsonObject;
    await step.do("duel-record-arbitration", async () => {
      await Promise.all([record(env, lease, workerId, "ARBITRATE", "GPT", gptArb), record(env, lease, workerId, "ARBITRATE", "GLM", glmArb)]);
      return true;
    });

    let winnerGpt = winnerOf(gptArb), winnerGlm = winnerOf(glmArb);
    let convergence: JsonObject | null = null;
    if (winnerGpt !== winnerGlm) {
      const [gptConvText, glmConvText] = await Promise.all([
        step.do("duel-gpt-convergence", { retries: { limit: 1, delay: "10 seconds" }, timeout: "15 minutes" }, async () => JSON.stringify(await callActor(env, "GPT", lease, COMMON_SYSTEM, convergencePrompt("GPT", context, bundle, gptArb, glmArb)))),
        step.do("duel-glm-convergence", { retries: { limit: 1, delay: "10 seconds" }, timeout: "15 minutes" }, async () => JSON.stringify(await callActor(env, "GLM", lease, COMMON_SYSTEM, convergencePrompt("GLM", context, bundle, gptArb, glmArb)))),
      ]);
      const gptConv = JSON.parse(gptConvText) as JsonObject;
      const glmConv = JSON.parse(glmConvText) as JsonObject;
      convergence = { gpt: gptConv, glm: glmConv };
      await step.do("duel-record-convergence", async () => {
        await Promise.all([record(env, lease, workerId, "CONVERGENCE", "GPT", gptConv), record(env, lease, workerId, "CONVERGENCE", "GLM", glmConv)]);
        return true;
      });
      gptArb = gptConv; glmArb = glmConv;
      winnerGpt = winnerOf(gptArb); winnerGlm = winnerOf(glmArb);
    }

    const common: JsonObject = {
      schema: "metaengine.compute.duel-result.h205f22.v1",
      duel_id: lease.duel_id ?? null,
      duel_key: lease.duel_key ?? null,
      milestone_key: lease.milestone_key ?? null,
      checkpoint_id: lease.checkpoint_id ?? null,
      payload_root_sha256: lease.payload_root_sha256 ?? null,
      base_github_sha: lease.base_github_sha ?? null,
      models: { gpt: lease.gpt_model || GPT_DEFAULT, glm: lease.glm_model || GLM_DEFAULT },
      bundle,
      gpt_arbitration: gptArb,
      glm_arbitration: glmArb,
      convergence,
      canonical: false,
      authority_effect: false,
    };

    if (winnerGpt !== winnerGlm) {
      const result = { ...common, outcome: "CANARY_REQUIRED", winner_gpt: winnerGpt, winner_glm: winnerGlm } as JsonObject;
      return await step.do("duel-complete-split", async () => JSON.stringify(await complete(env, lease, workerId, "CANARY_REQUIRED", result)));
    }
    if (winnerGpt === "NO_ACTION") {
      const result = { ...common, outcome: "NO_ACTION", winner: "NO_ACTION" } as JsonObject;
      return await step.do("duel-complete-no-action", async () => JSON.stringify(await complete(env, lease, workerId, "CANARY_REQUIRED", result)));
    }

    let selected: JsonObject;
    if (winnerGpt === "WIN_GPT") selected = gptRebuttal;
    else if (winnerGpt === "WIN_GLM") selected = glmRebuttal;
    else selected = { gpt_resolution_plan: gptArb.resolution_plan ?? null, glm_resolution_plan: glmArb.resolution_plan ?? null } as JsonObject;

    const result = { ...common, outcome: "RESOLVED", winner: winnerGpt, selected_action: selected } as JsonObject;
    return await step.do("duel-complete-resolved", async () => JSON.stringify(await complete(env, lease, workerId, "RESOLVED", result)));
  } catch (error) {
    const result = { schema: "metaengine.compute.duel-result.h205f22.v1", outcome: "FAILED", error: String(error).slice(0, 4000), canonical: false, authority_effect: false } as JsonObject;
    try { return await step.do("duel-complete-failed", async () => JSON.stringify(await complete(env, lease, workerId, "FAILED", result))); }
    catch { throw error; }
  }
}
