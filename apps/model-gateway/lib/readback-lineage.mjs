import { verifyChallengeReadback, verifyCommitteeAdvisoryReadback } from './readback-verifier.mjs';

function requireString(value, code) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(code);
  return value.trim();
}

export function verifyPersistedCommitteeReadback({ committeeReceipt, supervisorAdvisory, expectedTaskId = null }) {
  const verified = verifyCommitteeAdvisoryReadback({ committeeReceipt, supervisorAdvisory });
  if (expectedTaskId !== null) {
    const expected = requireString(expectedTaskId, 'expected_committee_task_id_required');
    if (committeeReceipt.task_id !== expected) throw new Error('committee_task_lineage_mismatch');
  }
  return {
    ...verified,
    task_lineage_verified: expectedTaskId !== null,
    canonical: false,
    authority_effect: false
  };
}

export function verifyPersistedChallengeReadback(receipt, { expectedTaskId = null } = {}) {
  const verified = verifyChallengeReadback(receipt);
  const parentTaskId = requireString(receipt.task_id, 'challenge_parent_task_id_required');
  if (expectedTaskId !== null) {
    const expected = requireString(expectedTaskId, 'expected_challenge_task_id_required');
    if (parentTaskId !== expected) throw new Error('challenge_parent_task_lineage_mismatch');
  }
  if (receipt.round1?.task_id !== `${parentTaskId}:propose`) {
    throw new Error('challenge_round1_task_lineage_mismatch');
  }
  if (receipt.round1_advisory?.task_id !== receipt.round1.task_id) {
    throw new Error('challenge_round1_advisory_task_lineage_mismatch');
  }
  if (receipt.challenge_round !== null && receipt.challenge_round !== undefined) {
    if (receipt.challenge_round.task_id !== `${parentTaskId}:rebut`) {
      throw new Error('challenge_round2_task_lineage_mismatch');
    }
  }
  return {
    ...verified,
    task_lineage_verified: true,
    parent_task_id: parentTaskId,
    canonical: false,
    authority_effect: false
  };
}
