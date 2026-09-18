import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { RsiRuntimeService } from '../src/rsi-runtime-service.mjs';
import { BROWSER_BRAIN_WORKING_MEMORY_SCHEMA } from '../src/browser-brain-working-memory.mjs';
import { createRsiSearchContext } from '../src/rsi-search-mode-router.mjs';

const SOURCE='a'.repeat(40);

function ambiguousBrain() {
  return {
    schema:BROWSER_BRAIN_WORKING_MEMORY_SCHEMA,
    global:{process_revision:7,cognitive_sequence:11,dropped_events:0},
    cells:[{
      tab_id:'tab_00000000-0000-4000-8000-000000000123',
      status:'READY',
      binding:null,
      last_event:null,
      last_command:{status:'AMBIGUOUS',effect_outcome:'AMBIGUOUS'},
      last_semantic_sequence:null,
      last_observed_at:'2026-09-18T17:10:00.000Z',
      attention_reason:null,
      execution_authority:false,
      authority_effect:false,
    }],
    raw_dom_stored:false,
    raw_network_stored:false,
    page_text_stored:false,
    input_values_stored:false,
    command_payload_stored:false,
    execution_authority:false,
    command_leasing:false,
    automatic_effect_retry_allowed:false,
    authority_effect:false,
  };
}

test('runtime opens a durable zero-authority learning episode from frontier with explicit empty-memory context',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-rsi-context-runtime-'));
  const ledgerPath=path.join(root,'rsi.jsonl');
  try {
    const first=new RsiRuntimeService({source_sha:SOURCE,ledgerPath});
    await first.start();
    await first.observeBrainSnapshot(ambiguousBrain());
    const frontier=first.improvementFrontier({limit:32});
    assert.equal(frontier.length,1);
    assert.equal(frontier[0].signal,'AMBIGUOUS_COMMAND_OUTCOMES');

    const preview=first.experienceContextForOpportunity({
      opportunity_id:frontier[0].opportunity_id,
    });
    assert.equal(preview.mode,'NO_VERIFIED_EXPERIENCE');
    assert.equal(preview.selected_case_count,0);
    assert.equal(preview.retrieval_is_advisory_only,true);

    const opened=await first.openLearningEpisodeFromOpportunity({
      opportunity_id:frontier[0].opportunity_id,
      max_candidates:3,
    });
    assert.equal(opened.context_plan.context_plan_digest,preview.context_plan_digest);
    assert.equal(opened.episode.search_context_digest,preview.search_context_digest);
    assert.equal(opened.episode.max_candidates,3);
    assert.equal(opened.episode.execution_authority,false);
    assert.equal(first.snapshot().experience_context.planned_count,1);
    assert.equal(first.snapshot().experience_context.task_lease_created,false);
    assert.equal(first.snapshot().experience_context.candidate_materialized,false);

    const second=new RsiRuntimeService({source_sha:SOURCE,ledgerPath});
    await second.start();
    const replayedFrontier=second.improvementFrontier({limit:32});
    assert.equal(replayedFrontier.length,1);
    assert.equal(replayedFrontier[0].opportunity_id,frontier[0].opportunity_id);
    assert.equal(second.snapshot().experience_context.planned_count,1);
    assert.equal(second.snapshot().episodes.episode_count,1);
    const replayedPreview=second.experienceContextForOpportunity({
      opportunity_id:frontier[0].opportunity_id,
    });
    assert.equal(replayedPreview.context_plan_digest,preview.context_plan_digest);
  } finally {
    await fs.rm(root,{recursive:true,force:true});
  }
});

test('opening the same experience context twice is durable-idempotent under deterministic episode identity',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-rsi-context-duplicate-'));
  const ledgerPath=path.join(root,'rsi.jsonl');
  try {
    const runtime=new RsiRuntimeService({source_sha:SOURCE,ledgerPath});
    await runtime.start();
    await runtime.observeBrainSnapshot(ambiguousBrain());
    const [entry]=runtime.improvementFrontier({limit:32});
    const first=await runtime.openLearningEpisodeFromOpportunity({opportunity_id:entry.opportunity_id});
    const second=await runtime.openLearningEpisodeFromOpportunity({opportunity_id:entry.opportunity_id});
    assert.equal(first.already_open,false);
    assert.equal(second.already_open,true);
    assert.equal(second.episode.episode_id,first.episode.episode_id);
    assert.equal(second.context_plan.context_plan_digest,first.context_plan.context_plan_digest);
    assert.equal(runtime.snapshot().episodes.episode_count,1);
    assert.equal(runtime.snapshot().experience_context.planned_count,1);
  } finally {
    await fs.rm(root,{recursive:true,force:true});
  }
});


test('runtime reuses the existing autonomous controller for experience-guided cycles and replays only durable evidence',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-rsi-experience-guided-cycle-'));
  const ledgerPath=path.join(root,'rsi.jsonl');
  try {
    const runtime=new RsiRuntimeService({source_sha:SOURCE,ledgerPath});
    await runtime.start();
    const observation=await runtime.observeBrainSnapshot(ambiguousBrain());
    const [entry]=runtime.improvementFrontier({limit:32});
    const searchContext=createRsiSearchContext({
      context_id:'rsi-context-runtime-experience-guided',
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

    const first=await runtime.prepareExperienceGuidedAutonomousEpisodeCycle({
      observation,
      opportunity_id:entry.opportunity_id,
      search_context:searchContext,
      cycle_generation:1,
      max_candidates:4,
      proposal_budget_units:100,
      exploration_fraction:0.2,
    });
    assert.equal(first.existing_autonomous_controller_reused,true);
    assert.equal(first.second_scheduler_created,false);
    assert.equal(first.second_frontier_created,false);
    assert.equal(first.retrieval_is_advisory_only,true);
    assert.equal(first.experience_context_plan.mode,'NO_VERIFIED_EXPERIENCE');
    assert.equal(first.autonomous_cycle.controller_plan.experience_context_digest,
      first.experience_context_plan.context_plan_digest.slice(7));
    assert.equal(first.autonomous_cycle.request_count,2);
    assert.equal(first.autonomous_cycle.scheduler_action_authorized,false);
    assert.equal(first.authority_effect,false);

    const second=await runtime.prepareExperienceGuidedAutonomousEpisodeCycle({
      observation,
      opportunity_id:entry.opportunity_id,
      search_context:searchContext,
      cycle_generation:1,
      max_candidates:4,
      proposal_budget_units:100,
      exploration_fraction:0.2,
    });
    assert.equal(second.cycle_digest,first.cycle_digest);
    assert.equal(second.already_recorded,true);
    assert.equal(second.autonomous_cycle.episode.episode_id,first.autonomous_cycle.episode.episode_id);
    assert.equal(runtime.snapshot().experience_guided_autonomous_cycle.count,1);

    const replay=new RsiRuntimeService({source_sha:SOURCE,ledgerPath});
    await replay.start();
    const snapshot=replay.snapshot();
    assert.equal(snapshot.experience_guided_autonomous_cycle.count,1);
    assert.equal(snapshot.experience_guided_autonomous_cycle.last_digest,first.cycle_digest);
    assert.equal(snapshot.experience_guided_autonomous_cycle.existing_autonomous_controller_reused,true);
    assert.equal(snapshot.experience_guided_autonomous_cycle.second_scheduler_created,false);
    assert.equal(snapshot.experience_guided_autonomous_cycle.second_frontier_created,false);
  } finally {
    await fs.rm(root,{recursive:true,force:true});
  }
});
