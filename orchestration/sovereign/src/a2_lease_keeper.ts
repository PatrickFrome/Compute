import { createHash, createPrivateKey, createPublicKey, type KeyObject } from "node:crypto";
import { exactModel, INGRESS_VERIFIER_ID, type Agent } from "./a2_protocol.js";

const WORKSPACE_ID = req("A2_WORKSPACE_ID");
const AGENT = req("A2_AGENT").toUpperCase() as Agent;
if (!(["GPT", "GLM"] as string[]).includes(AGENT)) throw new Error("A2_AGENT_invalid");
const RUNTIME_ID = req("A2_RUNTIME_ID");
const EPOCH = integer(req("A2_CAPABILITY_EPOCH"), 1, 1_000_000);
const PROVIDER = process.env.A2_PROVIDER || (AGENT === "GPT" ? "openai" : "z.ai");
const MODEL = process.env.A2_MODEL || exactModel(AGENT);
if (MODEL !== exactModel(AGENT)) throw new Error(`exact_model_required:${exactModel(AGENT)}`);
const INGRESS_URL = req("A2_INGRESS_URL").replace(/\/$/, "");
const INGRESS_TOKEN = process.env.A2_INGRESS_TOKEN || "";
const PRIVATE_PEM_B64 = req("A2_ED25519_PRIVATE_KEY_PEM_B64");
const RENEW_MS = integer(process.env.A2_LEASE_RENEW_MS || "25000", 5000, 60000);
const MICROSTEP_TIMEOUT = integer(process.env.A2_MICROSTEP_TIMEOUT_MS || "15000", 1000, 120000);
let stopped = false;

function req(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name}_required`);
  return value;
}
function integer(value: string, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new Error("integer_invalid");
  return parsed;
}
function sleep(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }
function rawPublic(key: KeyObject): Buffer {
  const der = key.export({ format: "der", type: "spki" }) as Buffer;
  if (der.length < 32) throw new Error("ed25519_spki_invalid");
  return der.subarray(der.length - 32);
}
function headers(): Record<string, string> {
  return { "content-type": "application/json", ...(INGRESS_TOKEN ? { authorization: `Bearer ${INGRESS_TOKEN}` } : {}) };
}
async function peerRpc<T>(fn: string, args: unknown[]): Promise<T> {
  const response = await fetch(`${INGRESS_URL}/v1/a2/rpc`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ fn, args }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`a2_lease_keeper_rpc_${response.status}:${text.slice(0,300)}`);
  return JSON.parse(text).value as T;
}

const privateKey = createPrivateKey(Buffer.from(PRIVATE_PEM_B64, "base64").toString("utf8"));
const publicKey = createPublicKey(privateKey);
const publicRaw = rawPublic(publicKey);
const publicBase64 = publicRaw.toString("base64");
const fingerprint = createHash("sha256").update(publicRaw).digest("hex");
const capabilities = {
  reasoning_summary_stream: AGENT === "GPT",
  tool_calls: true,
  max_emit_rate_hz: 4,
  inbound_queue_depth: 200,
  resume_from_commit_seq: true,
  max_opaque_ms: MICROSTEP_TIMEOUT,
  trusted_ingress: INGRESS_VERIFIER_ID,
  direct_database_access: false,
};

async function renew(): Promise<void> {
  const value = await peerRpc<any>("h205f22_a2_register_peer_session_v1", [
    WORKSPACE_ID,
    AGENT,
    RUNTIME_ID,
    PROVIDER,
    MODEL,
    MODEL,
    capabilities,
    EPOCH,
    publicBase64,
  ]);
  if (String(value.runtime_id) !== RUNTIME_ID || Number(value.capability_epoch) !== EPOCH) {
    throw new Error("a2_lease_keeper_identity_mismatch");
  }
  if (String(value.key_fingerprint_sha256) !== fingerprint) {
    throw new Error("a2_lease_keeper_key_mismatch");
  }
}

async function main(): Promise<void> {
  while (!stopped) {
    await renew();
    await sleep(RENEW_MS);
  }
}

process.on("SIGTERM", () => { stopped = true; });
process.on("SIGINT", () => { stopped = true; });
void main().catch((error) => {
  console.error("a2_lease_keeper_failed", error instanceof Error ? error.message : "internal_error");
  process.exit(1);
});