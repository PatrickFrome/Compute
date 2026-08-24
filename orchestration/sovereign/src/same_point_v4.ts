import { createHash } from "node:crypto";
import { hostname } from "node:os";
import { Client, Pool } from "pg";

type JsonObject = Record<string, unknown>;
type Actor = "GPT" | "GLM";
type Wave = "PROPOSE" | "REBUT";

type Lease = JsonObject & {
  leased?: boolean;
  duel_id?: string;
  duel_key?: string;
  subject?: JsonObject;
  gpt_model?: string;
  glm_model?: string;
  protocol_version?: string;
  current_tick?: number;
  current_checkpoint_sha256?: string;
  max_ticks?: number;
  lease_generation?: number;
  readback?: Readback;
  execution_policy?: string;
  debate_protocol?: string;
};

type Readback = JsonObject & {
  status?: string;
  current_tick?: number;
  current_checkpoint_sha256?: string;
  events?: JsonObject[];
  ticks?: JsonObject[];
};

type PairReceipt = JsonObject & {
  output_checkpoint_sha256?: string;
  gpt_event?: JsonObject;
  glm_event?: JsonObject;
  tick?: JsonObject;
};

type FinalizeReceipt = JsonObject & {
  replayed?: boolean;
  pair?: PairReceipt;
  decision?: JsonObject;
  readback?: Readback;
};

type ActorResult = {
  payload: JsonObject;
  executorError: boolean;
};

const SYSTEM = `You are one of two equal adversarial engineering contenders in METAENGINE H205F22 SAME_POINT_DUEL_V4.
You and the peer develop exactly the same immutable semantic point. This is active co-development, not chat.
There are exactly two waves: PROPOSE then REBUT. Both actors run simultaneously inside each wave.
Private chain-of-thought is never shared. Put every engineering-relevant rationale you want the peer and the ledger to see into the structured public fields: claim, reasoning_summary, evidence_used, assumptions, peer_claims_addressed, counterexample, falsifier, tests_required, and the action object.
Do not optimize for agreement. Prefer falsifiable claims, executable actions, concrete counterexamples, and security vetoes.
The REBUT wave sees both persisted PROPOSE events. Explicitly address the peer PROPOSE event hash.
The system, not either model, deterministically selects exactly one resulting_action after the REBUT pair is atomically persisted.
Never claim canonical authority, VERIFIED, merge authority, or live evidence absent from the ledger.
Return exactly one JSON object and no markdown.`;

