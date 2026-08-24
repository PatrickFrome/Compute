import type { WorkflowStep } from "cloudflare:workers";
import type { Env, JsonObject } from "./types";
import { rpc } from "./supabase";

type DuelActor = "GPT" | "GLM";
type DuelTerminal = "RESOLVED" | "CANARY_REQUIRED" | "BLOCKED" | "FAILED";
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
  protocol_version?: string;
  current_tick?: number;
  current_checkpoint_sha256?: string;
  max_ticks?: number;
  lease_generation?: number;
  lease_expires_at?: string;
};

type LockstepReadback = {
  schema: string;
  duel_id: string;
  duel_key: string;
  status: string;
  protocol_version: string;
  checkpoint_id: string;
  payload_root_sha256: string;
  base_github_sha: string;
  current_tick: number;
  current_checkpoint_sha256: string;
  max_ticks: number;
  events: JsonObject[];
  ticks: JsonObject[];
  result?: JsonObject | null;
  result_sha256?: string | null;
};

type PairReceipt = {
  schema: string;
  duel_id: string;
  tick_no: number;
  input_checkpoint_sha256: string;
  gpt_event_sha256: string;
  glm_event_sha256: string;
  output_checkpoint_sha256: string;
};

const GPT_DEFAULT = "openai/gpt-5.6-sol";
const GLM_DEFAULT = "@cf/zai-org/glm-5.2";
const MAX_CONTEXT_BYTES = 260_000;
const MAX_FILE_BYTES = 72_000;
const VALID_WINNERS = new Set(["WIN_GPT", "WIN_GLM", "SYNTHESIS", "NO_ACTION"]);

function jsonObject(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("duel_json_object_required");
  return value as JsonObject;
}

function extractJson(text: string): JsonObject {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try { return jsonObject(JSON.parse(trimmed)); } catch {}
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error(`duel_model_json_missing:${trimmed.slice(0, 500)}`);
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
    body: JSON.stringify({ model, instructions: system, input: prompt, reasoning: { effort: "high" }, max_output_tokens: 6000, store: false }),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`duel_gpt_failed:${res.status}:${raw.slice(0, 1600)}`);
  const body = jsonObject(JSON.parse(raw));
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
      ...(env.AOP_AI_GATEWAY_ID ? { "cf-aig-gateway-id": env.AOP_AI_GATEWAY_ID } : { "cf-aig-gateway-id": "default" }),
    },
    body: JSON.stringify({
      messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
      max_completion_tokens: 6000,
      reasoning_effort: "high",
      stream: false,
    }),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`duel_glm_failed:${res.status}:${raw.slice(0, 1600)}`);
  const body = jsonObject(JSON.parse(raw));
  const result = body.result && typeof body.result === "object" && !Array.isArray(body.result) ? body.result as JsonObject : body;
  let out = typeof result.response === "string" ? result.response : "";
  if (!out && Array.isArray(result.choices) && result.choices.length) {
    const first = result.choices[0];
    if (first && typeof first === "object" && !Array.isArray(first)) {
      const message = (first as JsonObject).message;
      if (message && typeof message === "object" && !Array.isArray(message) && typeof (message as JsonObject).content === "string") {
        out = String((message as JsonObject).content);
      }
    }
  }
  if (!out) throw new Error(`duel_glm_empty_output:${raw.slice(0, 800)}`);
  return extractJson(out);
}

