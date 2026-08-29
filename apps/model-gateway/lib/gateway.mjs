const RESPONSES_URL = 'https://ai-gateway.vercel.sh/v1/responses';
const CHAT_COMPLETIONS_URL = 'https://ai-gateway.vercel.sh/v1/chat/completions';

export function gatewayCredential(env = process.env) {
  return env.AI_GATEWAY_API_KEY || env.VERCEL_OIDC_TOKEN || '';
}

export function extractText(payload) {
  if (!payload || typeof payload !== 'object') return '';
  if (typeof payload.output_text === 'string') return payload.output_text;
  const output = Array.isArray(payload.output) ? payload.output : [];
  const parts = [];
  for (const item of output) {
    if (typeof item?.text === 'string') parts.push(item.text);
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if (typeof content?.text === 'string') parts.push(content.text);
    }
  }
  return parts.join('\n').trim();
}

function authHeaders(credential) {
  return {
    authorization: `Bearer ${credential}`,
    'content-type': 'application/json',
    'x-metaengine-authority-effect': 'false'
  };
}

async function parseGatewayResponse(response) {
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = { raw: text }; }
  if (!response.ok) {
    const error = new Error(`gateway_http_${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

export async function callGateway({ models, input, taskId, maxOutputTokens = 1200, env = process.env, fetchImpl = fetch }) {
  if (!Array.isArray(models) || models.length === 0) throw new Error('empty_model_plan');
  const credential = gatewayCredential(env);
  if (!credential) throw new Error('gateway_auth_unavailable');

  const [primary, ...fallbacks] = models;
  const body = {
    model: primary,
    input: [{ type: 'message', role: 'user', content: input }],
    max_output_tokens: maxOutputTokens,
    providerOptions: {
      gateway: {
        models,
        user: `metaengine:${taskId}`,
        tags: ['metaengine', 'f1-prep', 'advisory-peer']
      }
    }
  };

  const response = await fetchImpl(RESPONSES_URL, {
    method: 'POST',
    headers: authHeaders(credential),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(55_000)
  });

  return { payload: await parseGatewayResponse(response), primary, fallbacks };
}

export async function callChatGateway({ models, messages, maxTokens, temperature, logicalModel, env = process.env, fetchImpl = fetch }) {
  if (!Array.isArray(models) || models.length === 0) throw new Error('empty_model_plan');
  const credential = gatewayCredential(env);
  if (!credential) throw new Error('gateway_auth_unavailable');
  const [primary, ...fallbacks] = models;

  const response = await fetchImpl(CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers: authHeaders(credential),
    body: JSON.stringify({
      model: primary,
      messages,
      max_tokens: maxTokens,
      temperature,
      stream: false,
      providerOptions: {
        gateway: {
          models: fallbacks,
          user: `metaengine:${logicalModel}`,
          tags: ['metaengine', 'f1-prep', 'sovereign-openai-compat', `logical:${logicalModel}`]
        }
      }
    }),
    signal: AbortSignal.timeout(55_000)
  });

  return { payload: await parseGatewayResponse(response), primary, fallbacks };
}
