import { TRUSTED_SYSTEM_PREAMBLE } from './security.mjs';

export const LOGICAL_MODELS = Object.freeze({
  'metaengine/peer-a-free': Object.freeze([
    'minimax/minimax-m3-free',
    'poolside/laguna-s-2.1-free',
    'inclusionai/ling-3.0-flash-fin-free'
  ]),
  'metaengine/peer-b-free': Object.freeze([
    'poolside/laguna-s-2.1-free',
    'minimax/minimax-m3-free',
    'inclusionai/ling-3.0-flash-fin-free'
  ]),
  'metaengine/peer-c-free': Object.freeze([
    'inclusionai/ling-3.0-flash-fin-free',
    'minimax/minimax-m3-free',
    'poolside/laguna-s-2.1-free'
  ])
});

const MAX_MESSAGES = 48;
const MAX_TOTAL_CHARS = 360_000;
const MAX_OUTPUT_TOKENS = 4096;

export function logicalModelPlan(model) {
  const plan = LOGICAL_MODELS[model];
  if (!plan) throw new Error('logical_model_not_allowed');
  return [...plan];
}

export function logicalInventory() {
  return {
    object: 'list',
    data: Object.keys(LOGICAL_MODELS).map((id) => ({
      id,
      object: 'model',
      owned_by: 'metaengine',
      permission: [],
      authority_effect: false,
      zero_spend_required: true
    }))
  };
}

export function sanitizeChatCompletion(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid_body');
  const model = typeof body.model === 'string' ? body.model.trim() : '';
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (!LOGICAL_MODELS[model]) throw new Error('logical_model_not_allowed');
  if (!messages.length || messages.length > MAX_MESSAGES) throw new Error('invalid_messages');
  if (body.stream === true) throw new Error('streaming_not_supported');
  if (body.tools !== undefined || body.tool_choice !== undefined) throw new Error('tools_not_allowed');

  let totalChars = 0;
  const cleanMessages = messages.map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid_message');
    if (!['system', 'user', 'assistant'].includes(raw.role)) throw new Error('invalid_message_role');
    if (typeof raw.content !== 'string' || !raw.content.trim()) throw new Error('invalid_message_content');
    totalChars += raw.content.length;
    return { role: raw.role, content: raw.content };
  });
  if (totalChars > MAX_TOTAL_CHARS) throw new Error('messages_too_large');

  const requestedMax = Number(body.max_tokens ?? body.max_completion_tokens ?? 1200);
  const maxTokens = Number.isFinite(requestedMax)
    ? Math.max(1, Math.min(MAX_OUTPUT_TOKENS, Math.trunc(requestedMax)))
    : 1200;
  const requestedTemperature = Number(body.temperature ?? 0.2);
  const temperature = Number.isFinite(requestedTemperature)
    ? Math.max(0, Math.min(1, requestedTemperature))
    : 0.2;

  return {
    logicalModel: model,
    messages: [
      { role: 'system', content: TRUSTED_SYSTEM_PREAMBLE },
      ...cleanMessages
    ],
    maxTokens,
    temperature
  };
}
