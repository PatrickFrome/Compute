import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { RsiRuntimeService } from '../src/rsi-runtime-service.mjs';
import { BROWSER_BRAIN_WORKING_MEMORY_SCHEMA } from '../src/browser-brain-working-memory.mjs';
import { createRsiSearchContext } from '../src/rsi-search-mode-router.mjs';
import { createRsiExperienceContextAblationReceipt } from '../src/rsi-experience-context-ablation-attribution.mjs';

const SOURCE='a'.repeat(40);
const COMMAND='11111111-1111-4111-8111-111111111112';
const d=(c)=>'sha256:'+c.repeat(64);
const cid=(c)=>'candidate_sha256_'+c.repeat(64);

function registration(){
  return {
    command_id:COMMAND,
    task_id:'task.utility.learning.1',
    task_signature_digest:d('1'),
    environment_fingerprint:'metaengine.browser.runtime',
    model_family:'METAENGINE_RSI',
    producer:'DB_LEASE_SUPERVISOR',
    lease_evidence_digest:d('2'),
    candidate_id:cid('c'),
    candidate_sha:'c'.repeat(40),
    proposal_digest:d('3'),
    skill_digests:[],
    external_attribution:true,
    authored_by_candidate:false,
  };
}

function genericAttribution(){
  return {
    task_id:'browser.command.generic',
    task_signature_digest:d('5'),
    environment_fingerprint:'metaengine.browser.runtime',
    model_family:'METAENGINE_RSI',
    candidate_id:null,candidate_sha:null,proposal_digest:null,skill_digests:[],
    external_attribution:true,authored_by_candidate:false,
  };
}

