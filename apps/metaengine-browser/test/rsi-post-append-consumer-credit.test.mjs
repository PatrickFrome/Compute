import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  createRsiPostAppendConsumerCredit,
  verifyRsiPostAppendConsumerCredit,
  rsiPostAppendConsumerCreditTrustRootSnapshot,
} from '../src/rsi-post-append-consumer-credit.mjs';

const SOURCE='a'.repeat(40);
function d(label){return `sha256:${crypto.createHash('sha256').update(label,'utf8').digest('hex')}`}

function provenance(){
  return Object.freeze({
    schema:'metaengine.rsi.admission-exposure-hold-provenance.v1',version:1,
    skill_digest:d('skill'),
    admission_attempt_id:'attempt.post-append.1',
    admission_attempt_digest:d('attempt'),
    admission_certificate_digest:d('certificate'),
    effect_id_digest:d('effect'),
    effect_executor_identity_digest:d('effect-executor'),
    idempotency_key_digest:d('idempotency'),
    admitted_successor_library_digest:d('library'),
    confirmed_transition_digest:d('transition'),
    current_library_digest:d('library'),
    current_governance_digest:d('governance'),
    admission_state:'CONFIRMED_APPLIED_STORAGE_ONLY',
    exposure_hold_observed:true,dormant_cap_observed:true,active_for_composition:false,
    retrieval_exposure_allowed:false,release_authority:false,
    execution_authority:false,browser_authority:false,task_authority:false,scheduler_authority:false,
    production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    automatic_retry_allowed:false,authority_effect:false,
    provenance_digest:d('provenance'),
  });
}

function args(overrides={}){
  const p=provenance();
  return {
    credit_id:'post.append.credit.1',
    source_sha:SOURCE,
    skill_digest:p.skill_digest,
    admission_provenance:p,
    current_library_digest:p.current_library_digest,
    current_governance_digest:p.current_governance_digest,
    target_consumer_identity_digest:d('consumer'),
    target_consumer_context_digest:d('context'),
    evaluation_contract_digest:d('contract'),
    matched_control_receipt_digest:d('control'),
    treatment_receipt_digest:d('treatment'),
    retention_evidence_digest:d('retention'),
    credit_assigner_identity_digest:d('credit-assigner'),
    generation:1,
    measured_net_delta:0.25,
    regression_count:0,
    negative_transfer_count:0,
    retention_regression_count:0,
    hard_invariant_failure_count:0,
    same_instances_pass:true,same_harness_pass:true,same_budget_pass:true,
    from_scratch_replay_pass:true,contamination_clear:true,retention_gate_pass:true,
    fresh_post_append_measurement:true,measurement_captured_after_admission:true,
    external_credit_assigner:true,authored_by_candidate:false,
    ...overrides,
  };
}

test('fresh post-append target-consumer evidence yields positive zero-authority credit',()=>{
  const input=args();
  const receipt=createRsiPostAppendConsumerCredit(input);
  assert.equal(receipt.credit_sign,'POSITIVE');
  assert.equal(receipt.storage_admission_is_credit,false);
  assert.equal(receipt.release_review_is_credit,false);
  assert.equal(receipt.review_digest_used_as_credit,false);
  assert.equal(receipt.credit_is_activation_authority,false);
  assert.equal(receipt.credit_is_exposure_release_authority,false);
  assert.equal(receipt.authority_effect,false);
  assert.equal(verifyRsiPostAppendConsumerCredit(receipt,{
    source_sha:SOURCE,skill_digest:input.skill_digest,admission_provenance:input.admission_provenance,
    current_library_digest:input.current_library_digest,current_governance_digest:input.current_governance_digest,
  }).credit_digest,receipt.credit_digest);
});

test('post-append credit fails closed on stale lineage, candidate authorship, and role collapse',()=>{
  assert.throws(()=>createRsiPostAppendConsumerCredit(args({
    current_governance_digest:d('stale-governance'),
  })),/governance_drift/);
  assert.throws(()=>createRsiPostAppendConsumerCredit(args({
    external_credit_assigner:false,authored_by_candidate:true,
  })),/external_assigner_required/);
  assert.throws(()=>createRsiPostAppendConsumerCredit(args({
    credit_assigner_identity_digest:d('effect-executor'),
  })),/assigner_effect_executor_collapse/);
});

test('retention or negative-transfer regression cannot manufacture positive credit',()=>{
  const retention=createRsiPostAppendConsumerCredit(args({
    retention_gate_pass:false,retention_regression_count:1,measured_net_delta:0.4,
  }));
  assert.equal(retention.credit_sign,'NEGATIVE');
  const transfer=createRsiPostAppendConsumerCredit(args({
    negative_transfer_count:1,measured_net_delta:0.4,
  }));
  assert.equal(transfer.credit_sign,'NEGATIVE');
  const flat=createRsiPostAppendConsumerCredit(args({measured_net_delta:0}));
  assert.equal(flat.credit_sign,'INSUFFICIENT');
});

test('post-append credit trust root keeps measurement and effect authority separated',()=>{
  const root=rsiPostAppendConsumerCreditTrustRootSnapshot();
  assert.equal(root.fresh_post_append_measurement_required,true);
  assert.equal(root.target_consumer_identity_required,true);
  assert.equal(root.retention_gate_required_for_positive_credit,true);
  assert.equal(root.admission_storage_is_not_credit,true);
  assert.equal(root.exposure_review_is_not_credit,true);
  assert.equal(root.positive_credit_is_not_activation_authority,true);
  assert.equal(root.positive_credit_is_not_release_authority,true);
  assert.equal(root.authority_effect,false);
});