const VOTES = new Set(["WIN_GPT", "WIN_GLM", "SYNTHESIS", "NO_ACTION"]);
const DATABASE_URL = required("DATABASE_URL");
const RUNNER_ID = `sovereign:v4:${process.env.DUEL_RUNNER_ID || hostname()}`;
const GPT_URL = process.env.SOVEREIGN_GPT_URL || "http://127.0.0.1:8001";
const GLM_URL = process.env.SOVEREIGN_GLM_URL || "http://127.0.0.1:8002";
const GPT_MODEL = process.env.SOVEREIGN_GPT_MODEL || "openai/gpt-oss-20b";
const GLM_MODEL = process.env.SOVEREIGN_GLM_MODEL || "zai-org/GLM-4.7-Flash";
const COMMON_TOKEN = process.env.SOVEREIGN_INFERENCE_TOKEN || "";
const GPT_TOKEN = process.env.SOVEREIGN_GPT_TOKEN || COMMON_TOKEN;
const GLM_TOKEN = process.env.SOVEREIGN_GLM_TOKEN || COMMON_TOKEN;
const MODEL_TIMEOUT_MS = boundedInt(process.env.DUEL_MODEL_TIMEOUT_MS, 90_000, 5_000, 300_000);
const MAX_OUTPUT_TOKENS = boundedInt(process.env.DUEL_MAX_OUTPUT_TOKENS, 1_200, 256, 4_096);
const RECOVERY_MS = boundedInt(process.env.DUEL_RECOVERY_MS, 60_000, 5_000, 600_000);
const CHANNEL = "h205f22_same_point_v4_ready";
const pool = new Pool({ connectionString: DATABASE_URL, max: 6 });
const inFlight = new Set<string>();

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name}_required`);
  return value;
}

function boundedInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(raw ?? fallback);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.trunc(n))) : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asObj(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("object_required");
  return value as JsonObject;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function parseJson(text: string): JsonObject {
  const stripped = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    return asObj(JSON.parse(stripped));
  } catch {}
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error(`model_json_missing:${stripped.slice(0, 240)}`);
  return asObj(JSON.parse(stripped.slice(start, end + 1)));
}

function peerActor(actor: Actor): Actor {
  return actor === "GPT" ? "GLM" : "GPT";
}

function recentPeerHash(read: Readback, actor: Actor): string | null {
  const peer = peerActor(actor);
  const events = Array.isArray(read.events) ? read.events : [];
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (!event || typeof event !== "object" || Array.isArray(event)) continue;
    if (String(event.actor || "") === peer && typeof event.event_sha256 === "string") return event.event_sha256;
  }
  return null;
}

function visibleEvent(event: JsonObject): JsonObject {
  const payload = event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
    ? asObj(event.payload)
    : {};
  return {
    tick_no: event.tick_no ?? null,
    actor: event.actor ?? null,
    event_sha256: event.event_sha256 ?? null,
    payload_sha256: event.payload_sha256 ?? null,
    parent_checkpoint_sha256: event.parent_checkpoint_sha256 ?? null,
    phase: payload.phase ?? null,
    step_type: payload.step_type ?? event.step_type ?? null,
    claim: payload.claim ?? null,
    reasoning_summary: payload.reasoning_summary ?? [],
    evidence_used: payload.evidence_used ?? [],
    assumptions: payload.assumptions ?? [],
    peer_claims_addressed: payload.peer_claims_addressed ?? [],
    counterexample: payload.counterexample ?? null,
    falsifier: payload.falsifier ?? null,
    proposed_action: payload.proposed_action ?? null,
    resulting_action: payload.resulting_action ?? null,
    tests_required: payload.tests_required ?? [],
    need_canary: payload.need_canary ?? false,
    terminal_vote: payload.terminal_vote ?? null,
  };
}

function causalView(read: Readback): JsonObject {
  const events = (Array.isArray(read.events) ? read.events : [])
    .filter((event) => event && typeof event === "object" && !Array.isArray(event))
    .map((event) => visibleEvent(event as JsonObject));
  return {
    current_tick: read.current_tick ?? 0,
    current_checkpoint_sha256: read.current_checkpoint_sha256 ?? null,
    observable_reasoning_events: events,
  };
}

function phaseFor(read: Readback): Wave {
  const tick = Number(read.current_tick || 0);
  if (tick === 0) return "PROPOSE";
  if (tick === 1) return "REBUT";
  throw new Error(`v4_invalid_tick:${tick}`);
}

function prompt(actor: Actor, lease: Lease, read: Readback, wave: Wave): string {
  const peerHash = recentPeerHash(read, actor);
  const base = [
    `ACTOR=${actor}`,
    `WAVE=${wave}`,
    `DUEL=${lease.duel_key || ""}`,
    `SEMANTIC_POINT_CHECKPOINT=${String(lease.current_checkpoint_sha256 || "")}`,
    `BASE_SHA=${String(lease.base_github_sha || "")}`,
    `SUBJECT=${JSON.stringify(lease.subject || {})}`,
    `CAUSAL_VIEW=${JSON.stringify(causalView(read))}`,
  ];

  if (wave === "PROPOSE") {
    base.push(
      "You do not see the peer's current PROPOSE because both proposals are generated simultaneously.",
      "Independently propose the best next engineering action for exactly this semantic point.",
      "Return keys: phase, step_type, claim, reasoning_summary, evidence_used, assumptions, peer_claims_addressed, counterexample, falsifier, proposed_action, tests_required, peer_event_hash_addressed, need_canary, terminal_vote.",
      "phase MUST be PROPOSE. proposed_action MUST be one JSON object with a non-empty kind. peer_event_hash_addressed MUST be null. terminal_vote MUST be null."
    );
  } else {
    base.push(
      `PEER_PROPOSE_EVENT_HASH=${peerHash || "NONE"}`,
      "You now see both persisted PROPOSE events in CAUSAL_VIEW. Directly attack or defend the peer proposal using observable engineering reasoning.",
      "Choose your preferred final action after the dispute. You may refine your own proposal.",
      "Return keys: phase, step_type, claim, reasoning_summary, evidence_used, assumptions, peer_claims_addressed, counterexample, falsifier, resulting_action, tests_required, peer_event_hash_addressed, need_canary, terminal_vote.",
      "phase MUST be REBUT. resulting_action MUST be one JSON object with a non-empty kind.",
      "peer_event_hash_addressed MUST equal PEER_PROPOSE_EVENT_HASH.",
      "terminal_vote MUST be one of WIN_GPT, WIN_GLM, SYNTHESIS, NO_ACTION."
    );
  }
  return base.join("\n");
}

function ensureString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name}_required`);
  return value.trim();
}

