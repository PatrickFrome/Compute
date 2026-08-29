import { sha256 } from './security.mjs';

const COMMITTEE_SCHEMA = 'metaengine.model-gateway.free-committee.v1';
const ADVISORY_SCHEMA = 'metaengine.supervisor.advisory-committee.v1';

function requireObject(value, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(code);
  return value;
}

function requireBoolean(value, expected, code) {
  if (value !== expected) throw new Error(code);
}

function requireString(value, code) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(code);
  return value.trim();
}

export function validateCommitteeReceipt(receipt) {
  requireObject(receipt, 'committee_receipt_object_required');
  if (receipt.schema !== COMMITTEE_SCHEMA) throw new Error('committee_receipt_schema_invalid');
  requireString(receipt.task_id, 'committee_task_id_required');
  if (receipt.committee_size !== 3 || receipt.quorum_required !== 2) throw new Error('committee_shape_invalid');
  requireBoolean(receipt.authority_effect, false, 'committee_authority_forbidden');
  requireBoolean(receipt.synthesis_performed, false, 'committee_synthesis_forbidden');
  if (receipt.synthesis !== null) throw new Error('committee_synthesis_must_be_null');
  if (receipt.data_policy !== 'PUBLIC_OR_NON_SENSITIVE_ONLY') throw new Error('committee_data_policy_invalid');
  if (receipt.tariff_dependency !== true) throw new Error('committee_tariff_dependency_required');
  if (!Array.isArray(receipt.members) || receipt.members.length !== 3) throw new Error('committee_members_invalid');
  if (!Array.isArray(receipt.providers) || receipt.providers.length !== 3) throw new Error('committee_providers_invalid');
  if (new Set(receipt.providers).size !== 3) throw new Error('committee_provider_diversity_invalid');

  const members = receipt.members.map((member, index) => {
    requireObject(member, `committee_member_${index + 1}_invalid`);
    requireBoolean(member.authority_effect, false, 'committee_member_authority_forbidden');
    if (member.data_policy !== 'PUBLIC_OR_NON_SENSITIVE_ONLY') throw new Error('committee_member_data_policy_invalid');
    if (member.tariff_dependency !== true) throw new Error('committee_member_tariff_dependency_required');
    const provider = requireString(member.provider_family, 'committee_member_provider_required');
    if (provider !== receipt.providers[index]) throw new Error('committee_member_provider_order_mismatch');
    const requestedModel = requireString(member.requested_model, 'committee_member_requested_model_required');
    if (!requestedModel.startsWith(`${provider}/`)) throw new Error('committee_member_provider_model_mismatch');
    if (member.status !== 'SUCCESS' && member.status !== 'FAILED') throw new Error('committee_member_status_invalid');

    if (member.status === 'SUCCESS') {
      const servedModel = requireString(member.served_model, 'committee_member_served_model_required');
      if (servedModel !== requestedModel) throw new Error('committee_member_served_model_mismatch');
      const answer = requireString(member.answer, 'committee_member_answer_required');
      requireString(member.response_sha256, 'committee_member_response_hash_required');
      return { ...member, answer };
    }

    if (member.served_model !== null) throw new Error('committee_failed_member_served_model_must_be_null');
    requireString(member.error, 'committee_failed_member_error_required');
    return { ...member };
  });

  const successes = members.filter((member) => member.status === 'SUCCESS').length;
  if (receipt.successful_members !== successes) throw new Error('committee_success_count_mismatch');
  const expectedQuorum = successes >= 2;
  if (receipt.quorum_met !== expectedQuorum) throw new Error('committee_quorum_mismatch');
  if (receipt.committee_status !== (expectedQuorum ? 'QUORUM_MET' : 'QUORUM_FAILED')) {
    throw new Error('committee_status_mismatch');
  }

  return { receipt, members, successes, quorumMet: expectedQuorum };
}

export function toSupervisorAdvisory(receipt) {
  const validated = validateCommitteeReceipt(receipt);
  const committeeReceiptSha256 = sha256(JSON.stringify(receipt));
  const members = validated.members.map((member) => ({
    member_id: member.member_id,
    status: member.status,
    provider_family: member.provider_family,
    requested_model: member.requested_model,
    served_model: member.served_model,
    answer: member.status === 'SUCCESS' ? member.answer : null,
    answer_sha256: member.status === 'SUCCESS' ? sha256(member.answer) : null,
    response_sha256: member.status === 'SUCCESS' ? member.response_sha256 : null,
    error: member.status === 'FAILED' ? member.error : null,
    upstream_status: member.status === 'FAILED' && Number.isInteger(member.upstream_status) ? member.upstream_status : null,
    authority_effect: false
  }));

  return {
    schema: ADVISORY_SCHEMA,
    source: 'F1_ZERO_SPEND_COMMITTEE',
    task_id: receipt.task_id,
    committee_receipt_sha256: committeeReceiptSha256,
    quorum_met: validated.quorumMet,
    availability_quorum_only: true,
    semantic_consensus_evaluated: false,
    semantic_consensus: null,
    synthesis_performed: false,
    members,
    requires_supervisor_arbitration: true,
    direct_action_allowed: false,
    executable_action: null,
    tariff_dependency: true,
    data_policy: 'PUBLIC_OR_NON_SENSITIVE_ONLY',
    confidential_data_supported: false,
    canonical: false,
    authority_effect: false
  };
}
