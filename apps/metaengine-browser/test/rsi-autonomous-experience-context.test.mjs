import assert from 'node:assert/strict';
import test from 'node:test';

import { BrowserBrainWorkingMemory } from '../src/browser-brain-working-memory.mjs';
import { RsiShadowObserver } from '../src/rsi-shadow-observer.mjs';
import { buildRsiExperimentHypothesis } from '../src/supervisor-rsi-experiment-hypothesis.mjs';
import { buildRsiDevosExperimentPlan } from '../src/rsi-devos-experiment-plan.mjs';
import { createRsiSearchContext } from '../src/rsi-search-mode-router.mjs';
import {
  createRsiExperienceCase,
  createRsiExperienceGraphSnapshot,
} from '../src/rsi-experience-graph.mjs';
import {
  createRsiExperienceContextPlan,
} from '../src/rsi-experience-context-planner.mjs';
import {
  createRsiAutonomousEpisodePlan,
  verifyRsiAutonomousEpisodePlan,
  rsiAutonomousEpisodeControllerTrustRootSnapshot,
} from '../src/rsi-autonomous-episode-controller.mjs';

const SOURCE_SHA='a0af13c0640fffb4b6d5da1645220e32786b5ec0';
const TAB='tab_00000000-0000-4000-8000-000000000001';
const d=(c)=>'sha256:'+c.repeat(64);
const cid=(c)=>'candidate_sha256_'+c.repeat(64);

function observation(){
  const memory=new BrowserBrainWorkingMemory({maxEvents:64,maxCells:8,clock:()=>1_800_000_000_000});
  memory.rememberBinding({
    valid:true,tab_id:TAB,binding_generation:1,web_contents_id:7,renderer_pid:77,
    renderer_process_key:'77:1234',target_id:'target-7',document_generation:1,semantic_revision:1,
  });
  memory.rememberCommandOutcome({
    command_id:'cmd-ambiguous-experience-guided-1',action:'TYPE',tab_id:TAB,
    status:'AMBIGUOUS',effect_outcome:'AMBIGUOUS',recorded_at:'2027-01-15T08:01:00.000Z',
  });
  return new RsiShadowObserver({
    source_sha:SOURCE_SHA,clock:()=>1_800_000_001_000,
  }).observeBrainSnapshot(memory.snapshot());
}

function searchContext(){
  return createRsiSearchContext({
    context_id:'rsi-context-experience-guided-1',
    mutation_surface:'BROWSER_RUNTIME',
    problem_class:'AMBIGUITY_RECONCILIATION',
    budget_class:'NORMAL',
    skeleton_available:false,
    trace_history_available:true,
    lineage_candidate_count:2,
    failure_class:'TRANSPORT_AMBIGUITY',
    novelty_pressure:0.35,
    external_context_owner:true,
    authored_by_candidate:false,
  });
}

