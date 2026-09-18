import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import {
  createRsiMetaProfileCanaryDecision,
  createRsiMetaProfileCanaryOutcome,
} from '../src/rsi-meta-profile-canary-admission.mjs';
import {
  createRsiSealedCanaryReviewReceipt,
  createRsiSealedCanaryReview,
} from '../src/rsi-sealed-canary-review.mjs';
import {
  createRsiVerifierEvolutionPlan,
  verifyRsiVerifierEvolutionPlan,
  createRsiVerifierEvolutionEvaluationReceipt,
  verifyRsiVerifierEvolutionEvaluationReceipt,
  createRsiVerifierEvolutionAdmission,
  verifyRsiVerifierEvolutionAdmission,
  rsiVerifierEvolutionAdmissionTrustRootSnapshot,
} from '../src/rsi-verifier-evolution-admission.mjs';

const SOURCE='a'.repeat(40);
const d=(c)=>`sha256:${c.repeat(64)}`;
function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]))}
function dg(v){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`}

function canaryRecord(){
  const core={
    schema:'metaengine.rsi.meta-profile-canary-admission.v1',version:1,source_sha:SOURCE,
    canary_id:'verifier.evolution.canary.1',selection_digest:d('1'),bounded_canary_admission_digest:d('2'),
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
  const admission={...core,admission_digest:dg(core)};
  const decisions=[],outcomes=[];
  for(let i=1;i<=16;i++){
    const challenger=i<=6;
    const decision=createRsiMetaProfileCanaryDecision({
      admission,decision_seq:i,context_digest:dg({context:i}),baseline_plan_digest:dg({baseline:i}),
      baseline_selected_skill_digests:[d('b')],
      challenger_skill_digest:challenger?d('c'):null,
      challenger_status:challenger?'SHADOW_DIVERGENCE':'NO_APPLICABLE_META_ROLE',
      current_library_digest:admission.library_digest,current_governance_digest:admission.governance_digest,
      cohort_digest:admission.cohort_digest,
    });
    decisions.push(decision);
    outcomes.push(createRsiMetaProfileCanaryOutcome({
      admission,decision,outcome_id:`verifier.evolution.outcome.${i}`,
      outcome_safety:'PASS',security_awareness:'PASS',task_utility:0.2,
      ambiguous:false,hard_invariant_pass:true,evidence_digest:dg({outcome:i}),
      evidence_refs:[`verifier:evolution:outcome:${i}`],
      external_evaluator:true,authored_by_candidate:false,
    }));
  }
  return {admission,decisions,outcomes,rollback_required:false,rollback_reason:null};
}

function sealedEvidence(){
  const record=canaryRecord();
  const receipt=createRsiSealedCanaryReviewReceipt({
    receipt_id:'verifier.evolution.sealed.receipt.1',
    canary_record:record,
    sealed_verifier_root_digest:d('d'),
    trap_suite_digest:d('e'),
    transfer_holdout_digest:d('f'),
    trajectory_integrity_digest:d('1'),
    trap_count:8,traps_triggered:8,traps_detected:8,traps_exploited:0,
    self_authored_test_pass_rate:1,sealed_acceptance_pass:true,
    transfer_holdout_pass:true,trajectory_integrity_pass:true,
    evidence_refs:['verifier:evolution:sealed:receipt'],
    external_sealed_verifier:true,authored_by_candidate:false,
  });
  const review=createRsiSealedCanaryReview({
    review_id:'verifier.evolution.sealed.review.1',canary_record:record,receipt,
  });
  assert.equal(review.ready_for_external_canary_promotion_review,true);
  return {record,receipt,review};
}

function plan(overrides={}){
  const sealed=sealedEvidence();
  return createRsiVerifierEvolutionPlan({
    plan_id:'verifier.evolution.plan.1',source_sha:SOURCE,
    canary_record:sealed.record,sealed_review:sealed.review,sealed_receipt:sealed.receipt,
    candidate_verifier_root_digest:d('2'),candidate_artifact_digest:d('3'),
    candidate_build_receipt_digest:d('4'),secondary_verifier_root_digest:d('5'),
    hidden_anchor_suite_digest:d('6'),adversarial_prover_suite_digest:d('7'),
    reward_hacking_suite_digest:d('8'),transfer_holdout_digest:d('9'),
    trajectory_integrity_digest:d('a'),monitorability_suite_digest:d('b'),
    sabotage_suite_digest:d('c'),weak_to_strong_suite_digest:d('e'),
    external_plan_owner:true,authored_by_candidate:false,
    ...overrides,
  });
}

function receipt(p,role,{pass=true,idSuffix='1'}={}){
  const root=role==='PREDECESSOR'?p.predecessor_verifier_root_digest:p.secondary_verifier_root_digest;
  return createRsiVerifierEvolutionEvaluationReceipt({
    receipt_id:`verifier.evolution.${role.toLowerCase()}.receipt.${idSuffix}`,
    plan:p,evaluator_role:role,evaluator_root_digest:root,
    anchor_pass:pass,adversarial_attack_resistance_pass:pass,reward_hacking_trap_pass:pass,
    transfer_holdout_pass:pass,trajectory_integrity_pass:pass,monitorability_non_regression_pass:pass,
    sabotage_resistance_pass:pass,weak_to_strong_consistency_pass:pass,
    evaluation_evidence_digest:dg({role,pass,idSuffix}),
    evidence_refs:[`verifier:evolution:${role.toLowerCase()}:${idSuffix}`],
    external_evaluator:true,authored_by_candidate:false,
  });
}

test('dual independent verifier pass admits challenger only to verifier shadow',()=>{
  const p=plan();verifyRsiVerifierEvolutionPlan(p);
  const predecessor=receipt(p,'PREDECESSOR');
  const secondary=receipt(p,'SECONDARY');
  verifyRsiVerifierEvolutionEvaluationReceipt(predecessor,{plan:p});
  verifyRsiVerifierEvolutionEvaluationReceipt(secondary,{plan:p});
  const admission=createRsiVerifierEvolutionAdmission({
    admission_id:'verifier.evolution.admission.1',plan:p,
    predecessor_receipt:predecessor,secondary_receipt:secondary,
    external_admission_owner:true,authored_by_candidate:false,
  });
  verifyRsiVerifierEvolutionAdmission(admission,{plan:p,predecessor_receipt:predecessor,secondary_receipt:secondary});
  assert.equal(admission.state,'ELIGIBLE_FOR_VERIFIER_SHADOW');
  assert.equal(admission.eligible_for_verifier_shadow,true);
  assert.equal(admission.active_verifier_root_digest,p.predecessor_verifier_root_digest);
  assert.equal(admission.shadow_verifier_root_digest,p.candidate_verifier_root_digest);
  assert.equal(admission.verifier_root_replacement_authorized,false);
  assert.equal(admission.verifier_activation_authorized,false);
  assert.equal(admission.next_stage_requires_separate_sealed_admission,true);
  assert.equal(admission.authority_effect,false);
});

test('candidate, predecessor and secondary verifier roots must all be distinct',()=>{
  const sealed=sealedEvidence();
  assert.throws(()=>createRsiVerifierEvolutionPlan({
    plan_id:'verifier.evolution.plan.same-root',source_sha:SOURCE,
    canary_record:sealed.record,sealed_review:sealed.review,sealed_receipt:sealed.receipt,
    candidate_verifier_root_digest:sealed.receipt.sealed_verifier_root_digest,
    candidate_artifact_digest:d('3'),candidate_build_receipt_digest:d('4'),secondary_verifier_root_digest:d('5'),
    hidden_anchor_suite_digest:d('6'),adversarial_prover_suite_digest:d('7'),reward_hacking_suite_digest:d('8'),
    transfer_holdout_digest:d('9'),trajectory_integrity_digest:d('a'),monitorability_suite_digest:d('b'),
    sabotage_suite_digest:d('c'),weak_to_strong_suite_digest:d('e'),
    external_plan_owner:true,authored_by_candidate:false,
  }),/verifier_roots_must_be_distinct/);
});

test('predecessor secondary disagreement fails closed without shadow admission',()=>{
  const p=plan();
  const predecessor=receipt(p,'PREDECESSOR',{pass:true});
  const secondary=receipt(p,'SECONDARY',{pass:false});
  const admission=createRsiVerifierEvolutionAdmission({
    admission_id:'verifier.evolution.admission.disagreement',plan:p,
    predecessor_receipt:predecessor,secondary_receipt:secondary,
    external_admission_owner:true,authored_by_candidate:false,
  });
  assert.equal(admission.state,'REJECTED_VERIFIER_DISAGREEMENT');
  assert.equal(admission.verifier_disagreement,true);
  assert.equal(admission.eligible_for_verifier_shadow,false);
  assert.equal(admission.shadow_verifier_root_digest,null);
  assert.equal(admission.active_verifier_root_digest,p.predecessor_verifier_root_digest);
});

test('candidate-authored evaluation evidence is rejected',()=>{
  const p=plan();
  assert.throws(()=>createRsiVerifierEvolutionEvaluationReceipt({
    receipt_id:'verifier.evolution.self.receipt',plan:p,evaluator_role:'SECONDARY',
    evaluator_root_digest:p.secondary_verifier_root_digest,
    anchor_pass:true,adversarial_attack_resistance_pass:true,reward_hacking_trap_pass:true,
    transfer_holdout_pass:true,trajectory_integrity_pass:true,monitorability_non_regression_pass:true,
    sabotage_resistance_pass:true,weak_to_strong_consistency_pass:true,
    evaluation_evidence_digest:d('f'),evidence_refs:['verifier:evolution:self'],
    external_evaluator:false,authored_by_candidate:true,
  }),/external_evaluator_required/);
});

test('a receipt cannot be rebound to a different hidden suite or candidate',()=>{
  const p=plan();
  const r=receipt(p,'SECONDARY');
  const tampered={...r,hidden_anchor_suite_digest:d('f')};
  const core={...tampered};delete core.receipt_digest;
  tampered.receipt_digest=dg(core);
  assert.throws(()=>verifyRsiVerifierEvolutionEvaluationReceipt(tampered,{plan:p}),/receipt_binding_mismatch/);
});

test('self-rehashed verifier-root replacement downgrade is rejected',()=>{
  const p=plan();
  const predecessor=receipt(p,'PREDECESSOR');
  const secondary=receipt(p,'SECONDARY');
  const admission=createRsiVerifierEvolutionAdmission({
    admission_id:'verifier.evolution.admission.tamper',plan:p,
    predecessor_receipt:predecessor,secondary_receipt:secondary,
    external_admission_owner:true,authored_by_candidate:false,
  });
  const tampered={...admission,verifier_root_replacement_authorized:true};
  const core={...tampered};delete core.admission_digest;
  tampered.admission_digest=dg(core);
  assert.throws(()=>verifyRsiVerifierEvolutionAdmission(tampered,{
    plan:p,predecessor_receipt:predecessor,secondary_receipt:secondary,
  }),/admission_mismatch/);
});

test('verifier evolution trust root freezes recursive admission authority',()=>{
  const root=rsiVerifierEvolutionAdmissionTrustRootSnapshot();
  assert.equal(root.predecessor_verifier_frozen,true);
  assert.equal(root.distinct_secondary_verifier_required,true);
  assert.equal(root.candidate_verifier_shadow_only,true);
  assert.equal(root.candidate_cannot_self_certify,true);
  assert.equal(root.candidate_cannot_choose_hidden_suites,true);
  assert.equal(root.candidate_cannot_modify_constitution,true);
  assert.equal(root.disagreement_fails_closed,true);
  assert.equal(root.monitorability_non_regression_required,true);
  assert.equal(root.sabotage_resistance_required,true);
  assert.equal(root.weak_to_strong_consistency_required,true);
  assert.equal(root.active_verifier_remains_predecessor,true);
  assert.equal(root.verifier_root_replacement_authorized,false);
  assert.equal(root.existing_runtime_ledger_is_only_admission_receipt_plane,true);
  assert.equal(root.second_scheduler_allowed,false);
  assert.equal(root.authority_effect,false);
  assert.match(root.verifier_evolution_root_digest,/^sha256:[0-9a-f]{64}$/);
});
