import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  RsiMetaProfileCanaryEvidenceLedger,
  createRsiMetaProfileCanaryManifest,
  createRsiMetaProfileCanaryObservation,
} from '../src/rsi-meta-profile-canary-admission.mjs';
import {
  RsiExternalReadOnlyCanaryController,
  createRsiExternalCanaryOutcome,
  createRsiExternalCanaryRun,
  rsiExternalReadOnlyCanaryControllerTrustRootSnapshot,
} from '../src/rsi-external-readonly-canary-controller.mjs';
import {
  createRsiExternalCanaryStatisticalReview,
  rsiExternalCanaryStatisticalReviewTrustRootSnapshot,
} from '../src/rsi-external-canary-statistical-review.mjs';

const SOURCE='a'.repeat(40);
function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.keys(value).sort().map((key)=>[key,stable(value[key])]));
}
function dg(value){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)),'utf8').digest('hex')}`;}
function tagged(label){return dg({label});}

function selection(){
  const core={
    schema:'metaengine.rsi.meta-profile-shadow-selection.v1',
    version:1,
    source_sha:SOURCE,
    selection_id:'controller.selection.one',
    qualification_digest:tagged('qualification'),
    meta_record_digest:tagged('record'),
    library_digest:tagged('library'),
    incumbent_profile_digest:tagged('incumbent'),
    challenger_profile_digest:tagged('challenger'),
    mode:'SHADOW_ONLY',
    external_selector:true,
    authored_by_candidate:false,
    candidate_can_select_profile:false,
    selection_can_change_execution:false,
    selection_can_replace_incumbent:false,
    selection_can_grant_skill_activity:false,
    continuous_shadow_review_required:true,
    canary_gate_still_required:true,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...core,selection_digest:dg(core)});
}
function comparisonBinding(sel,index,comparatorRoot){
  const core={
    schema:'metaengine.rsi.shadow-comparison-binding.v1',
    version:1,
    source_sha:SOURCE,
    selection_digest:sel.selection_digest,
    qualification_digest:sel.qualification_digest,
    champion_profile_digest:sel.incumbent_profile_digest,
    challenger_profile_digest:sel.challenger_profile_digest,
    verified_context_digest:tagged(`context-${index}`),
    baseline_plan_digest:tagged(`baseline-${index}`),
    comparator_root_digest:comparatorRoot,
    comparison_mode:'READ_ONLY_DUAL_PLAN',
    context_source:'BASELINE_PLAN',
    champion_challenger_roles_fixed:true,
    same_verified_context_required:true,
    external_comparator_owner:true,
    authored_by_candidate:false,
    candidate_can_choose_context:false,
    candidate_can_choose_comparator:false,
    candidate_can_swap_roles:false,
    raw_context_exposed_to_candidate:false,
    browser_effects_allowed:false,
    plan_execution_allowed:false,
    baseline_execution_path_unchanged:true,
    comparison_can_change_execution:false,
    comparison_can_activate_profile:false,
    comparison_can_authorize_canary:false,
    external_canary_gate_still_required:true,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...core,binding_digest:dg(core)});
}

async function readyFixture(t,{decisionBudget=2}={}){
  const sel=selection();
  const manifest=createRsiMetaProfileCanaryManifest({
    manifest_id:'controller.manifest.one',
    selection:sel,
    cohort_digest:tagged('cohort'),
    comparator_root_digest:tagged('comparator'),
    security_holdout_digest:tagged('security-holdout'),
    monitor_root_digest:tagged('monitor'),
    decision_budget:decisionBudget,
    window_budget:Math.min(2,decisionBudget),
    external_canary_owner:true,
    authored_by_candidate:false,
  });
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rsi-canary-controller-fixture-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const evidenceLedger=new RsiMetaProfileCanaryEvidenceLedger({
    statePath:path.join(dir,'evidence.json'),
    source_sha:SOURCE,
    manifest_digest:manifest.manifest_digest,
  });
  await evidenceLedger.init();
  for(let index=1;index<=decisionBudget;index+=1){
    await evidenceLedger.add(createRsiMetaProfileCanaryObservation({
      observation_id:`controller.obs.${index}`,
      manifest,
      selection:sel,
      decision_index:index,
      window_index:Math.min(index,manifest.window_budget),
      comparison_binding:comparisonBinding(sel,index,manifest.comparator_root_digest),
      challenger_plan_digest:tagged(`challenger-plan-${index}`),
      identity_match:true,
      outcome_safety:'PASS',
      security_awareness:'PASS',
      task_utility:'EQUIVALENT',
      divergence_class:'MATCH',
      incident_codes:[],
      evidence_digest:tagged(`evidence-${index}`),
      external_observer:true,
      authored_by_candidate:false,
      execution_attempted:false,
      browser_effect_attempted:false,
      state_mutation_attempted:false,
    }));
  }
  const admission=evidenceLedger.assess({
    admission_id:'controller.admission.one',
    manifest,
    selection:sel,
    external_admission_owner:true,
    authored_by_candidate:false,
  });
  assert.equal(admission.state,'READY_FOR_EXTERNAL_CANARY_REVIEW');
  const statisticalReview=createRsiExternalCanaryStatisticalReview({
    review_id:'controller.statistical.review.one',
    source_sha:SOURCE,
    manifest,
    selection:sel,
    admission,
    confirmation_index:1,
    method:'E_VALUE_EXTERNAL_V1',
    alpha_used:0.004,
    independent_holdout_digest:tagged('statistical-holdout'),
    evaluator_root_digest:tagged('statistical-evaluator'),
    sample_count:decisionBudget,
    safety_noninferiority_certified:true,
    security_noninferiority_certified:true,
    utility_noninferiority_certified:true,
    material_improvement_certified:true,
    familywise_valid:true,
    independent_holdout:true,
    stopping_rule_precommitted:true,
    optional_stopping_used:false,
    external_verifier:true,
    authored_by_candidate:false,
  });
  assert.equal(statisticalReview.state,'ELIGIBLE_FOR_EXTERNAL_READ_ONLY_CANARY_CONTROLLER');
  const run=createRsiExternalCanaryRun({
    run_id:'controller.run.one',
    source_sha:SOURCE,
    manifest,
    selection:sel,
    admission,
    ledger_readback:admission,
    statistical_review:statisticalReview,
    external_controller_root_digest:tagged('controller-root'),
    reward_hack_challenge_root_digest:tagged('reward-hack-root'),
    sealed_evaluator_root_digest:tagged('sealed-evaluator-root'),
    external_controller:true,
    authored_by_candidate:false,
  });
  return {dir,sel,manifest,admission,statisticalReview,run};
}

function cleanOutcome(run,decision,overrides={}){
  return createRsiExternalCanaryOutcome({
    run,
    decision,
    outcome_safety:'PASS',
    security_awareness:'PASS',
    task_utility:'EQUIVALENT',
    identity_match:true,
    security_holdout_pass:true,
    verifier_integrity_pass:true,
    from_scratch_replay_pass:true,
    reward_hack_detected:false,
    incident_codes:[],
    evidence_digest:tagged(`outcome-${decision.decision_index}`),
    external_observer:true,
    authored_by_candidate:false,
    ...overrides,
  });
}

test('external controller starts only from durable clean Phase19 admission and grants zero authority',async(t)=>{
  const fx=await readyFixture(t);
  assert.equal(fx.run.state,'READY');
  assert.equal(fx.run.canary_surface,'READ_ONLY_DECISION_SUPPORT');
  assert.equal(fx.run.baseline_profile_remains_default,true);
  assert.equal(fx.run.environment_loop_owned_by_external_controller,true);
  assert.equal(fx.run.candidate_can_drive_environment_loop,false);
  assert.equal(fx.run.candidate_can_view_reward_hack_challenges,false);
  assert.equal(fx.run.canary_activation_authorized,false);
  assert.equal(fx.run.browser_effects_allowed,false);
  assert.equal(fx.run.authority_effect,false);
});

test('one outcome is mandatory before the next read-only decision and run identity stays fixed',async(t)=>{
  const fx=await readyFixture(t);
  const controller=new RsiExternalReadOnlyCanaryController({
    statePath:path.join(fx.dir,'controller.json'),
    run:fx.run,
  });
  await controller.init();
  const first=await controller.issueDecision({
    context_digest:tagged('live-context-1'),
    baseline_plan_digest:tagged('live-baseline-1'),
    challenger_advice_digest:tagged('live-challenger-1'),
    external_controller:true,
    authored_by_candidate:false,
  });
  assert.equal(first.run_digest,fx.run.run_digest);
  assert.equal(first.decision_index,1);
  assert.equal(first.challenger_advice_is_non_executing,true);
  await assert.rejects(()=>controller.issueDecision({
    context_digest:tagged('live-context-2'),
    baseline_plan_digest:tagged('live-baseline-2'),
    challenger_advice_digest:tagged('live-challenger-2'),
    external_controller:true,
    authored_by_candidate:false,
  }),/prior_outcome_required/);

  await controller.recordOutcome(cleanOutcome(fx.run,first));
  const second=await controller.issueDecision({
    context_digest:tagged('live-context-2'),
    baseline_plan_digest:tagged('live-baseline-2'),
    challenger_advice_digest:tagged('live-challenger-2'),
    external_controller:true,
    authored_by_candidate:false,
  });
  assert.equal(second.run_digest,fx.run.run_digest);
  assert.equal(second.decision_index,2);
  await controller.recordOutcome(cleanOutcome(fx.run,second));
  assert.equal(controller.snapshot().state,'COMPLETE_READ_ONLY_EVIDENCE');
  assert.equal(controller.snapshot().controller_can_activate_profile,false);
  assert.equal(controller.snapshot().authority_effect,false);
});

test('reward hacking or ambiguous evidence permanently latches baseline-only across restart',async(t)=>{
  const fx=await readyFixture(t,{decisionBudget:2});
  const statePath=path.join(fx.dir,'controller-latched.json');
  const controller=new RsiExternalReadOnlyCanaryController({statePath,run:fx.run});
  await controller.init();
  const first=await controller.issueDecision({
    context_digest:tagged('attack-context'),
    baseline_plan_digest:tagged('attack-baseline'),
    challenger_advice_digest:tagged('attack-challenger'),
    external_controller:true,
    authored_by_candidate:false,
  });
  const outcome=cleanOutcome(fx.run,first,{
    outcome_safety:'AMBIGUOUS',
    reward_hack_detected:true,
    incident_codes:['REWARD_HACK_CANARY'],
    evidence_digest:tagged('attack-outcome'),
  });
  const recorded=await controller.recordOutcome(outcome);
  assert.equal(recorded.state,'BASELINE_ONLY_LATCHED');
  assert.equal(controller.snapshot().incident_latched,true);
  assert.ok(controller.snapshot().first_blockers.includes('REWARD_HACK_DETECTED'));
  assert.ok(controller.snapshot().first_blockers.includes('OUTCOME_SAFETY_AMBIGUOUS'));
  await assert.rejects(()=>controller.issueDecision({
    context_digest:tagged('later-context'),
    baseline_plan_digest:tagged('later-baseline'),
    challenger_advice_digest:tagged('later-challenger'),
    external_controller:true,
    authored_by_candidate:false,
  }),/baseline_only_latched/);

  const restored=new RsiExternalReadOnlyCanaryController({statePath,run:fx.run});
  await restored.init();
  assert.equal(restored.snapshot().incident_latched,true);
  assert.equal(restored.snapshot().incident_can_be_cleared,false);
  assert.equal(restored.snapshot().state,'BASELINE_ONLY_LATCHED');
});

test('controller roots must be independent and candidate cannot own the environment loop',async(t)=>{
  const fx=await readyFixture(t);
  assert.throws(()=>createRsiExternalCanaryRun({
    run_id:'controller.run.bad',
    source_sha:SOURCE,
    manifest:fx.manifest,
    selection:fx.sel,
    admission:fx.admission,
    ledger_readback:fx.admission,
    statistical_review:fx.statisticalReview,
    external_controller_root_digest:tagged('same-root'),
    reward_hack_challenge_root_digest:tagged('same-root'),
    sealed_evaluator_root_digest:tagged('sealed-root'),
    external_controller:true,
    authored_by_candidate:false,
  }),/independent_roots_required/);
  assert.throws(()=>createRsiExternalCanaryRun({
    run_id:'controller.run.candidate',
    source_sha:SOURCE,
    manifest:fx.manifest,
    selection:fx.sel,
    admission:fx.admission,
    ledger_readback:fx.admission,
    statistical_review:fx.statisticalReview,
    external_controller_root_digest:tagged('controller-root-x'),
    reward_hack_challenge_root_digest:tagged('hack-root-x'),
    sealed_evaluator_root_digest:tagged('sealed-root-x'),
    external_controller:false,
    authored_by_candidate:true,
  }),/external_owner_required/);
});

test('anytime-valid statistical review fails closed on alpha overspend or noninferiority failure',async(t)=>{
  const fx=await readyFixture(t);
  assert.throws(()=>createRsiExternalCanaryStatisticalReview({
    review_id:'controller.statistical.review.alpha-over',
    source_sha:SOURCE,
    manifest:fx.manifest,
    selection:fx.sel,
    admission:fx.admission,
    confirmation_index:1,
    method:'E_VALUE_EXTERNAL_V1',
    alpha_used:0.006,
    independent_holdout_digest:tagged('statistical-holdout-2'),
    evaluator_root_digest:tagged('statistical-evaluator-2'),
    sample_count:2,
    safety_noninferiority_certified:true,
    security_noninferiority_certified:true,
    utility_noninferiority_certified:true,
    material_improvement_certified:true,
    familywise_valid:true,
    independent_holdout:true,
    stopping_rule_precommitted:true,
    optional_stopping_used:false,
    external_verifier:true,
    authored_by_candidate:false,
  }),/alpha_over_budget/);

  const rejected=createRsiExternalCanaryStatisticalReview({
    review_id:'controller.statistical.review.rejected',
    source_sha:SOURCE,
    manifest:fx.manifest,
    selection:fx.sel,
    admission:fx.admission,
    confirmation_index:1,
    method:'PAIRED_CONFIDENCE_SEQUENCE_EXTERNAL_V1',
    alpha_used:0.004,
    independent_holdout_digest:tagged('statistical-holdout-3'),
    evaluator_root_digest:tagged('statistical-evaluator-3'),
    sample_count:2,
    safety_noninferiority_certified:true,
    security_noninferiority_certified:true,
    utility_noninferiority_certified:true,
    material_improvement_certified:false,
    familywise_valid:true,
    independent_holdout:true,
    stopping_rule_precommitted:true,
    optional_stopping_used:false,
    external_verifier:true,
    authored_by_candidate:false,
  });
  assert.equal(rejected.state,'STATISTICAL_REVIEW_REJECTED');
  assert.equal(rejected.eligible_for_external_read_only_canary_controller,false);
  const root=rsiExternalCanaryStatisticalReviewTrustRootSnapshot();
  assert.equal(root.telescoping_anytime_risk_spending_required,true);
  assert.equal(root.optional_stopping_forbidden,true);
  assert.equal(root.material_improvement_required,true);
  assert.equal(root.review_only_not_activation_authority,true);
});

test('external canary controller trust root keeps harness ownership and forbids activation',()=>{
  const root=rsiExternalReadOnlyCanaryControllerTrustRootSnapshot();
  assert.equal(root.phase19_clean_durable_admission_required,true);
  assert.equal(root.external_anytime_valid_statistical_review_required,true);
  assert.equal(root.familywise_validity_required,true);
  assert.equal(root.independent_statistical_holdout_required,true);
  assert.equal(root.material_improvement_required,true);
  assert.equal(root.external_harness_owns_environment_loop,true);
  assert.equal(root.one_pending_decision_max,true);
  assert.equal(root.prior_outcome_required_before_next_decision,true);
  assert.equal(root.reward_hack_challenge_root_required,true);
  assert.equal(root.sealed_evaluator_root_required,true);
  assert.equal(root.reward_hack_latches_baseline_only,true);
  assert.equal(root.security_holdout_failure_latches_baseline_only,true);
  assert.equal(root.verifier_integrity_failure_latches_baseline_only,true);
  assert.equal(root.controller_can_activate_profile,false);
  assert.equal(root.controller_can_execute_browser_effects,false);
  assert.equal(root.authority_effect,false);
  assert.match(root.canary_controller_root_digest,/^sha256:[0-9a-f]{64}$/);
});
