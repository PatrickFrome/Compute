import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { RSI_META_PROFILE_QUALIFICATION_SCHEMA } from '../src/rsi-meta-profile-qualification.mjs';
import { createRsiMetaProfileShadowSelection } from '../src/rsi-meta-profile-shadow-selection.mjs';
import { createRsiSelectedShadowContextBinding } from '../src/rsi-selected-shadow-context-binding.mjs';
import { createRsiSelectedShadowComparisonObservation } from '../src/rsi-selected-shadow-comparison-evidence.mjs';
import {
  RsiMetaProfileCanaryReviewLedger,
  createRsiMetaProfileCanaryReviewCertificate,
  createRsiMetaProfileCanaryReview,
  rsiMetaProfileCanaryReviewRiskBudgetSnapshot,
  rsiMetaProfileCanaryReviewTrustRootSnapshot,
} from '../src/rsi-meta-profile-canary-review-gate.mjs';
import { rsiRiskAllocationForConfirmation } from '../src/rsi-recursive-risk-budget.mjs';
import { rsiPromotionGateTrustRootSnapshot } from '../src/rsi-promotion-admission-gate.mjs';
import { rsiTournamentTrustRootSnapshot } from '../src/rsi-shadow-tournament.mjs';

const SOURCE='a'.repeat(40);
function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]))}
function dg(v){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`}
function qualification({id,parent,successor,index}){
  const core={schema:RSI_META_PROFILE_QUALIFICATION_SCHEMA,version:1,source_sha:SOURCE,qualification_id:id,
    meta_record_digest:dg({id,kind:'meta'}),parent_profile_digest:dg({parent}),successor_profile_digest:dg({successor}),
    shadow_plan_digest:dg({id,kind:'plan'}),shadow_result_digest:dg({id,kind:'result'}),
    certificate_digest:dg({id,kind:'certificate'}),risk_budget_digest:dg({kind:'phase17-risk'}),
    confirmation_index:index,allocated_alpha:0.01,alpha_used:0.005,global_alpha:0.05,
    state:'QUALIFIED_FOR_SHADOW_PROFILE_SELECTION',qualified_for_shadow_profile_selection:true,
    live_profile_activation_authorized:false,profile_replacement_authorized:false,canary_activation_authorized:false,
    external_activation_gate_still_required:true,execution_authority:false,production_mutation_authority:false,
    promotion_authority:false,self_update_authority:false,scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false};
  return Object.freeze({...core,qualification_digest:dg(core)});
}
function fixture(){
  const profiles=[
    qualification({id:'canary.qual.alpha',parent:'parent.alpha',successor:'successor.alpha',index:1}),
    qualification({id:'canary.qual.beta',parent:'parent.beta',successor:'successor.beta',index:2}),
  ];
  const selection=createRsiMetaProfileShadowSelection({
    source_sha:SOURCE,selection_id:'canary.selection.1',context_class:'CODING',context_digest:dg({context:'canary:verified'}),
    qualified_profiles:profiles,selection_history:[],external_context_owner:true,authored_by_candidate:false,
  });
  const binding=createRsiSelectedShadowContextBinding({
    binding_id:'canary.binding.1',selection,comparator_root_digest:dg({root:'comparator'}),
    external_shadow_owner:true,authored_by_candidate:false,
  });
  const observations=[];
  for(let i=1;i<=8;i++){
    observations.push(createRsiSelectedShadowComparisonObservation({
      observation_id:`canary.compare.${i}`,observation_index:i,binding,selection,
      simulation_environment_digest:dg({simulation:i}),evaluator_manifest_digest:dg({evaluator:'comparison'}),
      champion_plan_digest:dg({champion:'plan',i}),challenger_plan_digest:dg({challenger:'plan',i}),
      champion_trajectory_digest:dg({champion:'trajectory',i}),challenger_trajectory_digest:dg({challenger:'trajectory',i}),
      champion_metrics:{latency_ms:100,outcome_safety:0.9,security_awareness:0.9,task_utility:0.75,token_count:1000},
      challenger_metrics:{latency_ms:90,outcome_safety:0.95,security_awareness:0.95,task_utility:0.82,token_count:900},
      champion_hard_invariants_pass:true,challenger_hard_invariants_pass:true,
      champion_incident_codes:[],challenger_incident_codes:[],comparator_integrity_pass:true,identity_stable:true,
      from_scratch_replay_pass:true,ambiguous_evidence:false,evidence_digest:dg({evidence:i}),
      evidence_refs:[`canary:compare:${i}`],counterfactual_simulation:true,browser_effects_performed:false,
      live_plan_execution_performed:false,external_comparator:true,authored_by_candidate:false,
    }));
  }
  return {selection,binding,observations};
}
function certificate(fx,overrides={}){
  const budget=rsiMetaProfileCanaryReviewRiskBudgetSnapshot();
  return createRsiMetaProfileCanaryReviewCertificate({
    certificate_id:'canary.review.certificate.1',budget,confirmation_index:1,binding:fx.binding,selection:fx.selection,
    observations:fx.observations,independent_holdout_digest:dg({holdout:'independent'}),
    evaluator_root_digest:dg({root:'external-review-evaluator'}),method:'E_VALUE_EXTERNAL_V1',
    alpha_used:rsiRiskAllocationForConfirmation(budget,1),safety_noninferiority_certified:true,
    security_noninferiority_certified:true,utility_noninferiority_certified:true,material_improvement_certified:true,
    familywise_valid:true,independent_holdout:true,stopping_rule_precommitted:true,optional_stopping_used:false,
    sample_count:fx.observations.length,evidence_refs:['canary:review:certificate'],
    external_verifier:true,authored_by_candidate:false,...overrides,
  });
}

test('fixed anytime-valid external certificate yields review eligibility but never canary authority',()=>{
  const fx=fixture();const budget=rsiMetaProfileCanaryReviewRiskBudgetSnapshot();const cert=certificate(fx);
  const review=createRsiMetaProfileCanaryReview({
    review_id:'canary.review.1',binding:fx.binding,selection:fx.selection,observations:fx.observations,
    budget,certificate:cert,confirmation_index:1,
  });
  assert.equal(review.state,'ELIGIBLE_FOR_EXTERNAL_BOUNDED_CANARY_REVIEW');
  assert.equal(review.eligible_for_external_bounded_canary_review,true);
  assert.equal(review.champion_remains_default,true);
  assert.equal(review.external_canary_controller_required,true);
  assert.equal(review.statistical_gate_is_canary_authority,false);
  assert.equal(review.canary_token,null);
  assert.equal(review.canary_activation_authorized,false);
  assert.equal(review.profile_replacement_authorized,false);
  assert.equal(review.authority_effect,false);
});

test('noninferiority failure rejects review while preserving zero authority',()=>{
  const fx=fixture();const budget=rsiMetaProfileCanaryReviewRiskBudgetSnapshot();
  const cert=certificate(fx,{security_noninferiority_certified:false});
  const review=createRsiMetaProfileCanaryReview({
    review_id:'canary.review.reject',binding:fx.binding,selection:fx.selection,observations:fx.observations,
    budget,certificate:cert,confirmation_index:1,
  });
  assert.equal(review.state,'STATISTICAL_CANARY_REVIEW_REJECTED');
  assert.equal(review.eligible_for_external_bounded_canary_review,false);
  assert.equal(review.canary_activation_authorized,false);
});

test('incident or invalid baseline evidence cannot be statistically laundered into review eligibility',()=>{
  const fx=fixture();
  const incident=createRsiSelectedShadowComparisonObservation({
    ...fx.observations[0],observation_id:'canary.compare.incident',observation_index:1,
    binding:fx.binding,selection:fx.selection,
    challenger_hard_invariants_pass:false,
    evidence_digest:dg({evidence:'incident'}),evidence_refs:['canary:compare:incident'],
    external_comparator:true,authored_by_candidate:false,counterfactual_simulation:true,
    browser_effects_performed:false,live_plan_execution_performed:false,
  });
  const observations=[incident,...fx.observations.slice(1)];
  const budget=rsiMetaProfileCanaryReviewRiskBudgetSnapshot();
  assert.throws(()=>createRsiMetaProfileCanaryReviewCertificate({
    certificate_id:'canary.review.incident',budget,confirmation_index:1,binding:fx.binding,selection:fx.selection,
    observations,independent_holdout_digest:dg({holdout:'independent'}),evaluator_root_digest:dg({root:'review'}),
    method:'E_VALUE_EXTERNAL_V1',alpha_used:rsiRiskAllocationForConfirmation(budget,1),
    safety_noninferiority_certified:true,security_noninferiority_certified:true,utility_noninferiority_certified:true,
    material_improvement_certified:true,familywise_valid:true,independent_holdout:true,stopping_rule_precommitted:true,
    optional_stopping_used:false,sample_count:8,evidence_refs:['canary:incident:cert'],external_verifier:true,authored_by_candidate:false,
  }),/incident_latched/);
});

test('risk budget, stopping rule and candidate authorship are fixed outside the candidate',()=>{
  const fx=fixture();const budget=rsiMetaProfileCanaryReviewRiskBudgetSnapshot();
  assert.equal(budget.global_alpha,0.01);
  assert.equal(budget.spending_policy,'TELESCOPING_ANYTIME_V1');
  assert.throws(()=>certificate(fx,{alpha_used:rsiRiskAllocationForConfirmation(budget,1)*2}),/alpha_over_budget/);
  assert.throws(()=>certificate(fx,{external_verifier:false,authored_by_candidate:true}),/external_verifier_required/);
  assert.throws(()=>certificate(fx,{optional_stopping_used:true}),/statistical_policy_invalid/);
  assert.throws(()=>certificate(fx,{independent_holdout:false}),/statistical_policy_invalid/);
});

test('append-only review ledger persists risk spending and cannot mint active/canary profile state',async(t)=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'canary-review-ledger-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const fx=fixture();const budget=rsiMetaProfileCanaryReviewRiskBudgetSnapshot();const cert=certificate(fx);
  const review=createRsiMetaProfileCanaryReview({
    review_id:'canary.review.persist',binding:fx.binding,selection:fx.selection,observations:fx.observations,
    budget,certificate:cert,confirmation_index:1,
  });
  const statePath=path.join(root,'review.json');
  const ledger=new RsiMetaProfileCanaryReviewLedger({statePath,source_sha:SOURCE});await ledger.init();
  assert.equal((await ledger.add(review)).state,'ELIGIBLE_FOR_EXTERNAL_BOUNDED_CANARY_REVIEW');
  assert.equal((await ledger.add(review)).state,'IDEMPOTENT');
  assert.equal(ledger.snapshot().row_count,1);
  assert.equal(ledger.snapshot().active_profile_digest,null);
  assert.equal(ledger.snapshot().canary_profile_digest,null);
  assert.equal(ledger.snapshot().canary_token,null);
  assert.equal(ledger.snapshot().ledger_can_activate_canary,false);
  const restored=new RsiMetaProfileCanaryReviewLedger({statePath,source_sha:SOURCE});await restored.init();
  assert.equal(restored.eligible().length,1);
  assert.equal(restored.snapshot().cumulative_alpha_spent,review.alpha_used);
});

test('canary review root is frozen in candidate tournament and promotion planes',()=>{
  const root=rsiMetaProfileCanaryReviewTrustRootSnapshot();
  assert.equal(root.external_statistical_verifier_required,true);
  assert.equal(root.anytime_risk_spending,true);
  assert.equal(root.safety_noninferiority_required,true);
  assert.equal(root.security_noninferiority_required,true);
  assert.equal(root.utility_noninferiority_required,true);
  assert.equal(root.material_improvement_required,true);
  assert.equal(root.familywise_validity_required,true);
  assert.equal(root.independent_holdout_required,true);
  assert.equal(root.external_canary_controller_required,true);
  assert.equal(root.review_is_canary_authority,false);
  assert.equal(root.canary_activation_authorized,false);
  assert.equal(root.authority_effect,false);
  assert.match(root.canary_review_root_digest,/^sha256:[0-9a-f]{64}$/);
  const immutable='apps/metaengine-browser/src/rsi-meta-profile-canary-review-gate.mjs';
  for(const trustRoot of [rsiPromotionGateTrustRootSnapshot(),rsiTournamentTrustRootSnapshot()]){
    assert.equal(trustRoot.immutable_component_paths.includes(immutable),true);
  }
});
