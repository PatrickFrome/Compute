export const REASONING_POLICY_VERSION = '1.0.0';

export const MAX_REASONING_POLICY = Object.freeze({
  schema: 'metaengine.reasoning-policy.v1',
  version: REASONING_POLICY_VERSION,
  requested_level: 'MAX_AVAILABLE',
  openai_responses: Object.freeze({
    reasoning_effort: 'max',
    reasoning_mode: 'pro',
  }),
  hidden_chain_of_thought_is_evidence: false,
  model_output_authority: false,
  unavailable_setting_behavior: 'REQUEST_HIGHEST_SUPPORTED_AND_CONTINUE_EVIDENCE_GATED',
});

export function buildMaxReasoningDirective({ role = 'CHAT' } = {}) {
  const normalizedRole = String(role || 'CHAT').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '_').slice(0, 64) || 'CHAT';
  return [
    'reasoning_policy=MAX_AVAILABLE',
    `reasoning_role=${normalizedRole}`,
    'reasoning_effort=max',
    'reasoning_mode=pro',
    'Use the highest reasoning/thinking level actually available to this chat or model for every non-trivial cycle; do not silently downgrade for latency or convenience.',
    'Where the runtime exposes explicit reasoning controls, configure the strongest supported setting. For OpenAI GPT-5.6 Responses workers this means reasoning.effort=max and reasoning.mode=pro.',
    'If a chat surface does not expose a verifiable reasoning control, explicitly request the highest available reasoning in the prompt and continue evidence-gated; do not invent a capability receipt.',
    'Never expose or rely on hidden chain-of-thought as authority or evidence; use claims, tests, counterexamples, tool telemetry and reproducible artifacts instead.',
  ];
}
