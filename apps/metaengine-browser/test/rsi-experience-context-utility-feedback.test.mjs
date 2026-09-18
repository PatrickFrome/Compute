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
import { createRsiExperienceContextPlan } from '../src/rsi-experience-context-planner.mjs';
import { createRsiAutonomousEpisodePlan } from '../src/rsi-autonomous-episode-controller.mjs';
import {
  createRsiExperienceContextUtilityFeedback,
  verifyRsiExperienceContextUtilityFeedback,
  rsiExperienceContextUtilityFeedbackTrustRootSnapshot,
} from '../src/rsi-experience-context-utility-feedback.mjs';

const SOURCE='a0af13c0640fffb4b6d5da1645220e32786b5ec0';
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
    command_id:'cmd-ambiguous-utility-1',action:'TYPE',tab_id:TAB,
    status:'AMBIGUOUS',effect_outcome:'AMBIGUOUS',recorded_at:'2027-01-15T08:01:00.000Z',
  });
  return new RsiShadowObserver({
    source_sha:SOURCE,clock:()=>1_800_000_001_000,
  }).observeBrainSnapshot(memory.snapshot());
}

function searchContext(){
  return createRsiSearchContext({
    context_id:'rsi-context-utility-1',
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

function fixture(){
  const obs=observation();
  const opportunity=obs.opportunities.find((row)=>row.signal==='AMBIGUOUS_COMMAND_OUTCOMES');
  const hypothesis=buildRsiExperimentHypothesis({observation:obs,opportunity_id:opportunity.opportunity_id});
  const plan=buildRsiDevosExperimentPlan({observation:obs,opportunity_id:opportunity.opportunity_id,hypothesis});
  const frontier={
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
  const anchor={
    task_id:'utility.history.1',
    task_signature_digest:d('1'),
    challenge_family:'BROWSER_RUNTIME',
    hidden_manifest_digest:d('2'),
    external_writer:true,
    authored_by_candidate:false,
  };
  const helpfulCase=createRsiExperienceCase({
    case_id:'rsi_case_utility_helpful_candidate',
    task_id:anchor.task_id,task_signature_digest:anchor.task_signature_digest,attempt_index:1,
    candidate_id:cid('b'),candidate_sha:'b'.repeat(40),outcome:'SUCCESS',
    environment_fingerprint:'metaengine.browser.runtime',model_family:'METAENGINE_RSI',
    execution_signature_digest:d('3'),failure_codes:[],
    mechanism_tags:['AMBIGUOUS_COMMAND_OUTCOMES','BROWSER_RUNTIME'],
    lesson_digests:[d('4')],attribution_digests:[d('5')],transfer_receipt_digests:[],
    evidence_digest:d('6'),evidence_refs:['evidence:utility-helpful'],
    external_writer:true,authored_by_candidate:false,
  });
  const harmfulCase=createRsiExperienceCase({
    case_id:'rsi_case_utility_negative_transfer',
    task_id:anchor.task_id,task_signature_digest:anchor.task_signature_digest,attempt_index:2,
    candidate_id:cid('c'),candidate_sha:'c'.repeat(40),outcome:'FAILURE',
    environment_fingerprint:'metaengine.browser.runtime',model_family:'METAENGINE_RSI',
    execution_signature_digest:d('7'),failure_codes:['AMBIGUOUS_COMMAND_OUTCOMES'],
    mechanism_tags:['AMBIGUOUS_COMMAND_OUTCOMES','BROWSER_RUNTIME'],
    lesson_digests:[d('8')],attribution_digests:[d('9')],transfer_receipt_digests:[],
    evidence_digest:d('a'),evidence_refs:['evidence:utility-harmful'],
    external_writer:true,authored_by_candidate:false,
  });
  const graph=createRsiExperienceGraphSnapshot({
    graph_id:'rsi.runtime.experience.'+SOURCE.slice(0,16),
    epoch:1,task_anchors:[anchor],cases:[helpfulCase,harmfulCase],
  });
  const contextPlan=createRsiExperienceContextPlan({
    frontier_entry:frontier,
    experience_graph_snapshot:graph,
    bridge_case_ids:[helpfulCase.case_id,harmfulCase.case_id],
  });
  const controllerPlan=createRsiAutonomousEpisodePlan({
    observation:obs,
    opportunity_id:opportunity.opportunity_id,
    search_context:searchContext(),
    experience_context_plan:contextPlan,
  });
  return {obs,opportunity,graph,contextPlan,controllerPlan};
}

function judgments(contextPlan){
  return contextPlan.selected_cases.map((row)=>({
    case_id:row.case_id,
    case_digest:row.case_digest,
    outcome:row.case_id.includes('negative')?'HARMFUL':'HELPFUL',
    evidence_digest:row.case_id.includes('negative')?d('b'):d('c'),
    evidence_refs:[row.case_id.includes('negative')?'eval:negative-transfer':'eval:helpful-transfer'],
  }));
}

test('external evaluator records complete contextual utility over exactly the retrieved case set',()=>{
  const {contextPlan,controllerPlan}=fixture();
  const feedback=createRsiExperienceContextUtilityFeedback({
    experience_context_plan:contextPlan,
    autonomous_controller_plan:controllerPlan,
    evaluation_digest:d('d'),
    evaluation_kind:'EPISODE_EVALUATION',
    evaluator_id:'external-context-utility-evaluator-v1',
    judgments:judgments(contextPlan),
    external_evaluator:true,
    authored_by_candidate:false,
  });
  verifyRsiExperienceContextUtilityFeedback(feedback);
  assert.equal(feedback.receipt_count,contextPlan.selected_case_count);
  assert.equal(feedback.complete_selected_case_attribution,true);
  assert.equal(feedback.harmful_count,1);
  assert.ok(feedback.helpful_count>=1);
  assert.equal(feedback.state,'NEGATIVE_TRANSFER_PRESENT');
  assert.equal(feedback.utility_is_contextual_not_global_truth,true);
  assert.equal(feedback.causal_credit_claimed,false);
  assert.equal(feedback.positive_utility_is_skill_evidence,false);
  assert.ok(feedback.utility_receipts.every((row)=>row.target_context_digest===contextPlan.target_context_digest));
  assert.ok(feedback.utility_receipts.every((row)=>row.external_evaluator===true));
  assert.ok(feedback.utility_receipts.every((row)=>row.candidate_can_edit_utility===false));
});

test('candidate cannot label memory utility and partial selected-case attribution is rejected',()=>{
  const {contextPlan,controllerPlan}=fixture();
  assert.throws(()=>createRsiExperienceContextUtilityFeedback({
    experience_context_plan:contextPlan,
    autonomous_controller_plan:controllerPlan,
    evaluation_digest:d('d'),
    evaluation_kind:'EPISODE_EVALUATION',
    evaluator_id:'external-context-utility-evaluator-v1',
    judgments:judgments(contextPlan),
    external_evaluator:true,
    authored_by_candidate:true,
  }),/external_evaluator_required/);
  assert.throws(()=>createRsiExperienceContextUtilityFeedback({
    experience_context_plan:contextPlan,
    autonomous_controller_plan:controllerPlan,
    evaluation_digest:d('d'),
    evaluation_kind:'EPISODE_EVALUATION',
    evaluator_id:'external-context-utility-evaluator-v1',
    judgments:judgments(contextPlan).slice(0,1),
    external_evaluator:true,
    authored_by_candidate:false,
  }),/complete_case_judgments_required/);
});

test('utility feedback must bind to the exact controller context and selected case digests',()=>{
  const {contextPlan,controllerPlan}=fixture();
  const wrongController=structuredClone(controllerPlan);
  wrongController.experience_context_digest='f'.repeat(64);
  assert.throws(()=>createRsiExperienceContextUtilityFeedback({
    experience_context_plan:contextPlan,
    autonomous_controller_plan:wrongController,
    evaluation_digest:d('d'),evaluation_kind:'EPISODE_EVALUATION',
    evaluator_id:'external-context-utility-evaluator-v1',
    judgments:judgments(contextPlan),external_evaluator:true,authored_by_candidate:false,
  }),/(controller_plan_digest_mismatch|controller_context_mismatch|experience_context)/);

  const bad=judgments(contextPlan);
  bad[0]={...bad[0],case_digest:d('e')};
  assert.throws(()=>createRsiExperienceContextUtilityFeedback({
    experience_context_plan:contextPlan,
    autonomous_controller_plan:controllerPlan,
    evaluation_digest:d('d'),evaluation_kind:'EPISODE_EVALUATION',
    evaluator_id:'external-context-utility-evaluator-v1',
    judgments:bad,external_evaluator:true,authored_by_candidate:false,
  }),/case_digest_mismatch/);
});

test('feedback cannot be widened into global reward, skill evidence or authority',()=>{
  const {contextPlan,controllerPlan}=fixture();
  const base=createRsiExperienceContextUtilityFeedback({
    experience_context_plan:contextPlan,
    autonomous_controller_plan:controllerPlan,
    evaluation_digest:d('d'),evaluation_kind:'EPISODE_EVALUATION',
    evaluator_id:'external-context-utility-evaluator-v1',
    judgments:judgments(contextPlan),external_evaluator:true,authored_by_candidate:false,
  });
  for(const mutate of [
    x=>{x.utility_is_contextual_not_global_truth=false;},
    x=>{x.positive_utility_is_skill_evidence=true;},
    x=>{x.utility_is_scheduler_authority=true;},
    x=>{x.utility_is_promotion_authority=true;},
    x=>{x.graph_write_performed=true;},
    x=>{x.self_update_authority=true;},
  ]){
    const copy=structuredClone(base);mutate(copy);
    assert.throws(()=>verifyRsiExperienceContextUtilityFeedback(copy),/(feedback_policy_invalid|self_update_authority_invalid)/);
  }
});

test('utility feedback trust root preserves contextual negative-transfer memory without authority',()=>{
  const root=rsiExperienceContextUtilityFeedbackTrustRootSnapshot();
  assert.equal(root.external_evaluator_required,true);
  assert.equal(root.complete_selected_case_attribution_required,true);
  assert.equal(root.exact_target_context_binding_required,true);
  assert.equal(root.contextual_utility_not_global_truth,true);
  assert.equal(root.harmful_is_negative_transfer_memory,true);
  assert.equal(root.positive_utility_is_skill_evidence,false);
  assert.equal(root.candidate_can_label_utility,false);
  assert.equal(root.utility_is_scheduler_authority,false);
  assert.equal(root.utility_is_promotion_authority,false);
  assert.equal(root.utility_is_execution_authority,false);
});
