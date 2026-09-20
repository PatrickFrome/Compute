import assert from 'node:assert/strict';
import test from 'node:test';

import { RSI_L1_RESULT_DELIVERY_EVALUATION_SCHEMA } from '../scripts/rsi-l1-result-delivery-evaluator.mjs';
import { buildL1EvidenceBundle, RSI_L1_EVIDENCE_PRODUCER_CONTEXT_SCHEMA } from '../scripts/rsi-l1-evidence-bundle.mjs';

const PARENT = '1'.repeat(40);
const CANDIDATE = '2'.repeat(40);
const COMPONENT = '3'.repeat(64);

function evaluation(overrides = {}) {
  const summary = {
    static_non_authority_surface: true,
    result_delivery_wall_clock_bounded: true,
    durable_receipt_reconciliation_required: true,
    absent_receipt_remains_ambiguous: true,
    healthy_control_negative_case: true,
    command_cycle_progress_recovers: true,
    immutable_receipt_redelivery: true,
    duplicate_irreversible_effect_count: 0,
    physical_effect_execution_count: 0,
    ambiguous_followup_mutation_count: 0,
    ...(overrides.summary || {}),
  };
  return {
    schema: RSI_L1_RESULT_DELIVERY_EVALUATION_SCHEMA,
    repetitions: 5,
    deadline_ms: 80,
    attempts: 3,
    outer_bound_ms: 450,
    static_proof: { ok: true, effect_executor_access: false, authority_effect: false },
    summary,
    runs: Array.from({ length: 5 }, (_, index) => ({ repetition: index + 1 })),
    passed: overrides.passed ?? Object.values(summary).every((value) => value === true || value === 0),
    candidate_execution_is_project_authority: false,
    browser_actuation_available: false,
    effect_executor_available: false,
    production_credentials_available: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_effect_retry_allowed: false,
    authority_effect: false,
  };
}

function build(measured) {
  return buildL1EvidenceBundle({
    evaluation: measured,
    parentSha: PARENT,
    candidateSha: CANDIDATE,
    componentSha256: COMPONENT,
    change: 'CREATE',
    runId: 35231551042,
    runAttempt: 1,
  });
}

test('trusted producer deterministically maps a passing sandbox measurement to complete ADMITTED evidence without authority', () => {
  const bundle = build(evaluation());
  assert.equal(bundle.context.schema, RSI_L1_EVIDENCE_PRODUCER_CONTEXT_SCHEMA);
  assert.equal(bundle.context.incident_binding.classification, 'HISTORICAL_PRODUCTION_DERIVED_REPLAY_FIXTURE');
  assert.equal(bundle.context.incident_binding.replay_source_sha_semantics, 'CURRENT_EXACT_PARENT_FOR_REPLAY_NOT_HISTORICAL_INCIDENT_BUILD_IDENTITY');
  assert.equal(bundle.plan.hypothesis.signal, 'RESULT_DELIVERY_STALL_AFTER_EFFECT_BINDING');
  assert.equal(bundle.plan.candidate.parent_sha, PARENT);
  assert.equal(bundle.plan.candidate.candidate_sha, CANDIDATE);
  assert.equal(bundle.result.complete, true);
  assert.equal(bundle.result.state, 'ADMITTED');
  assert.equal(bundle.result.disposition, 'HYPOTHESIS_SUPPORTED');
  assert.equal(bundle.receipts.length, bundle.plan.evidence_root.required_receipts.length + bundle.plan.evidence_root.hard_gates.length);
  assert.ok(bundle.receipts.every((receipt) => receipt.authored_by_candidate === false && receipt.external_evaluator === true && receipt.authority_effect === false));
  assert.equal(bundle.context.candidate_authored_verdict, false);
  assert.equal(bundle.context.promotion_authority, false);
  assert.equal(bundle.context.self_update_authority, false);
});

test('unbounded result delivery is rejected by hard gates even if candidate claims success elsewhere', () => {
  const measured = evaluation({
    passed: false,
    summary: {
      result_delivery_wall_clock_bounded: false,
      durable_receipt_reconciliation_required: false,
      command_cycle_progress_recovers: false,
    },
  });
  const bundle = build(measured);
  assert.equal(bundle.result.complete, true);
  assert.equal(bundle.result.state, 'REJECTED');
  assert.equal(bundle.result.disposition, 'HARD_GATE_FAILED');
  assert.ok(bundle.result.failed_hard_gates.includes('result_delivery_wall_clock_bounded==true'));
  assert.ok(bundle.result.failed_hard_gates.includes('durable_receipt_reconciliation_required==true'));
  assert.ok(bundle.result.failed_hard_gates.includes('command_cycle_progress_recovers==true'));
  assert.equal(bundle.context.evaluation_passed, false);
  assert.equal(bundle.context.authority_effect, false);
});

test('effect replay or mutation evidence cannot be hidden behind transport success', () => {
  const measured = evaluation({
    passed: false,
    summary: {
      duplicate_irreversible_effect_count: 1,
      physical_effect_execution_count: 2,
      ambiguous_followup_mutation_count: 1,
    },
  });
  const bundle = build(measured);
  assert.equal(bundle.result.state, 'REJECTED');
  assert.ok(bundle.result.failed_hard_gates.includes('duplicate_irreversible_effect_count==0'));
  assert.ok(bundle.result.failed_hard_gates.includes('physical_effect_execution_count<=1'));
  assert.ok(bundle.result.failed_hard_gates.includes('ambiguous_followup_mutation_count==0'));
  assert.equal(bundle.result.replay_authorized, false);
  assert.equal(bundle.result.automatic_retry_allowed, false);
});

test('producer refuses authority-bearing or malformed sandbox evaluation', () => {
  assert.throws(() => build({ ...evaluation(), promotion_authority: true }), /promotion_authority_invalid/);
  assert.throws(() => build({ ...evaluation(), automatic_effect_retry_allowed: true }), /retry_invalid/);
  assert.throws(() => build({ ...evaluation(), runs: [] }), /repetitions_invalid/);
  assert.throws(() => buildL1EvidenceBundle({ evaluation: evaluation(), parentSha: PARENT, candidateSha: PARENT, componentSha256: COMPONENT, change: 'CREATE', runId: 1, runAttempt: 1 }), /candidate_noop/);
});
