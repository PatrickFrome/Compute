/**
 * Sovereign two-actor inference policy.
 *
 * Both active actors are OpenAI/ChatGPT agents with independent endpoint,
 * model, token and context identities. Historical V4 database RPCs still use
 * slot names GPT/GLM; those names are compatibility storage coordinates only
 * and MUST NOT select a provider or a GLM model.
 */
export type SovereignActor = "ACTOR_A" | "ACTOR_B";
export type LegacyDbActorSlot = "GPT" | "GLM";

export const SOVEREIGN_ACTIVE_PROVIDER = "OPENAI";
export const SOVEREIGN_ACTIVE_PLATFORM = "CHATGPT";
export const SOVEREIGN_TRANSPORT = "OPENAI_COMPAT_ENDPOINT";
export const DEFAULT_OPENAI_MODEL = "openai/gpt-oss-20b";

function normalizeEndpoint(value: string, fallback: string): string {
  const raw = String(value || fallback).trim();
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("sovereign_actor_endpoint_invalid"); }
  if (!["http:","https:"].includes(url.protocol)) throw new Error("sovereign_actor_endpoint_invalid");
  return raw.replace(/\/$/, "");
}

export function normalizeSovereignOpenAiModel(value?: string | null): string {
  const raw = String(value || DEFAULT_OPENAI_MODEL).trim();
  const id = raw.replace(/^openai\//i, "");
  if (!/^gpt-[a-z0-9._-]+$/i.test(id)) throw new Error("sovereign_openai_model_required");
  return `openai/${id}`;
}

const COMMON_TOKEN = process.env.SOVEREIGN_INFERENCE_TOKEN || "";
const COMMON_MODEL = normalizeSovereignOpenAiModel(process.env.SOVEREIGN_OPENAI_MODEL || DEFAULT_OPENAI_MODEL);

const CONFIG = Object.freeze({
  ACTOR_A: Object.freeze({
    actor: "ACTOR_A" as const,
    provider: SOVEREIGN_ACTIVE_PROVIDER,
    platform: SOVEREIGN_ACTIVE_PLATFORM,
    transport: SOVEREIGN_TRANSPORT,
    base: normalizeEndpoint(process.env.SOVEREIGN_ACTOR_A_URL || "", "http://127.0.0.1:8001"),
    model: normalizeSovereignOpenAiModel(process.env.SOVEREIGN_ACTOR_A_MODEL || COMMON_MODEL),
    token: process.env.SOVEREIGN_ACTOR_A_TOKEN || COMMON_TOKEN,
    legacy_db_slot: "GPT" as const,
  }),
  ACTOR_B: Object.freeze({
    actor: "ACTOR_B" as const,
    provider: SOVEREIGN_ACTIVE_PROVIDER,
    platform: SOVEREIGN_ACTIVE_PLATFORM,
    transport: SOVEREIGN_TRANSPORT,
    base: normalizeEndpoint(process.env.SOVEREIGN_ACTOR_B_URL || "", "http://127.0.0.1:8002"),
    model: normalizeSovereignOpenAiModel(process.env.SOVEREIGN_ACTOR_B_MODEL || COMMON_MODEL),
    token: process.env.SOVEREIGN_ACTOR_B_TOKEN || COMMON_TOKEN,
    legacy_db_slot: "GLM" as const,
  }),
});

export function actorConfig(actor: SovereignActor) {
  return CONFIG[actor];
}

export function peerActor(actor: SovereignActor): SovereignActor {
  return actor === "ACTOR_A" ? "ACTOR_B" : "ACTOR_A";
}

export function legacyDbSlot(actor: SovereignActor): LegacyDbActorSlot {
  return CONFIG[actor].legacy_db_slot;
}

export function actorForLegacyDbSlot(slot: string): SovereignActor | null {
  const normalized=String(slot || "").trim().toUpperCase();
  if (normalized==="GPT") return "ACTOR_A";
  if (normalized==="GLM") return "ACTOR_B";
  return null;
}

export function actorModelFromLegacyLease(actor: SovereignActor, lease: { gpt_model?: unknown; glm_model?: unknown } = {}): string {
  const raw = actor === "ACTOR_A" ? lease.gpt_model : lease.glm_model;
  return normalizeSovereignOpenAiModel(typeof raw === "string" && raw.trim() ? raw : actorConfig(actor).model);
}

export function sovereignActorPolicySnapshot() {
  return Object.freeze({
    schema: "metaengine.sovereign.actor-policy.v1",
    provider: SOVEREIGN_ACTIVE_PROVIDER,
    platform: SOVEREIGN_ACTIVE_PLATFORM,
    transport: SOVEREIGN_TRANSPORT,
    actors: Object.freeze([
      Object.freeze({ actor:"ACTOR_A", model:CONFIG.ACTOR_A.model, legacy_db_slot:"GPT" }),
      Object.freeze({ actor:"ACTOR_B", model:CONFIG.ACTOR_B.model, legacy_db_slot:"GLM" }),
    ]),
    legacy_glm_provider_active: false,
    legacy_db_slot_names_are_provider_identity: false,
    independent_actor_contexts_required: true,
    authority_effect: false,
  });
}
