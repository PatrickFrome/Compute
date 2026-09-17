import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import { buildRsiDevosExperimentPlan } from '../src/rsi-devos-experiment-plan.mjs';
import { RSI_COMMAND_PLANE_LIVENESS_INPUT_SCHEMA, RsiCommandPlaneLivenessObserver } from '../src/rsi-command-plane-liveness-observer.mjs';
import { RSI_ISOLATED_CANDIDATE_HANDOFF_SCHEMA } from '../src/rsi-isolated-candidate-builder.mjs';
import { buildRsiExperimentHypothesis } from '../src/supervisor-rsi-experiment-hypothesis.mjs';
import {
  applyRsiHypothesisEvidenceGate,
  createRsiHypothesisEvidenceGatePlan,
  createRsiHypothesisEvidenceReceipt,
} from '../src/supervisor-rsi-hypothesis-evidence-gate.mjs';
import * as originModule from '../src/supervisor-rsi-evidence-origin.mjs';

const {
  RSI_EVIDENCE_ORIGIN_READBACK_SCHEMA,
  createRsiEvidenceOriginSubject,
  verifyRsiEvidenceOriginReadback,
  verifyRsiEvidenceOriginSubject,
} = originModule;

const SOURCE_SHA = 'b71075d3534fd2cd4709c5ad17fd7d47f60c545f';
const CANDIDATE_SHA = 'c'.repeat(40);
const OBSERVED_AT = '2026-09-17T10:41:40.000Z';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}
function digest(value) { return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)), 'utf8').digest('hex')}`; }
function observation() {
  const observer = new RsiCommandPlaneLivenessObserver({
    source_sha: SOURCE_SHA,
    clock: () => Date.parse(OBSERVED_AT),
    heartbeat_fresh_ms: 15_000,
    perception_fresh_ms: 15_000,
    command_stall_ms: 120_000,
  });
  return observer.observe({
    schema: RSI_COMMAND_PLANE_LIVENESS_INPUT_SCHEMA,
    observed_at: OBSERVED_AT,
    heartbeat_at: '2026-09-17T10:41:35.000Z',
    perception_at: '2026-09-17T10:41:36.000Z',
    command_progress_at: '2026-09-17T05:09:49.879Z',
    pending_command_count: 5,
    active_command: {
      command_id: 'd5d24937-c7e6-4ce1-bf93-134495b1d039', action: 'SCROLL', command_lane: 'TAB_MUTATION', status: 'LEASED',
      leased_at: '2026-09-17T05:09:48.211Z', effect_bound_at: '2026-09-17T05:09:49.879Z', receipt_recorded_at: null,
    },
    command_payload_exposed: false, page_text_exposed: false, input_values_exposed: false, raw_network_exposed: false,
    execution_authority: false, production_mutation_authority: false, automatic_retry_allowed: false, authority_effect: false,
  });
}
function handoff(experimentId, marker = 'd') {
  const candidateId = `candidate_sha256_${marker.repeat(64)}`;
  const core = {
    schema: RSI_ISOLATED_CANDIDATE_HANDOFF_SCHEMA, version: 1, experiment_id: experimentId, mutation_surface: 'BROWSER_RUNTIME',
    parent_sha: SOURCE_SHA, candidate_sha: CANDIDATE_SHA,
    candidate_capsule: { candidate_id: candidateId, source: { head: CANDIDATE_SHA }, components: [{ path: 'apps/metaengine-browser/src/browser-window-runtime.mjs', change: 'MODIFY', digest: `sha256:${'a'.repeat(64)}` }] },
    candidate_verification: { ok: true, executable: false, promotion_authorized: false },
    sandbox_plan: { mode: 'PREPARE_ONLY' }, sandbox_plan_verification: { execution_authorized: false },
    shadow_archive_proposal: { candidate_id: candidateId, parent_sha: SOURCE_SHA, candidate_sha: CANDIDATE_SHA },
    eligible_for_evaluation: true, eligible_for_promotion: false, materialization_replay_authorized: false,
    execution_authority: false, production_mutation_authority: false, promotion_authority: false, self_update_authority: false, automatic_retry_allowed: false, authority_effect: false,
  };
  return { ...core, handoff_digest: digest(core) };
}
function setup(marker = 'd') {
  const observed = observation();
  const opportunity = observed.opportunities.find((entry) => entry.signal === 'RESULT_DELIVERY_STALL_AFTER_EFFECT_BINDING');
  assert.ok(opportunity);
  const hypothesis = buildRsiExperimentHypothesis({ observation: observed, opportunity_id: opportunity.opportunity_id });
  const experiment = buildRsiDevosExperimentPlan({ observation: observed, opportunity_id: opportunity.opportunity_id, hypothesis });
  const candidateHandoff = handoff(experiment.experiment_id, marker);
  const plan = createRsiHypothesisEvidenceGatePlan({ observation: observed, hypothesis, experiment_plan: experiment, candidate_handoff: candidateHandoff });
  const receipts = [
    ...plan.evidence_root.required_receipts.map((entry, index) => createRsiHypothesisEvidenceReceipt({ plan, kind: 'REQUIRED_RECEIPT', evidence_class: entry.evidence_class, hypothesis_outcome: 'SUPPORTS', evidence_refs: [`github:run:${5000 + index}`], paired_repetitions: 5 })),
    ...plan.evidence_root.hard_gates.map((entry, index) => createRsiHypothesisEvidenceReceipt({ plan, kind: 'HARD_GATE', hard_gate: entry.hard_gate, result: 'PASS', evidence_refs: [`github:check:${6000 + index}`], paired_repetitions: 5 })),
  ];
  const result = applyRsiHypothesisEvidenceGate({ plan, receipts });
  assert.equal(result.state, 'ADMITTED');
  return { plan, receipts, result };
}
function readback(subject, overrides = {}) {
  const core = {
    schema: RSI_EVIDENCE_ORIGIN_READBACK_SCHEMA,
    version: 1,
    subject_id: subject.subject_id,
    subject_digest: subject.subject_digest,
    repository: 'PatrickFrome/Compute',
    workflow_path: '.github/workflows/rsi-evidence-origin-attestation.yml',
    workflow_ref: 'refs/heads/main',
    workflow_sha: '1'.repeat(40),
    workflow_blob_sha: '2'.repeat(40),
    run_id: 35222134008,
    run_attempt: 1,
    bundle_sha256: '3'.repeat(64),
    verification_bytes_sha256: '4'.repeat(64),
    attestation_action: 'actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6',
    verification_method: 'gh attestation verify',
    verification_repository: 'PatrickFrome/Compute',
    identity_source: 'PERSISTED_GITHUB_ATTESTATION_VERIFICATION_BYTES',
    attestation_verified: true,
    independent_verification_passed: true,
    external_trusted_workflow: true,
    authored_by_candidate: false,
    project_authority_granted: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
    ...overrides,
  };
  return { ...core, readback_digest: digest(core) };
}

test('V1.11 subject binds complete V1.10 evidence but grants no origin/evaluator authority before external readback', () => {
  const { plan, receipts, result } = setup();
  const subject = createRsiEvidenceOriginSubject({ plan, receipts, result });
  const verified = verifyRsiEvidenceOriginSubject(subject);
  assert.equal(verified.ok, true);
  assert.equal(subject.terminal_result.state, 'ADMITTED');
  assert.equal(subject.origin_proven, false);
  assert.equal(subject.eligible_for_evaluator_mesh, false);
  assert.equal(subject.attestation_policy.persisted_verification_bytes_required, true);
  assert.equal(subject.attestation_policy.exact_workflow_commit_required, true);
  assert.equal(subject.attestation_policy.exact_workflow_blob_required, true);
  assert.equal(subject.attestation_policy.attest_without_verify_sufficient, false);
  assert.equal(subject.attestation_policy.pull_request_live_attestation_allowed, false);
  assert.equal(subject.promotion_authority, false);
  assert.equal(subject.self_update_authority, false);
});

test('supervisor module cannot mint trusted attestation readback', () => {
  assert.equal(Object.hasOwn(originModule, 'createRsiEvidenceOriginReadback'), false);
});

test('tampered terminal result or receipt set cannot produce an origin subject', () => {
  const { plan, receipts, result } = setup();
  assert.throws(() => createRsiEvidenceOriginSubject({ plan, receipts, result: { ...result, disposition: 'FORGED' } }), /rsi_evidence_origin_result_mismatch/);
  assert.throws(() => createRsiEvidenceOriginSubject({ plan, receipts: receipts.slice(0, -1), result }), /rsi_evidence_origin_result_mismatch/);
});

test('incomplete evidence is not attestable as a terminal origin subject', () => {
  const { plan, receipts } = setup();
  const partial = receipts.slice(0, -1);
  const blocked = applyRsiHypothesisEvidenceGate({ plan, receipts: partial });
  assert.equal(blocked.state, 'BLOCKED');
  assert.throws(() => createRsiEvidenceOriginSubject({ plan, receipts: partial, result: blocked }), /rsi_evidence_origin_result_not_terminal/);
});

test('exact persisted attestation verification readback unlocks evaluator admission but still grants zero project authority', () => {
  const { plan, receipts, result } = setup();
  const subject = createRsiEvidenceOriginSubject({ plan, receipts, result });
  const proof = verifyRsiEvidenceOriginReadback({ subject, readback: readback(subject) });
  assert.equal(proof.origin_proven, true);
  assert.equal(proof.evidence_class, 'ATTESTED_EVIDENCE_READY_NON_AUTHORITY');
  assert.equal(proof.eligible_for_evaluator_mesh, true);
  assert.equal(proof.project_authority_granted, false);
  assert.equal(proof.execution_authority, false);
  assert.equal(proof.promotion_authority, false);
  assert.equal(proof.self_update_authority, false);
  assert.equal(proof.automatic_retry_allowed, false);
  assert.match(proof.result_digest, /^sha256:[0-9a-f]{64}$/);
});

test('attest-only, wrong repo/workflow/ref or candidate-authored readback fails closed', () => {
  const { plan, receipts, result } = setup();
  const subject = createRsiEvidenceOriginSubject({ plan, receipts, result });
  for (const forged of [
    readback(subject, { independent_verification_passed: false }),
    readback(subject, { repository: 'attacker/fork' }),
    readback(subject, { workflow_path: '.github/workflows/forged.yml' }),
    readback(subject, { workflow_ref: 'refs/heads/work/attacker' }),
    readback(subject, { authored_by_candidate: true }),
    readback(subject, { project_authority_granted: true }),
  ]) {
    assert.throws(() => verifyRsiEvidenceOriginReadback({ subject, readback: forged }), /rsi_evidence_origin_readback_/);
  }
});

test('readback replay across exact candidate subjects is rejected', () => {
  const first = setup('d');
  const second = setup('e');
  const firstSubject = createRsiEvidenceOriginSubject(first);
  const secondSubject = createRsiEvidenceOriginSubject(second);
  const firstReadback = readback(firstSubject);
  assert.throws(() => verifyRsiEvidenceOriginReadback({ subject: secondSubject, readback: firstReadback }), /rsi_evidence_origin_readback_subject_mismatch/);
});

test('readback digest, verification bytes and exact workflow identities are immutable', () => {
  const { plan, receipts, result } = setup();
  const subject = createRsiEvidenceOriginSubject({ plan, receipts, result });
  const valid = readback(subject);
  assert.throws(() => verifyRsiEvidenceOriginReadback({ subject, readback: { ...valid, readback_digest: `sha256:${'f'.repeat(64)}` } }), /rsi_evidence_origin_readback_digest_mismatch/);
  assert.throws(() => verifyRsiEvidenceOriginReadback({ subject, readback: readback(subject, { workflow_sha: 'bad' }) }), /rsi_evidence_origin_workflow_exact_sha_required/);
  assert.throws(() => verifyRsiEvidenceOriginReadback({ subject, readback: readback(subject, { workflow_blob_sha: 'bad' }) }), /rsi_evidence_origin_workflow_blob_exact_sha_required/);
  assert.throws(() => verifyRsiEvidenceOriginReadback({ subject, readback: readback(subject, { verification_bytes_sha256: 'bad' }) }), /rsi_evidence_origin_verification_bytes_digest_invalid/);
});

test('FALSIFIED terminal evidence can be origin-attested for the evolution archive but never admitted to evaluator mesh', () => {
  const base = setup();
  const falsifyClass = base.plan.evidence_root.required_receipts[0].evidence_class;
  const falsifiedReceipts = base.receipts.map((receipt) => receipt.evidence_class === falsifyClass
    ? createRsiHypothesisEvidenceReceipt({ plan: base.plan, kind: 'REQUIRED_RECEIPT', evidence_class: falsifyClass, hypothesis_outcome: 'FALSIFIES', evidence_refs: ['github:run:9999'], paired_repetitions: 5 })
    : receipt);
  const falsifiedResult = applyRsiHypothesisEvidenceGate({ plan: base.plan, receipts: falsifiedReceipts });
  assert.equal(falsifiedResult.state, 'FALSIFIED');
  const subject = createRsiEvidenceOriginSubject({ plan: base.plan, receipts: falsifiedReceipts, result: falsifiedResult });
  const proof = verifyRsiEvidenceOriginReadback({ subject, readback: readback(subject) });
  assert.equal(proof.origin_proven, true);
  assert.equal(proof.terminal_state, 'FALSIFIED');
  assert.equal(proof.eligible_for_evaluator_mesh, false);
  assert.equal(proof.promotion_authority, false);
});
