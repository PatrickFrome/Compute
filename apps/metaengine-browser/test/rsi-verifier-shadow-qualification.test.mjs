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
  createRsiVerifierEvolutionEvaluationReceipt,
  createRsiVerifierEvolutionAdmission,
} from '../src/rsi-verifier-evolution-admission.mjs';
import {
  createRsiVerifierShadowObservation,
  verifyRsiVerifierShadowObservation,
  createRsiVerifierShadowQualification,
  verifyRsiVerifierShadowQualification,
  rsiVerifierShadowQualificationTrustRootSnapshot,
} from '../src/rsi-verifier-shadow-qualification.mjs';

const SOURCE='a'.repeat(40);
const d=(c)=>`sha256:${c.repeat(64)}`;
function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]))}
function dg(v){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`}

function canaryRecord(){
  const core={
    schema:'metaengine.rsi.meta-profile-canary-admission.v1',version:1,source_sha:SOURCE,
    canary_id:'verifier.shadow.canary.1',selection_digest:d('1'),bounded_canary_admission_digest:d('2'),
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
      baseline_selected_skill_digests:[d('b')],challenger_skill_digest:challenger?d('c'):null,
      challenger_status:challenger?'SHADOW_DIVERGENCE':'NO_APPLICABLE_META_ROLE',
      current_library_digest:admission.library_digest,current_governance_digest:admission.governance_digest,
      cohort_digest:admission.cohort_digest,
    });
    decisions.push(decision);
    outcomes.push(createRsiMetaProfileCanaryOutcome({
      admission,decision,outcome_id:`verifier.shadow.canary.outcome.${i}`,
      outcome_safety:'PASS',security_awareness:'PASS',task_utility:0.25,
      ambiguous:false,hard_invariant_pass:true,evidence_digest:dg({canaryOutcome:i}),
      evidence_refs:[`verifier:shadow:canary:outcome:${i}`],
      external_evaluator:true,authored_by_candidate:false,
    }));
  }
  return {admission,decisions,outcomes,rollback_required:false,rollback_reason:null};
}

function evolutionBundle(){
  const record=canaryRecord();
  const sealedReceipt=createRsiSealedCanaryReviewReceipt({
    receipt_id:'verifier.shadow.sealed.receipt.1',canary_record:record,
    sealed_verifier_root_digest:d('d'),trap_suite_digest:d('e'),
    transfer_holdout_digest:d('f'),trajectory_integrity_digest:d('1'),
    trap_count:8,traps_triggered:8,traps_detected:8,traps_exploited:0,
    self_authored_test_pass_rate:1,sealed_acceptance_pass:true,
    transfer_holdout_pass:true,trajectory_integrity_pass:true,
    evidence_refs:['verifier:shadow:sealed:receipt'],
    external_sealed_verifier:true,authored_by_candidate:false,
  });
  const sealedReview=createRsiSealedCanaryReview({
    review_id:'verifier.shadow.sealed.review.1',canary_record:record,receipt:sealedReceipt,
  });
  const plan=createRsiVerifierEvolutionPlan({
    plan_id:'verifier.shadow.evolution.plan.1',source_sha:SOURCE,
    canary_record:record,sealed_review:sealedReview,sealed_receipt:sealedReceipt,
    candidate_verifier_root_digest:d('2'),candidate_artifact_digest:d('3'),
    candidate_build_receipt_digest:d('4'),secondary_verifier_root_digest:d('5'),
    hidden_anchor_suite_digest:d('6'),adversarial_prover_suite_digest:d('7'),
    reward_hacking_suite_digest:d('8'),transfer_holdout_digest:d('9'),
    trajectory_integrity_digest:d('a'),monitorability_suite_digest:d('b'),
    sabotage_suite_digest:d('c'),weak_to_strong_suite_digest:d('e'),
    external_plan_owner:true,authored_by_candidate:false,
  });
  const makeReceipt=(role)=>createRsiVerifierEvolutionEvaluationReceipt({
    receipt_id:`verifier.shadow.${role.toLowerCase()}.receipt.1`,plan,evaluator_role:role,
    evaluator_root_digest:role==='PREDECESSOR'?plan.predecessor_verifier_root_digest:plan.secondary_verifier_root_digest,
    anchor_pass:true,adversarial_attack_resistance_pass:true,reward_hacking_trap_pass:true,
    transfer_holdout_pass:true,trajectory_integrity_pass:true,monitorability_non_regression_pass:true,
    sabotage_resistance_pass:true,weak_to_strong_consistency_pass:true,
    evaluation_evidence_digest:dg({role}),evidence_refs:[`verifier:shadow:${role.toLowerCase()}:receipt`],
    external_evaluator:true,authored_by_candidate:false,
  });
  const predecessorReceipt=makeReceipt('PREDECESSOR');
  const secondaryReceipt=makeReceipt('SECONDARY');
  const admission=createRsiVerifierEvolutionAdmission({
    admission_id:'verifier.shadow.evolution.admission.1',plan,
    predecessor_receipt:predecessorReceipt,secondary_receipt:secondaryReceipt,
    external_admission_owner:true,authored_by_candidate:false,
  });
  assert.equal(admission.eligible_for_verifier_shadow,true);
  return {plan,admission,predecessorReceipt,secondaryReceipt};
}

const CATEGORIES=[
  'ANCHOR','ADVERSARIAL_PROVER','REWARD_HACK','TRANSFER',
  'TRAJECTORY','MONITORABILITY','SABOTAGE','WEAK_TO_STRONG',
];

function observations(bundle,{repair=true,regressionIndex=null,secondaryWrongIndex=null,integrityFailIndex=null,categoryOverride=null}={}){
  const rows=[];
  let idx=0;
  for(const cat of CATEGORIES){
    for(let copy=0;copy<2;copy++){
      idx+=1;
      const reference=idx%2===0?'ACCEPT':'REJECT';
      let predecessor=reference;
      let candidate=reference;
      let secondary=reference;
      if(repair&&idx===1)predecessor=reference==='ACCEPT'?'REJECT':'ACCEPT';
      if(regressionIndex===idx)candidate=reference==='ACCEPT'?'REJECT':'ACCEPT';
      if(secondaryWrongIndex===idx)secondary=reference==='ACCEPT'?'REJECT':'ACCEPT';
      rows.push(createRsiVerifierShadowObservation({
        observation_id:`verifier.shadow.observation.${idx}`,
        observation_index:idx,
        admission:bundle.admission,plan:bundle.plan,
        predecessor_receipt:bundle.predecessorReceipt,secondary_receipt:bundle.secondaryReceipt,
        case_category:categoryOverride?.[idx]||cat,
        case_digest:dg({case:idx}),
        reference_verdict:reference,predecessor_verdict:predecessor,
        candidate_verdict:candidate,secondary_verdict:secondary,
        evaluator_integrity_pass:integrityFailIndex===idx?false:true,
        trajectory_replay_pass:true,
        evidence_digest:dg({evidence:idx}),evidence_refs:[`verifier:shadow:evidence:${idx}`],
        external_auditor:true,authored_by_candidate:false,
      }));
    }
  }
  return rows;
}

test('full hidden coverage with zero regression and one blind-spot repair qualifies verifier shadow only',()=>{
  const bundle=evolutionBundle();
  const rows=observations(bundle);
  rows.forEach(row=>verifyRsiVerifierShadowObservation(row,{
    admission:bundle.admission,plan:bundle.plan,
    predecessor_receipt:bundle.predecessorReceipt,secondary_receipt:bundle.secondaryReceipt,
  }));
  const q=createRsiVerifierShadowQualification({
    qualification_id:'verifier.shadow.qualification.1',
    admission:bundle.admission,plan:bundle.plan,
    predecessor_receipt:bundle.predecessorReceipt,secondary_receipt:bundle.secondaryReceipt,
    observations:rows,external_qualification_owner:true,authored_by_candidate:false,
  });
  verifyRsiVerifierShadowQualification(q,{
    admission:bundle.admission,plan:bundle.plan,
    predecessor_receipt:bundle.predecessorReceipt,secondary_receipt:bundle.secondaryReceipt,
    observations:rows,
  });
  assert.equal(q.state,'QUALIFIED_VERIFIER_SHADOW');
  assert.equal(q.qualified_for_verifier_shadow_continuation,true);
  assert.equal(q.blind_spot_repair_count,1);
  assert.equal(q.candidate_regression_count,0);
  assert.equal(q.candidate_reference_error_count,0);
  assert.equal(q.secondary_reference_error_count,0);
  assert.equal(q.audit_integrity_pass,true);
  assert.equal(q.pareto_nonregression_pass,true);
  assert.equal(q.active_verifier_root_digest,bundle.plan.predecessor_verifier_root_digest);
  assert.equal(q.shadow_verifier_root_digest,bundle.plan.candidate_verifier_root_digest);
  assert.equal(q.verifier_root_replacement_authorized,false);
  assert.equal(q.verifier_activation_authorized,false);
  assert.equal(q.authority_effect,false);
});

test('perfect imitation without a verified blind-spot repair is insufficient',()=>{
  const bundle=evolutionBundle();
  const q=createRsiVerifierShadowQualification({
    qualification_id:'verifier.shadow.qualification.no-repair',
    admission:bundle.admission,plan:bundle.plan,
    predecessor_receipt:bundle.predecessorReceipt,secondary_receipt:bundle.secondaryReceipt,
    observations:observations(bundle,{repair:false}),
    external_qualification_owner:true,authored_by_candidate:false,
  });
  assert.equal(q.state,'INSUFFICIENT_VERIFIER_SHADOW_IMPROVEMENT');
  assert.equal(q.verified_blind_spot_repair_pass,false);
  assert.equal(q.qualified_for_verifier_shadow_continuation,false);
  assert.equal(q.shadow_verifier_root_digest,null);
});

test('one candidate regression fails closed even when another blind spot is repaired',()=>{
  const bundle=evolutionBundle();
  const q=createRsiVerifierShadowQualification({
    qualification_id:'verifier.shadow.qualification.regression',
    admission:bundle.admission,plan:bundle.plan,
    predecessor_receipt:bundle.predecessorReceipt,secondary_receipt:bundle.secondaryReceipt,
    observations:observations(bundle,{repair:true,regressionIndex:2}),
    external_qualification_owner:true,authored_by_candidate:false,
  });
  assert.equal(q.state,'REJECTED_VERIFIER_REGRESSION');
  assert.equal(q.candidate_regression_count,1);
  assert.equal(q.pareto_nonregression_pass,false);
  assert.equal(q.qualified_for_verifier_shadow_continuation,false);
});

test('secondary audit disagreement or evaluator-integrity failure blocks qualification',()=>{
  const bundle=evolutionBundle();
  for(const rows of [
    observations(bundle,{secondaryWrongIndex:3}),
    observations(bundle,{integrityFailIndex:4}),
  ]){
    const q=createRsiVerifierShadowQualification({
      qualification_id:`verifier.shadow.qualification.audit.${rows[2].secondary_matches_reference?'integrity':'secondary'}`,
      admission:bundle.admission,plan:bundle.plan,
      predecessor_receipt:bundle.predecessorReceipt,secondary_receipt:bundle.secondaryReceipt,
      observations:rows,external_qualification_owner:true,authored_by_candidate:false,
    });
    assert.equal(q.state,'REJECTED_SHADOW_AUDIT_INTEGRITY');
    assert.equal(q.audit_integrity_pass,false);
    assert.equal(q.qualified_for_verifier_shadow_continuation,false);
  }
});

test('fixed two-per-category coverage cannot be replaced by cherry-picked cases',()=>{
  const bundle=evolutionBundle();
  const override={16:'ANCHOR'};
  assert.throws(()=>createRsiVerifierShadowQualification({
    qualification_id:'verifier.shadow.qualification.bad-coverage',
    admission:bundle.admission,plan:bundle.plan,
    predecessor_receipt:bundle.predecessorReceipt,secondary_receipt:bundle.secondaryReceipt,
    observations:observations(bundle,{categoryOverride:override}),
    external_qualification_owner:true,authored_by_candidate:false,
  }),/category_coverage_invalid/);
});

test('candidate cannot author verifier-shadow observations',()=>{
  const bundle=evolutionBundle();
  assert.throws(()=>createRsiVerifierShadowObservation({
    observation_id:'verifier.shadow.observation.self',observation_index:1,
    admission:bundle.admission,plan:bundle.plan,
    predecessor_receipt:bundle.predecessorReceipt,secondary_receipt:bundle.secondaryReceipt,
    case_category:'ANCHOR',case_digest:d('f'),reference_verdict:'ACCEPT',
    predecessor_verdict:'ACCEPT',candidate_verdict:'ACCEPT',secondary_verdict:'ACCEPT',
    evaluator_integrity_pass:true,trajectory_replay_pass:true,evidence_digest:d('1'),
    evidence_refs:['verifier:shadow:self'],external_auditor:false,authored_by_candidate:true,
  }),/external_auditor_required/);
});

test('verifier shadow trust root forbids scalar or majority-vote authority',()=>{
  const root=rsiVerifierShadowQualificationTrustRootSnapshot();
  assert.equal(root.fixed_observation_count,16);
  assert.equal(root.observations_per_category,2);
  assert.equal(root.full_category_coverage_required,true);
  assert.equal(root.pareto_nonregression_required,true);
  assert.equal(root.zero_candidate_reference_errors_required,true);
  assert.equal(root.at_least_one_verified_blind_spot_repair_required,true);
  assert.equal(root.majority_vote_authoritative,false);
  assert.equal(root.scalar_score_authoritative,false);
  assert.equal(root.raw_case_content_allowed,false);
  assert.equal(root.candidate_can_choose_cases,false);
  assert.equal(root.active_verifier_remains_predecessor,true);
  assert.equal(root.verifier_root_replacement_authorized,false);
  assert.equal(root.existing_runtime_ledger_is_only_qualification_receipt_plane,true);
  assert.equal(root.second_scheduler_allowed,false);
  assert.equal(root.authority_effect,false);
  assert.match(root.verifier_shadow_root_digest,/^sha256:[0-9a-f]{64}$/);
});