function ensureArray(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${name}_array_required`);
  return value;
}

function ensureAction(value: unknown, name: string): JsonObject {
  const action = asObj(value);
  ensureString(action.kind, `${name}.kind`);
  return action;
}

function validateModelPayload(payload: JsonObject, wave: Wave, expectedPeerHash: string | null): JsonObject {
  if (payload.phase !== wave) throw new Error(`phase_mismatch:${String(payload.phase)}:${wave}`);
  ensureString(payload.step_type, "step_type");
  ensureString(payload.claim, "claim");
  ensureArray(payload.reasoning_summary, "reasoning_summary");
  ensureArray(payload.evidence_used, "evidence_used");
  ensureArray(payload.assumptions, "assumptions");
  ensureArray(payload.peer_claims_addressed, "peer_claims_addressed");
  ensureString(payload.falsifier, "falsifier");
  ensureArray(payload.tests_required, "tests_required");

  if (wave === "PROPOSE") {
    ensureAction(payload.proposed_action, "proposed_action");
    if (payload.peer_event_hash_addressed !== null && payload.peer_event_hash_addressed !== undefined) {
      throw new Error("propose_peer_hash_must_be_null");
    }
    payload.peer_event_hash_addressed = null;
    payload.terminal_vote = null;
  } else {
    ensureAction(payload.resulting_action, "resulting_action");
    if (!expectedPeerHash || payload.peer_event_hash_addressed !== expectedPeerHash) {
      throw new Error("rebut_peer_hash_mismatch");
    }
    if (typeof payload.terminal_vote !== "string" || !VOTES.has(payload.terminal_vote)) {
      throw new Error("rebut_terminal_vote_invalid");
    }
  }

  payload.need_canary = payload.need_canary === true;
  payload.model_response = true;
  payload.canonical = false;
  payload.authority_effect = false;
  return payload;
}

function visibleError(actor: Actor, wave: Wave, peerHash: string | null, error: unknown): JsonObject {
  const common: JsonObject = {
    phase: wave,
    step_type: "EXECUTOR_ERROR",
    claim: `${actor} ${wave} execution did not produce a valid public engineering step`,
    reasoning_summary: ["No model reasoning was fabricated; this is a SYSTEM-observed executor or schema failure."],
    evidence_used: [],
    assumptions: [],
    peer_claims_addressed: [],
    counterexample: null,
    falsifier: "A later invocation succeeds under the same immutable semantic point",
    tests_required: [],
    peer_event_hash_addressed: wave === "REBUT" ? peerHash : null,
    need_canary: false,
    terminal_vote: wave === "REBUT" ? "NO_ACTION" : null,
    synthetic: true,
    model_response: false,
    error: String(error).slice(0, 1800),
    canonical: false,
    authority_effect: false,
  };
  if (wave === "PROPOSE") common.proposed_action = { kind: "NO_ACTION", reason: "EXECUTOR_ERROR" };
  else common.resulting_action = { kind: "NO_ACTION", reason: "EXECUTOR_ERROR" };
  return common;
}

async function modelCall(actor: Actor, lease: Lease, read: Readback, wave: Wave): Promise<JsonObject> {
  const base = actor === "GPT" ? GPT_URL : GLM_URL;
  const model = actor === "GPT" ? (lease.gpt_model || GPT_MODEL) : (lease.glm_model || GLM_MODEL);
  const token = actor === "GPT" ? GPT_TOKEN : GLM_TOKEN;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("model_timeout"), MODEL_TIMEOUT_MS);
  const started = Date.now();
  try {
    const response = await fetch(`${base.replace(/\/$/, "")}/v1/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: prompt(actor, lease, read, wave) },
        ],
        max_tokens: MAX_OUTPUT_TOKENS,
        temperature: 0.2,
        stream: false,
      }),
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(`local_${actor.toLowerCase()}:${response.status}:${raw.slice(0, 800)}`);
    const body = asObj(JSON.parse(raw));
    const choices = Array.isArray(body.choices) ? body.choices : [];
    const first = choices[0] && typeof choices[0] === "object" && !Array.isArray(choices[0]) ? asObj(choices[0]) : {};
    const message = first.message && typeof first.message === "object" && !Array.isArray(first.message) ? asObj(first.message) : {};
    if (typeof message.content !== "string" || !message.content.trim()) throw new Error(`local_${actor.toLowerCase()}_empty`);
    const peerHash = wave === "REBUT" ? recentPeerHash(read, actor) : null;
    const payload = validateModelPayload(parseJson(message.content), wave, peerHash);
    payload._executor = {
      mode: "SOVEREIGN_SAME_POINT_V4",
      wave,
      tariff_dependency: false,
      model,
      endpoint_sha256: sha256(base),
      latency_ms: Date.now() - started,
      canonical: false,
      authority_effect: false,
    };
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

