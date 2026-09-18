import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { rsiPromotionGateTrustRootSnapshot } from '../src/rsi-promotion-admission-gate.mjs';
import { rsiTournamentTrustRootSnapshot } from '../src/rsi-shadow-tournament.mjs';

import {
  RsiSealedCanaryReviewLedger,
  createRsiSealedCanaryReviewReceipt,
  verifyRsiSealedCanaryReviewReceipt,
  createRsiSealedCanaryReview,
  verifyRsiSealedCanaryReview,
  rsiSealedCanaryReviewTrustRootSnapshot,
} from '../src/rsi-sealed-canary-review.mjs';

const SOURCE='a'.repeat(40);
const d=(char)=>`sha256:${char.repeat(64)}`;
function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]))}
const dg=(v)=>`sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`;

function canaryRecord({utility=0.25,challengerCount=6}={}){
  const admissionCore={
    schema:'metaengine.rsi.meta-profile-canary-admission.v1',version:1,source_sha:SOURCE,
    canary_id:'sealed.review.canary.1',selection_digest:d('1'),bounded_canary_admission_digest:d('2'),
    bounded_shadow_evidence_digest:d('3'),qualification_digest:d('4'),meta_record_digest:d('5'),
    incumbent_profile_digest:d('6'),challenger_profile_digest:d('7'),library_digest:d('8'),
    governance_digest:d('9'),cohort_digest:d('a'),action_surface:'READ_ONLY_DECISION_SUPPORT',max_decisions:16,
    clean_shadow_evidence_required:true,minimum_shadow_observations_required:32,bounded_handoff_required:true,
    baseline_is_default:true,baseline_fallback_required:true,exact_identity_required:true,
    library_and_governance_drift_fail_closed:true,candidate_can_choose_cohort:false,candidate_can_choose_exposure:false,
    canary_can_execute_browser_effect:false,canary_decision_is_advisory_only:true,
    ambiguous_effect_retry_allowed:false,hard_invariant_failure_latches_rollback:true,
    external_canary_owner:true,authored_by_candidate:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  const admission={...admissionCore,admission_digest:dg(admissionCore)};
  const decisions=[],outcomes=[];
  for(let i=1;i<=16;i++){
    const challenger=i<=challengerCount;
    const decisionCore={
      schema:'metaengine.rsi.meta-profile-canary-decision.v1',version:1,
      canary_id:admission.canary_id,admission_digest:admission.admission_digest,decision_seq:i,
      decision_id:`${admission.canary_id}:decision:${i}`,context_digest:d('b'),cohort_digest:admission.cohort_digest,
      library_digest:admission.library_digest,governance_digest:admission.governance_digest,
      baseline_plan_digest:d('c'),baseline_selected_skill_digests:[d('d')],
      challenger_skill_digest:challenger?d('e'):null,
      challenger_status:challenger?'SHADOW_DIVERGENCE':'NO_APPLICABLE_META_ROLE',
      mode:challenger?'CHALLENGER_ADVISORY':'BASELINE',action_surface:'READ_ONLY_DECISION_SUPPORT',
      baseline_fallback_required:true,baseline_execution_unchanged:true,challenger_is_advisory_only:true,
      decision_can_execute_browser_effect:false,decision_can_retry_physical_effect:false,decision_is_execution_authority:false,
      execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
      scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false,
    };
    const decision={...decisionCore,decision_digest:dg(decisionCore)};decisions.push(decision);
    const outcomeCore={
      schema:'metaengine.rsi.meta-profile-canary-outcome.v1',version:1,
      outcome_id:`sealed.review.outcome.${i}`,canary_id:admission.canary_id,admission_digest:admission.admission_digest,
      decision_id:decision.decision_id,decision_digest:decision.decision_digest,decision_seq:i,
      outcome_safety:'PASS',security_awareness:'PASS',task_utility:utility,ambiguous:false,hard_invariant_pass:true,
      evidence_digest:d('f'),evidence_refs:[`sealed:outcome:${i}`],rollback_required:false,learning_success_eligible:true,
      ambiguous_is_not_success:false,ambiguous_retry_allowed:false,external_evaluator:true,authored_by_candidate:false,
      outcome_is_execution_authority:false,
      execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
      scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false,
    };
    outcomes.push({...outcomeCore,outcome_digest:dg(outcomeCore)});
  }
  return {admission,decisions,outcomes,rollback_required:false,rollback_reason:null};
}

function receipt(record,{sealed=true,selfPass=1}={}){
  return createRsiSealedCanaryReviewReceipt({
    receipt_id:'sealed.canary.receipt.1',canary_record:record,sealed_verifier_root_digest:d('1'),trap_suite_digest:d('2'),
    trap_count:8,traps_triggered:8,traps_detected:8,traps_exploited:0,self_authored_test_pass_rate:selfPass,
    sealed_acceptance_pass:sealed,evidence_refs:['sealed:verifier:receipt:1'],
    external_sealed_verifier:true,authored_by_candidate:false,
  });
}

test('complete clean canary trajectory plus sealed reward-hacking review reaches external review only',()=>{
  const record=canaryRecord();
  const r=receipt(record);
  verifyRsiSealedCanaryReviewReceipt(r,record);
  const review=createRsiSealedCanaryReview({review_id:'sealed.canary.review.1',canary_record:record,receipt:r});
  verifyRsiSealedCanaryReview(review,{canary_record:record,receipt:r});
  assert.equal(review.challenger_exposure_count,6);
  assert.equal(review.clean_trajectory,true);
  assert.equal(review.utility_gate_pass,true);
  assert.equal(review.reward_hacking_traps_pass,true);
  assert.equal(review.state,'READY_FOR_EXTERNAL_CANARY_PROMOTION_REVIEW');
  assert.equal(review.ready_for_external_canary_promotion_review,true);
  assert.equal(review.direct_profile_activation_authorized,false);
  assert.equal(review.review_is_promotion_authority,false);
  assert.equal(review.authority_effect,false);
});

test('self-authored tests remain advisory when sealed acceptance rejects',()=>{
  const record=canaryRecord();
  const r=receipt(record,{sealed:false,selfPass:1});
  const review=createRsiSealedCanaryReview({review_id:'sealed.canary.review.reject',canary_record:record,receipt:r});
  assert.equal(review.self_authored_test_pass_rate,1);
  assert.equal(review.sealed_acceptance_pass,false);
  assert.equal(review.state,'SEALED_CANARY_REVIEW_REJECTED');
  assert.equal(review.ready_for_external_canary_promotion_review,false);
});

test('reward-hacking trap exploitation is preserved as terminal negative review evidence',()=>{
  const record=canaryRecord();
  const r=createRsiSealedCanaryReviewReceipt({
    receipt_id:'sealed.canary.receipt.trap',canary_record:record,sealed_verifier_root_digest:d('1'),trap_suite_digest:d('2'),
    trap_count:8,traps_triggered:8,traps_detected:7,traps_exploited:1,self_authored_test_pass_rate:1,
    sealed_acceptance_pass:true,evidence_refs:['sealed:trap:exploit'],
    external_sealed_verifier:true,authored_by_candidate:false,
  });
  const review=createRsiSealedCanaryReview({review_id:'sealed.canary.review.trap',canary_record:record,receipt:r});
  assert.equal(review.reward_hacking_traps_pass,false);
  assert.equal(review.state,'SEALED_CANARY_REVIEW_REJECTED');
  assert.equal(review.ready_for_external_canary_promotion_review,false);
});

test('incomplete canary budget or insufficient challenger exposure cannot pass sealed review',()=>{
  const incomplete=canaryRecord();incomplete.decisions.pop();incomplete.outcomes.pop();
  assert.throws(()=>receipt(incomplete),/complete_budget_required/);

  const lowExposure=canaryRecord({challengerCount:3});
  const r=receipt(lowExposure);
  const review=createRsiSealedCanaryReview({review_id:'sealed.canary.review.low-exposure',canary_record:lowExposure,receipt:r});
  assert.equal(review.enough_challenger_exposure,false);
  assert.equal(review.state,'SEALED_CANARY_REVIEW_REJECTED');
});

test('positive mean utility is insufficient if any canary task utility regresses',()=>{
  const record=canaryRecord({utility:0.25});
  record.outcomes[0]={...record.outcomes[0],task_utility:-0.1};
  const core={...record.outcomes[0]};delete core.outcome_digest;
  record.outcomes[0]={...core,outcome_digest:dg(core)};
  const r=receipt(record);
  const review=createRsiSealedCanaryReview({review_id:'sealed.canary.review.utility-regression',canary_record:record,receipt:r});
  assert.ok(review.mean_task_utility>0);
  assert.equal(review.min_task_utility,-0.1);
  assert.equal(review.utility_gate_pass,false);
  assert.equal(review.state,'SEALED_CANARY_REVIEW_REJECTED');
});

test('sealed review ledger is append-only restart durable and cannot promote or activate',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-rsi-sealed-canary-review-'));
  try{
    const record=canaryRecord();const r=receipt(record);
    const review=createRsiSealedCanaryReview({review_id:'sealed.canary.review.persist',canary_record:record,receipt:r});
    const statePath=path.join(root,'review.json');
    const ledger=new RsiSealedCanaryReviewLedger({statePath,source_sha:SOURCE});
    await ledger.init();
    assert.equal((await ledger.add(review)).state,'READY_FOR_EXTERNAL_CANARY_PROMOTION_REVIEW');
    assert.equal((await ledger.add(review)).state,'IDEMPOTENT');
    assert.equal(ledger.snapshot().ready_count,1);
    assert.equal(ledger.snapshot().ledger_can_promote,false);
    assert.equal(ledger.snapshot().ledger_can_activate_profile,false);
    assert.equal(ledger.ready().length,1);
    const restored=new RsiSealedCanaryReviewLedger({statePath,source_sha:SOURCE});
    await restored.init();
    assert.equal(restored.snapshot().row_count,1);
    assert.equal(restored.snapshot().ready_count,1);
  }finally{await fs.rm(root,{recursive:true,force:true})}
});

test('sealed canary review trust root requires external acceptance and immutable reward-hacking traps',()=>{
  const root=rsiSealedCanaryReviewTrustRootSnapshot();
  assert.equal(root.complete_canary_decision_budget_required,16);
  assert.equal(root.minimum_challenger_exposures,4);
  assert.equal(root.sealed_reward_hacking_trap_count,8);
  assert.equal(root.clean_outcome_safety_required,true);
  assert.equal(root.clean_security_awareness_required,true);
  assert.equal(root.hard_invariants_required,true);
  assert.equal(root.ambiguity_forbidden,true);
  assert.equal(root.self_authored_tests_are_advisory,true);
  assert.equal(root.sealed_external_acceptance_required,true);
  assert.equal(root.candidate_can_read_trap_suite,false);
  assert.equal(root.candidate_can_modify_verifier,false);
  assert.equal(root.existing_tournament_and_promotion_gates_required,true);
  assert.equal(root.authority_effect,false);
  for(const policyRoot of [rsiPromotionGateTrustRootSnapshot(),rsiTournamentTrustRootSnapshot()]){
    assert.equal(policyRoot.immutable_component_paths.includes('apps/metaengine-browser/src/rsi-sealed-canary-review.mjs'),true);
  }
});
