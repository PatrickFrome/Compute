/**
 * ME2 active inference policy.
 *
 * Operator directive (2026-10-04):
 *   - every NEW/ACTIVE agent uses OpenAI;
 *   - Browser fleet surface is ChatGPT;
 *   - GLM/Z.ai identifiers remain legacy read compatibility only.
 *
 * Model identity is intentionally separate from transport. Agent/session rows
 * store `openai:<model>`; providers.ts may use direct OpenAI or an explicitly
 * configured OpenAI-compatible gateway without changing durable agent identity.
 */
import { emit, getMeta, listAgents, setAgentModel } from "../store";

export const ACTIVE_INFERENCE_PROVIDER = "OPENAI";
export const ACTIVE_INFERENCE_PLATFORM = "CHATGPT";
export const ACTIVE_INFERENCE_MODEL_DEFAULT = "gpt-5.6";
export const LEGACY_GLM_PROVIDER = "ZAI";
export const LEGACY_GLM_PLATFORM = "GLM_ZAI";

function cleanModel(value: string): string {
  const model = String(value || "").trim().slice(0, 96);
  if (!/^gpt-[a-z0-9._-]+$/i.test(model)) throw new Error("openai_model_tag_invalid");
  return model;
}

export function canonicalOpenAiModel(): string {
  const configured = String(
    process.env.ME2_OPENAI_MODEL
      || getMeta("openai_canonical")
      || ACTIVE_INFERENCE_MODEL_DEFAULT,
  ).trim();
  return cleanModel(configured || ACTIVE_INFERENCE_MODEL_DEFAULT);
}

export function activeAgentModelTag(): string {
  return `openai:${canonicalOpenAiModel()}`;
}

export function isLegacyGlmModelTag(value: string): boolean {
  return /^(?:zai:|glm[-:])/i.test(String(value || "").trim());
}

/**
 * Canonical durable model identity.
 * - old zai:/glm tags are migrated to the active OpenAI canonical model;
 * - bare gpt-* tags are normalized to openai:gpt-*;
 * - gateway transport prefixes are accepted only when they name an OpenAI
 *   model, then collapsed to provider-neutral durable OpenAI identity.
 */
export function normalizeActiveAgentModelTag(value?: string | null): string {
  const raw = String(value || "").trim();
  if (!raw || isLegacyGlmModelTag(raw)) return activeAgentModelTag();

  const lower = raw.toLowerCase();
  if (lower.startsWith("openai:")) return `openai:${cleanModel(raw.slice(raw.indexOf(":") + 1))}`;
  if (lower.startsWith("gateway:")) {
    const requested = raw.slice(raw.indexOf(":") + 1).replace(/^openai\//i, "");
    return `openai:${cleanModel(requested)}`;
  }
  if (/^gpt-/i.test(raw)) return `openai:${cleanModel(raw)}`;
  throw new Error("inference_provider_not_allowed");
}

/** Boot migration: all live registry agents converge onto the OpenAI canonical
 * identity. Historical event/evidence rows are never rewritten. */
export function migrateAgentsToActiveInference(): {
  provider: typeof ACTIVE_INFERENCE_PROVIDER;
  platform: typeof ACTIVE_INFERENCE_PLATFORM;
  target: string;
  upgraded: number;
  already: number;
} {
  const target = activeAgentModelTag();
  let upgraded = 0;
  let already = 0;
  for (const agent of listAgents()) {
    if (agent.model === target) {
      already += 1;
      continue;
    }
    setAgentModel(agent.id, target);
    emit("AGENT_MODEL_SET", {
      id: agent.id,
      role: agent.role,
      from: agent.model,
      to: target,
      provider: ACTIVE_INFERENCE_PROVIDER,
      platform: ACTIVE_INFERENCE_PLATFORM,
      by: "openai_inference_policy",
      legacy_source: isLegacyGlmModelTag(agent.model),
    }, agent.id, null);
    upgraded += 1;
  }
  return { provider: ACTIVE_INFERENCE_PROVIDER, platform: ACTIVE_INFERENCE_PLATFORM, target, upgraded, already };
}

export function inferencePolicySnapshot() {
  return Object.freeze({
    schema: "metaengine.me2.inference-policy.v1",
    provider: ACTIVE_INFERENCE_PROVIDER,
    platform: ACTIVE_INFERENCE_PLATFORM,
    canonical_model: canonicalOpenAiModel(),
    agent_model_tag: activeAgentModelTag(),
    legacy_glm_active: false,
    legacy_glm_read_compatibility: true,
    transport_identity_is_not_agent_identity: true,
    authority_effect: false,
  });
}