async function callActor(env: Env, actor: DuelActor, lease: DuelLease, prompt: string): Promise<JsonObject> {
  const system = [
    "You are an equal engineering contender in METAENGINE H205F22 LOCKSTEP_V2.",
    "This is an active co-development state machine, not a message relay.",
    "Both contenders receive the exact same immutable checkpoint and shared append-only history for this tick.",
    "Do not optimize for agreement. Concede only when evidence defeats your design.",
    "Outputs are non-authority: canonical=false and authority_effect=false.",
    "Never claim live evidence that is not present in the supplied shared state.",
    "Truth laws: caller labels are not provenance; FETCHED != VERIFIED; reader credentials must not be forge-capable writers; expired evidence is historical only.",
    "Return exactly one JSON object, no markdown fences.",
  ].join("\n");
  return actor === "GPT"
    ? callGpt(env, lease.gpt_model || GPT_DEFAULT, system, prompt)
    : callGlm(env, lease.glm_model || GLM_DEFAULT, system, prompt);
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "user-agent": "metaengine-h205f22-lockstep/2" } });
  if (!res.ok) return `FETCH_FAILED ${res.status} ${url}`;
  const text = await res.text();
  return text.length > MAX_FILE_BYTES ? `${text.slice(0, MAX_FILE_BYTES)}\n...[TRUNCATED]` : text;
}

async function collectContext(env: Env, lease: DuelLease): Promise<JsonObject> {
  const subject = lease.subject ?? {};
  const repo = typeof subject.repository === "string" ? subject.repository : "PatrickFrome/Compute";
  const paths = Array.isArray(subject.paths) ? subject.paths.filter((x): x is string => typeof x === "string").slice(0, 10) : [];
  const baseSha = lease.base_github_sha || "";
  const files: JsonObject = {};
  for (const path of paths) files[path] = await fetchText(`https://raw.githubusercontent.com/${repo}/${baseSha}/${path}`);
  const context: JsonObject = {
    duel_key: lease.duel_key ?? null,
    milestone_key: lease.milestone_key ?? null,
    checkpoint_id: lease.checkpoint_id ?? null,
    payload_root_sha256: lease.payload_root_sha256 ?? null,
    base_github_sha: baseSha,
    subject,
    supervisor_snapshot: await rpc<JsonObject>(env, "h205f22_aop1_snapshot_v1", {}),
    files,
  };
  if (JSON.stringify(context).length > MAX_CONTEXT_BYTES) context.files = { note: "file bodies omitted: context cap reached; exact paths and immutable base remain in subject" };
  return context;
}

function phaseForTick(tick: number): "PROPOSE" | "ATTACK" | "REBUT" | "ARBITRATE" | "CONVERGENCE" {
  if (tick === 1) return "PROPOSE";
  if (tick === 2) return "ATTACK";
  if (tick === 3) return "REBUT";
  if (tick === 4) return "ARBITRATE";
  return "CONVERGENCE";
}

function actorPrompt(actor: DuelActor, phase: string, tick: number, context: JsonObject, readback: LockstepReadback): string {
  const shared = JSON.stringify({ context, lockstep: readback });
  const prefix = `ACTOR=${actor}; PHASE=${phase}; TICK=${tick}. Both actors see this identical shared state and checkpoint ${readback.current_checkpoint_sha256}.`;
  if (phase === "PROPOSE") return `${prefix}\nIndependently design the strongest implementable next mutation. Return keys phase,actor,thesis,invariant_closure,mutation_plan,tests,live_evidence_plan,rollback,risks,alternatives_rejected. mutation_plan must name exact files/DB objects and concrete changes.\nSHARED_STATE=${shared}`;
  if (phase === "ATTACK") return `${prefix}\nAttack the opponent's tick-1 proposal using concrete counterexamples: SQL/runtime semantics, privilege bypass, races, stale provenance, hidden dependencies, apply/rollback failures. Also state what is genuinely stronger than your own proposal. Return keys phase,actor,target_actor,blocking_findings,nonblocking_findings,opponent_strengths,decisive_canaries,provisional_score.\nSHARED_STATE=${shared}`;
  if (phase === "REBUT") return `${prefix}\nRevise your proposal after both attacks. Concede valid findings; do not defend a broken design. Return keys phase,actor,concessions,rejected_attacks,revised_thesis,revised_mutation_plan,revised_tests,remaining_risks,decisive_canary.\nSHARED_STATE=${shared}`;
  if (phase === "ARBITRATE") return `${prefix}\nArbitrate by evidence, not identity. Score safety 30, correctness 25, live verifiability 20, reversibility 10, simplicity 10, performance/cost 5. Critical trust-boundary flaw is automatic veto. Choose winner exactly WIN_GPT, WIN_GLM, SYNTHESIS, or NO_ACTION. Return keys phase,actor,winner,critical_vetoes,score_gpt,score_glm,rationale,resolution_plan,decisive_canary_if_split.\nSHARED_STATE=${shared}`;
  return `${prefix}\nPrior arbitration split or required convergence. Re-evaluate both complete histories without identity loyalty. Choose winner exactly WIN_GPT, WIN_GLM, SYNTHESIS, or NO_ACTION. If evidence cannot safely decide, choose NO_ACTION and specify one minimal decisive canary. Return keys phase,actor,winner,rationale,resolution_plan,decisive_canary.\nSHARED_STATE=${shared}`;
}

