import { sha256 } from './security.mjs';
import { canonicalJson, toSupervisorAdvisory, validateCommitteeReceipt } from './supervisor-advisory.mjs';

const CHALLENGE_SCHEMA = 'metaengine.model-gateway.free-committee-challenge.v1';
const CHALLENGE_ROUND_SCHEMA = 'metaengine.model-gateway.free-committee-challenge-round.v1';
const TOPOLOGY = 'SPARSE_RING_TARGETED_FALSIFICATION_V1';
const DATA_POLICY = 'PUBLIC_OR_NON_SENSITIVE_ONLY';

function requireObject(value, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(code);
  return value;
}

function requireArray(value, code) {
  if (!Array.isArray(value)) throw new Error(code);
  return value;
}

function requireBoolean(value, expected, code) {
  if (value !== expected) throw new Error(code);
}

function requireString(value, code) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(code);
  return value.trim();
}

function requireSha256(value, code) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) throw new Error(code);
  return value;
}

function assertNonAuthority(value, prefix = 'readback') {
  requireBoolean(value.authority_effect, false, `${prefix}_authority_forbidden`);
  if (value.canonical !== undefined) requireBoolean(value.canonical, false, `${prefix}_canonical_forbidden`);
  if (value.direct_action_allowed !== undefined) requireBoolean(value.direct_action_allowed, false, `${prefix}_direct_action_forbidden`);
  if (value.executable_action !== undefined && value.executable_action !== null) throw new Error(`${prefix}_executable_action_forbidden`);
  if (value.synthesis_performed !== undefined) requireBoolean(value.synthesis_performed, false, `${prefix}_synthesis_forbidden`);
  if (value.semantic_consensus_evaluated !== undefined) requireBoolean(value.semantic_consensus_evaluated, false, `${prefix}_semantic_consensus_forbidden`);
  if (value.semantic_consensus !== undefined && value.semantic_consensus !== null) throw new Error(`${prefix}_semantic_consensus_must_be_null`);
  if (value.data_policy !== undefined && value.data_policy !== DATA_POLICY) throw new Error(`${prefix}_data_policy_invalid`);
  if (value.tariff_dependency !== undefined) requireBoolean(value.tariff_dependency, true, `${prefix}_tariff_dependency_required`);
}

function canonicalHash(value) {
  return sha256(canonicalJson(value));
}

function withoutKey(value, key) {
  const copy = { ...requireObject(value, 'readback_object_required') };
  delete copy[key];
  return copy;
}

function verifyZeroSpendEvidence(evidence, models, prefix) {
  const value = requireObject(evidence, `${prefix}_evidence_required`);
  const rows = requireArray(value.models, `${prefix}_models_required`);
  if (rows.length !== models.length) throw new Error(`${prefix}_model_count_mismatch`);
  rows.forEach((row, index) => {
    requireObject(row, `${prefix}_model_row_invalid`);
    if (row.model !== models[index]) throw new Error(`${prefix}_model_order_mismatch`);
    requireBoolean(row.zero_price, true, `${prefix}_zero_price_required`);
  });
  requireObject(value.privacy, `${prefix}_privacy_required`);
  requireString(value.privacy.classification, `${prefix}_privacy_classification_required`);
  return value;
}

export function verifyCommitteeAdvisoryReadback({ committeeReceipt, supervisorAdvisory }) {
  const validated = validateCommitteeReceipt(committeeReceipt);
  const advisory = requireObject(supervisorAdvisory, 'supervisor_advisory_object_required');
  const expected = toSupervisorAdvisory(committeeReceipt);
  if (canonicalJson(advisory) !== canonicalJson(expected)) throw new Error('supervisor_advisory_readback_mismatch');
  assertNonAuthority(advisory, 'supervisor_advisory');
  requireBoolean(advisory.requires_supervisor_arbitration, true, 'supervisor_arbitration_required');
  requireBoolean(advisory.availability_quorum_only, true, 'availability_quorum_only_required');
  requireSha256(advisory.committee_receipt_sha256, 'committee_receipt_hash_required');
  requireSha256(advisory.zero_spend_evidence_sha256, 'zero_spend_evidence_hash_required');
  if (advisory.committee_receipt_sha256 !== canonicalHash(committeeReceipt)) {
    throw new Error('committee_receipt_hash_mismatch');
  }
  if (advisory.zero_spend_evidence_sha256 !== canonicalHash(validated.zeroSpendEvidence)) {
    throw new Error('zero_spend_evidence_hash_mismatch');
  }
  return {
    valid: true,
    schema: 'metaengine.model-gateway.committee-readback-verification.v1',
    task_id: committeeReceipt.task_id,
    committee_receipt_sha256: advisory.committee_receipt_sha256,
    zero_spend_evidence_sha256: advisory.zero_spend_evidence_sha256,
    quorum_met: validated.quorumMet,
    canonical: false,
    authority_effect: false
  };
}

