import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";

import {
  exactModel,
  INGRESS_VERIFIER_ID,
  verifyEd25519RawPublicKey,
  type Agent,
} from "./a2_protocol.js";

type Json = Record<string, unknown>;
type RpcEnvelope<T> = { value: T };
type SubmitResult = { ok: boolean; status: number; text: string };

const INGRESS_URL = required("A2_INGRESS_URL").replace(/\/$/, "");
const INGRESS_TOKEN = process.env.A2_INGRESS_TOKEN || "";
const WORKSPACE_ID = required("A2_WORKSPACE_ID");
const AGENT = (process.env.A2_CANARY_AGENT || "GPT").toUpperCase() as Agent;
if (AGENT !== "GPT" && AGENT !== "GLM") throw new Error("A2_CANARY_AGENT_invalid");
const MODEL = exactModel(AGENT);
const RUNTIME_ID = `a2-http-ed25519-canary-${AGENT.toLowerCase()}-${Date.now()}`;
const EPOCH = Number(process.env.A2_CANARY_CAPABILITY_EPOCH || Date.now());
let sessionId = "";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name}_required`);
  return value;
}

function headers(): Record<string, string> {
  const result: Record<string, string> = { "content-type": "application/json" };
  if (INGRESS_TOKEN) result.authorization = `Bearer ${INGRESS_TOKEN}`;
  return result;
}

function rawPublic(key: ReturnType<typeof generateKeyPairSync>["publicKey"]): Buffer {
  const der = key.export({ format: "der", type: "spki" }) as Buffer;
  if (der.length < 32) throw new Error("ed25519_spki_invalid");
  return der.subarray(-32);
}

async function peerRpc<T>(fn: string, args: unknown[]): Promise<T> {
  const response = await fetch(`${INGRESS_URL}/v1/a2/rpc`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ fn, args }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`a2_peer_rpc_${response.status}`);
  return (JSON.parse(text) as RpcEnvelope<T>).value;
}

async function submit(body: Json): Promise<SubmitResult> {
  const response = await fetch(`${INGRESS_URL}/v1/a2/emit`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  return { ok: response.ok, status: response.status, text: await response.text() };
}

function providerFor(agent: Agent): string {
  return agent === "GPT" ? "openai" : "z.ai";
}

function assertNegative(result: SubmitResult): void {
  if (result.ok || !result.text.includes("a2_ingress_ed25519_invalid")) {
    throw new Error(`a2_canary_tampered_signature_not_rejected:${result.status}`);
  }
}

async function closeSession(): Promise<void> {
  if (!sessionId) return;
  try {
    await peerRpc("h205f22_a2_close_peer_session_v1", [sessionId]);
  } catch {
    console.error("a2_canary_session_close_failed");
  }
}

async function runCanary(): Promise<void> {
  const snapshot = await peerRpc<any>("h205f22_a2_read_snapshot_v1", [WORKSPACE_ID, 1]);
  const workspace = snapshot?.workspace;
  if (!workspace) throw new Error("a2_canary_workspace_not_found");
  if (workspace.mode !== "COLLABORATE") throw new Error("a2_canary_workspace_not_collaborating");
  const beforeHead = Number(snapshot.head_commit_seq || 0);
  const semanticPoint = typeof workspace.semantic_point === "string" ? workspace.semantic_point : "";
  if (!semanticPoint) throw new Error("a2_canary_semantic_point_missing");

  const keypair = generateKeyPairSync("ed25519");
  const publicRaw = rawPublic(keypair.publicKey);
  const publicBase64 = publicRaw.toString("base64");
  const fingerprint = createHash("sha256").update(publicRaw).digest("hex");
  const provider = providerFor(AGENT);
  const capabilities = {
    canary_only: true,
    http_ingress_only: true,
    direct_database_access: false,
    trusted_ingress: INGRESS_VERIFIER_ID,
  };
  const registered = await peerRpc<any>("h205f22_a2_register_peer_session_v1", [
    WORKSPACE_ID,
    AGENT,
    RUNTIME_ID,
    provider,
    MODEL,
    MODEL,
    capabilities,
    EPOCH,
    publicBase64,
  ]);
  sessionId = typeof registered?.session_id === "string" ? registered.session_id : "";
  if (!sessionId) throw new Error("a2_canary_session_registration_failed");

  const next = await peerRpc<any>("h205f22_a2_next_agent_seq_v1", [sessionId]);
  const agentSeq = Number(next.next_agent_seq);
  const eventId = randomUUID();
  const payload = {
    state: "A2_HTTP_ED25519_INGRESS_CANARY",
    canary_only: true,
    negative_then_positive: true,
  };
  const provenance = {
    provider,
    requested_model: MODEL,
    reported_model: MODEL,
    runtime_id: RUNTIME_ID,
    capability_epoch: EPOCH,
    canary_only: true,
  };
  const prepared = await peerRpc<any>("h205f22_a2_prepare_event_v1", [
    eventId,
    sessionId,
    agentSeq,
    semanticPoint,
    "CHECKPOINT",
    0,
    [],
    payload,
    null,
    provenance,
  ]);
  const eventHash = typeof prepared?.event_hash === "string" ? prepared.event_hash : "";
  if (!/^[0-9a-f]{64}$/.test(eventHash)) throw new Error("a2_canary_event_hash_invalid");
  const signature = sign(null, Buffer.from(eventHash, "hex"), keypair.privateKey).toString("base64");
  if (!verifyEd25519RawPublicKey(publicBase64, eventHash, signature)) {
    throw new Error("a2_canary_local_signature_verify_failed");
  }

  const baseBody = {
    event_id: eventId,
    session_id: sessionId,
    agent_seq: agentSeq,
    semantic_point: semanticPoint,
    event_type: "CHECKPOINT",
    priority: 0,
    parent_hashes: [],
    payload,
    visibility_proof_id: null,
    model_provenance: provenance,
    event_hash: eventHash,
    signature_key_fingerprint_sha256: fingerprint,
  };
  const tampered = Buffer.from(signature, "base64");
  tampered[0] ^= 1;
  assertNegative(await submit({ ...baseBody, signature_base64: tampered.toString("base64") }));

  const afterNegative = await peerRpc<any>("h205f22_a2_read_events_v1", [WORKSPACE_ID, beforeHead, 100]);
  if ((afterNegative.events || []).some((event: any) => event.event_id === eventId)) {
    throw new Error("a2_canary_tampered_signature_persisted");
  }

  const positive = await submit({ ...baseBody, signature_base64: signature });
  if (!positive.ok) throw new Error(`a2_canary_valid_signature_rejected:${positive.status}`);
  const emitted = JSON.parse(positive.text);
  if (emitted.ingress_verification !== INGRESS_VERIFIER_ID || emitted.signature_bound !== true) {
    throw new Error("a2_canary_ingress_receipt_missing_or_unbound");
  }
  const afterPositive = await peerRpc<any>("h205f22_a2_read_events_v1", [WORKSPACE_ID, beforeHead, 100]);
  const persisted = (afterPositive.events || []).find((event: any) => event.event_id === eventId);
  if (!persisted) throw new Error("a2_canary_valid_event_not_persisted");
  const persistedSignature = typeof persisted.signature_base64 === "string" ? persisted.signature_base64 : "";
  const persistedHash = typeof persisted.event_hash === "string" ? persisted.event_hash : "";
  if (persistedSignature !== signature || !verifyEd25519RawPublicKey(publicBase64, persistedHash, persistedSignature)) {
    throw new Error("a2_canary_persisted_ed25519_verify_failed");
  }
  if (persisted.canonical !== undefined && persisted.canonical !== false) throw new Error("a2_canary_canonical_violation");
  if (persisted.authority_effect !== undefined && persisted.authority_effect !== false) throw new Error("a2_canary_authority_violation");

  console.log(JSON.stringify({
    schema: "metaengine.compute.a2-http-ed25519-canary.v1",
    workspace_id: WORKSPACE_ID,
    agent: AGENT,
    event_id: eventId,
    event_hash: eventHash,
    commit_seq: persisted.commit_seq,
    ingress_receipt_id: emitted.ingress_receipt_id,
    negative_rejected: true,
    positive_persisted: true,
    persisted_ed25519_verified: true,
    canonical: false,
    authority_effect: false,
  }, null, 2));
}

try {
  await runCanary();
} catch {
  console.error("a2_ingress_canary_failed");
  process.exitCode = 1;
} finally {
  await closeSession();
}