function winner(payload: JsonObject): string {
  const value = typeof payload.winner === "string" ? payload.winner : "NO_ACTION";
  return VALID_WINNERS.has(value) ? value : "NO_ACTION";
}

async function readLockstep(env: Env, duelId: string): Promise<LockstepReadback> {
  return rpc<LockstepReadback>(env, "h205f22_duel_read_lockstep_v2", { p_duel_id: duelId, p_after_tick: 0 });
}

async function submitPair(env: Env, lease: DuelLease, workerId: string, tick: number, checkpoint: string, phase: string, gpt: JsonObject, glm: JsonObject): Promise<PairReceipt> {
  if (!lease.duel_id || lease.lease_generation == null) throw new Error("lockstep_invalid_lease");
  return rpc<PairReceipt>(env, "h205f22_duel_submit_pair_v2", {
    p_duel_id: lease.duel_id,
    p_worker: workerId,
    p_lease_generation: lease.lease_generation,
    p_tick_no: tick,
    p_seen_checkpoint_sha256: checkpoint,
    p_gpt_step_type: phase,
    p_gpt_payload: gpt,
    p_glm_step_type: phase,
    p_glm_payload: glm,
  });
}

async function complete(env: Env, lease: DuelLease, workerId: string, status: DuelTerminal, result: JsonObject): Promise<JsonObject> {
  if (!lease.duel_id || lease.lease_generation == null) throw new Error("lockstep_invalid_lease");
  return rpc<JsonObject>(env, "h205f22_duel_complete_lockstep_v2", {
    p_duel_id: lease.duel_id,
    p_worker: workerId,
    p_lease_generation: lease.lease_generation,
    p_status: status,
    p_result: result,
  });
}

