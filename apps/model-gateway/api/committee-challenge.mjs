import { validateTask, modelPlan } from '../lib/policy.mjs';
import { authorized, buildPeerInput, sha256 } from '../lib/security.mjs';
import { callGateway } from '../lib/gateway.mjs';
import { assertZeroSpend } from '../lib/catalog.mjs';
import { runCommittee } from '../lib/committee.mjs';
import { runChallengeRound } from '../lib/challenge.mjs';
import { canonicalJson, toSupervisorAdvisory } from '../lib/supervisor-advisory.mjs';

function send(response, status, body) {
  response.status(status).json(body);
}

function validateFreeCommitteeTask(requestBody) {
  const task = validateTask(requestBody);
  if (task.role !== 'free') throw new Error('committee_free_role_required');
  if (task.paidOk) throw new Error('committee_paid_opt_in_forbidden');
  if (task.preferredModels.length) throw new Error('committee_preferred_models_forbidden');
  return task;
}

function buildEnrichedRound1(committee, requestHash, zeroSpendEvidence) {
  return {
    ...committee,
    request_sha256: requestHash,
    zero_spend_verified: true,
    zero_spend_evidence: zeroSpendEvidence,
    privacy_classification: zeroSpendEvidence.privacy?.classification || 'UNKNOWN',
    confidential_data_supported: false,
    authority_effect: false
  };
}

export default async function handler(request, response) {
  if (request.method !== 'POST') return send(response, 405, { error: 'method_not_allowed' });
  if (!authorized(request)) return send(response, 401, { error: 'unauthorized' });

  let task;
  try {
    task = validateFreeCommitteeTask(request.body);
  } catch (error) {
    return send(response, 400, { error: error.message, authority_effect: false });
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
    mode: 'FREE_COMMITTEE_TARGETED_FALSIFICATION_V1',
    models,
    max_output_tokens: task.maxOutputTokens,
    input
  }));

  let round1;
  let round1Advisory;
  try {
    const round1Pricing = await assertZeroSpend(models);
    const committee = await runCommittee({
      models,
      input,
      taskId: `${task.taskId}:propose`,
      maxOutputTokens: task.maxOutputTokens,
      callModel: callGateway
    });
    round1 = buildEnrichedRound1(committee, requestHash, round1Pricing);
    round1Advisory = toSupervisorAdvisory(round1);
  } catch (error) {
    return send(response, 502, {
      schema: 'metaengine.model-gateway.free-committee-challenge-error.v1',
      task_id: task.taskId,
      phase: 'ROUND1',
      error: error.message || 'round1_failure',
      request_sha256: requestHash,
      direct_action_allowed: false,
      canonical: false,
      authority_effect: false
    });
  }

  if (!round1.quorum_met) {
    const core = {
      schema: 'metaengine.model-gateway.free-committee-challenge.v1',
      task_id: task.taskId,
      request_sha256: requestHash,
      topology: 'SPARSE_RING_TARGETED_FALSIFICATION_V1',
      round1,
      round1_advisory: round1Advisory,
      round2_zero_spend_evidence: null,
      challenge_round: null,
      challenge_status: 'SKIPPED_ROUND1_QUORUM_FAILED',
      semantic_consensus_evaluated: false,
      semantic_consensus: null,
      synthesis_performed: false,
      requires_supervisor_arbitration: true,
      direct_action_allowed: false,
      executable_action: null,
      tariff_dependency: true,
      data_policy: 'PUBLIC_OR_NON_SENSITIVE_ONLY',
      confidential_data_supported: false,
      canonical: false,
      authority_effect: false
    };
    return send(response, 503, { ...core, receipt_sha256: sha256(canonicalJson(core)) });
  }

  try {
    // Re-check pricing immediately before the second inference wave. The first
    // wave cannot authorize spend for a later wave if the catalog changed.
    const round2Pricing = await assertZeroSpend(models);
    const challengeRound = await runChallengeRound({
      round1,
      input,
      taskId: `${task.taskId}:rebut`,
      maxOutputTokens: task.maxOutputTokens,
      callModel: callGateway
    });
    const core = {
      schema: 'metaengine.model-gateway.free-committee-challenge.v1',
      task_id: task.taskId,
      request_sha256: requestHash,
      topology: 'SPARSE_RING_TARGETED_FALSIFICATION_V1',
      round1,
      round1_advisory: round1Advisory,
      round2_zero_spend_evidence: round2Pricing,
      round2_zero_spend_evidence_sha256: sha256(canonicalJson(round2Pricing)),
      challenge_round: challengeRound,
      challenge_round_sha256: sha256(canonicalJson(challengeRound)),
      challenge_status: challengeRound.challenge_status,
      target_coverage_complete: challengeRound.target_coverage_complete,
      semantic_consensus_evaluated: false,
      semantic_consensus: null,
      synthesis_performed: false,
      requires_supervisor_arbitration: true,
      direct_action_allowed: false,
      executable_action: null,
      tariff_dependency: true,
      data_policy: 'PUBLIC_OR_NON_SENSITIVE_ONLY',
      confidential_data_supported: false,
      canonical: false,
      authority_effect: false
    };
    return send(response, challengeRound.target_coverage_complete ? 200 : 503, {
      ...core,
      receipt_sha256: sha256(canonicalJson(core))
    });
  } catch (error) {
    const core = {
      schema: 'metaengine.model-gateway.free-committee-challenge-error.v1',
      task_id: task.taskId,
      phase: 'ROUND2',
      error: error.message || 'round2_failure',
      request_sha256: requestHash,
      round1,
      round1_advisory: round1Advisory,
      semantic_consensus_evaluated: false,
      synthesis_performed: false,
      requires_supervisor_arbitration: true,
      direct_action_allowed: false,
      canonical: false,
      authority_effect: false
    };
    return send(response, 502, { ...core, receipt_sha256: sha256(canonicalJson(core)) });
  }
}
