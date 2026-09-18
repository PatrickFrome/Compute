import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import {
  createRsiMetaProfileCanaryDecision,
  createRsiMetaProfileCanaryOutcome,
} from '../src/rsi-meta-profile-canary-admission.mjs';
import {
  createRsiCanaryExternalVerifierReview,
  verifyRsiCanaryExternalVerifierReview,
  rsiCanaryExternalVerifierTrustRootSnapshot,
} from '../src/rsi-canary-external-verifier.mjs';

const SOURCE='a'.repeat(40);
const d=(c)=>`sha256:${c.repeat(64)}`;
function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]))}
function dg(v){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`}
function admission(){
  const core={
    schema:'metaengine.rsi.meta-profile-canary-admission.v1',version:1,
    source_sha:SOURCE,canary_id:'canary.external.verifier.1',
    selection_digest:d('1'),bounded_canary_admission_digest:d('2'),bounded_shadow_evidence_digest:d('3'),
    qualification_digest:d('4'),meta_record_digest:d('5'),incumbent_profile_digest:d('6'),challenger_profile_digest:d('7'),
    library_digest:d('8'),governance_digest:d('9'),cohort_digest:d('a'),
    action_surface:'READ_ONLY_DECISION_SUPPORT',max_decisions:16,
    clean_shadow_evidence_required:true,minimum_shadow_observations_required:32,bounded_handoff_required:true,
    baseline_is_default:true,baseline_fallback_required:true,exact_identity_required:true,
    library_and_governance_drift_fail_closed:true,candidate_can_choose_cohort:false,candidate_can_choose_exposure:false,
    canary_can_execute_browser_effect:false,canary_decision_is_advisory_only:true,ambiguous_effect_retry_allowed:false,
    hard_invariant_failure_latches_rollback:true,external_canary_owner:true,authored_by_candidate:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...core,admission_digest:dg(core)});
}
function cleanRows(a){
  const decisions=[],outcomes=[];
  for(let i=1;i<=a.max_decisions;i++){
    const decision=createRsiMetaProfileCanaryDecision({
      admission:a,decision_seq:i,context_digest:dg({context:i}),baseline_plan_digest:dg({baseline:i}),
      baseline_selected_skill_digests:[d('b')],challenger_skill_digest:null,challenger_status:'MATCHES_BASELINE',
      current_library_digest:a.library_digest,current_governance_digest:a.governance_digest,cohort_digest:a.cohort_digest,
    });
    decisions.push(decision);
    outcomes.push(createRsiMetaProfileCanaryOutcome({
      admission:a,decision,outcome_id:`outcome.${i}`,outcome_safety:'PASS',security_awareness:'PASS',task_utility:0.1,
      ambiguous:false,hard_invariant_pass:true,evidence_digest:dg({evidence:i}),evidence_refs:[`external:outcome:${i}`],
      external_evaluator:true,authored_by_candidate:false,
    }));
  }
  return {decisions,outcomes};
}
function review(overrides={}){
  const a=admission(),rows=cleanRows(a);
  return createRsiCanaryExternalVerifierReview({
    review_id:'external.verifier.review.1',admission:a,...rows,
    verifier_root_digest:d('c'),hidden_acceptance_manifest_digest:d('d'),reward_hacking_trap_digest:d('e'),
    transfer_holdout_digest:d('f'),trajectory_integrity_digest:d('1'),candidate_test_digest:d('2'),
    hidden_acceptance_pass:true,reward_hacking_trap_pass:true,transfer_holdout_pass:true,trajectory_integrity_pass:true,
    external_verifier:true,authored_by_candidate:false,...overrides,
  });
}

test('complete clean fixed-budget canary plus sealed external checks yields verifier-evolution review only',()=>{
  const row=review();
  verifyRsiCanaryExternalVerifierReview(row);
  assert.equal(row.state,'READY_FOR_SEPARATE_VERIFIER_EVOLUTION_REVIEW');
  assert.equal(row.fixed_budget_complete,true);
  assert.equal(row.all_external_dimensions_pass,true);
  assert.equal(row.candidate_tests_advisory_only,true);
  assert.equal(row.incumbent_remains_default,true);
  assert.equal(row.deployment_acceptance_authorized,false);
  assert.equal(row.profile_activation_authorized,false);
  assert.equal(row.authority_effect,false);
});

test('reward-hacking trap failure rejects external verifier review',()=>{
  const row=review({reward_hacking_trap_pass:false});
  assert.equal(row.state,'REJECTED_EXTERNAL_VERIFIER');
  assert.equal(row.all_external_dimensions_pass,false);
  assert.equal(row.deployment_acceptance_authorized,false);
});

test('candidate cannot author the external verifier receipt',()=>{
  const a=admission(),rows=cleanRows(a);
  assert.throws(()=>createRsiCanaryExternalVerifierReview({
    review_id:'external.verifier.review.candidate',admission:a,...rows,
    verifier_root_digest:d('c'),hidden_acceptance_manifest_digest:d('d'),reward_hacking_trap_digest:d('e'),
    transfer_holdout_digest:d('f'),trajectory_integrity_digest:d('1'),candidate_test_digest:d('2'),
    hidden_acceptance_pass:true,reward_hacking_trap_pass:true,transfer_holdout_pass:true,trajectory_integrity_pass:true,
    external_verifier:false,authored_by_candidate:true,
  }),/external_verifier_required/);
});

test('missing canary outcomes cannot be hidden by a clean partial sample',()=>{
  const a=admission(),rows=cleanRows(a);
  assert.throws(()=>createRsiCanaryExternalVerifierReview({
    review_id:'external.verifier.review.partial',admission:a,decisions:rows.decisions,outcomes:rows.outcomes.slice(0,15),
    verifier_root_digest:d('c'),hidden_acceptance_manifest_digest:d('d'),reward_hacking_trap_digest:d('e'),
    transfer_holdout_digest:d('f'),trajectory_integrity_digest:d('1'),candidate_test_digest:d('2'),
    hidden_acceptance_pass:true,reward_hacking_trap_pass:true,transfer_holdout_pass:true,trajectory_integrity_pass:true,
    external_verifier:true,authored_by_candidate:false,
  }),/complete_fixed_budget_required/);
});

test('canary ambiguity cannot be converted into verifier success',()=>{
  const a=admission(),rows=cleanRows(a);
  rows.outcomes[0]=createRsiMetaProfileCanaryOutcome({
    admission:a,decision:rows.decisions[0],outcome_id:'outcome.ambiguous',outcome_safety:'PASS',security_awareness:'PASS',
    task_utility:0.1,ambiguous:true,hard_invariant_pass:true,evidence_digest:d('3'),evidence_refs:['external:ambiguous'],
    external_evaluator:true,authored_by_candidate:false,
  });
  assert.throws(()=>createRsiCanaryExternalVerifierReview({
    review_id:'external.verifier.review.ambiguous',admission:a,...rows,
    verifier_root_digest:d('c'),hidden_acceptance_manifest_digest:d('d'),reward_hacking_trap_digest:d('e'),
    transfer_holdout_digest:d('f'),trajectory_integrity_digest:d('1'),candidate_test_digest:d('2'),
    hidden_acceptance_pass:true,reward_hacking_trap_pass:true,transfer_holdout_pass:true,trajectory_integrity_pass:true,
    external_verifier:true,authored_by_candidate:false,
  }),/canary_not_clean/);
});

test('trust root keeps verifier evolution separated from deployment authority',()=>{
  const root=rsiCanaryExternalVerifierTrustRootSnapshot();
  assert.equal(root.full_fixed_budget_canary_required,true);
  assert.equal(root.reward_hacking_trap_required,true);
  assert.equal(root.transfer_holdout_required,true);
  assert.equal(root.trajectory_integrity_required,true);
  assert.equal(root.candidate_tests_advisory_only,true);
  assert.equal(root.verifier_evolution_requires_separate_sealed_admission,true);
  assert.equal(root.deployment_acceptance_authorized,false);
  assert.equal(root.profile_activation_authorized,false);
  assert.equal(root.authority_effect,false);
  assert.match(root.verifier_root_digest,/^sha256:[0-9a-f]{64}$/);
});
