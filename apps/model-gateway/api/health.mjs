import { modelPlan } from '../lib/policy.mjs';
import { gatewayCredential } from '../lib/gateway.mjs';

export default function handler(_request, response) {
  response.status(200).json({
    ok: true,
    schema: 'metaengine.model-gateway.health.v1',
    authority_effect: false,
    gateway_auth_configured: Boolean(gatewayCredential()),
    inbound_auth_configured: Boolean(process.env.METAENGINE_MODEL_GATEWAY_TOKEN),
    paid_models_enabled: process.env.METAENGINE_ALLOW_PAID_MODELS === '1',
    default_models: modelPlan('free')
  });
}
