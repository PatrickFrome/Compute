import { extractText } from './gateway.mjs';
import { sha256 } from './security.mjs';

export const COMMITTEE_SIZE = 3;
export const COMMITTEE_QUORUM = 2;

export function assertCommitteePlan(models) {
  if (!Array.isArray(models) || models.length !== COMMITTEE_SIZE) {
    throw new Error('committee_requires_exactly_three_models');
  }
  const uniqueModels = new Set(models);
  if (uniqueModels.size !== COMMITTEE_SIZE) throw new Error('committee_models_must_be_unique');
  const providers = models.map((model) => String(model).split('/')[0]);
  if (providers.some((provider) => !provider) || new Set(providers).size !== COMMITTEE_SIZE) {
    throw new Error('committee_requires_three_provider_families');
  }
  return { models: [...models], providers };
}

function publicFailure(error) {
  return {
    error: typeof error?.message === 'string' && error.message ? error.message : 'committee_member_failure',
    upstream_status: Number.isInteger(error?.status) ? error.status : null
  };
}

export async function runCommittee({
  models,
  input,
  taskId,
  maxOutputTokens,
  callModel,
  now = () => new Date().toISOString()
}) {
  const plan = assertCommitteePlan(models);
  if (typeof callModel !== 'function') throw new Error('committee_call_model_required');

  const startedAt = now();
  const members = await Promise.all(plan.models.map(async (model, index) => {
    const memberId = `committee-${index + 1}`;
    const memberStartedAt = now();
    try {
      const result = await callModel({
        models: [model],
        input,
        taskId: `${taskId}:${memberId}`,
        maxOutputTokens
      });
      if (result?.servedModel !== model) throw new Error('committee_served_model_mismatch');
      const answer = extractText(result.payload);
      if (!answer) throw new Error('committee_empty_answer');
      return {
        member_id: memberId,
        status: 'SUCCESS',
        provider_family: model.split('/')[0],
        requested_model: model,
        served_model: result.servedModel,
        answer,
        response_sha256: sha256(JSON.stringify(result.payload)),
        started_at: memberStartedAt,
        completed_at: now(),
        tariff_dependency: true,
        data_policy: 'PUBLIC_OR_NON_SENSITIVE_ONLY',
        authority_effect: false
      };
    } catch (error) {
      return {
        member_id: memberId,
        status: 'FAILED',
        provider_family: model.split('/')[0],
        requested_model: model,
        served_model: null,
        ...publicFailure(error),
        started_at: memberStartedAt,
        completed_at: now(),
        tariff_dependency: true,
        data_policy: 'PUBLIC_OR_NON_SENSITIVE_ONLY',
        authority_effect: false
      };
    }
  }));

  const successfulMembers = members.filter((member) => member.status === 'SUCCESS').length;
  const quorumMet = successfulMembers >= COMMITTEE_QUORUM;
  return {
    schema: 'metaengine.model-gateway.free-committee.v1',
    task_id: taskId,
    committee_size: COMMITTEE_SIZE,
    quorum_required: COMMITTEE_QUORUM,
    successful_members: successfulMembers,
    quorum_met: quorumMet,
    committee_status: quorumMet ? 'QUORUM_MET' : 'QUORUM_FAILED',
    providers: plan.providers,
    models_requested: plan.models,
    members,
    synthesis_performed: false,
    synthesis: null,
    started_at: startedAt,
    completed_at: now(),
    tariff_dependency: true,
    data_policy: 'PUBLIC_OR_NON_SENSITIVE_ONLY',
    authority_effect: false
  };
}