function readback(){
  return {
    schema:'metaengine.rsi.result-receipt-readback.v1',
    command_id:COMMAND,found:true,terminal:true,status:'COMPLETED',
    receipt:{
      schema:'metaengine.native-supervisor.command-receipt.v2',
      command_id:COMMAND,action:'SCROLL',platform:'CHATGPT',result:null,
      effect_outcome:'CONFIRMED',lane:'MUTATION',effect_key:'effect-utility-1',
      execution_ms:11,recorded_at:'2026-09-18T17:52:00.000Z',authority_effect:false,
    },
    error:null,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,
    self_update_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
}

function creditAssignment(){
  return {
    credit_id:'credit.utility.learning.1',
    assignment_method:'HIERARCHICAL_EXTERNAL',
    step_credit:0.6,confidence:0.97,attempt_index:1,
    challenge_family:'BROWSER_RUNTIME',
    hidden_manifest_digest:d('6'),
    execution_signature_digest:d('7'),
    failure_codes:[],
    mechanism_tags:['AMBIGUOUS_COMMAND_OUTCOMES','BROWSER_RUNTIME'],
    lesson_digests:[d('8')],attribution_digests:[],transfer_receipt_digests:[],
    evidence_digest:d('9'),evidence_refs:['evidence:terminal-receipt','evidence:external-credit'],
    external_credit_assigner:true,authored_by_candidate:false,
  };
}

function ambiguousBrain(){
  return {
    schema:BROWSER_BRAIN_WORKING_MEMORY_SCHEMA,
    global:{process_revision:7,cognitive_sequence:11,dropped_events:0},
    cells:[{
      tab_id:'tab_00000000-0000-4000-8000-000000000456',
      status:'READY',binding:null,last_event:null,
      last_command:{status:'AMBIGUOUS',effect_outcome:'AMBIGUOUS'},
      last_semantic_sequence:null,last_observed_at:'2026-09-18T17:10:00.000Z',
      attention_reason:null,execution_authority:false,authority_effect:false,
    }],
    raw_dom_stored:false,raw_network_stored:false,page_text_stored:false,input_values_stored:false,
    command_payload_stored:false,execution_authority:false,command_leasing:false,
    automatic_effect_retry_allowed:false,authority_effect:false,
  };
}

function searchContext(){
  return createRsiSearchContext({
    context_id:'rsi-context-runtime-utility-feedback',
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

test('runtime appends contextual utility after durable feedback and replays identical graph state',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-rsi-context-utility-runtime-'));
  const ledgerPath=path.join(root,'rsi.jsonl');
  try{
    const runtime=new RsiRuntimeService({source_sha:SOURCE,ledgerPath});
    await runtime.start();

    await runtime.registerBrowserCommandAttribution(registration());
    const outcome=await runtime.ingestBrowserOutcome({
      readback:readback(),
      attribution:genericAttribution(),
    });
    const credit=await runtime.recordTrustedCredit({
      outcome_episode_digest:outcome.episode_digest,
      assignment:creditAssignment(),
    });
    const caseId=credit.experience_case.case_id;
    const graphBeforeUtility=runtime.snapshot().trusted_credit.experience_graph_snapshot_digest;

    const observation=await runtime.observeBrainSnapshot(ambiguousBrain());
    const [entry]=runtime.improvementFrontier({limit:32});
    const cycle=await runtime.prepareExperienceGuidedAutonomousEpisodeCycle({
      observation,
      opportunity_id:entry.opportunity_id,
      search_context:searchContext(),
      bridge_case_ids:[caseId],
      cycle_generation:1,
      max_candidates:4,
      proposal_budget_units:100,
      exploration_fraction:0.2,
    });
    assert.equal(cycle.experience_context_plan.mode,'VERIFIED_EXPERIENCE_RETRIEVAL');
    assert.equal(cycle.experience_context_plan.selected_case_count,1);
    assert.equal(cycle.experience_context_plan.selected_cases[0].case_id,caseId);

    const selected=cycle.experience_context_plan.selected_cases[0];
    const feedback=await runtime.recordExperienceContextUtilityFeedback({
      cycle_digest:cycle.cycle_digest,
      autonomous_controller_plan:cycle.autonomous_cycle.controller_plan,
      evaluation_digest:d('d'),
      evaluation_kind:'EPISODE_EVALUATION',
      evaluator_id:'external-context-utility-evaluator-v1',
      judgments:[{
        case_id:selected.case_id,
        case_digest:selected.case_digest,
        outcome:'HELPFUL',
        evidence_digest:d('e'),
        evidence_refs:['eval:utility-helpful-runtime'],
      }],
    });
    assert.equal(feedback.already_recorded,false);
    assert.equal(feedback.feedback.state,'CONTEXT_UTILITY_OBSERVED');
    assert.equal(feedback.feedback.helpful_count,1);
    assert.equal(feedback.feedback.harmful_count,0);
    assert.notEqual(feedback.graph_snapshot_digest,graphBeforeUtility);

    const duplicate=await runtime.recordExperienceContextUtilityFeedback({
      cycle_digest:cycle.cycle_digest,
      autonomous_controller_plan:cycle.autonomous_cycle.controller_plan,
      evaluation_digest:d('d'),
      evaluation_kind:'EPISODE_EVALUATION',
      evaluator_id:'external-context-utility-evaluator-v1',
      judgments:[{
        case_id:selected.case_id,
        case_digest:selected.case_digest,
        outcome:'HELPFUL',
        evidence_digest:d('e'),
        evidence_refs:['eval:utility-helpful-runtime'],
      }],
    });
    assert.equal(duplicate.already_recorded,true);
    assert.equal(duplicate.graph_snapshot_digest,feedback.graph_snapshot_digest);
    assert.equal(runtime.snapshot().experience_context_utility_feedback.count,1);
    assert.equal(runtime.snapshot().experience_context_utility_feedback.helpful_receipt_count,1);
    assert.equal(runtime.snapshot().experience_context_utility_feedback.harmful_receipt_count,0);

    const replay=new RsiRuntimeService({source_sha:SOURCE,ledgerPath});
    await replay.start();
    assert.equal(replay.snapshot().experience_context_utility_feedback.count,1);
    assert.equal(replay.snapshot().experience_context_utility_feedback.helpful_receipt_count,1);
    assert.equal(replay.snapshot().trusted_credit.experience_graph_snapshot_digest,feedback.graph_snapshot_digest);
    assert.equal(replay.snapshot().execution_authority,false);
    assert.equal(replay.snapshot().scheduler_authority,false);
    assert.equal(replay.snapshot().promotion_authority,false);
    assert.equal(replay.snapshot().self_update_authority,false);
  }finally{
    await fs.rm(root,{recursive:true,force:true});
  }
});

test('runtime refuses utility feedback for an unpersisted guided cycle',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-rsi-context-utility-unbound-'));
  const ledgerPath=path.join(root,'rsi.jsonl');
  try{
    const runtime=new RsiRuntimeService({source_sha:SOURCE,ledgerPath});
    await runtime.start();
    await assert.rejects(
      runtime.recordExperienceContextUtilityFeedback({
        cycle_digest:'f'.repeat(64),
        autonomous_controller_plan:{},
        evaluation_digest:d('d'),
        evaluation_kind:'EPISODE_EVALUATION',
        evaluator_id:'external-context-utility-evaluator-v1',
        judgments:[],
      }),
      /experience_guided_cycle_not_persisted/,
    );
  }finally{
    await fs.rm(root,{recursive:true,force:true});
  }
});


test('runtime persists matched memory ablation attribution before applying derived utility feedback',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-rsi-context-attribution-runtime-'));
  const ledgerPath=path.join(root,'rsi.jsonl');
  try{
    const runtime=new RsiRuntimeService({source_sha:SOURCE,ledgerPath});
    await runtime.start();
    await runtime.registerBrowserCommandAttribution(registration());
    const outcome=await runtime.ingestBrowserOutcome({readback:readback(),attribution:genericAttribution()});
    const credit=await runtime.recordTrustedCredit({
      outcome_episode_digest:outcome.episode_digest,
      assignment:creditAssignment(),
    });

    const observation=await runtime.observeBrainSnapshot(ambiguousBrain());
    const [entry]=runtime.improvementFrontier({limit:32});
    const cycle=await runtime.prepareExperienceGuidedAutonomousEpisodeCycle({
      observation,
      opportunity_id:entry.opportunity_id,
      search_context:searchContext(),
      bridge_case_ids:[credit.experience_case.case_id],
      cycle_generation:2,
      max_candidates:4,
      proposal_budget_units:100,
      exploration_fraction:0.2,
    });
    assert.equal(cycle.experience_context_plan.selected_case_count,1);

    const plan=runtime.prepareExperienceContextAttribution({
      cycle_digest:cycle.cycle_digest,
      autonomous_controller_plan:cycle.autonomous_cycle.controller_plan,
      evaluation_protocol_digest:d('a'),
      objective_spec:[
        {metric:'TASK_SUCCESS',direction:'HIGHER_BETTER',epsilon:0.01},
        {metric:'P95_LATENCY_MS',direction:'LOWER_BETTER',epsilon:2},
      ],
    });
    assert.equal(plan.ablation_count,1);
    const receipt=createRsiExperienceContextAblationReceipt({
      plan,
      ablation_id:plan.ablations[0].ablation_id,
      baseline_hard_invariants_pass:true,
      ablated_hard_invariants_pass:true,
      baseline_objectives:[
        {metric:'TASK_SUCCESS',value:0.82},
        {metric:'P95_LATENCY_MS',value:100},
      ],
      ablated_objectives:[
        {metric:'TASK_SUCCESS',value:0.68},
        {metric:'P95_LATENCY_MS',value:118},
      ],
      workload_digest:d('b'),
      seed_set_digest:d('c'),
      budget_digest:d('d'),
      evaluator_id:'external-memory-ablation-runtime-v1',
      evidence_digest:d('e'),
      evidence_refs:['eval:runtime-memory-ablation'],
      external_evaluator:true,
      authored_by_candidate:false,
    });
    assert.equal(receipt.outcome,'HELPFUL');

    const result=await runtime.recordAttributedExperienceContextUtilityFeedback({
      cycle_digest:cycle.cycle_digest,
      autonomous_controller_plan:cycle.autonomous_cycle.controller_plan,
      attribution_plan:plan,
      ablation_receipts:[receipt],
    });
    assert.equal(result.attribution.state,'ATTRIBUTION_READY');
    assert.equal(result.attribution.eligible_for_context_utility_feedback,true);
    assert.equal(result.utility_feedback_recorded,true);
    assert.equal(result.utility_feedback.helpful_count,1);
    assert.equal(runtime.snapshot().experience_context_attribution.count,1);
    assert.equal(runtime.snapshot().experience_context_attribution.ambiguous_interaction_count,0);
    assert.equal(runtime.snapshot().experience_context_utility_feedback.count,1);

    const duplicate=await runtime.recordAttributedExperienceContextUtilityFeedback({
      cycle_digest:cycle.cycle_digest,
      autonomous_controller_plan:cycle.autonomous_cycle.controller_plan,
      attribution_plan:plan,
      ablation_receipts:[receipt],
    });
    assert.equal(duplicate.attribution_already_recorded,true);
    assert.equal(duplicate.utility_feedback_already_recorded,true);
    assert.equal(runtime.snapshot().experience_context_attribution.count,1);
    assert.equal(runtime.snapshot().experience_context_utility_feedback.count,1);

    const replay=new RsiRuntimeService({source_sha:SOURCE,ledgerPath});
    await replay.start();
    assert.equal(replay.snapshot().experience_context_attribution.count,1);
    assert.equal(replay.snapshot().experience_context_utility_feedback.count,1);
    assert.equal(replay.snapshot().experience_context_attribution.attribution_is_skill_evidence,false);
    assert.equal(replay.snapshot().experience_context_attribution.attribution_is_scheduler_authority,false);
  }finally{
    await fs.rm(root,{recursive:true,force:true});
  }
});
