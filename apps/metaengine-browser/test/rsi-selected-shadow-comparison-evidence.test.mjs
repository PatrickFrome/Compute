import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { RSI_META_PROFILE_QUALIFICATION_SCHEMA } from '../src/rsi-meta-profile-qualification.mjs';
import { createRsiMetaProfileShadowSelection } from '../src/rsi-meta-profile-shadow-selection.mjs';
import { createRsiSelectedShadowContextBinding } from '../src/rsi-selected-shadow-context-binding.mjs';
import {
  RsiSelectedShadowComparisonLedger,
  createRsiSelectedShadowComparisonObservation,
  rsiSelectedShadowComparisonTrustRootSnapshot,
  verifyRsiSelectedShadowComparisonObservation,
} from '../src/rsi-selected-shadow-comparison-evidence.mjs';
import { rsiPromotionGateTrustRootSnapshot } from '../src/rsi-promotion-admission-gate.mjs';
import { rsiTournamentTrustRootSnapshot } from '../src/rsi-shadow-tournament.mjs';

const SOURCE='a'.repeat(40);

function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.keys(value).sort().map((key)=>[key,stable(value[key])]));
}
function dg(value){
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)),'utf8').digest('hex')}`;
}
function qualification({id,parent,successor,index}){
  const core={
    schema:RSI_META_PROFILE_QUALIFICATION_SCHEMA,version:1,source_sha:SOURCE,
    qualification_id:id,meta_record_digest:dg({id,kind:'meta'}),
    parent_profile_digest:dg({parent}),successor_profile_digest:dg({successor}),
    shadow_plan_digest:dg({id,kind:'plan'}),shadow_result_digest:dg({id,kind:'result'}),
    certificate_digest:dg({id,kind:'certificate'}),risk_budget_digest:dg({kind:'risk'}),
    confirmation_index:index,allocated_alpha:0.01,alpha_used:0.005,global_alpha:0.05,
    state:'QUALIFIED_FOR_SHADOW_PROFILE_SELECTION',qualified_for_shadow_profile_selection:true,
    live_profile_activation_authorized:false,profile_replacement_authorized:false,canary_activation_authorized:false,
    external_activation_gate_still_required:true,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...core,qualification_digest:dg(core)});
}
function fixture(){
  const profiles=[
    qualification({id:'qual.compare.alpha',parent:'parent.alpha',successor:'successor.alpha',index:1}),
    qualification({id:'qual.compare.beta',parent:'parent.beta',successor:'successor.beta',index:2}),
  ];
  const selection=createRsiMetaProfileShadowSelection({
    source_sha:SOURCE,selection_id:'selection.compare.1',context_class:'CODING',
    context_digest:dg({context:'verified:1'}),qualified_profiles:profiles,selection_history:[],
    external_context_owner:true,authored_by_candidate:false,
  });
  const binding=createRsiSelectedShadowContextBinding({
    binding_id:'binding.compare.1',selection,comparator_root_digest:dg({root:'comparator'}),
    external_shadow_owner:true,authored_by_candidate:false,
  });
  return {selection,binding};
}
function metrics(overrides={}){
  return {
    latency_ms:100,
    outcome_safety:0.90,
    security_awareness:0.80,
    task_utility:0.75,
    token_count:1000,
    ...overrides,
  };
}
function observation(fx,index,overrides={}){
  return createRsiSelectedShadowComparisonObservation({
    observation_id:`compare.observation.${index}`,observation_index:index,
    binding:fx.binding,selection:fx.selection,
    simulation_environment_digest:dg({simulation:index}),
    evaluator_manifest_digest:dg({evaluator:'manifest'}),
    champion_plan_digest:dg({champion:'plan',index}),
    challenger_plan_digest:dg({challenger:'plan',index}),
    champion_trajectory_digest:dg({champion:'trajectory',index}),
    challenger_trajectory_digest:dg({challenger:'trajectory',index}),
    champion_metrics:metrics(),
    challenger_metrics:metrics({latency_ms:90,outcome_safety:0.95,security_awareness:0.85,task_utility:0.80,token_count:900}),
    champion_hard_invariants_pass:true,
    challenger_hard_invariants_pass:true,
    champion_incident_codes:[],
    challenger_incident_codes:[],
    comparator_integrity_pass:true,
    identity_stable:true,
    from_scratch_replay_pass:true,
    ambiguous_evidence:false,
    evidence_digest:dg({evidence:index}),
    evidence_refs:[`shadow:comparison:${index}`],
    counterfactual_simulation:true,
    browser_effects_performed:false,
    live_plan_execution_performed:false,
    external_comparator:true,
    authored_by_candidate:false,
    ...overrides,
  });
}

test('comparison records multidimensional counterfactual evidence without a scalar winner or execution authority',()=>{
  const fx=fixture();
  const row=observation(fx,1);
  const checked=verifyRsiSelectedShadowComparisonObservation(row,fx);
  assert.equal(checked.vector_relation,'VECTOR_PARETO_ADVANCE');
  assert.equal(checked.signed_challenger_gain.outcome_safety>0,true);
  assert.equal(checked.signed_challenger_gain.security_awareness>0,true);
  assert.equal(checked.signed_challenger_gain.task_utility>0,true);
  assert.equal(checked.signed_challenger_gain.latency_efficiency>0,true);
  assert.equal(checked.signed_challenger_gain.token_efficiency>0,true);
  assert.equal(checked.scalar_winner,null);
  assert.equal(checked.counterfactual_simulation,true);
  assert.equal(checked.browser_effects_performed,false);
  assert.equal(checked.live_plan_execution_performed,false);
  assert.equal(checked.champion_remains_execution_baseline,true);
  assert.equal(checked.canary_review_authorized,false);
  assert.equal(checked.canary_activation_authorized,false);
  assert.equal(checked.authority_effect,false);
});

test('vector tradeoff stays evidence-only and does not become a winner decision',()=>{
  const fx=fixture();
  const row=observation(fx,1,{
    challenger_metrics:metrics({
      latency_ms:80,
      outcome_safety:0.80,
      security_awareness:0.90,
      task_utility:0.90,
      token_count:850,
    }),
  });
  assert.equal(row.vector_relation,'VECTOR_TRADEOFF');
  assert.equal(row.has_any_gain,true);
  assert.equal(row.has_any_regression,true);
  assert.equal(row.scalar_winner,null);
  assert.equal(row.observation_is_canary_admission,false);
});

test('counterfactual boundary rejects candidate-authored or live-effect evidence',()=>{
  const fx=fixture();
  assert.throws(()=>observation(fx,1,{external_comparator:false,authored_by_candidate:true}),/external_comparator_required/);
  assert.throws(()=>observation(fx,1,{browser_effects_performed:true}),/counterfactual_only_required/);
  assert.throws(()=>observation(fx,1,{live_plan_execution_performed:true}),/counterfactual_only_required/);
});

test('integrity ambiguity or challenger invariant failure latches incident and clean later rows cannot clear it',async(t)=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'shadow-comparison-ledger-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const fx=fixture();
  const statePath=path.join(root,'evidence.json');
  const ledger=new RsiSelectedShadowComparisonLedger({statePath,source_sha:SOURCE});
  await ledger.init();

  const first=observation(fx,1,{
    challenger_hard_invariants_pass:false,
    comparator_integrity_pass:false,
    ambiguous_evidence:true,
  });
  const firstStored=await ledger.add(first,fx);
  assert.equal(firstStored.state,'INCIDENT_LATCHED');
  assert.equal(firstStored.summary.incident_latched,true);
  assert.deepEqual(firstStored.summary.first_incident_codes,[
    'AMBIGUOUS_EVIDENCE',
    'COMPARATOR_INTEGRITY_FAILURE',
    'HARD_INVARIANT_FAILURE',
  ]);

  for(let index=2;index<=8;index+=1){
    await ledger.add(observation(fx,index),fx);
  }
  const summary=ledger.summary(fx.binding.binding_digest);
  assert.equal(summary.row_count,8);
  assert.equal(summary.evidence_floor_reached,true);
  assert.equal(summary.incident_latched,true);
  assert.equal(summary.ready_for_canary_review,false);
  assert.equal(summary.canary_review_authorized,false);
  assert.equal(summary.canary_activation_authorized,false);

  const restarted=new RsiSelectedShadowComparisonLedger({statePath,source_sha:SOURCE});
  await restarted.init();
  assert.equal(restarted.summary(fx.binding.binding_digest).incident_latched,true);
  assert.equal(restarted.snapshot().incident_can_be_cleared,false);
});

test('ledger rejects skipped observation indexes and conflicting observation identities',async(t)=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'shadow-comparison-sequence-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const fx=fixture();
  const ledger=new RsiSelectedShadowComparisonLedger({statePath:path.join(root,'state.json'),source_sha:SOURCE});
  await ledger.init();

  await assert.rejects(()=>ledger.add(observation(fx,2),fx),/index_out_of_sequence/);
  const first=observation(fx,1);
  assert.equal((await ledger.add(first,fx)).state,'EVIDENCE_RECORDED');
  assert.equal((await ledger.add(first,fx)).state,'IDEMPOTENT');

  const conflicting=observation(fx,1,{evidence_digest:dg({different:'evidence'})});
  await assert.rejects(()=>ledger.add(conflicting,fx),/observation_conflict/);
});

test('baseline invalidity is visible and can never create canary review authority',async(t)=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'shadow-comparison-baseline-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const fx=fixture();
  const ledger=new RsiSelectedShadowComparisonLedger({statePath:path.join(root,'state.json'),source_sha:SOURCE});
  await ledger.init();
  const row=observation(fx,1,{
    champion_hard_invariants_pass:false,
    champion_incident_codes:['BASELINE_ENVIRONMENT_FAILURE'],
  });
  await ledger.add(row,fx);
  const summary=ledger.summary(fx.binding.binding_digest);
  assert.equal(summary.baseline_invalid_observed,true);
  assert.equal(summary.ready_for_canary_review,false);
  assert.equal(summary.canary_review_authorized,false);
});

test('comparison trust root is immutable in candidate, tournament and promotion planes',()=>{
  const root=rsiSelectedShadowComparisonTrustRootSnapshot();
  assert.equal(root.counterfactual_simulation_required,true);
  assert.equal(root.browser_effects_forbidden,true);
  assert.equal(root.live_plan_execution_forbidden,true);
  assert.equal(root.external_comparator_required,true);
  assert.equal(root.comparator_integrity_required,true);
  assert.equal(root.from_scratch_replay_required,true);
  assert.equal(root.scalar_winner_authoritative,false);
  assert.equal(root.incident_latch_fail_closed,true);
  assert.equal(root.evidence_floor_does_not_authorize_canary_review,true);
  assert.equal(root.canary_review_authorized,false);
  assert.equal(root.canary_activation_authorized,false);
  assert.equal(root.authority_effect,false);
  assert.match(root.comparison_root_digest,/^sha256:[0-9a-f]{64}$/);

  const immutable='apps/metaengine-browser/src/rsi-selected-shadow-comparison-evidence.mjs';
  for(const trustRoot of [rsiPromotionGateTrustRootSnapshot(),rsiTournamentTrustRootSnapshot()]){
    assert.equal(trustRoot.immutable_component_paths.includes(immutable),true);
  }
});
