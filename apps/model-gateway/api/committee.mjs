import { validateTask, modelPlan } from '../lib/policy.mjs';
import { authorized, buildPeerInput, sha256 } from '../lib/security.mjs';
import { callGateway } from '../lib/gateway.mjs';
import { assertZeroSpend } from '../lib/catalog.mjs';
import { runCommittee } from '../lib/committee.mjs';
import { toSupervisorAdvisory } from '../lib/supervisor-advisory.mjs';

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
    return send(response, 400, { error: error.message, authority_effect: false });
  }

  if (task.role !== 'free') {
    return send(response, 400, { error: 'committee_free_role_required', authority_effect: false });
  }
  if (task.paidOk) {
    return send(response, 400, { error: 'committee_paid_opt_in_forbidden', authority_effect: false });
  }
  if (task.preferredModels.length) {
    return send(response, 400, { error: 'committee_preferred_models_forbidden', authority_effect: false });
  }

  const models = modelPlan('free', { paidOk: false, preferredModels: [] });
  let input;
  try {
    input = buildPeerInput(task);
  } catch (error) {
    return send(response, 400, { error: error.message, authority_effect: false });
  }

  const requestHash = sha256(JSON.stringify({
    task_id: task.taskId,
    mode: 'FREE_COMMITTEE_2_OF_3_V1',
    models,
    max_output_tokens: task.maxOutputTokens,
    input
  }));

  try {
    // Fresh catalog check happens before any external inference fan-out.
    const zeroSpendEvidence = await assertZeroSpend(models);
    const committee = await runCommittee({
      models,
      input,
      taskId: task.taskId,
      maxOutputTokens: task.maxOutputTokens,
      callModel: callGateway
    });
    // The supervisor envelope independently re-validates the committee receipt.
    // It cannot synthesize consensus or authorize an action.
    const supervisorAdvisory = toSupervisorAdvisory(committee);
    const body = {
      ...committee,
      request_sha256: requestHash,
      zero_spend_verified: true,
      zero_spend_evidence: zeroSpendEvidence,
      privacy_classification: zeroSpendEvidence.privacy?.classification || 'UNKNOWN',
      confidential_data_supported: false,
      supervisor_advisory: supervisorAdvisory,
      authority_effect: false
    };
    return send(response, committee.quorum_met ? 200 : 503, body);
  } catch (error) {
    return send(response, 502, {
      schema: 'metaengine.model-gateway.free-committee-error.v1',
      task_id: task.taskId,
      error: error.message || 'committee_failure',
      upstream_status: Number.isInteger(error.status) ? error.status : null,
      request_sha256: requestHash,
      zero_spend_verified: false,
      confidential_data_supported: false,
      tariff_dependency: true,
      data_policy: 'PUBLIC_OR_NON_SENSITIVE_ONLY',
      authority_effect: false
    });
  }
}