function indexSuccessfulRound1Members(round1) {
  const validated = validateCommitteeReceipt(round1);
  return new Map(validated.members
    .filter((member) => member.status === 'SUCCESS')
    .map((member) => [member.member_id, member]));
}

function verifyChallengeRound(round1, challengeRound) {
  const round = requireObject(challengeRound, 'challenge_round_object_required');
  if (round.schema !== CHALLENGE_ROUND_SCHEMA) throw new Error('challenge_round_schema_invalid');
  assertNonAuthority(round, 'challenge_round');
  if (!String(round.task_id || '').endsWith(':rebut')) throw new Error('challenge_round_task_id_invalid');
  const expectedSourceHash = canonicalHash(round1);
  if (round.source_round1_receipt_sha256 !== expectedSourceHash) throw new Error('challenge_round_source_hash_mismatch');

  const members = indexSuccessfulRound1Members(round1);
  const assignments = requireArray(round.assignments, 'challenge_assignments_required');
  const challenges = requireArray(round.challenges, 'challenges_required');
  if (assignments.length !== members.size) throw new Error('challenge_assignment_count_mismatch');
  if (challenges.length !== assignments.length) throw new Error('challenge_count_mismatch');

  const assignmentByChallengeKey = new Map();
  const expectedTargets = new Set();
  for (const assignment of assignments) {
    requireObject(assignment, 'challenge_assignment_invalid');
    const challengerId = requireString(assignment.challenger_member_id, 'challenger_member_id_required');
    const targetId = requireString(assignment.target_member_id, 'target_member_id_required');
    if (challengerId === targetId) throw new Error('challenge_self_target_forbidden');
    const challenger = members.get(challengerId);
    const target = members.get(targetId);
    if (!challenger || !target) throw new Error('challenge_assignment_unknown_member');
    if (assignment.challenger_model !== challenger.requested_model || assignment.challenger_provider !== challenger.provider_family) {
      throw new Error('challenge_assignment_challenger_provenance_mismatch');
    }
    if (assignment.target_model !== target.requested_model || assignment.target_provider !== target.provider_family) {
      throw new Error('challenge_assignment_target_provenance_mismatch');
    }
    const key = `${challengerId}->${targetId}`;
    if (assignmentByChallengeKey.has(key)) throw new Error('challenge_assignment_duplicate');
    assignmentByChallengeKey.set(key, assignment);
    expectedTargets.add(targetId);
  }

  const successfulTargets = new Set();
  let successes = 0;
  challenges.forEach((challenge) => {
    requireObject(challenge, 'challenge_entry_invalid');
    assertNonAuthority(challenge, 'challenge_entry');
    const challengerId = requireString(challenge.challenger_member_id, 'challenge_challenger_id_required');
    const targetId = requireString(challenge.target_member_id, 'challenge_target_id_required');
    const assignment = assignmentByChallengeKey.get(`${challengerId}->${targetId}`);
    if (!assignment) throw new Error('challenge_without_assignment');
    if (challenge.challenger_model !== assignment.challenger_model || challenge.challenger_provider !== assignment.challenger_provider) {
      throw new Error('challenge_challenger_provenance_mismatch');
    }
    if (challenge.target_model !== assignment.target_model || challenge.target_provider !== assignment.target_provider) {
      throw new Error('challenge_target_provenance_mismatch');
    }
    const target = members.get(targetId);
    if (challenge.target_answer_sha256 !== sha256(target.answer)) throw new Error('challenge_target_answer_hash_mismatch');
    if (challenge.status !== 'SUCCESS' && challenge.status !== 'FAILED') throw new Error('challenge_status_invalid');
    if (challenge.status === 'SUCCESS') {
      successes += 1;
      if (challenge.served_model !== challenge.challenger_model) throw new Error('challenge_served_model_mismatch');
      const critique = requireString(challenge.critique, 'challenge_critique_required');
      if (challenge.critique_sha256 !== sha256(critique)) throw new Error('challenge_critique_hash_mismatch');
      requireSha256(challenge.response_sha256, 'challenge_response_hash_required');
      successfulTargets.add(targetId);
    } else {
      if (challenge.served_model !== null) throw new Error('failed_challenge_served_model_must_be_null');
      requireString(challenge.error, 'failed_challenge_error_required');
    }
  });

  if (round.successful_challenges !== successes) throw new Error('successful_challenge_count_mismatch');
  const coverage = successfulTargets.size === expectedTargets.size && [...expectedTargets].every((target) => successfulTargets.has(target));
  if (round.target_coverage_complete !== coverage) throw new Error('challenge_target_coverage_mismatch');
  if (round.challenge_status !== (coverage ? 'COMPLETE' : 'INCOMPLETE')) throw new Error('challenge_round_status_mismatch');
  return { coverage, successes, expectedTargets: expectedTargets.size };
}