function frontierFromObservation(obs,opportunity){
  const hypothesis=buildRsiExperimentHypothesis({
    observation:obs,
    opportunity_id:opportunity.opportunity_id,
  });
  const plan=buildRsiDevosExperimentPlan({
    observation:obs,
    opportunity_id:opportunity.opportunity_id,
    hypothesis,
  });
  return {
    opportunity_id:opportunity.opportunity_id,
    signal:opportunity.signal,
    priority:opportunity.priority,
    mutation_surface:opportunity.mutation_surface,
    observation_digest:obs.observation_digest,
    hypothesis,
    plan,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
}

function postAdoptionGraph(frontier){
  const taskAnchor={
    task_id:'post_adoption_verified_case_1',
    task_signature_digest:'sha256:'+String(frontier.plan.plan_digest).replace(/^sha256:/,''),
    challenge_family:'BROWSER_RUNTIME',
    hidden_manifest_digest:d('6'),
    external_writer:true,
    authored_by_candidate:false,
  };
  const experience=createRsiExperienceCase({
    case_id:'rsi_post_adopt_verified_success_1',
    task_id:taskAnchor.task_id,
    task_signature_digest:taskAnchor.task_signature_digest,
    attempt_index:1,
    candidate_id:cid('b'),
    candidate_sha:'b'.repeat(40),
    outcome:'SUCCESS',
    environment_fingerprint:'metaengine.browser.runtime',
    model_family:'METAENGINE_RSI',
    execution_signature_digest:d('7'),
    failure_codes:[],
    mechanism_tags:['AMBIGUOUS_COMMAND_OUTCOMES','BROWSER_RUNTIME','PARETO_IMPROVEMENT','POST_ADOPTION_DEPLOYMENT'],
    lesson_digests:[d('8')],
    attribution_digests:[d('9')],
    transfer_receipt_digests:[],
    evidence_digest:d('a'),
    evidence_refs:['post-adoption-evidence-1'],
    external_writer:true,
    authored_by_candidate:false,
  });
  return createRsiExperienceGraphSnapshot({
    graph_id:'rsi.runtime.experience.bbbbbbbbbbbbbbbb',
    epoch:1,
    task_anchors:[taskAnchor],
    cases:[experience],
  });
}

function experiencePlan(){
  const obs=observation();
  const opportunity=obs.opportunities.find((row)=>row.signal==='AMBIGUOUS_COMMAND_OUTCOMES');
  const frontier=frontierFromObservation(obs,opportunity);
  const graph=postAdoptionGraph(frontier);
  const plan=createRsiExperienceContextPlan({
    frontier_entry:frontier,
    experience_graph_snapshot:graph,
  });
  return {obs,opportunity,frontier,graph,plan};
}

test('verified post-adoption Experience Graph context is bound into the existing autonomous episode and DevOS variants',()=>{
  const {obs,opportunity,graph,plan}=experiencePlan();
  assert.equal(plan.mode,'VERIFIED_EXPERIENCE_RETRIEVAL');
  assert.equal(plan.selected_case_count,1);

  const guided=createRsiAutonomousEpisodePlan({
    observation:obs,
    opportunity_id:opportunity.opportunity_id,
    search_context:searchContext(),
    experience_context_plan:plan,
  });
  const unguided=createRsiAutonomousEpisodePlan({
    observation:obs,
    opportunity_id:opportunity.opportunity_id,
    search_context:searchContext(),
  });

  verifyRsiAutonomousEpisodePlan(guided);
  assert.notEqual(guided.episode_id,unguided.episode_id);
  assert.equal(guided.experience_context_digest,plan.context_plan_digest.slice(7));
  assert.equal(guided.experience_context_summary.graph_snapshot_digest,graph.snapshot_digest);
  assert.equal(guided.experience_context_summary.selected_case_count,1);
  assert.equal(guided.experience_context_summary.selected_cases[0].case_id,'rsi_post_adopt_verified_success_1');
  assert.equal(guided.experience_context_advisory_only,true);
  assert.equal(guided.candidate_can_modify_experience_context,false);
  assert.equal(guided.experience_context_is_scheduler_authority,false);
  assert.equal(guided.experience_context_is_promotion_authority,false);

  for(const variant of guided.variant_plans){
    const ctx=variant.task_spec.rsi.experience_context;
    assert.equal(ctx.context_plan_digest,plan.context_plan_digest);
    assert.equal(ctx.selected_case_count,1);
    assert.equal(ctx.selected_cases[0].outcome,'SUCCESS');
    assert.equal(ctx.retrieval_is_advisory_only,true);
    assert.equal(ctx.scheduler_action_authorized,false);
    assert.equal(ctx.execution_authority,false);
    assert.ok(variant.task_spec.constraints.includes('rsi_experience_retrieval_is_advisory_only'));
    assert.ok(variant.task_spec.constraints.includes('rsi_experience_candidate_cannot_modify_context'));
    assert.ok(variant.task_spec.constraints.includes('rsi_experience_graph_snapshot_digest='+graph.snapshot_digest));
  }
});

test('experience context must match exact source, observation, opportunity and mutation surface',()=>{
  const {obs,opportunity,plan}=experiencePlan();

  const wrongObservation=structuredClone(plan);
  wrongObservation.observation_digest='f'.repeat(64);
  assert.throws(()=>createRsiAutonomousEpisodePlan({
    observation:obs,opportunity_id:opportunity.opportunity_id,
    search_context:searchContext(),experience_context_plan:wrongObservation,
  }),/(context_plan_digest_mismatch|experience_context_observation_mismatch)/);

  const wrongOpportunity=structuredClone(plan);
  wrongOpportunity.opportunity_id='opp:ffffffffffffffffffffffff';
  assert.throws(()=>createRsiAutonomousEpisodePlan({
    observation:obs,opportunity_id:opportunity.opportunity_id,
    search_context:searchContext(),experience_context_plan:wrongOpportunity,
  }),/(context_plan_digest_mismatch|experience_context_opportunity_mismatch)/);
});

test('candidate or worker cannot rewrite the selected experience summary after controller planning',()=>{
  const {obs,opportunity,plan}=experiencePlan();
  const guided=createRsiAutonomousEpisodePlan({
    observation:obs,opportunity_id:opportunity.opportunity_id,
    search_context:searchContext(),experience_context_plan:plan,
  });

  const tampered=structuredClone(guided);
  tampered.variant_plans[0].task_spec.rsi.experience_context.selected_cases[0].outcome='FAILURE';
  assert.throws(()=>verifyRsiAutonomousEpisodePlan(tampered),/variant_experience_context_mismatch/);

  const widened=structuredClone(guided);
  widened.experience_context_is_scheduler_authority=true;
  assert.throws(()=>verifyRsiAutonomousEpisodePlan(widened),/plan_policy_invalid/);
});

test('autonomous controller trust root freezes graph retrieval and keeps it advisory',()=>{
  const root=rsiAutonomousEpisodeControllerTrustRootSnapshot();
  assert.equal(root.verified_experience_context_supported,true);
  assert.equal(root.experience_context_retrieval_is_advisory_only,true);
  assert.equal(root.candidate_can_modify_experience_context,false);
  assert.equal(root.experience_context_is_scheduler_authority,false);
  assert.equal(root.experience_context_is_promotion_authority,false);
  assert.ok(root.immutable_component_paths.includes('apps/metaengine-browser/src/rsi-experience-context-planner.mjs'));
  assert.ok(root.immutable_component_paths.includes('apps/metaengine-browser/src/rsi-experience-graph.mjs'));
});
