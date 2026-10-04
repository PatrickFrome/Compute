/** Active inference is OpenAI only. GPT/GLM remain database wire aliases for
 * actor A/B so historical event hashes and deterministic arbitration still read. */
export type WireActor = "GPT" | "GLM";
export type LogicalActor = "PRIMARY" | "CRITIC";
export type OpenAiAgent = {
  agent_id: "agent_a" | "agent_b";
  provider: "OPENAI";
  platform: "OPENAI_API";
  base: "https://api.openai.com";
  model: string;
  token: string;
};
export type OpenAiPolicy = { agent_a: OpenAiAgent; agent_b: OpenAiAgent };
type JsonObject = Record<string, unknown>;
const DEFAULT_MODEL = "gpt-6.1-sol";

export function openAiModel(value: unknown): string {
  const model = String(value || "").trim().replace(/^openai[:/]/i, "");
  // gpt-oss is an open-weight model, not a hosted Chat Completions model.
  if (!/^(?:gpt-[a-z0-9._-]+|o[1-9][a-z0-9._-]*)$/i.test(model) || /^gpt-oss(?:-|$)/i.test(model)) {
    throw new Error("openai_model_not_allowed");
  }
  return model;
}

export function openAiPolicy(env: Record<string, string | undefined> = process.env): OpenAiPolicy {
  const token = String(env.SOVEREIGN_OPENAI_API_KEY || env.OPENAI_API_KEY || "").trim();
  const commonModel = env.ME2_OPENAI_MODEL || DEFAULT_MODEL;
  const agent = (agent_id: OpenAiAgent["agent_id"], model: string): OpenAiAgent => ({
    agent_id, provider: "OPENAI", platform: "OPENAI_API",
    base: "https://api.openai.com", model: openAiModel(model), token,
  });
  return {
    agent_a: agent("agent_a", env.SOVEREIGN_PRIMARY_MODEL || env.SOVEREIGN_AGENT_A_MODEL || commonModel),
    agent_b: agent("agent_b", env.SOVEREIGN_CRITIC_MODEL || env.SOVEREIGN_AGENT_B_MODEL || commonModel),
  };
}

export function actorConfig(policy: OpenAiPolicy, actor: WireActor | LogicalActor, saved: JsonObject = {}): OpenAiAgent {
  const primary = actor === "PRIMARY" || actor === "GPT";
  const cfg = primary ? policy.agent_a : policy.agent_b;
  const activeHint = saved[primary ? "primary_model" : "critic_model"] ?? saved[primary ? "agent_a_model" : "agent_b_model"];
  if (activeHint != null) return { ...cfg, model: openAiModel(activeHint) };
  const legacyHint = saved[primary ? "gpt_model" : "glm_model"];
  if (legacyHint != null) {
    // Historical GLM/local model names remain readable, never active routes.
    try { return { ...cfg, model: openAiModel(legacyHint) }; }
    catch { /* Keep the active actor's configured OpenAI model. */ }
  }
  return { ...cfg };
}

export function openAiChatBody(cfg: OpenAiAgent, input: JsonObject): JsonObject {
  const body: JsonObject = { ...input, model: openAiModel(cfg.model), store: false };
  if (body.max_completion_tokens == null && body.max_tokens != null) body.max_completion_tokens = body.max_tokens;
  delete body.max_tokens;
  if (/^(?:gpt-[5-9](?:[.-]|$)|o[1-9])/i.test(cfg.model)) delete body.temperature;
  delete body.conversation;
  delete body.conversation_id;
  delete body.previous_response_id;
  const metadata = body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
    ? body.metadata as JsonObject : {};
  body.metadata = { ...metadata, agent_id: cfg.agent_id, provider: cfg.provider };
  return body;
}

export async function requestOpenAiChat(
  cfg: OpenAiAgent,
  input: JsonObject,
  options: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<Response> {
  if (!cfg.token) throw new Error("openai_api_key_required");
  return (options.fetchImpl || fetch)("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    redirect: "error",
    signal: options.signal,
    headers: { "content-type": "application/json", authorization: `Bearer ${cfg.token}` },
    body: JSON.stringify(openAiChatBody(cfg, input)),
  });
}
