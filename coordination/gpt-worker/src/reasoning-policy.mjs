export const OPENAI_MAX_REASONING_POLICY = Object.freeze({
  schema: 'metaengine.openai-reasoning-policy.v1',
  requested_level: 'MAX_AVAILABLE',
  reasoning: Object.freeze({ effort: 'max', mode: 'pro' }),
  hidden_chain_of_thought_is_evidence: false,
  authority_effect: false,
});

export function assertMaxReasoningModel(model) {
  const normalized = String(model || '').trim().toLowerCase();
  if (!/^gpt-5\.6(?:$|-)/.test(normalized)) {
    throw new Error('openai_model_max_reasoning_unverified');
  }
  return normalized;
}

export function openAIMaxReasoningConfig(model) {
  assertMaxReasoningModel(model);
  return { effort: 'max', mode: 'pro' };
}
