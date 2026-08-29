const GATEWAY_URL = 'https://ai-gateway.vercel.sh/v1/responses';

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

export async function callGateway({ models, input, taskId, env = process.env, fetchImpl = fetch }) {
  if (!Array.isArray(models) || models.length === 0) throw new Error('empty_model_plan');
  const credential = gatewayCredential(env);
  if (!credential) throw new Error('gateway_auth_unavailable');

  const [primary, ...fallbacks] = models;
  const body = {
    model: primary,
    input: [{ type: 'message', role: 'user', content: input }],
    providerOptions: {
      gateway: {
        models,
        user: `metaengine:${taskId}`,
        tags: ['metaengine', 'f1-prep', 'advisory-peer']
      }
    }
  };

  const response = await fetchImpl(GATEWAY_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${credential}`,
      'content-type': 'application/json',
      'x-metaengine-authority-effect': 'false'
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(55_000)
  });

  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = { raw: text }; }

  if (!response.ok) {
    const error = new Error(`gateway_http_${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return { payload, primary, fallbacks };
}
