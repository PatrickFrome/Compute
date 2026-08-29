const FREE_MODELS = Object.freeze([
  'minimax/minimax-m3-free',
  'poolside/laguna-s-2.1-free',
  'inclusionai/ling-3.0-flash-fin-free'
]);

const PAID_MODEL_PROFILES = Object.freeze({
  architecture: [
    'anthropic/claude-sonnet-5',
    'google/gemini-3.7-flash',
    'alibaba/qwen3.8-max',
    'deepseek/deepseek-v4-pro-0813',
    'zai/glm-5.3'
  ],
  coding: [
    'deepseek/deepseek-v4-pro-0813',
    'anthropic/claude-sonnet-5',
    'google/gemini-3.7-flash',
    'alibaba/qwen3.8-flash',
    'spacexai/grok-4.6'
  ],
  critic: [
    'google/gemini-3.7-flash',
    'zai/glm-5.3',
    'alibaba/qwen3.8-max',
    'deepseek/deepseek-v4-pro-0813',
    'anthropic/claude-sonnet-5'
  ],
  research: [
    'spacexai/grok-4.6',
    'google/gemini-3.7-flash',
    'anthropic/claude-sonnet-5',
    'alibaba/qwen3.8-max',
    'zai/glm-5.3'
  ]
});

export const ALLOWED_ROLES = Object.freeze([
  'free',
  'architecture',
  'coding',
  'critic',
  'research'
]);

export const LIMITS = Object.freeze({
  maxPromptChars: 120_000,
  maxContextChars: 240_000,
  maxTaskIdChars: 160,
  maxPreferredModels: 8,
  defaultPeerOutputTokens: 1200,
  maxPeerOutputTokens: 4096,
  hardMaxPaidRequestUsd: 0.50
});

export function paidModelsEnabled(env = process.env) {
  return env.METAENGINE_ALLOW_PAID_MODELS === '1';
}

export function modelPlan(role, { paidOk = false, preferredModels = [], env = process.env } = {}) {
  if (!ALLOWED_ROLES.includes(role)) throw new Error('unsupported_role');

  const canUsePaid = paidOk && paidModelsEnabled(env);
  const base = role === 'free' || !canUsePaid
    ? FREE_MODELS
    : PAID_MODEL_PROFILES[role];

  const allow = new Set([...FREE_MODELS, ...Object.values(PAID_MODEL_PROFILES).flat()]);
  const preferred = preferredModels.filter((model) => allow.has(model));
  const ordered = [...preferred, ...base].filter((model, index, all) => all.indexOf(model) === index);

  if (!canUsePaid) {
    return ordered.filter((model) => FREE_MODELS.includes(model));
  }
  return ordered;
}

export function validateTask(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid_body');
  const taskId = typeof body.task_id === 'string' ? body.task_id.trim() : '';
  const role = typeof body.role === 'string' ? body.role.trim() : 'free';
  const prompt = typeof body.prompt === 'string' ? body.prompt : '';
  const context = typeof body.context === 'string' ? body.context : '';
  const preferredModels = Array.isArray(body.preferred_models) ? body.preferred_models : [];
  const requestedMaxOutputTokens = body.max_output_tokens ?? LIMITS.defaultPeerOutputTokens;

  if (!taskId || taskId.length > LIMITS.maxTaskIdChars) throw new Error('invalid_task_id');
  if (!ALLOWED_ROLES.includes(role)) throw new Error('unsupported_role');
  if (!prompt || prompt.length > LIMITS.maxPromptChars) throw new Error('invalid_prompt');
  if (context.length > LIMITS.maxContextChars) throw new Error('context_too_large');
  if (preferredModels.length > LIMITS.maxPreferredModels || preferredModels.some((x) => typeof x !== 'string')) {
    throw new Error('invalid_preferred_models');
  }
  if (!Number.isInteger(requestedMaxOutputTokens) || requestedMaxOutputTokens < 1 || requestedMaxOutputTokens > LIMITS.maxPeerOutputTokens) {
    throw new Error('invalid_max_output_tokens');
  }

  return {
    taskId,
    role,
    prompt,
    context,
    paidOk: body.paid_ok === true,
    preferredModels,
    maxOutputTokens: requestedMaxOutputTokens
  };
}