async function actorVisible(actor: Actor, lease: Lease, read: Readback, wave: Wave): Promise<ActorResult> {
  const peerHash = wave === "REBUT" ? recentPeerHash(read, actor) : null;
  try {
    return { payload: await modelCall(actor, lease, read, wave), executorError: false };
  } catch (error) {
    return { payload: visibleError(actor, wave, peerHash, error), executorError: true };
  }
}

function stepType(payload: JsonObject): string {
  const raw = typeof payload.step_type === "string" ? payload.step_type.trim().toUpperCase() : "OBSERVE";
  return /^[A-Z0-9_]{2,48}$/.test(raw) ? raw : "OBSERVE";
}

function eventPayload(event: JsonObject | undefined): JsonObject {
  if (!event || !event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) {
    throw new Error("persisted_event_payload_missing");
  }
  return asObj(event.payload);
}

function appendReadback(read: Readback, receipt: PairReceipt, tick: number): Readback {
  if (!receipt.gpt_event || !receipt.glm_event || !receipt.tick) throw new Error("persisted_pair_readback_missing");
  return {
    ...read,
    status: "RUNNING",
    current_tick: tick,
    current_checkpoint_sha256: receipt.output_checkpoint_sha256,
    events: [...(Array.isArray(read.events) ? read.events : []), receipt.gpt_event, receipt.glm_event].slice(-128),
    ticks: [...(Array.isArray(read.ticks) ? read.ticks : []), receipt.tick].slice(-64),
  };
}

async function targetLease(duelId: string): Promise<Lease> {
  const result = await pool.query<{ v: Lease }>(
    "select public.h205f22_duel_lease_target_lockstep_v3($1::uuid,$2::text,$3::integer,$4::bigint) as v",
    [duelId, RUNNER_ID, 3600, 0],
  );
  return result.rows[0]?.v || { leased: false };
}

async function recoveryLease(): Promise<Lease> {
  const result = await pool.query<{ v: Lease }>(
    "select public.h205f22_duel_lease_lockstep_v2($1::text,$2::integer) as v",
    [RUNNER_ID, 3600],
  );
  return result.rows[0]?.v || { leased: false };
}

