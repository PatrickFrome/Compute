import test from 'node:test';
import assert from 'node:assert/strict';
import { runCommittee } from '../lib/committee.mjs';
import { runChallengeRound } from '../lib/challenge.mjs';
import { canonicalJson, toSupervisorAdvisory } from '../lib/supervisor-advisory.mjs';
import { sha256 } from '../lib/security.mjs';
import { verifyPersistedChallengeReadback, verifyPersistedCommitteeReadback } from '../lib/readback-lineage.mjs';

const MODELS = [
  'minimax/minimax-m3-free',
  'poolside/laguna-s-2.1-free',
  'inclusionai/ling-3.0-flash-fin-free'
];

function zeroSpendEvidence() {
  return {
    models: MODELS.map((model) => ({ model, zero_price: true })),
    privacy: { classification: 'EXTERNAL_NON_ZDR_OR_TRAINING_UNCERTAIN' }
  };
}

async function fakeCall({ models }) {
  const model = models[0];
  return {
    servedModel: model,
    payload: { model, output_text: `answer:${model}` }
  };
}

function hashRoot(receipt) {
  const { receipt_sha256: _ignored, ...core } = receipt;
  receipt.receipt_sha256 = sha256(canonicalJson(core));
  return receipt;
}

async function buildCompleteReceipt(parentTaskId = 'lineage-task') {
  const requestHash = 'b'.repeat(64);
  const base = await runCommittee({
    models: MODELS,
    input: 'public task',
    taskId: `${parentTaskId}:propose`,
    maxOutputTokens: 128,
    callModel: fakeCall,
    now: () => '2026-08-29T05:10:00.000Z'
  });
  const round1 = {
    ...base,
    request_sha256: requestHash,
    zero_spend_verified: true,
    zero_spend_evidence: zeroSpendEvidence(),
    privacy_classification: 'EXTERNAL_NON_ZDR_OR_TRAINING_UNCERTAIN',
    confidential_data_supported: false,
    authority_effect: false
  };
  const round1Advisory = toSupervisorAdvisory(round1);
  const round2Evidence = zeroSpendEvidence();
  const challengeRound = await runChallengeRound({
    round1,
    input: 'public task',
    taskId: `${parentTaskId}:rebut`,
    maxOutputTokens: 128,
    callModel: fakeCall,
    now: () => '2026-08-29T05:10:01.000Z'
  });
  const core = {
    schema: 'metaengine.model-gateway.free-committee-challenge.v1',
    task_id: parentTaskId,
    request_sha256: requestHash,
    topology: 'SPARSE_RING_TARGETED_FALSIFICATION_V1',
    round1,
    round1_advisory: round1Advisory,
    round2_zero_spend_evidence: round2Evidence,
    round2_zero_spend_evidence_sha256: sha256(canonicalJson(round2Evidence)),
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
  return { ...core, receipt_sha256: sha256(canonicalJson(core)) };
}

test('strict persisted challenge verification binds parent, PROPOSE and REBUT task lineage', async () => {
  const receipt = await buildCompleteReceipt();
  const verified = verifyPersistedChallengeReadback(receipt, { expectedTaskId: 'lineage-task' });
  assert.equal(verified.valid, true);
  assert.equal(verified.task_lineage_verified, true);
  assert.equal(verified.parent_task_id, 'lineage-task');
});

test('strict verifier rejects a self-consistent but spliced PROPOSE task id', async () => {
  const receipt = await buildCompleteReceipt();
  receipt.round1.task_id = 'other-task:propose';
  receipt.round1_advisory = toSupervisorAdvisory(receipt.round1);
  receipt.challenge_round.source_round1_receipt_sha256 = sha256(canonicalJson(receipt.round1));
  receipt.challenge_round_sha256 = sha256(canonicalJson(receipt.challenge_round));
  hashRoot(receipt);
  assert.throws(
    () => verifyPersistedChallengeReadback(receipt),
    /challenge_round1_task_lineage_mismatch/
  );
});

test('strict verifier rejects a self-consistent but spliced REBUT task id', async () => {
  const receipt = await buildCompleteReceipt();
  receipt.challenge_round.task_id = 'other-task:rebut';
  receipt.challenge_round_sha256 = sha256(canonicalJson(receipt.challenge_round));
  hashRoot(receipt);
  assert.throws(
    () => verifyPersistedChallengeReadback(receipt),
    /challenge_round2_task_lineage_mismatch/
  );
});

test('strict verifier may bind an externally expected parent task id', async () => {
  const receipt = await buildCompleteReceipt();
  assert.throws(
    () => verifyPersistedChallengeReadback(receipt, { expectedTaskId: 'different-task' }),
    /challenge_parent_task_lineage_mismatch/
  );
});

test('strict committee readback may bind an externally expected task id', async () => {
  const receipt = await buildCompleteReceipt();
  const verified = verifyPersistedCommitteeReadback({
    committeeReceipt: receipt.round1,
    supervisorAdvisory: receipt.round1_advisory,
    expectedTaskId: 'lineage-task:propose'
  });
  assert.equal(verified.task_lineage_verified, true);
  assert.throws(
    () => verifyPersistedCommitteeReadback({
      committeeReceipt: receipt.round1,
      supervisorAdvisory: receipt.round1_advisory,
      expectedTaskId: 'different-task:propose'
    }),
    /committee_task_lineage_mismatch/
  );
});
