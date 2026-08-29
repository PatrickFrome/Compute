import { validateTask, modelPlan, paidModelsEnabled } from '../lib/policy.mjs';
import { authorized, buildPeerInput, sha256 } from '../lib/security.mjs';
import { callGateway, extractText } from '../lib/gateway.mjs';
import { assertPaidBudget, assertZeroSpend } from '../lib/catalog.mjs';

function send(response, status, body) {
  response.status(status).json(body);
}

export default async function handler(request, response) {
  if (request.method !== 'POST') return send(response, 405, { error: 'method_not_allowed' });
  if (!authorized(request)) return send(response, 401, { error: 'unauthorized' });

  let task;
  try {
    task = validateTask(request.body);
  } catch (error) {
    return send(response, 400, { error: error.message });
  }

  const paidRouteAuthorized = task.paidOk && paidModelsEnabled();
  const models = modelPlan(task.role, {
    paidOk: task.paidOk,
    preferredModels: task.preferredModels
  });
  const input = buildPeerInput(task);
  const requestHash = sha256(JSON.stringify({
    task_id: task.taskId,
    role: task.role,
    models,
    max_output_tokens: task.maxOutputTokens,
    input
  }));
  const startedAt = new Date().toISOString();

  try {
    let paidBudget = null;
    if (!paidRouteAuthorized) {
      await assertZeroSpend(models);
    } else {
      paidBudget = await assertPaidBudget(models, {
        input,
        maxOutputTokens: task.maxOutputTokens
      });
    }
    const result = await callGateway({
      models,
      input,
      taskId: task.taskId,
      maxOutputTokens: task.maxOutputTokens
    });
    const answer = extractText(result.payload);
    const responseHash = sha256(JSON.stringify(result.payload));
    return send(response, 200, {
      schema: 'metaengine.model-gateway.peer-receipt.v1',
      task_id: task.taskId,
      role: task.role,
      models_requested: models,
      primary_model: result.primary,
      fallback_models: result.fallbacks,
      paid_route_authorized: paidRouteAuthorized,
      zero_spend_verified: !paidRouteAuthorized,
      max_output_tokens: task.maxOutputTokens,
      paid_budget: paidBudget,
      answer,
      request_sha256: requestHash,
      response_sha256: responseHash,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      authority_effect: false
    });
  } catch (error) {
    return send(response, 502, {
      schema: 'metaengine.model-gateway.error.v1',
      task_id: task.taskId,
      error: error.message || 'gateway_failure',
      upstream_status: Number.isInteger(error.status) ? error.status : null,
      request_sha256: requestHash,
      authority_effect: false
    });
  }
}