async function submitProposal(lease: Lease, checkpoint: string, gpt: JsonObject, glm: JsonObject): Promise<PairReceipt> {
  if (!lease.duel_id || lease.lease_generation == null) throw new Error("lease_identity_missing");
  const result = await pool.query<{ v: PairReceipt }>(
    "select public.h205f22_duel_submit_pair_v3($1::uuid,$2::text,$3::bigint,1,$4::text,$5::text,$6::jsonb,$7::text,$8::jsonb) as v",
    [
      lease.duel_id,
      RUNNER_ID,
      lease.lease_generation,
      checkpoint,
      stepType(gpt),
      JSON.stringify(gpt),
      stepType(glm),
      JSON.stringify(glm),
    ],
  );
  if (!result.rows[0]?.v) throw new Error("proposal_pair_receipt_missing");
  return result.rows[0].v;
}

async function submitRebutAndFinalize(
  lease: Lease,
  checkpoint: string,
  gpt: JsonObject,
  glm: JsonObject,
): Promise<FinalizeReceipt> {
  if (!lease.duel_id || lease.lease_generation == null) throw new Error("lease_identity_missing");
  const result = await pool.query<{ v: FinalizeReceipt }>(
    "select public.h205f22_duel_submit_rebut_finalize_v4($1::uuid,$2::text,$3::bigint,$4::text,$5::text,$6::jsonb,$7::text,$8::jsonb) as v",
    [
      lease.duel_id,
      RUNNER_ID,
      lease.lease_generation,
      checkpoint,
      stepType(gpt),
      JSON.stringify(gpt),
      stepType(glm),
      JSON.stringify(glm),
    ],
  );
  if (!result.rows[0]?.v) throw new Error("rebut_finalize_receipt_missing");
  return result.rows[0].v;
}

function assertV4Lease(lease: Lease): void {
  const subject = lease.subject && typeof lease.subject === "object" && !Array.isArray(lease.subject) ? lease.subject : {};
  const protocol = lease.debate_protocol || subject.debate_protocol;
  if (protocol !== "SAME_POINT_DUEL_V4") throw new Error(`wrong_debate_protocol:${String(protocol)}`);
  if (lease.protocol_version !== "LOCKSTEP_V2") throw new Error("wrong_low_level_protocol");
  if (Number(lease.max_ticks || 0) !== 2) throw new Error("v4_must_have_two_ticks");
  if (lease.execution_policy === "HOSTED_ONLY") throw new Error("v4_hosted_only_not_supported");
}

async function processLease(lease: Lease): Promise<void> {
  if (!lease.leased || !lease.duel_id || lease.lease_generation == null) return;
  assertV4Lease(lease);

  let read: Readback = lease.readback && typeof lease.readback === "object" && !Array.isArray(lease.readback)
    ? lease.readback
    : {};
  let checkpoint = String(read.current_checkpoint_sha256 || lease.current_checkpoint_sha256 || "");
  let tick = Number(read.current_tick || lease.current_tick || 0);

  if (tick === 0) {
    const wave: Wave = "PROPOSE";
    const started = Date.now();
    const [gpt, glm] = await Promise.all([
      actorVisible("GPT", lease, read, wave),
      actorVisible("GLM", lease, read, wave),
    ]);
    gpt.payload._lockstep = {
      debate_protocol: "SAME_POINT_DUEL_V4",
      wave,
      pair_inference_ms: Date.now() - started,
      execution_plane: "SOVEREIGN_V4_PERSISTENT",
      tariff_dependency: false,
    };
    glm.payload._lockstep = {
      debate_protocol: "SAME_POINT_DUEL_V4",
      wave,
      pair_inference_ms: Date.now() - started,
      execution_plane: "SOVEREIGN_V4_PERSISTENT",
      tariff_dependency: false,
    };
    const receipt = await submitProposal(lease, checkpoint, gpt.payload, glm.payload);
    checkpoint = String(receipt.output_checkpoint_sha256 || checkpoint);
    read = appendReadback(read, receipt, 1);
    tick = 1;
  }

  if (tick === 1) {
    const wave: Wave = "REBUT";
    const started = Date.now();
    const [gpt, glm] = await Promise.all([
      actorVisible("GPT", lease, read, wave),
      actorVisible("GLM", lease, read, wave),
    ]);
    gpt.payload._lockstep = {
      debate_protocol: "SAME_POINT_DUEL_V4",
      wave,
      pair_inference_ms: Date.now() - started,
      execution_plane: "SOVEREIGN_V4_PERSISTENT",
      tariff_dependency: false,
    };
    glm.payload._lockstep = {
      debate_protocol: "SAME_POINT_DUEL_V4",
      wave,
      pair_inference_ms: Date.now() - started,
      execution_plane: "SOVEREIGN_V4_PERSISTENT",
      tariff_dependency: false,
    };

    const receipt = await submitRebutAndFinalize(lease, checkpoint, gpt.payload, glm.payload);
    const decision = receipt.decision && typeof receipt.decision === "object" && !Array.isArray(receipt.decision)
      ? receipt.decision
      : null;
    console.log(JSON.stringify({
      status: "SAME_POINT_DECIDED",
      duel_id: lease.duel_id,
      duel_key: lease.duel_key,
      decision,
      replayed: receipt.replayed === true,
      canonical: false,
      authority_effect: false,
    }));
    return;
  }

  if (tick >= 2) {
    console.log(JSON.stringify({
      status: "SAME_POINT_ALREADY_ADVANCED",
      duel_id: lease.duel_id,
      current_tick: tick,
      canonical: false,
      authority_effect: false,
    }));
  }
}

