import { DurableObject } from "cloudflare:workers";
import { LESSONS, evaluateDecision, looksLikeSecret, responseRequiresReply } from "./guards.mjs";

const AGENT = "chatgpt";
const PEER = "glm";
const ENVELOPE_SCHEMA = "metaengine.agent-message.h205f22.v1";
const DEFAULT_INTERVAL_SECONDS = 60;
const MAX_MESSAGES_PER_CYCLE = 5;
const LOCK_TTL_MS = 120_000;

const DECISION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["decision", "kind", "content", "assertions"],
  properties: {
    decision: { type: "string", enum: ["NO_OP", "PUBLISH_ENVELOPE"] },
    kind: { type: ["string", "null"], enum: ["ATTACK", "ACCEPT", "FIX", "REBUTTAL", "RECHECK", "REVIEW", null] },
    content: { type: "string", maxLength: 20000 },
    assertions: {
      type: "array",
      maxItems: 32,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "topic", "effect", "source_plane", "identity_source", "evidence_state",
          "statement", "basis_ref", "metric_numerator", "metric_denominator"
        ],
        properties: {
          topic: { type: "string", enum: ["PROJECT_AUTHORITY", "EXECUTION_AUTHORITY", "EVIDENCE", "METRIC", "WITNESS_IDENTITY", "OTHER"] },
          effect: { type: "string", enum: ["GRANTS", "DENIES", "DESCRIBES"] },
          source_plane: { type: "string", enum: ["PROJECT_CLAIM", "AOP_RUN", "PAP_TRANSPORT", "NONE"] },
          identity_source: { type: "string", enum: ["SERVER_DERIVED", "CLIENT_ASSERTION", "NONE"] },
          evidence_state: { type: "string", enum: ["PREPARED", "DOCUMENTED", "REPORTED_BY_PEER", "UNKNOWN"] },
          statement: { type: "string", maxLength: 2000 },
          basis_ref: { type: ["string", "null"], maxLength: 500 },
          metric_numerator: { type: ["number", "null"] },
          metric_denominator: { type: ["number", "null"] }
        }
      }
    }
  }
};

const CHARTER = `You are the autonomous ChatGPT coordination worker for METAENGINE H205F22.
You are PREPARED-only. You never grant, infer, or exercise canonical project authority.
Project claim authority, AOP execution leases, and PAP transport identity are separate planes.
A run lease or RUN_FENCED event never by itself grants project claim authority.
Client-provided worker/pool/witness identity is only an assertion; authoritative identity must be server-derived.
Do not claim VERIFIED, LIVE, DURABLE, SAME_WORLD, or percentage metrics unless the supplied context contains independently reproducible evidence and a denominator where applicable. This worker currently has no authority read-barrier, so treat live project-authority claims as unavailable.
Do not output secrets, credentials, private keys, access tokens, or environment values.
For messages that require a response, obey the PAP transition contract exactly:
PROPOSAL -> ATTACK or ACCEPT; ATTACK -> FIX or REBUTTAL; FIX -> RECHECK; REVIEW -> REVIEW.
Return only the structured decision. Do not provide hidden reasoning or chain-of-thought.`;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function nowIso() {
  return new Date().toISOString();
}

function expiresIso(minutes = 30) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

async function sha256Json(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function extractOutputText(response) {
  if (typeof response?.output_text === "string" && response.output_text.length > 0) return response.output_text;
  for (const item of response?.output ?? []) {
    if (item?.type !== "message") continue;
    for (const content of item?.content ?? []) {
      if (content?.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  throw new Error("openai_missing_output_text");
}

function safeLog(event, fields = {}) {
  console.log(JSON.stringify({ event, at: nowIso(), ...fields }));
}

async function postJson(url, token, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`pap_http_${response.status}`);
  return await response.json();
}

async function papRead(env, afterSeq) {
  const url = new URL(`${env.PAP_BASE_URL.replace(/\/$/, "")}/pap/read`);
  url.searchParams.set("peer", PEER);
  url.searchParams.set("after_seq", String(afterSeq));
  const response = await fetch(url, { headers: { authorization: `Bearer ${env.PAP_CHATGPT_TOKEN}` } });
  if (!response.ok) throw new Error(`pap_read_http_${response.status}`);
  return await response.json();
}

async function papPublish(env, envelope) {
  if (envelope.authority_effect !== false || envelope.canonical !== false) throw new Error("law2_violation");
  if (looksLikeSecret(envelope)) throw new Error("secret_scan_failed_before_publish");
  return await postJson(`${env.PAP_BASE_URL.replace(/\/$/, "")}/pap/publish`, env.PAP_CHATGPT_TOKEN, envelope);
}

async function papAck(env, ids) {
  return await postJson(`${env.PAP_BASE_URL.replace(/\/$/, "")}/pap/ack`, env.PAP_CHATGPT_TOKEN, { ids });
}

async function callOpenAI(env, incoming, guardFeedback = []) {
  const contextPack = {
    schema: "metaengine.gpt-coordination-context.h205f22.v1",
    authority_context: "UNAVAILABLE_TO_AUTONOMOUS_WORKER__PREPARED_ONLY",
    incoming_message: incoming,
    lessons: LESSONS,
    previous_guard_feedback: guardFeedback,
    response_contract: {
      PROPOSAL: ["ATTACK", "ACCEPT"],
      ATTACK: ["FIX", "REBUTTAL"],
      FIX: ["RECHECK"],
      REVIEW: ["REVIEW"],
    },
  };

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL,
      store: false,
      instructions: CHARTER,
      input: JSON.stringify(contextPack),
      max_output_tokens: 1400,
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "h205f22_coordination_decision",
          strict: true,
          schema: DECISION_SCHEMA,
        },
      },
    }),
  });

  if (!response.ok) throw new Error(`openai_http_${response.status}`);
  const raw = await response.json();
  const text = extractOutputText(raw);
  if (looksLikeSecret(text)) throw new Error("secret_scan_failed_model_output");
  return JSON.parse(text);
}

