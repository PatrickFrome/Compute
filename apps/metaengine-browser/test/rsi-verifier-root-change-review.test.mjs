import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import { createRsiMetaProfileCanaryDecision,createRsiMetaProfileCanaryOutcome } from '../src/rsi-meta-profile-canary-admission.mjs';
import { createRsiSealedCanaryReviewReceipt,createRsiSealedCanaryReview } from '../src/rsi-sealed-canary-review.mjs';
import {
  createRsiVerifierEvolutionPlan,createRsiVerifierEvolutionEvaluationReceipt,createRsiVerifierEvolutionAdmission,
} from '../src/rsi-verifier-evolution-admission.mjs';
import {
  createRsiVerifierShadowObservation,createRsiVerifierShadowQualification,
} from '../src/rsi-verifier-shadow-qualification.mjs';
import {
  createRsiVerifierRootChangeProposal,verifyRsiVerifierRootChangeProposal,
  createRsiVerifierRootChangeApproval,verifyRsiVerifierRootChangeApproval,
  createRsiVerifierRootChangeReview,verifyRsiVerifierRootChangeReview,
  rsiVerifierRootChangeReviewTrustRootSnapshot,
} from '../src/rsi-verifier-root-change-review.mjs';

const SOURCE='a'.repeat(40);
const d=(c)=>`sha256:${c.repeat(64)}`;
function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]))}
function dg(v){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`}

function canaryRecord(){
  const core={
    schema:'metaengine.rsi.meta-profile-canary-admission.v1',version:1,source_sha:SOURCE,
    canary_id:'root.change.canary.1',selection_digest:d('1'),bounded_canary_admission_digest:d('2'),
    bounded_shadow_evidence_digest:d('3'),qualification_digest:d('4'),meta_record_digest:d('5'),
    incumbent_profile_digest:d('6'),challenger_profile_digest:d('7'),library_digest:d('8'),
    governance_digest:d('9'),cohort_digest:d('a'),action_surface:'READ_ONLY_DECISION_SUPPORT',max_decisions:16,
    clean_shadow_evidence_required:true,minimum_shadow_observations_required:32,bounded_handoff_required:true,
    baseline_is_default:true,baseline_fallback_required:true,exact_identity_required:true,
    library_and_governance_drift_fail_closed:true,candidate_can_choose_cohort:false,candidate_can_choose_exposure:false,
    canary_can_execute_browser_effect:false,canary_decision_is_advisory_only:true,ambiguous_effect_retry_allowed:false,
    hard_invariant_failure_latches_rollback:true,external_canary_owner:true,authored_by_candidate:false,
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
      admission,decision,outcome_id:`root.change.canary.outcome.${i}`,outcome_safety:'PASS',
      security_awareness:'PASS',task_utility:0.3,ambiguous:false,hard_invariant_pass:true,
      evidence_digest:dg({outcome:i}),evidence_refs:[`root:change:canary:outcome:${i}`],
      external_evaluator:true,authored_by_candidate:false,
    }));
  }
  return {admission,decisions,outcomes,rollback_required:false,rollback_reason:null};
}

const CATEGORIES=['ANCHOR','ADVERSARIAL_PROVER','REWARD_HACK','TRANSFER','TRAJECTORY','MONITORABILITY','SABOTAGE','WEAK_TO_STRONG'];

function shadowBundle(){
  const record=canaryRecord();
  const sealedReceipt=createRsiSealedCanaryReviewReceipt({
    receipt_id:'root.change.sealed.receipt.1',canary_record:record,sealed_verifier_root_digest:d('d'),
    trap_suite_digest:d('e'),transfer_holdout_digest:d('f'),trajectory_integrity_digest:d('1'),
    trap_count:8,traps_triggered:8,traps_detected:8,traps_exploited:0,self_authored_test_pass_rate:1,
    sealed_acceptance_pass:true,transfer_holdout_pass:true,trajectory_integrity_pass:true,
    evidence_refs:['root:change:sealed:receipt'],external_sealed_verifier:true,authored_by_candidate:false,
  });
  const sealedReview=createRsiSealedCanaryReview({
    review_id:'root.change.sealed.review.1',canary_record:record,receipt:sealedReceipt,
  });
  const plan=createRsiVerifierEvolutionPlan({
    plan_id:'root.change.evolution.plan.1',source_sha:SOURCE,canary_record:record,sealed_review:sealedReview,sealed_receipt:sealedReceipt,
    candidate_verifier_root_digest:d('2'),candidate_artifact_digest:d('3'),candidate_build_receipt_digest:d('4'),
    secondary_verifier_root_digest:d('5'),hidden_anchor_suite_digest:d('6'),adversarial_prover_suite_digest:d('7'),
    reward_hacking_suite_digest:d('8'),transfer_holdout_digest:d('9'),trajectory_integrity_digest:d('a'),
    monitorability_suite_digest:d('b'),sabotage_suite_digest:d('c'),weak_to_strong_suite_digest:d('e'),
    external_plan_owner:true,authored_by_candidate:false,
  });
  const mk=(role)=>createRsiVerifierEvolutionEvaluationReceipt({
    receipt_id:`root.change.${role.toLowerCase()}.receipt`,plan,evaluator_role:role,
    evaluator_root_digest:role==='PREDECESSOR'?plan.predecessor_verifier_root_digest:plan.secondary_verifier_root_digest,
    anchor_pass:true,adversarial_attack_resistance_pass:true,reward_hacking_trap_pass:true,transfer_holdout_pass:true,
    trajectory_integrity_pass:true,monitorability_non_regression_pass:true,sabotage_resistance_pass:true,
    weak_to_strong_consistency_pass:true,evaluation_evidence_digest:dg({role}),
    evidence_refs:[`root:change:${role.toLowerCase()}:receipt`],external_evaluator:true,authored_by_candidate:false,
  });
  const predecessorReceipt=mk('PREDECESSOR'),secondaryReceipt=mk('SECONDARY');
  const admission=createRsiVerifierEvolutionAdmission({
    admission_id:'root.change.evolution.admission.1',plan,predecessor_receipt:predecessorReceipt,
    secondary_receipt:secondaryReceipt,external_admission_owner:true,authored_by_candidate:false,
  });
  const observations=[];
  let idx=0;
  for(const cat of CATEGORIES){
    for(let copy=0;copy<2;copy++){
      idx+=1;
      const reference=idx%2===0?'ACCEPT':'REJECT';
      const predecessor=idx===1?(reference==='ACCEPT'?'REJECT':'ACCEPT'):reference;
      observations.push(createRsiVerifierShadowObservation({
        observation_id:`root.change.shadow.observation.${idx}`,observation_index:idx,
        admission,plan,predecessor_receipt:predecessorReceipt,secondary_receipt:secondaryReceipt,
        case_category:cat,case_digest:dg({case:idx}),reference_verdict:reference,
        predecessor_verdict:predecessor,candidate_verdict:reference,secondary_verdict:reference,
        evaluator_integrity_pass:true,trajectory_replay_pass:true,evidence_digest:dg({shadowEvidence:idx}),
        evidence_refs:[`root:change:shadow:evidence:${idx}`],external_auditor:true,authored_by_candidate:false,
      }));
    }
  }
  const qualification=createRsiVerifierShadowQualification({
    qualification_id:'root.change.shadow.qualification.1',admission,plan,
    predecessor_receipt:predecessorReceipt,secondary_receipt:secondaryReceipt,observations,
    external_qualification_owner:true,authored_by_candidate:false,
  });
  assert.equal(qualification.state,'QUALIFIED_VERIFIER_SHADOW');
  return {plan,admission,predecessorReceipt,secondaryReceipt,observations,qualification};
}

function proposal(bundle,overrides={}){
  return createRsiVerifierRootChangeProposal({
    proposal_id:'root.change.proposal.1',qualification:bundle.qualification,observations:bundle.observations,
    admission:bundle.admission,plan:bundle.plan,predecessor_receipt:bundle.predecessorReceipt,
    secondary_receipt:bundle.secondaryReceipt,current_root_generation:7,next_root_generation:8,
    prior_root_history_digest:d('f'),compatibility_manifest_digest:d('1'),compatibility_evidence_digest:d('2'),
    external_proposal_owner:true,authored_by_candidate:false,...overrides,
  });
}
function approval(p,role,{pass=true,idSuffix='1'}={}){
  return createRsiVerifierRootChangeApproval({
    approval_id:`root.change.${role.toLowerCase()}.approval.${idSuffix}`,proposal:p,approver_role:role,
    approver_root_digest:role==='PREDECESSOR_TRUST'?p.predecessor_verifier_root_digest:p.secondary_verifier_root_digest,
    qualification_binding_pass:pass,constitution_unchanged_pass:pass,compatibility_pass:pass,
    rollback_protection_pass:pass,root_history_continuity_pass:pass,independent_audit_pass:pass,
    shadow_nonregression_pass:pass,approval_evidence_digest:dg({role,pass,idSuffix}),
    evidence_refs:[`root:change:${role.toLowerCase()}:${idSuffix}`],external_approver:true,authored_by_candidate:false,
  });
}

test('monotonic 2-of-2 root-change review is ready only for external controller review',()=>{
  const bundle=shadowBundle(),p=proposal(bundle);verifyRsiVerifierRootChangeProposal(p);
  const predecessor=approval(p,'PREDECESSOR_TRUST'),secondary=approval(p,'SECONDARY_TRUST');
  verifyRsiVerifierRootChangeApproval(predecessor,{proposal:p});
  verifyRsiVerifierRootChangeApproval(secondary,{proposal:p});
  const review=createRsiVerifierRootChangeReview({
    review_id:'root.change.review.1',proposal:p,predecessor_approval:predecessor,secondary_approval:secondary,
    external_review_owner:true,authored_by_candidate:false,
  });
  verifyRsiVerifierRootChangeReview(review,{proposal:p,predecessor_approval:predecessor,secondary_approval:secondary});
  assert.equal(review.state,'READY_FOR_EXTERNAL_TRUST_ROOT_CONTROLLER_REVIEW');
  assert.equal(review.ready_for_external_trust_root_controller_review,true);
  assert.equal(review.current_root_generation,7);
  assert.equal(review.next_root_generation,8);
  assert.equal(review.active_verifier_root_digest,p.predecessor_verifier_root_digest);
  assert.equal(review.proposed_verifier_root_digest,p.candidate_verifier_root_digest);
  assert.equal(review.active_verifier_remains_predecessor,true);
  assert.equal(review.root_change_authorized,false);
  assert.equal(review.verifier_activation_authorized,false);
  assert.equal(review.trust_root_update_token,null);
  assert.equal(review.authority_effect,false);
});

test('root generation cannot skip forward or roll backward',()=>{
  const bundle=shadowBundle();
  assert.throws(()=>proposal(bundle,{current_root_generation:7,next_root_generation:9}),/increment_by_one/);
  assert.throws(()=>proposal(bundle,{current_root_generation:7,next_root_generation:6}),/increment_by_one/);
});

test('self-rehashed root history tampering is rejected',()=>{
  const bundle=shadowBundle(),p=proposal(bundle);
  const tampered={...p,next_root_history_digest:d('3')};
  const core={...tampered};delete core.proposal_digest;
  tampered.proposal_digest=dg(core);
  assert.throws(()=>verifyRsiVerifierRootChangeProposal(tampered),/history_chain_mismatch/);
});

test('candidate verifier cannot approve its own root change',()=>{
  const bundle=shadowBundle(),p=proposal(bundle);
  assert.throws(()=>createRsiVerifierRootChangeApproval({
    approval_id:'root.change.self.approval',proposal:p,approver_role:'SECONDARY_TRUST',
    approver_root_digest:p.candidate_verifier_root_digest,qualification_binding_pass:true,
    constitution_unchanged_pass:true,compatibility_pass:true,rollback_protection_pass:true,
    root_history_continuity_pass:true,independent_audit_pass:true,shadow_nonregression_pass:true,
    approval_evidence_digest:d('4'),evidence_refs:['root:change:self'],external_approver:true,authored_by_candidate:false,
  }),/approver_root_mismatch|candidate_cannot_approve_self/);
});

test('approval disagreement fails closed without root authority',()=>{
  const bundle=shadowBundle(),p=proposal(bundle);
  const predecessor=approval(p,'PREDECESSOR_TRUST',{pass:true});
  const secondary=approval(p,'SECONDARY_TRUST',{pass:false});
  const review=createRsiVerifierRootChangeReview({
    review_id:'root.change.review.disagreement',proposal:p,predecessor_approval:predecessor,secondary_approval:secondary,
    external_review_owner:true,authored_by_candidate:false,
  });
  assert.equal(review.state,'REJECTED_ROOT_CHANGE_APPROVAL_DISAGREEMENT');
  assert.equal(review.approval_disagreement,true);
  assert.equal(review.ready_for_external_trust_root_controller_review,false);
  assert.equal(review.active_verifier_root_digest,p.predecessor_verifier_root_digest);
  assert.equal(review.root_change_authorized,false);
});

test('candidate-authored approval evidence is rejected',()=>{
  const bundle=shadowBundle(),p=proposal(bundle);
  assert.throws(()=>createRsiVerifierRootChangeApproval({
    approval_id:'root.change.candidate.approval',proposal:p,approver_role:'SECONDARY_TRUST',
    approver_root_digest:p.secondary_verifier_root_digest,qualification_binding_pass:true,
    constitution_unchanged_pass:true,compatibility_pass:true,rollback_protection_pass:true,
    root_history_continuity_pass:true,independent_audit_pass:true,shadow_nonregression_pass:true,
    approval_evidence_digest:d('5'),evidence_refs:['root:change:candidate'],
    external_approver:false,authored_by_candidate:true,
  }),/external_approver_required/);
});

test('root-change trust root requires monotonic history and 2-of-2 external review without actuation',()=>{
  const root=rsiVerifierRootChangeReviewTrustRootSnapshot();
  assert.equal(root.phase22_shadow_qualification_required,true);
  assert.equal(root.generation_increment_exactly_one,true);
  assert.equal(root.hash_chained_root_history_required,true);
  assert.equal(root.rollback_to_prior_generation_allowed,false);
  assert.equal(root.predecessor_trust_approval_required,true);
  assert.equal(root.independent_secondary_approval_required,true);
  assert.equal(root.approval_threshold,'2_OF_2');
  assert.equal(root.candidate_self_approval_allowed,false);
  assert.equal(root.active_verifier_remains_predecessor,true);
  assert.equal(root.root_change_authorized,false);
  assert.equal(root.verifier_activation_authorized,false);
  assert.equal(root.external_trust_root_controller_required,true);
  assert.equal(root.existing_runtime_ledger_is_only_root_change_review_receipt_plane,true);
  assert.equal(root.second_scheduler_allowed,false);
  assert.equal(root.authority_effect,false);
  assert.match(root.verifier_root_change_root_digest,/^sha256:[0-9a-f]{64}$/);
});