function dispatch(duelId: string): void {
  if (!/^[0-9a-f-]{36}$/i.test(duelId) || inFlight.has(duelId)) return;
  inFlight.add(duelId);
  void targetLease(duelId)
    .then(processLease)
    .catch((error) => console.error("same_point_v4_target_failed", duelId, String(error)))
    .finally(() => inFlight.delete(duelId));
}

async function reconcile(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    const lease = await recoveryLease();
    if (!lease.leased) return;
    await processLease(lease);
  }
}

async function listenForever(): Promise<void> {
  for (;;) {
    const client = new Client({ connectionString: DATABASE_URL });
    try {
      await client.connect();
      client.on("notification", (message) => {
        if (message.channel !== CHANNEL || !message.payload) return;
        try {
          const payload = asObj(JSON.parse(message.payload));
          if (payload.debate_protocol !== "SAME_POINT_DUEL_V4") return;
          if (typeof payload.duel_id === "string") dispatch(payload.duel_id);
        } catch (error) {
          console.error("same_point_v4_notify_parse_failed", String(error));
        }
      });
      await client.query(`listen ${CHANNEL}`);
      console.log(JSON.stringify({
        status: "LISTENING",
        runner_id: RUNNER_ID,
        channel: CHANNEL,
        debate_protocol: "SAME_POINT_DUEL_V4",
        wave_plan: ["PROPOSE", "REBUT"],
        reasoning_visibility: "OBSERVABLE_ENGINEERING_REASONING_V1",
        arbitration_policy: "EVIDENCE_FIRST_ONE_ACTION_V1",
        tariff_dependency: false,
      }));
      await new Promise<void>((_resolve, reject) => client.once("error", reject));
    } catch (error) {
      console.error("same_point_v4_listener_error", String(error));
    } finally {
      await client.end().catch(() => undefined);
    }
    await sleep(1_000);
    await reconcile().catch((error) => console.error("same_point_v4_reconcile_failed", String(error)));
  }
}

async function main(): Promise<void> {
  console.log(JSON.stringify({
    status: "STARTING",
    runner_id: RUNNER_ID,
    debate_protocol: "SAME_POINT_DUEL_V4",
    gpt_model: GPT_MODEL,
    glm_model: GLM_MODEL,
    gpt_endpoint_sha256: sha256(GPT_URL),
    glm_endpoint_sha256: sha256(GLM_URL),
    tariff_dependency: false,
  }));
  await reconcile();
  setInterval(() => void reconcile().catch((error) => console.error("same_point_v4_reconcile_failed", String(error))), RECOVERY_MS).unref();
  await listenForever();
}

void main().catch(async (error) => {
  console.error("same_point_v4_fatal", String(error));
  await pool.end().catch(() => undefined);
  process.exitCode = 1;
});