function buildEnvelope(incoming, decision) {
  const id = `${AGENT}-${Date.now()}`;
  return {
    schema: ENVELOPE_SCHEMA,
    id,
    from: AGENT,
    to: PEER,
    kind: decision.kind,
    evidence_class: "PREPARED",
    authority_effect: false,
    canonical: false,
    requires_response: responseRequiresReply(decision.kind),
    ts: nowIso(),
    expires_at: expiresIso(30),
    mode: incoming.mode ?? "INTEGRATION",
    thread_id: incoming.thread_id ?? "CROSS-CUTTING",
    in_reply_to: incoming.id,
    content: decision.content,
    assertions: decision.assertions,
    worker: {
      schema: "metaengine.gpt-coordination-worker.h205f22.v1",
      runtime: "CLOUDFLARE_DURABLE_OBJECT",
      evidence_scope: "PREPARED_ONLY",
    },
  };
}

async function buildSelfBlockedReceipt(incoming, blockedBy) {
  return {
    schema: ENVELOPE_SCHEMA,
    id: `${AGENT}-${Date.now()}`,
    from: AGENT,
    to: PEER,
    kind: "REVIEW",
    evidence_class: "PREPARED",
    authority_effect: false,
    canonical: false,
    requires_response: false,
    ts: nowIso(),
    expires_at: expiresIso(30),
    mode: incoming.mode ?? "INTEGRATION",
    thread_id: incoming.thread_id ?? "CROSS-CUTTING",
    in_reply_to: incoming.id,
    content: "SELF_BLOCKED: autonomous generation violated deterministic lesson guards twice; toxic candidate content was discarded. Original PAP item remains unresolved for peer/supervisor review.",
    guard_receipt: {
      schema: "metaengine.agent-guard-receipt.h205f22.v1",
      input_message_id: incoming.id,
      input_sha256: await sha256Json(incoming),
      attempts: 2,
      blocked_by: [...new Set(blockedBy)].sort(),
      disposition: "PEER_REVIEW_REQUIRED",
    },
  };
}

