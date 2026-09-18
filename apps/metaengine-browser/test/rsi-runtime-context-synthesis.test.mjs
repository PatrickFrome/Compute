
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { RsiRuntimeService } from '../src/rsi-runtime-service.mjs';
import { BROWSER_BRAIN_WORKING_MEMORY_SCHEMA } from '../src/browser-brain-working-memory.mjs';

const SOURCE='a'.repeat(40);
const TARGET='apps/metaengine-browser/src/browser-brain-working-memory.mjs';
const d=(c)=>`sha256:${c.repeat(64)}`;

function brain(){
  return {
    schema:BROWSER_BRAIN_WORKING_MEMORY_SCHEMA,
    global:{process_revision:2,cognitive_sequence:3,dropped_events:0},
    cells:[{
      tab_id:'tab_00000000-0000-4000-8000-000000000456',
      status:'READY',
      binding:null,
      last_event:null,
      last_command:{status:'AMBIGUOUS',effect_outcome:'AMBIGUOUS'},
      last_semantic_sequence:null,
      last_observed_at:'2026-09-18T18:00:00.000Z',
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

function sourceSnapshot(){
  return {
    schema:'metaengine.devos.packaged-source-snapshot.v1',
    repository:'PatrickFrome/Compute',
    head:SOURCE,
    ref:SOURCE,
    bounded:true,
    arbitrary_path_copy:false,
    process_spawn_used:false,
    authority_effect:false,
    source_files:[TARGET],
    source_file_count:1,
  };
}

function proposal(){
  return {
    proposal_id:'proposal:runtime-context-synthesis:1',
    mutations:[{path:TARGET,change:'MODIFY'}],
    proposal_evidence_digest:d('1'),
    producer_receipt_digest:d('2'),
    proposer_class:'EXTERNAL_DEVOS_PLANNER',
    external_proposer_verified:true,
    authored_by_candidate:false,
  };
}

test('durable experience context produces bounded zero-authority candidate build planning and survives restart',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-rsi-context-synthesis-runtime-'));
  const ledgerPath=path.join(root,'rsi.jsonl');
  try{
    const first=new RsiRuntimeService({source_sha:SOURCE,ledgerPath});
    await first.start();
    await first.observeBrainSnapshot(brain());
    const [entry]=first.improvementFrontier({limit:32});
    assert.ok(entry);

    const opened=await first.openLearningEpisodeFromOpportunity({
      opportunity_id:entry.opportunity_id,
      max_candidates:4,
    });
    const planned=await first.planContextAwareCandidateBuild({
      episode_id:opened.episode.episode_id,
      source_snapshot:sourceSnapshot(),
      proposal:proposal(),
      generation:1,
      sequence:1,
    });

    assert.equal(planned.synthesis_request.context_plan_digest,opened.context_plan.context_plan_digest);
    assert.equal(planned.synthesis_request.selected_experience_count,0);
    assert.equal(planned.mutation_proposal.external_proposer_verified,true);
    assert.deepEqual(planned.context_candidate_build.exact_mutation_set,[{path:TARGET,change:'MODIFY'}]);
    assert.equal(planned.context_candidate_build.devos_lease_required_before_materialization,true);
    assert.equal(planned.context_candidate_build.candidate_materialized,false);
    assert.equal(planned.scheduler_action_authorized,false);
    assert.equal(planned.authority_effect,false);

    const snap=first.snapshot();
    assert.equal(snap.experience_context.planned_count,1);
    assert.equal(snap.candidate_synthesis.planned_build_count,1);
    assert.equal(snap.candidate_synthesis.lease_created,false);
    assert.equal(snap.candidate_synthesis.workspace_created,false);
    assert.equal(snap.candidate_synthesis.candidate_materialized,false);
    assert.equal(snap.scheduler_authority,false);
    assert.equal(snap.execution_authority,false);

    const second=new RsiRuntimeService({source_sha:SOURCE,ledgerPath});
    await second.start();
    assert.equal(second.snapshot().experience_context.planned_count,1);
    assert.equal(second.snapshot().candidate_synthesis.planned_build_count,1);
    assert.equal(second.episodeExperienceContext(opened.episode.episode_id).context_plan_digest,opened.context_plan.context_plan_digest);
    assert.equal(second.improvementFrontier({limit:32}).length,1);
  }finally{
    await fs.rm(root,{recursive:true,force:true});
  }
});

test('context synthesis rejects proposal path outside trusted source snapshot before any DevOS effect',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-rsi-context-synthesis-fence-'));
  const ledgerPath=path.join(root,'rsi.jsonl');
  try{
    const runtime=new RsiRuntimeService({source_sha:SOURCE,ledgerPath});
    await runtime.start();
    await runtime.observeBrainSnapshot(brain());
    const [entry]=runtime.improvementFrontier({limit:32});
    const opened=await runtime.openLearningEpisodeFromOpportunity({opportunity_id:entry.opportunity_id});

    await assert.rejects(
      runtime.planContextAwareCandidateBuild({
        episode_id:opened.episode.episode_id,
        source_snapshot:{...sourceSnapshot(),source_files:['apps/metaengine-browser/src/main.mjs'],source_file_count:1},
        proposal:proposal(),
      }),
      /mutation_target_not_in_source_snapshot/,
    );
    assert.equal(runtime.snapshot().candidate_synthesis.planned_build_count,0);
    assert.equal(runtime.snapshot().candidate_synthesis.candidate_materialized,false);
  }finally{
    await fs.rm(root,{recursive:true,force:true});
  }
});
