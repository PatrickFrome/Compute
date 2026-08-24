import { createHash } from "node:crypto";
import { hostname } from "node:os";
import { Client, Pool } from "pg";

type JsonObject = Record<string, unknown>;
type Actor = "GPT" | "GLM";
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
type ActorResult = { payload: JsonObject; executorError: boolean };

const SYSTEM = `You are one of two equal adversarial engineering contenders in METAENGINE H205F22 MICROSTEP_LOCKSTEP_V2.
This is active co-development, not chat. Produce exactly ONE observable engineering step per invocation.
Private chain-of-thought is never shared; all peer-relevant engineering rationale must be observable in the JSON step.
Both actors start from the same persisted checkpoint. Explicitly address the peer's immediately previous event hash when one exists.
Do not optimize for agreement. Prefer falsifiable claims, executable patches/tests, concrete counterexamples, or security vetoes.
BUILD/BREAK roles rotate each tick. Never claim canonical authority, VERIFIED, or live evidence absent from the ledger.
Return exactly one JSON object and no markdown.`;

const VOTES = new Set(["WIN_GPT", "WIN_GLM", "SYNTHESIS", "NO_ACTION"]);
const DATABASE_URL = required("DATABASE_URL");
const RUNNER_ID = `sovereign:${process.env.DUEL_RUNNER_ID || hostname()}`;
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
const pool = new Pool({ connectionString: DATABASE_URL, max: 6 });
const inFlight = new Set<string>();

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name}_required`);
  return v;
}

function boundedInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(raw ?? fallback);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.trunc(n))) : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asObj(v: unknown): JsonObject {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("object_required");
  return v as JsonObject;
}

function parseJson(text: string): JsonObject {
  const s = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try { return asObj(JSON.parse(s)); } catch {}
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error(`model_json_missing:${s.slice(0, 240)}`);
  return asObj(JSON.parse(s.slice(a, b + 1)));
}

function endpointHash(url: string): string {
  return createHash("sha256").update(url).digest("hex");
}

function recentPeerHash(read: Readback, actor: Actor): string | null {
  const events = Array.isArray(read.events) ? read.events : [];
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (!e || typeof e !== "object" || Array.isArray(e)) continue;
    if (String(e.actor || "") !== actor && typeof e.event_sha256 === "string") return e.event_sha256;
  }
  return null;
}

function compactHistory(read: Readback): JsonObject {
  const events = (Array.isArray(read.events) ? read.events : []).slice(-24).map((raw) => {
    const e = asObj(raw);
    const p = e.payload && typeof e.payload === "object" && !Array.isArray(e.payload) ? asObj(e.payload) : {};
    return {
      tick_no: e.tick_no ?? null,
      actor: e.actor ?? null,
      step_type: e.step_type ?? null,
      event_sha256: e.event_sha256 ?? null,
      payload_sha256: e.payload_sha256 ?? null,
      parent_checkpoint_sha256: e.parent_checkpoint_sha256 ?? null,
      summary: p.summary ?? null,
      action: p.action ?? null,
      falsifier: p.falsifier ?? null,
      risk_delta: p.risk_delta ?? null,
      terminal_vote: p.terminal_vote ?? null,
      need_canary: p.need_canary ?? null,
    };
  });
  return {
    current_tick: read.current_tick ?? 0,
    current_checkpoint_sha256: read.current_checkpoint_sha256 ?? null,
    events,
  };
}

function prompt(actor: Actor, lease: Lease, read: Readback): string {
  const tick = Number(read.current_tick || 0) + 1;
  const peer = recentPeerHash(read, actor);
  const build = (tick + (actor === "GPT" ? 0 : 1)) % 2 === 0;
  const lens = build
    ? "BUILD: propose the smallest executable improvement and the evidence that would prove it works; still surface blockers."
    : "BREAK: search for a counterexample, race, stale assumption, security failure, or cheaper falsifier; agree only if the design survives attack.";
  return [
    `ACTOR=${actor}`,
    `DUEL=${lease.duel_key || ""}`,
    `NEXT_TICK=${tick}`,
    `SEEN_CHECKPOINT=${String(read.current_checkpoint_sha256 || "")}`,
    `PEER_PREVIOUS_EVENT_HASH=${peer || "NONE"}`,
    `ROLE_LENS=${build ? "BUILD" : "BREAK"}`,
    `LENS_RULE=${lens}`,
    `SUBJECT=${JSON.stringify(lease.subject || {})}`,
    `CAUSAL_HISTORY=${JSON.stringify(compactHistory(read))}`,
    "Return keys: step_type, summary, evidence_used, peer_event_hash_addressed, action, falsifier, risk_delta, ready_to_resolve, terminal_vote, need_canary, resolution.",
    "If PEER_PREVIOUS_EVENT_HASH is not NONE, peer_event_hash_addressed MUST equal it.",
  ].join("\n");
}

async function modelCall(actor: Actor, lease: Lease, text: string): Promise<JsonObject> {
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
          { role: "user", content: text },
        ],
        max_tokens: MAX_OUTPUT_TOKENS,
        temperature: 0.2,
        stream: false,
      }),
    });
    const bodyText = await response.text();
    if (!response.ok) throw new Error(`local_${actor.toLowerCase()}:${response.status}:${bodyText.slice(0, 800)}`);
    const body = asObj(JSON.parse(bodyText));
    const choices = Array.isArray(body.choices) ? body.choices : [];
    const first = choices[0] && typeof choices[0] === "object" && !Array.isArray(choices[0]) ? asObj(choices[0]) : {};
    const message = first.message && typeof first.message === "object" && !Array.isArray(first.message) ? asObj(first.message) : {};
    if (typeof message.content !== "string" || !message.content.trim()) throw new Error(`local_${actor.toLowerCase()}_empty`);
    const payload = parseJson(message.content);
    payload._executor = {
      mode: "SOVEREIGN_OPENAI_COMPAT",
      tariff_dependency: false,
      model,
      endpoint_sha256: endpointHash(base),
      latency_ms: Date.now() - started,
      canonical: false,
      authority_effect: false,
    };
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

function visibleError(actor: Actor, peerHash: string | null, error: unknown): JsonObject {
  return {
    step_type: "EXECUTOR_ERROR",
    summary: `${actor} sovereign inference failed`,
    evidence_used: [],
    peer_event_hash_addressed: peerHash,
    action: { kind: "BLOCKED_EXECUTOR", backend: "SOVEREIGN_OPENAI_COMPAT" },
    falsifier: "A later local invocation succeeds under the same immutable subject",
    risk_delta: "No model reasoning was fabricated; this is a SYSTEM-observed executor failure.",
    ready_to_resolve: false,
    terminal_vote: null,
    need_canary: false,
    resolution: null,
    synthetic: true,
    model_response: false,
    error: String(error).slice(0, 1800),
    canonical: false,
    authority_effect: false,
  };
}

async function actorVisible(actor: Actor, lease: Lease, read: Readback): Promise<ActorResult> {
  const peer = recentPeerHash(read, actor);
  try {
    return { payload: await modelCall(actor, lease, prompt(actor, lease, read)), executorError: false };
  } catch (error) {
    return { payload: visibleError(actor, peer, error), executorError: true };
  }
}

function stepType(p: JsonObject): string {
  const s = typeof p.step_type === "string" ? p.step_type.trim().toUpperCase() : "OBSERVE";
  return /^[A-Z0-9_]{2,48}$/.test(s) ? s : "OBSERVE";
}

function peerAckOk(p: JsonObject, expected: string | null): boolean {
  return !expected || p.peer_event_hash_addressed === expected;
}

function vote(p: JsonObject): string | null {
  return typeof p.terminal_vote === "string" && VOTES.has(p.terminal_vote) ? p.terminal_vote : null;
}

function eventPayload(e: JsonObject | undefined): JsonObject {
  if (!e || !e.payload || typeof e.payload !== "object" || Array.isArray(e.payload)) throw new Error("persisted_event_payload_missing");
  return asObj(e.payload);
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
  const r = await pool.query<{ v: Lease }>(
    "select public.h205f22_duel_lease_target_lockstep_v3($1::uuid,$2::text,$3::integer,$4::bigint) as v",
    [duelId, RUNNER_ID, 3600, 0],
  );
  return r.rows[0]?.v || { leased: false };
}

async function recoveryLease(): Promise<Lease> {
  const r = await pool.query<{ v: Lease }>(
    "select public.h205f22_duel_lease_lockstep_v2($1::text,$2::integer) as v",
    [RUNNER_ID, 3600],
  );
  return r.rows[0]?.v || { leased: false };
}

async function readback(duelId: string): Promise<Readback> {
  const r = await pool.query<{ v: Readback }>(
    "select public.h205f22_duel_read_lockstep_v2($1::uuid,$2::bigint) as v",
    [duelId, 0],
  );
  return r.rows[0]?.v || {};
}

async function submitPair(lease: Lease, tick: number, checkpoint: string, g: JsonObject, l: JsonObject): Promise<PairReceipt> {
  if (!lease.duel_id || lease.lease_generation == null) throw new Error("lease_identity_missing");
  const args = [lease.duel_id, RUNNER_ID, lease.lease_generation, tick, checkpoint, stepType(g), JSON.stringify(g), stepType(l), JSON.stringify(l)];
  const sql = "select public.h205f22_duel_submit_pair_v3($1::uuid,$2::text,$3::bigint,$4::bigint,$5::text,$6::text,$7::jsonb,$8::text,$9::jsonb) as v";
  try {
    const r = await pool.query<{ v: PairReceipt }>(sql, args);
    return r.rows[0]?.v || {};
  } catch (first) {
    await sleep(100);
    const r = await pool.query<{ v: PairReceipt }>(sql, args);
    if (!r.rows[0]?.v) throw first;
    return r.rows[0].v;
  }
}

async function complete(lease: Lease, status: string, result: JsonObject): Promise<void> {
  if (!lease.duel_id || lease.lease_generation == null) throw new Error("lease_identity_missing");
  await pool.query(
    "select public.h205f22_duel_complete_lockstep_v2($1::uuid,$2::text,$3::bigint,$4::text,$5::jsonb)",
    [lease.duel_id, RUNNER_ID, lease.lease_generation, status, JSON.stringify(result)],
  );
}

async function processLease(lease: Lease): Promise<void> {
  if (!lease.leased || !lease.duel_id || lease.lease_generation == null) return;
  if (lease.protocol_version !== "LOCKSTEP_V2") throw new Error("protocol_mismatch");
  if (lease.execution_policy === "HOSTED_ONLY") return;
  let read: Readback = lease.readback && typeof lease.readback === "object" ? lease.readback : await readback(lease.duel_id);
  let checkpoint = String(read.current_checkpoint_sha256 || lease.current_checkpoint_sha256 || "");
  let lastTick = Number(read.current_tick || lease.current_tick || 0);
  const maxTicks = Math.min(Number(lease.max_ticks || 64), 512);

  try {
    for (let tick = lastTick + 1; tick <= maxTicks; tick++) {
      checkpoint = String(read.current_checkpoint_sha256 || checkpoint);
      const gPeer = recentPeerHash(read, "GPT");
      const lPeer = recentPeerHash(read, "GLM");
      const started = Date.now();
      const [g, l] = await Promise.all([actorVisible("GPT", lease, read), actorVisible("GLM", lease, read)]);
      if (!peerAckOk(g.payload, gPeer) || !peerAckOk(l.payload, lPeer)) throw new Error(`peer_hash_ack_failed:${tick}`);
      g.payload._lockstep = { tick_no: tick, pair_inference_ms: Date.now() - started, execution_plane: "SOVEREIGN_PERSISTENT_RUNNER", tariff_dependency: false };
      l.payload._lockstep = { tick_no: tick, pair_inference_ms: Date.now() - started, execution_plane: "SOVEREIGN_PERSISTENT_RUNNER", tariff_dependency: false };

      const receipt = await submitPair(lease, tick, checkpoint, g.payload, l.payload);
      const gp = eventPayload(receipt.gpt_event);
      const lp = eventPayload(receipt.glm_event);
      checkpoint = String(receipt.output_checkpoint_sha256 || checkpoint);
      lastTick = tick;
      read = appendReadback(read, receipt, tick);

      if (g.executorError || l.executorError || gp.model_response === false || lp.model_response === false) {
        await complete(lease, "BLOCKED", {
          schema: "metaengine.compute.duel-sovereign-result.h205f22.v1",
          outcome: "BLOCKED_EXECUTOR",
          inference_backend: "SOVEREIGN_OPENAI_COMPAT",
          tariff_dependency: false,
          final_tick: tick,
          final_checkpoint_sha256: checkpoint,
          gpt_step: gp,
          glm_step: lp,
          canonical: false,
          authority_effect: false,
        });
        return;
      }

      const gv = vote(gp);
      const lv = vote(lp);
      if (gp.ready_to_resolve === true && lp.ready_to_resolve === true && gv && gv === lv) {
        await complete(lease, "RESOLVED", {
          schema: "metaengine.compute.duel-sovereign-result.h205f22.v1",
          outcome: "RESOLVED",
          winner: gv,
          inference_backend: "SOVEREIGN_OPENAI_COMPAT",
          tariff_dependency: false,
          final_tick: tick,
          final_checkpoint_sha256: checkpoint,
          canonical: false,
          authority_effect: false,
        });
        return;
      }

      if (gp.need_canary === true && lp.need_canary === true) {
        await complete(lease, "CANARY_REQUIRED", {
          schema: "metaengine.compute.duel-sovereign-result.h205f22.v1",
          outcome: "CANARY_REQUIRED",
          inference_backend: "SOVEREIGN_OPENAI_COMPAT",
          tariff_dependency: false,
          final_tick: tick,
          final_checkpoint_sha256: checkpoint,
          canonical: false,
          authority_effect: false,
        });
        return;
      }
    }

    await complete(lease, "CANARY_REQUIRED", {
      schema: "metaengine.compute.duel-sovereign-result.h205f22.v1",
      outcome: "CANARY_REQUIRED",
      reason: "MAX_MICROSTEPS",
      inference_backend: "SOVEREIGN_OPENAI_COMPAT",
      tariff_dependency: false,
      final_tick: lastTick,
      final_checkpoint_sha256: checkpoint,
      canonical: false,
      authority_effect: false,
    });
  } catch (error) {
    await complete(lease, "FAILED", {
      schema: "metaengine.compute.duel-sovereign-result.h205f22.v1",
      outcome: "FAILED",
      error: String(error).slice(0, 2400),
      inference_backend: "SOVEREIGN_OPENAI_COMPAT",
      tariff_dependency: false,
      final_tick: lastTick,
      final_checkpoint_sha256: checkpoint,
      canonical: false,
      authority_effect: false,
    });
  }
}

function dispatch(duelId: string): void {
  if (!/^[0-9a-f-]{36}$/i.test(duelId) || inFlight.has(duelId)) return;
  inFlight.add(duelId);
  void targetLease(duelId)
    .then(processLease)
    .catch((error) => console.error("sovereign_target_failed", duelId, String(error)))
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
      client.on("notification", (msg) => {
        if (msg.channel !== "h205f22_duel_ready_v1" || !msg.payload) return;
        try {
          const payload = asObj(JSON.parse(msg.payload));
          if (typeof payload.duel_id === "string") dispatch(payload.duel_id);
        } catch (error) {
          console.error("sovereign_notify_parse_failed", String(error));
        }
      });
      await client.query("listen h205f22_duel_ready_v1");
      console.log(JSON.stringify({ status: "LISTENING", runner_id: RUNNER_ID, tariff_dependency: false }));
      await new Promise<void>((_resolve, reject) => client.once("error", reject));
    } catch (error) {
      console.error("sovereign_listener_error", String(error));
    } finally {
      await client.end().catch(() => undefined);
    }
    await sleep(1_000);
    await reconcile().catch((error) => console.error("sovereign_reconcile_failed", String(error)));
  }
}

async function main(): Promise<void> {
  console.log(JSON.stringify({
    status: "STARTING",
    runner_id: RUNNER_ID,
    gpt_model: GPT_MODEL,
    glm_model: GLM_MODEL,
    gpt_endpoint_sha256: endpointHash(GPT_URL),
    glm_endpoint_sha256: endpointHash(GLM_URL),
    tariff_dependency: false,
  }));
  await reconcile();
  setInterval(() => void reconcile().catch((error) => console.error("sovereign_reconcile_failed", String(error))), RECOVERY_MS).unref();
  await listenForever();
}

void main().catch(async (error) => {
  console.error("sovereign_fatal", String(error));
  await pool.end().catch(() => undefined);
  process.exitCode = 1;
});