export function verifyChallengeReadback(receipt) {
  const value = requireObject(receipt, 'challenge_receipt_object_required');
  if (value.schema !== CHALLENGE_SCHEMA) throw new Error('challenge_receipt_schema_invalid');
  assertNonAuthority(value, 'challenge_receipt');
  if (value.topology !== TOPOLOGY) throw new Error('challenge_topology_invalid');
  requireBoolean(value.requires_supervisor_arbitration, true, 'challenge_supervisor_arbitration_required');
  requireSha256(value.request_sha256, 'challenge_request_hash_required');
  requireSha256(value.receipt_sha256, 'challenge_receipt_hash_required');
  const expectedRoot = canonicalHash(withoutKey(value, 'receipt_sha256'));
  if (value.receipt_sha256 !== expectedRoot) throw new Error('challenge_receipt_hash_mismatch');

  const round1 = requireObject(value.round1, 'challenge_round1_required');
  if (round1.request_sha256 !== value.request_sha256) throw new Error('challenge_round1_request_hash_mismatch');
  const advisoryVerification = verifyCommitteeAdvisoryReadback({
    committeeReceipt: round1,
    supervisorAdvisory: value.round1_advisory
  });

  if (!round1.quorum_met) {
    if (value.challenge_status !== 'SKIPPED_ROUND1_QUORUM_FAILED') throw new Error('challenge_skipped_status_mismatch');
    if (value.round2_zero_spend_evidence !== null || value.challenge_round !== null) throw new Error('challenge_skipped_round2_must_be_null');
    if (value.target_coverage_complete !== undefined) throw new Error('challenge_skipped_target_coverage_forbidden');
    return {
      valid: true,
      schema: 'metaengine.model-gateway.challenge-readback-verification.v1',
      task_id: value.task_id,
      receipt_sha256: value.receipt_sha256,
      round1_committee_receipt_sha256: advisoryVerification.committee_receipt_sha256,
      challenge_status: value.challenge_status,
      target_coverage_complete: false,
      canonical: false,
      authority_effect: false
    };
  }

  const round2Evidence = verifyZeroSpendEvidence(value.round2_zero_spend_evidence, round1.models_requested, 'challenge_round2_zero_spend');
  requireSha256(value.round2_zero_spend_evidence_sha256, 'challenge_round2_zero_spend_hash_required');
  if (value.round2_zero_spend_evidence_sha256 !== canonicalHash(round2Evidence)) throw new Error('challenge_round2_zero_spend_hash_mismatch');
  requireSha256(value.challenge_round_sha256, 'challenge_round_hash_required');
  if (value.challenge_round_sha256 !== canonicalHash(value.challenge_round)) throw new Error('challenge_round_hash_mismatch');

  const roundVerification = verifyChallengeRound(round1, value.challenge_round);
  if (value.challenge_status !== value.challenge_round.challenge_status) throw new Error('challenge_outer_status_mismatch');
  if (value.target_coverage_complete !== roundVerification.coverage) throw new Error('challenge_outer_coverage_mismatch');

  return {
    valid: true,
    schema: 'metaengine.model-gateway.challenge-readback-verification.v1',
    task_id: value.task_id,
    receipt_sha256: value.receipt_sha256,
    round1_committee_receipt_sha256: advisoryVerification.committee_receipt_sha256,
    round2_zero_spend_evidence_sha256: value.round2_zero_spend_evidence_sha256,
    challenge_round_sha256: value.challenge_round_sha256,
    challenge_status: value.challenge_status,
    target_coverage_complete: roundVerification.coverage,
    successful_challenges: roundVerification.successes,
    canonical: false,
    authority_effect: false
  };
}