export class GptCoordinationAgent extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
  }

  intervalMs() {
    const seconds = Number(this.env.POLL_INTERVAL_SECONDS ?? DEFAULT_INTERVAL_SECONDS);
    return Math.max(30, Math.min(900, Number.isFinite(seconds) ? seconds : DEFAULT_INTERVAL_SECONDS)) * 1000;
  }

  async ensureScheduled() {
    const alarm = await this.ctx.storage.getAlarm();
    if (alarm === null) await this.ctx.storage.setAlarm(Date.now() + this.intervalMs());
    return { scheduled: true, next_alarm: await this.ctx.storage.getAlarm() };
  }

  async status() {
    return {
      schema: "metaengine.gpt-coordination-worker-status.h205f22.v1",
      agent: AGENT,
      runtime: "CLOUDFLARE_DURABLE_OBJECT",
      evidence_scope: "PREPARED_ONLY",
      cursor: (await this.ctx.storage.get("peer_cursor")) ?? 0,
      last_cycle_at: (await this.ctx.storage.get("last_cycle_at")) ?? null,
      last_success_at: (await this.ctx.storage.get("last_success_at")) ?? null,
      last_error_code: (await this.ctx.storage.get("last_error_code")) ?? null,
      guard_blocks: (await this.ctx.storage.get("guard_blocks")) ?? 0,
      processed_messages: (await this.ctx.storage.get("processed_messages")) ?? 0,
      next_alarm: await this.ctx.storage.getAlarm(),
      durable_state: true,
      project_authority: false,
    };
  }

  async scheduleNext() {
    await this.ctx.storage.setAlarm(Date.now() + this.intervalMs());
  }

  async runOnce(source = "rpc") {
    const now = Date.now();
    const lockUntil = (await this.ctx.storage.get("lock_until")) ?? 0;
    if (lockUntil > now) return { ok: false, busy: true, lock_until: lockUntil };
    await this.ctx.storage.put("lock_until", now + LOCK_TTL_MS);
    await this.ctx.storage.put("last_cycle_at", nowIso());

    try {
      if (!this.env.PAP_CHATGPT_TOKEN) throw new Error("missing_PAP_CHATGPT_TOKEN");
      if (!this.env.OPENAI_API_KEY) throw new Error("missing_OPENAI_API_KEY");
      if (!this.env.OPENAI_MODEL) throw new Error("missing_OPENAI_MODEL");

      let cursor = (await this.ctx.storage.get("peer_cursor")) ?? 0;
      const read = await papRead(this.env, cursor);
      if (read.gap_detected === true) {
        await this.ctx.storage.put("last_error_code", "PAP_GAP_DETECTED");
        safeLog("cycle_blocked_gap", { source, cursor });
        return { ok: false, blocked: "PAP_GAP_DETECTED", cursor };
      }

      const messages = Array.isArray(read.messages) ? read.messages.slice(0, MAX_MESSAGES_PER_CYCLE) : [];
      let processed = 0;
      let published = 0;
      let guardBlocks = 0;

      for (const incoming of messages) {
        const seq = Number(incoming.seq ?? 0);
        if (!incoming.id || !Number.isInteger(seq) || seq <= cursor) continue;

        if (incoming.requires_response !== true) {
          await papAck(this.env, [incoming.id]);
          cursor = seq;
          await this.ctx.storage.put("peer_cursor", cursor);
          processed += 1;
          continue;
        }

        let decision = await callOpenAI(this.env, incoming, []);
        let verdict = evaluateDecision(decision, incoming);
        let allBlockedBy = [...verdict.blockedBy];

        if (!verdict.ok) {
          guardBlocks += 1;
          decision = await callOpenAI(this.env, incoming, verdict.blockedBy);
          verdict = evaluateDecision(decision, incoming);
          allBlockedBy = [...allBlockedBy, ...verdict.blockedBy];
        }

        if (verdict.ok && decision.decision === "PUBLISH_ENVELOPE") {
          const envelope = buildEnvelope(incoming, decision);
          await papPublish(this.env, envelope);
          published += 1;
        } else if (!verdict.ok) {
          const receipt = await buildSelfBlockedReceipt(incoming, allBlockedBy);
          await papPublish(this.env, receipt);
          published += 1;
          guardBlocks += 1;
        }

        await papAck(this.env, [incoming.id]);
        cursor = seq;
        await this.ctx.storage.put("peer_cursor", cursor);
        processed += 1;
      }

      const previousProcessed = (await this.ctx.storage.get("processed_messages")) ?? 0;
      const previousBlocks = (await this.ctx.storage.get("guard_blocks")) ?? 0;
      await this.ctx.storage.put({
        processed_messages: previousProcessed + processed,
        guard_blocks: previousBlocks + guardBlocks,
        last_success_at: nowIso(),
        last_error_code: null,
      });
      safeLog("cycle_complete", { source, processed, published, guard_blocks: guardBlocks, cursor });
      return { ok: true, processed, published, guard_blocks: guardBlocks, cursor };
    } catch (error) {
      const code = error instanceof Error ? error.message : String(error);
      await this.ctx.storage.put("last_error_code", code.slice(0, 200));
      safeLog("cycle_failed", { source, error_code: code.slice(0, 120) });
      return { ok: false, error_code: code.slice(0, 200) };
    } finally {
      await this.ctx.storage.delete("lock_until");
      await this.scheduleNext();
    }
  }

  async alarm() {
    await this.runOnce("alarm");
  }
}

function coordinator(env) {
  return env.GPT_COORDINATOR.getByName("h205f22-chatgpt");
}

function isControlAuthorized(request, env) {
  const auth = request.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ") || !env.WORKER_CONTROL_TOKEN) return false;
  return constantTimeEqual(auth.slice(7), env.WORKER_CONTROL_TOKEN);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const stub = coordinator(env);

    if (request.method === "GET" && url.pathname === "/health") {
      return json(await stub.status());
    }

    if (request.method === "POST" && url.pathname === "/wake") {
      if (!isControlAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
      return json(await stub.runOnce("http"));
    }

    if (request.method === "POST" && url.pathname === "/schedule") {
      if (!isControlAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
      return json(await stub.ensureScheduled());
    }

    return json({ error: "not_found", endpoints: ["GET /health", "POST /wake", "POST /schedule"] }, 404);
  },

  async scheduled(_controller, env, _ctx) {
    const stub = coordinator(env);
    await stub.ensureScheduled();
    await stub.runOnce("cron");
  },
};
