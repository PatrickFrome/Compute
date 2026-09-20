import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import { buildRsiDevosExperimentPlan } from '../src/rsi-devos-experiment-plan.mjs';
import {
  RSI_COMMAND_PLANE_LIVENESS_INPUT_SCHEMA,
  RsiCommandPlaneLivenessObserver,
} from '../src/rsi-command-plane-liveness-observer.mjs';
import { RSI_ISOLATED_CANDIDATE_HANDOFF_SCHEMA } from '../src/rsi-isolated-candidate-builder.mjs';
import { buildRsiExperimentHypothesis } from '../src/supervisor-rsi-experiment-hypothesis.mjs';
import {
  applyRsiHypothesisEvidenceGate,
  createRsiHypothesisEvidenceGatePlan,
  createRsiHypothesisEvidenceReceipt,
  verifyRsiHypothesisEvidenceReceipt,
} from '../src/supervisor-rsi-hypothesis-evidence-gate.mjs';

const SOURCE_SHA = 'b71075d3534fd2cd4709c5ad17fd7d47f60c545f';
const CANDIDATE_SHA = 'c'.repeat(40);
const OBSERVED_AT = '2026-09-17T10:41:40.000Z';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}
function digest(value) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)), 'utf8').digest('hex')}`;
}
function observation(overrides = {}) {
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
      command_id: 'd5d24937-c7e6-4ce1-bf93-134495b1d039',
      action: 'SCROLL', command_lane: 'TAB_MUTATION', status: 'LEASED',
      leased_at: '2026-09-17T05:09:48.211Z', effect_bound_at: '2026-09-17T05:09:49.879Z', receipt_recorded_at: null,
    },
    command_payload_exposed: false, page_text_exposed: false, input_values_exposed: false, raw_network_exposed: false,
    execution_authority: false, production_mutation_authority: false, automatic_retry_allowed: false, authority_effect: false,
    ...overrides,
  });
}
function opportunity(sourceObservation, signal = 'RESULT_DELIVERY_STALL_AFTER_EFFECT_BINDING') {
  const found = sourceObservation.opportunities.find((entry) => entry.signal === signal);
  assert.ok(found, `missing opportunity ${signal}`);
  return found;
}
function candidateHandoff(experimentId, suffix = 'd') {
  const candidateId = `candidate_sha256_${suffix.repeat(64)}`;
  const core = {
    schema: RSI_ISOLATED_CANDIDATE_HANDOFF_SCHEMA,
    version: 1,
    experiment_id: experimentId,
    mutation_surface: 'BROWSER_RUNTIME',
    parent_sha: SOURCE_SHA,
    candidate_sha: CANDIDATE_SHA,
    candidate_capsule: {
      candidate_id: candidateId,
      source: { head: CANDIDATE_SHA },
      components: [{ path: 'apps/metaengine-browser/src/browser-window-runtime.mjs', change: 'MODIFY', digest: `sha256:${'a'.repeat(64)}` }],
    },
    candidate_verification: { ok: true, executable: false, promotion_authorized: false },
    sandbox_plan: { mode: 'PREPARE_ONLY' },
    sandbox_plan_verification: { execution_authorized: false },
    shadow_archive_proposal: { candidate_id: candidateId, parent_sha: SOURCE_SHA, candidate_sha: CANDIDATE_SHA },
    eligible_for_evaluation: true,
    eligible_for_promotion: false,
    materialization_replay_authorized: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return { ...core, handoff_digest: digest(core) };
}
function setup(signal = 'RESULT_DELIVERY_STALL_AFTER_EFFECT_BINDING', suffix = 'd') {
  const observed = observation();
  const sourceOpportunity = opportunity(observed, signal);
  const hypothesis = buildRsiExperimentHypothesis({ observation: observed, opportunity_id: sourceOpportunity.opportunity_id });
  const experiment = buildRsiDevosExperimentPlan({ observation: observed, opportunity_id: sourceOpportunity.opportunity_id, hypothesis });
  const handoff = candidateHandoff(experiment.experiment_id, suffix);
  const plan = createRsiHypothesisEvidenceGatePlan({ observation: observed, hypothesis, experiment_plan: experiment, candidate_handoff: handoff });
  return { observed, sourceOpportunity, hypothesis, experiment, handoff, plan };
}
function fullReceipts(plan, { falsify = null, inconclusive = null, failGate = null } = {}) {
  const required = plan.evidence_root.required_receipts.map((entry, index) => createRsiHypothesisEvidenceReceipt({
    plan,
    kind: 'REQUIRED_RECEIPT',
    evidence_class: entry.evidence_class,
    hypothesis_outcome: entry.evidence_class === falsify ? 'FALSIFIES' : entry.evidence_class === inconclusive ? 'INCONCLUSIVE' : 'SUPPORTS',
    evidence_refs: [`github:run:${1000 + index}`],
    paired_repetitions: 5,
  }));
  const gates = plan.evidence_root.hard_gates.map((entry, index) => createRsiHypothesisEvidenceReceipt({
    plan,
    kind: 'HARD_GATE',
    hard_gate: entry.hard_gate,
    result: entry.hard_gate === failGate ? 'FAIL' : 'PASS',
    evidence_refs: [`github:check:${2000 + index}`],
    paired_repetitions: 5,
  }));
  return [...required, ...gates];
}

test('V1.10 plan binds exact V1.9 hypothesis, experiment, candidate and immutable evidence protocol', () => {
  const { hypothesis, experiment, plan } = setup();
  assert.equal(plan.hypothesis.hypothesis_id, hypothesis.hypothesis_id);
  assert.equal(plan.hypothesis.hypothesis_digest, hypothesis.hypothesis_digest);
  assert.equal(plan.experiment.experiment_id, experiment.experiment_id);
  assert.equal(plan.candidate.parent_sha, SOURCE_SHA);
  assert.equal(plan.candidate.candidate_sha, CANDIDATE_SHA);
  assert.equal(plan.protocol.paired_parent_candidate_required, true);
  assert.equal(plan.protocol.holdout_required, true);
  assert.equal(plan.protocol.minimum_paired_repetitions, 5);
  assert.equal(plan.protocol.no_optional_stopping, true);
  assert.equal(plan.protocol.scalar_reward_authoritative, false);
  assert.equal(plan.evidence_root.candidate_can_register_producer, false);
  assert.equal(plan.execution_authority, false);
  assert.equal(plan.production_mutation_authority, false);
  assert.equal(plan.promotion_authority, false);
  assert.equal(plan.self_update_authority, false);
  assert.equal(plan.automatic_retry_allowed, false);
});

test('admission fails closed on hypothesis tampering', () => {
  const { observed, hypothesis, experiment, handoff } = setup();
  const forged = { ...hypothesis, claim: 'Accept any candidate after one successful sample.' };
  assert.throws(() => createRsiHypothesisEvidenceGatePlan({ observation: observed, hypothesis: forged, experiment_plan: experiment, candidate_handoff: handoff }), /rsi_hypothesis_evidence_hypothesis_mismatch/);
});

test('receipt replay across candidates is rejected by exact plan/candidate binding', () => {
  const first = setup('RESULT_DELIVERY_STALL_AFTER_EFFECT_BINDING', 'd');
  const second = setup('RESULT_DELIVERY_STALL_AFTER_EFFECT_BINDING', 'e');
  const receipt = createRsiHypothesisEvidenceReceipt({ plan: first.plan, kind: 'REQUIRED_RECEIPT', evidence_class: first.plan.evidence_root.required_receipts[0].evidence_class, hypothesis_outcome: 'SUPPORTS', evidence_refs: ['github:run:3001'] });
  assert.throws(() => verifyRsiHypothesisEvidenceReceipt({ plan: second.plan, receipt }), /rsi_hypothesis_evidence_receipt_plan_mismatch/);
});

test('candidate-authored and unregistered-producer receipts are rejected', () => {
  const { plan } = setup();
  const receipt = createRsiHypothesisEvidenceReceipt({ plan, kind: 'REQUIRED_RECEIPT', evidence_class: plan.evidence_root.required_receipts[0].evidence_class, hypothesis_outcome: 'SUPPORTS', evidence_refs: ['github:run:3002'] });
  assert.throws(() => verifyRsiHypothesisEvidenceReceipt({ plan, receipt: { ...receipt, authored_by_candidate: true } }), /rsi_hypothesis_evidence_receipt_origin_invalid/);
  assert.throws(() => verifyRsiHypothesisEvidenceReceipt({ plan, receipt: { ...receipt, producer_id: 'candidate\/forged-producer' } }), /rsi_hypothesis_evidence_receipt_producer_mismatch/);
});

test('protocol weakening is rejected: no single-run, no no-holdout, no optional stopping', () => {
  const { plan } = setup();
  const receipt = createRsiHypothesisEvidenceReceipt({ plan, kind: 'REQUIRED_RECEIPT', evidence_class: plan.evidence_root.required_receipts[0].evidence_class, hypothesis_outcome: 'SUPPORTS', evidence_refs: ['github:run:3003'] });
  assert.throws(() => verifyRsiHypothesisEvidenceReceipt({ plan, receipt: { ...receipt, evaluation_protocol: { ...receipt.evaluation_protocol, paired_repetitions: 1 } } }), /rsi_hypothesis_evidence_receipt_protocol_invalid/);
  assert.throws(() => verifyRsiHypothesisEvidenceReceipt({ plan, receipt: { ...receipt, evaluation_protocol: { ...receipt.evaluation_protocol, holdout_used: false } } }), /rsi_hypothesis_evidence_receipt_protocol_invalid/);
  assert.throws(() => verifyRsiHypothesisEvidenceReceipt({ plan, receipt: { ...receipt, evaluation_protocol: { ...receipt.evaluation_protocol, optional_stopping_used: true } } }), /rsi_hypothesis_evidence_receipt_protocol_invalid/);
});

test('missing precommitted evidence yields BLOCKED rather than partial positive verdict', () => {
  const { plan } = setup();
  const result = applyRsiHypothesisEvidenceGate({ plan, receipts: fullReceipts(plan).slice(0, -1) });
  assert.equal(result.complete, false);
  assert.equal(result.state, 'BLOCKED');
  assert.equal(result.disposition, 'INCOMPLETE_EVIDENCE');
  assert.equal(result.eligible_for_evaluator_mesh, false);
  assert.equal(result.promotion_authority, false);
  assert.equal(result.automatic_retry_allowed, false);
});

test('complete independent falsification becomes FALSIFIED without retry or promotion authority', () => {
  const { plan } = setup();
  const falsify = plan.evidence_root.required_receipts[0].evidence_class;
  const result = applyRsiHypothesisEvidenceGate({ plan, receipts: fullReceipts(plan, { falsify }) });
  assert.equal(result.complete, true);
  assert.equal(result.state, 'FALSIFIED');
  assert.equal(result.disposition, 'HYPOTHESIS_FALSIFIED');
  assert.deepEqual(result.falsifying_evidence_classes, [falsify]);
  assert.equal(result.evolution_archive_eligible, true);
  assert.equal(result.eligible_for_evaluator_mesh, false);
  assert.equal(result.replay_authorized, false);
  assert.equal(result.execution_authority, false);
  assert.equal(result.promotion_authority, false);
  assert.equal(result.self_update_authority, false);
  assert.equal(result.automatic_retry_allowed, false);
});

test('failed hard gate rejects candidate even when hypothesis receipts support claim', () => {
  const { plan } = setup();
  const failGate = plan.evidence_root.hard_gates[0].hard_gate;
  const result = applyRsiHypothesisEvidenceGate({ plan, receipts: fullReceipts(plan, { failGate }) });
  assert.equal(result.state, 'REJECTED');
  assert.equal(result.disposition, 'HARD_GATE_FAILED');
  assert.deepEqual(result.failed_hard_gates, [failGate]);
  assert.equal(result.eligible_for_evaluator_mesh, false);
});

test('only complete support with all hard gates PASS advances to generic Evaluator Mesh', () => {
  const { plan } = setup();
  const result = applyRsiHypothesisEvidenceGate({ plan, receipts: fullReceipts(plan) });
  assert.equal(result.complete, true);
  assert.equal(result.state, 'ADMITTED');
  assert.equal(result.disposition, 'HYPOTHESIS_SUPPORTED');
  assert.equal(result.eligible_for_evaluator_mesh, true);
  assert.equal(result.evolution_archive_eligible, true);
  assert.equal(result.promotion_authority, false);
  assert.equal(result.self_update_authority, false);
  assert.match(result.result_digest, /^sha256:[0-9a-f]{64}$/);
});

test('candidate mutation of supervisor trust root is rejected even if upstream fencing regresses', () => {
  const { observed, hypothesis, experiment, handoff } = setup();
  const core = structuredClone(handoff);
  delete core.handoff_digest;
  core.candidate_capsule.components = [{ path: 'apps/metaengine-browser/src/supervisor-rsi-hypothesis-evidence-gate.mjs', change: 'MODIFY', digest: `sha256:${'b'.repeat(64)}` }];
  const forgedHandoff = { ...core, handoff_digest: digest(core) };
  assert.throws(() => createRsiHypothesisEvidenceGatePlan({ observation: observed, hypothesis, experiment_plan: experiment, candidate_handoff: forgedHandoff }), /rsi_hypothesis_evidence_candidate_mutates_supervisor_root/);
});

test('unsupported signal cannot manufacture a V1.10 admission plan', () => {
  const observed = observation();
  const source = opportunity(observed);
  const alteredOpportunity = { ...source, signal: 'UNREGISTERED_TEST_SIGNAL' };
  const opportunityMaterial = { ...alteredOpportunity };
  delete opportunityMaterial.opportunity_id;
  alteredOpportunity.opportunity_id = `opp:${digest(opportunityMaterial).slice('sha256:'.length, 'sha256:'.length + 24)}`;
  const forgedObservation = { ...observed, opportunities: observed.opportunities.map((entry) => entry.opportunity_id === source.opportunity_id ? alteredOpportunity : entry) };
  const observationMaterial = { ...forgedObservation };
  delete observationMaterial.observation_digest;
  forgedObservation.observation_digest = digest(observationMaterial).slice('sha256:'.length);
  const forgedHypothesis = { ...buildRsiExperimentHypothesis({ observation: observed, opportunity_id: source.opportunity_id }), opportunity_id: alteredOpportunity.opportunity_id };
  assert.throws(() => createRsiHypothesisEvidenceGatePlan({ observation: forgedObservation, hypothesis: forgedHypothesis, experiment_plan: {}, candidate_handoff: {} }), /rsi_hypothesis_signal_unregistered/);
});