export async function runDuelWorkflow(env: Env, step: WorkflowStep, workerId: string): Promise<unknown> {
  const leaseText = await step.do("lockstep-v2-lease", { retries: { limit: 4, delay: "5 seconds", backoff: "exponential" } }, async () => JSON.stringify(await rpc<DuelLease>(env, "h205f22_duel_lease_lockstep_v2", { p_worker: workerId, p_lease_seconds: 3600 })));
  const lease = JSON.parse(leaseText) as DuelLease;
  if (!lease.leased) return { status: "LOCKSTEP_IDLE" };
  if (lease.protocol_version !== "LOCKSTEP_V2" || !lease.duel_id || !lease.current_checkpoint_sha256) throw new Error("lockstep_v2_lease_contract_invalid");

  const contextText = await step.do("lockstep-v2-context", async () => JSON.stringify(await collectContext(env, lease)));
  const context = JSON.parse(contextText) as JsonObject;

  try {
    for (let tick = (lease.current_tick ?? 0) + 1; tick <= Math.min(lease.max_ticks ?? 5, 5); tick++) {
      const readText = await step.do(`lockstep-read-${tick}`, async () => JSON.stringify(await readLockstep(env, lease.duel_id!)));
      const readback = JSON.parse(readText) as LockstepReadback;
      if (readback.status !== "RUNNING") return { status: "LOCKSTEP_TERMINAL", duel_id: lease.duel_id, terminal_status: readback.status };
      if (readback.current_tick !== tick - 1) throw new Error(`lockstep_tick_drift:${readback.current_tick}:${tick}`);
      const phase = phaseForTick(tick);
      const checkpoint = readback.current_checkpoint_sha256;

      const [gptText, glmText] = await Promise.all([
        step.do(`lockstep-gpt-${tick}-${phase.toLowerCase()}`, { retries: { limit: 2, delay: "10 seconds", backoff: "exponential" }, timeout: "15 minutes" }, async () => JSON.stringify(await callActor(env, "GPT", lease, actorPrompt("GPT", phase, tick, context, readback)))),
        step.do(`lockstep-glm-${tick}-${phase.toLowerCase()}`, { retries: { limit: 2, delay: "10 seconds", backoff: "exponential" }, timeout: "15 minutes" }, async () => JSON.stringify(await callActor(env, "GLM", lease, actorPrompt("GLM", phase, tick, context, readback)))),
      ]);
      const gpt = JSON.parse(gptText) as JsonObject;
      const glm = JSON.parse(glmText) as JsonObject;
      const receiptText = await step.do(`lockstep-submit-pair-${tick}`, { retries: { limit: 3, delay: "5 seconds", backoff: "exponential" } }, async () => JSON.stringify(await submitPair(env, lease, workerId, tick, checkpoint, phase, gpt, glm)));
      const receipt = JSON.parse(receiptText) as PairReceipt;

      if (phase === "ARBITRATE" || phase === "CONVERGENCE") {
        const gptWinner = winner(gpt);
        const glmWinner = winner(glm);
        if (gptWinner === glmWinner && gptWinner !== "NO_ACTION") {
          const result: JsonObject = {
            schema: "metaengine.compute.duel-lockstep-result.h205f22.v2",
            outcome: "RESOLVED",
            winner: gptWinner,
            final_tick: tick,
            final_checkpoint_sha256: receipt.output_checkpoint_sha256,
            gpt_decision: gpt,
            glm_decision: glm,
            canonical: false,
            authority_effect: false,
          };
          return await step.do(`lockstep-complete-resolved-${tick}`, async () => JSON.stringify(await complete(env, lease, workerId, "RESOLVED", result)));
        }
        if (phase === "CONVERGENCE") {
          const result: JsonObject = {
            schema: "metaengine.compute.duel-lockstep-result.h205f22.v2",
            outcome: "CANARY_REQUIRED",
            winner_gpt: gptWinner,
            winner_glm: glmWinner,
            final_tick: tick,
            final_checkpoint_sha256: receipt.output_checkpoint_sha256,
            gpt_decision: gpt,
            glm_decision: glm,
            canonical: false,
            authority_effect: false,
          };
          return await step.do("lockstep-complete-canary", async () => JSON.stringify(await complete(env, lease, workerId, "CANARY_REQUIRED", result)));
        }
      }
    }

    const finalRead = await readLockstep(env, lease.duel_id);
    const result: JsonObject = {
      schema: "metaengine.compute.duel-lockstep-result.h205f22.v2",
      outcome: "CANARY_REQUIRED",
      reason: "lockstep_tick_budget_exhausted_without_consensus",
      final_tick: finalRead.current_tick,
      final_checkpoint_sha256: finalRead.current_checkpoint_sha256,
      canonical: false,
      authority_effect: false,
    };
    return await complete(env, lease, workerId, "CANARY_REQUIRED", result);
  } catch (error) {
    const latest = await readLockstep(env, lease.duel_id);
    if (latest.status === "RUNNING") {
      const result: JsonObject = {
        schema: "metaengine.compute.duel-lockstep-result.h205f22.v2",
        outcome: "FAILED",
        error: String(error).slice(0, 4000),
        final_tick: latest.current_tick,
        final_checkpoint_sha256: latest.current_checkpoint_sha256,
        canonical: false,
        authority_effect: false,
      };
      try { return await complete(env, lease, workerId, "FAILED", result); } catch {}
    }
    throw error;
  }
}
