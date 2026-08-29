import test from 'node:test';
import assert from 'node:assert/strict';
import { runCommittee } from '../lib/committee.mjs';
import { runChallengeRound } from '../lib/challenge.mjs';
import { canonicalJson, toSupervisorAdvisory } from '../lib/supervisor-advisory.mjs';
import { sha256 } from '../lib/security.mjs';
import {
  buildChallengeLineageArgs,
  buildCommitteeLineageArgs,
  verifyChallengeLineageReadback,
  verifyCommitteeLineageReadback
} from '../lib/lineage-envelope.mjs';

const MODELS = [
  'minimax/minimax-m3-free',
  'poolside/laguna-s-2.1-free',
  'inclusionai/ling-3.0-flash-fin-free'
];

function evidence() {
  return {
    models: MODELS.map((model) => ({ model, zero_price: true })),
    privacy: { classification: 'EXTERNAL_NON_ZDR_OR_TRAINING_UNCERTAIN' }
  };
}

async function fakeCall({ models }) {
  const model = models[0];
  return { servedModel: model, payload: { model, output_text: `answer:${model}` } };
}

async function buildReceipts(parentTaskId = 'persist-task') {
  const requestSha256 = 'b'.repeat(64);
  const base = await runCommittee({
    models: MODELS,
    input: 'public task',
    taskId: `${parentTaskId}:propose`,
    maxOutputTokens: 128,
    callModel: fakeCall,
    now: () => '2026-08-29T05:20:00.000Z'
  });
  const committee = {
    ...base,
    request_sha256: requestSha256,
    zero_spend_verified: true,
    zero_spend_evidence: evidence(),
    privacy_classification: 'EXTERNAL_NON_ZDR_OR_TRAINING_UNCERTAIN',
    confidential_data_supported: false,
    authority_effect: false
  };
  const advisory = toSupervisorAdvisory(committee);
  const round2 = evidence();
  const challengeRound = await runChallengeRound({
    round1: committee,
    input: 'public task',
    taskId: `${parentTaskId}:rebut`,
    maxOutputTokens: 128,
    callModel: fakeCall,
    now: () => '2026-08-29T05:20:01.000Z'
  });
  const core = {
    schema: 'metaengine.model-gateway.free-committee-challenge.v1',
    task_id: parentTaskId,
    request_sha256: requestSha256,
    topology: 'SPARSE_RING_TARGETED_FALSIFICATION_V1',
    round1: committee,
    round1_advisory: advisory,
    round2_zero_spend_evidence: round2,
    round2_zero_spend_evidence_sha256: sha256(canonicalJson(round2)),
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
  const challenge = { ...core, receipt_sha256: sha256(canonicalJson(core)) };
  return { committee, advisory, challenge };
}

function simulatedRow(args) {
  return {
    edge_id: '11111111-1111-4111-8111-111111111111',
    relation: args.p_relation,
    subject_kind: args.p_subject_kind,
    subject_id: args.p_subject_id,
    subject_sha256: args.p_subject_sha256,
    object_kind: args.p_object_kind,
    object_id: args.p_object_id,
    object_sha256: args.p_object_sha256,
    trace_id: args.p_trace_id,
    metadata: structuredClone(args.p_metadata),
    receipt_sha256: 'f'.repeat(64),
    canonical: false,
    authority_effect: false
  };
}

test('committee envelope maps verified advisory evidence into non-authority RESULT_OF lineage args', async () => {
  const { committee, advisory } = await buildReceipts();
  const args = buildCommitteeLineageArgs({ committeeReceipt: committee, supervisorAdvisory: advisory });
  assert.equal(args.p_relation, 'RESULT_OF');
  assert.equal(args.p_subject_kind, 'MODEL_GATEWAY_TASK');
  assert.equal(args.p_subject_id, 'persist-task:propose');
  assert.equal(args.p_subject_sha256, committee.request_sha256);
  assert.equal(args.p_object_kind, 'MODEL_GATEWAY_COMMITTEE_RECEIPT');
  assert.equal(args.p_object_sha256, advisory.committee_receipt_sha256);
  assert.equal(args.p_metadata.canonical, false);
  assert.equal(args.p_metadata.authority_effect, false);
  assert.equal(args.p_metadata.persistence_mode, 'APPEND_ONLY_LINEAGE_EVIDENCE');

  const verified = verifyCommitteeLineageReadback(simulatedRow(args));
  assert.equal(verified.valid, true);
  assert.equal(verified.receipt_kind, 'COMMITTEE');
});

test('challenge envelope preserves strict task lineage and root receipt hash', async () => {
  const { challenge } = await buildReceipts();
  const args = buildChallengeLineageArgs({ challengeReceipt: challenge, traceId: 'a'.repeat(32) });
  assert.equal(args.p_subject_id, 'persist-task');
  assert.equal(args.p_subject_sha256, challenge.request_sha256);
  assert.equal(args.p_object_kind, 'MODEL_GATEWAY_CHALLENGE_RECEIPT');
  assert.equal(args.p_object_sha256, challenge.receipt_sha256);
  assert.equal(args.p_trace_id, 'a'.repeat(32));

  const verified = verifyChallengeLineageReadback(simulatedRow(args));
  assert.equal(verified.valid, true);
  assert.equal(verified.challenge_status, 'COMPLETE');
  assert.equal(verified.target_coverage_complete, true);
});

test('lineage readback rejects object hash or authority drift', async () => {
  const { challenge } = await buildReceipts();
  const args = buildChallengeLineageArgs({ challengeReceipt: challenge });
  const hashDrift = simulatedRow(args);
  hashDrift.object_sha256 = '0'.repeat(64);
  assert.throws(() => verifyChallengeLineageReadback(hashDrift), /object_hash_mismatch/);

  const authorityDrift = simulatedRow(args);
  authorityDrift.authority_effect = true;
  assert.throws(() => verifyChallengeLineageReadback(authorityDrift), /authority_forbidden/);
});

test('lineage readback revalidates embedded receipt instead of trusting metadata summary', async () => {
  const { challenge } = await buildReceipts();
  const args = buildChallengeLineageArgs({ challengeReceipt: challenge });
  const row = simulatedRow(args);
  row.metadata.receipt.round1.members[0].answer = 'mutated after persistence';
  assert.throws(() => verifyChallengeLineageReadback(row), /receipt_hash_mismatch|advisory_readback_mismatch/);
});

test('lineage adapter rejects invalid trace ids before any database call can be prepared', async () => {
  const { challenge } = await buildReceipts();
  assert.throws(
    () => buildChallengeLineageArgs({ challengeReceipt: challenge, traceId: 'not-a-trace-id' }),
    /lineage_trace_id_invalid/
  );
});
