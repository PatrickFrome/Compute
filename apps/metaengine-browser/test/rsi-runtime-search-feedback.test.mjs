
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { BrowserBrainWorkingMemory } from '../src/browser-brain-working-memory.mjs';
import { RsiShadowObserver } from '../src/rsi-shadow-observer.mjs';
import { createRsiSearchContext } from '../src/rsi-search-mode-router.mjs';
import { RsiRuntimeService } from '../src/rsi-runtime-service.mjs';

const SOURCE_SHA='a0af13c0640fffb4b6d5da1645220e32786b5ec0';
const CANDIDATE_SHA='b'.repeat(40);
const CANDIDATE_ID='candidate_sha256_'+'c'.repeat(64);
const TAB='tab_00000000-0000-4000-8000-000000000001';

function stable(v){
  if(Array.isArray(v)) return v.map(stable);
  if(!v||typeof v!=='object') return v;
  return Object.fromEntries(Object.keys(v).sort().map((k)=>[k,stable(v[k])]));
}
function digest(v){
  return crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex');
}
function input(){
  const memory=new BrowserBrainWorkingMemory({maxEvents:64,maxCells:8,clock:()=>1_800_000_000_000});
  memory.rememberBinding({
    valid:true,tab_id:TAB,binding_generation:1,web_contents_id:7,renderer_pid:77,
    renderer_process_key:'77:1234',target_id:'target-7',document_generation:1,semantic_revision:1,
  });
  memory.rememberCommandOutcome({
    command_id:'cmd-runtime-feedback-1',action:'TYPE',tab_id:TAB,status:'AMBIGUOUS',
    effect_outcome:'AMBIGUOUS',recorded_at:'2027-01-15T08:01:00.000Z',
  });
  const observation=new RsiShadowObserver({
    source_sha:SOURCE_SHA,clock:()=>1_800_000_001_000,
  }).observeBrainSnapshot(memory.snapshot());
  const opportunity=observation.opportunities.find((row)=>row.signal==='AMBIGUOUS_COMMAND_OUTCOMES');
  const search_context=createRsiSearchContext({
    context_id:'rsi-context-runtime-feedback-1',
    mutation_surface:'BROWSER_RUNTIME',
    problem_class:'AMBIGUITY_RECONCILIATION',
    budget_class:'NORMAL',
    skeleton_available:false,
    trace_history_available:true,
    lineage_candidate_count:2,
    failure_class:'TRANSPORT_AMBIGUITY',
    novelty_pressure:0.4,
    external_context_owner:true,
    authored_by_candidate:false,
  });
  return {
    observation,
    opportunity_id:opportunity.opportunity_id,
    search_context,
    cycle_generation:1,
    max_candidates:4,
    proposal_budget_units:100,
    exploration_fraction:0.2,
  };
}
function handoff(plan,index=0){
  const variant=plan.variant_plans[index];
  return {
    schema:'metaengine.rsi.isolated-candidate-handoff.v1',
    version:1,
    experiment_id:variant.experiment_id,
    mutation_surface:'BROWSER_RUNTIME',
    parent_sha:SOURCE_SHA,
    candidate_sha:CANDIDATE_SHA,
    target_branch:variant.target_branch,
    handoff_digest:'sha256:'+'d'.repeat(64),
    candidate_capsule:{candidate_id:CANDIDATE_ID,source:{head:CANDIDATE_SHA}},
    eligible_for_evaluation:true,
    eligible_for_promotion:false,
    materialization_replay_authorized:false,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
}
function bundle(plan){
  const kinds=['HARD_INVARIANTS','OBJECTIVES','HOLDOUT','REGRESSION_REPLAY','EVALUATION_INTEGRITY','TOURNAMENT'];
  const evidence=kinds.map((kind,index)=>({
    evidence_kind:kind,
    evidence_id:'runtime-feedback-evidence-'+String(index+1),
    evidence_digest:String(index+1).repeat(64).slice(0,64),
    source_artifact_digest:String(index+7).repeat(64).slice(0,64),
    result:'PASS',
    ambiguous_effect:false,
    external_evidence_required:true,
    authored_by_candidate:false,
    physical_effect_replay_allowed:false,
    authority_effect:false,
    automatic_retry_allowed:false,
  }));
  const core={
    schema:'metaengine.rsi.episode-evaluation-bundle.v1',
    version:1,
    episode_id:plan.episode_id,
    source_sha:SOURCE_SHA,
    trust_root_set_digest:'e'.repeat(64),
    candidate_id:CANDIDATE_ID,
    candidate_sha:CANDIDATE_SHA,
    parent_sha:SOURCE_SHA,
    mutation_surface:'BROWSER_RUNTIME',
    evidence,
    complete_evidence_set:true,
    candidate_authored_evidence_allowed:false,
    scalar_reward_authoritative:false,
    visible_suite_alone_sufficient:false,
    external_promotion_gate_still_required:true,
    direct_promotion_enabled:false,
    execution_authority:false,
    browser_authority:false,
    scheduler_authority:false,
    task_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return {...core,bundle_digest:digest(core)};
}

test('verified evaluation feedback is durable and automatically informs the next matching search context',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-rsi-search-feedback-runtime-'));
  const ledgerPath=path.join(root,'rsi.jsonl');
  try{
    const first=new RsiRuntimeService({source_sha:SOURCE_SHA,ledgerPath});
    await first.start();
    const firstCycle=await first.prepareAutonomousEpisodeCycle({...input(),search_outcomes:[]});
    const plan=firstCycle.controller_plan;
    const recorded=await first.recordVerifiedSearchFeedback({
      controller_plan:plan,
      candidate_handoff:handoff(plan),
      evaluation_bundle:bundle(plan),
      cost_units:12,
    });
    assert.equal(recorded.already_recorded,false);
    assert.equal(recorded.feedback.net_benefit_verified,true);
    assert.equal(first.snapshot().verified_search_feedback_count,1);

    const duplicate=await first.recordVerifiedSearchFeedback({
      controller_plan:plan,
      candidate_handoff:handoff(plan),
      evaluation_bundle:bundle(plan),
      cost_units:12,
    });
    assert.equal(duplicate.already_recorded,true);
    assert.equal(first.snapshot().verified_search_feedback_count,1);

    const second=new RsiRuntimeService({source_sha:SOURCE_SHA,ledgerPath});
    await second.start();
    assert.equal(second.snapshot().verified_search_feedback_count,1);
    const next=await second.prepareAutonomousEpisodeCycle(input());
    assert.equal(next.controller_plan.routing_plan.evidence_outcome_digests.length,1);
    assert.equal(next.controller_plan.routing_plan.externally_verified_outcomes_only,true);
    assert.notEqual(next.controller_plan.routing_digest,plan.routing_digest);
    assert.equal(next.scheduler_action_authorized,false);
    assert.equal(next.execution_authority,false);
  }finally{
    await fs.rm(root,{recursive:true,force:true});
  }
});

test('runtime search feedback remains bounded contextual evidence, never scalar or scheduler authority',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-rsi-search-feedback-policy-'));
  const ledgerPath=path.join(root,'rsi.jsonl');
  try{
    const runtime=new RsiRuntimeService({source_sha:SOURCE_SHA,ledgerPath});
    await runtime.start();
    const cycle=await runtime.prepareAutonomousEpisodeCycle({...input(),search_outcomes:[]});
    const recorded=await runtime.recordVerifiedSearchFeedback({
      controller_plan:cycle.controller_plan,
      candidate_handoff:handoff(cycle.controller_plan),
      evaluation_bundle:bundle(cycle.controller_plan),
      cost_units:5,
    });
    assert.equal(recorded.feedback.scalar_reward_authoritative,false);
    assert.equal(recorded.feedback.search_feedback_is_scheduler_authority,false);
    assert.equal(recorded.feedback.search_feedback_is_promotion_authority,false);
    const snapshot=runtime.snapshot();
    assert.equal(snapshot.verified_search_feedback_capacity,512);
    assert.equal(snapshot.verified_search_feedback_scalar_reward_authoritative,false);
    assert.equal(snapshot.scheduler_authority,false);
    assert.equal(snapshot.promotion_authority,false);
    assert.equal(snapshot.self_update_authority,false);
  }finally{
    await fs.rm(root,{recursive:true,force:true});
  }
});
