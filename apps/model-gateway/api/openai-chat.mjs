import { authorized } from '../lib/security.mjs';
import { assertZeroSpend } from '../lib/catalog.mjs';
import { callChatGateway } from '../lib/gateway.mjs';
import { logicalModelPlan, sanitizeChatCompletion } from '../lib/openai-compat.mjs';

export default async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ error: 'method_not_allowed' });
  if (!authorized(request)) return response.status(401).json({ error: 'unauthorized' });

  let chat;
  try {
    chat = sanitizeChatCompletion(request.body);
  } catch (error) {
    return response.status(400).json({ error: error.message, authority_effect: false });
  }

  const models = logicalModelPlan(chat.logicalModel);
  try {
    const zeroSpendEvidence = await assertZeroSpend(models);
    const result = await callChatGateway({
      models,
      messages: chat.messages,
      maxTokens: chat.maxTokens,
      temperature: chat.temperature,
      logicalModel: chat.logicalModel
    });
    const first = Array.isArray(result.payload?.choices) ? result.payload.choices[0] : null;
    const content = first?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw new Error('gateway_empty_answer');
    return response.status(200).json({
      ...result.payload,
      metaengine: {
        logical_model: chat.logicalModel,
        upstream_primary: result.primary,
        upstream_fallbacks: result.fallbacks,
        upstream_served_model: result.servedModel,
        zero_spend_verified: true,
        zero_spend_evidence: zeroSpendEvidence,
        confidential_data_supported: false,
        tariff_dependency: true,
        data_policy: 'PUBLIC_OR_NON_SENSITIVE_ONLY',
        authority_effect: false
      }
    });
  } catch (error) {
    return response.status(502).json({
      error: error.message || 'gateway_failure',
      upstream_status: Number.isInteger(error.status) ? error.status : null,
      tariff_dependency: true,
      data_policy: 'PUBLIC_OR_NON_SENSITIVE_ONLY',
      authority_effect: false
    });
  }
}
