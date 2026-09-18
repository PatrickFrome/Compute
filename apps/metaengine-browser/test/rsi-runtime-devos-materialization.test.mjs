import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { RsiRuntimeService } from '../src/rsi-runtime-service.mjs';
import { BROWSER_BRAIN_WORKING_MEMORY_SCHEMA } from '../src/browser-brain-working-memory.mjs';

const SOURCE='a'.repeat(40);
const TARGET='apps/metaengine-browser/src/browser-brain-working-memory.mjs';
const COORD='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TASK='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PHYSICAL_WORKSPACE='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const d=(c)=>`sha256:${c.repeat(64)}`;

function ambiguousBrain(){
  return {
    schema:BROWSER_BRAIN_WORKING_MEMORY_SCHEMA,
    global:{process_revision:9,cognitive_sequence:12,dropped_events:0},
    cells:[{
      tab_id:'tab_00000000-0000-4000-8000-000000000123',
      status:'READY',
      binding:null,
      last_event:null,
      last_command:{status:'AMBIGUOUS',effect_outcome:'AMBIGUOUS'},
      last_semantic_sequence:null,
      last_observed_at:'2026-09-18T18:10:00.000Z',
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
    proposal_id:'proposal:runtime-devos-handoff:1',
    mutations:[{path:TARGET,change:'MODIFY'}],
    proposal_evidence_digest:d('1'),
    producer_receipt_digest:d('2'),
    proposer_class:'EXTERNAL_DEVOS_PLANNER',
    external_proposer_verified:true,
    authored_by_candidate:false,
  };
}

function schedulerReadback(handoff){
  const task={
    task_id:TASK,
    workspace_id:COORD,
    idempotency_key:handoff.idempotency_key,
    point_id:handoff.point_id,
    role:'IMPLEMENTER',
    claim_class:'MUTATING',
    base_sha:SOURCE,
    branch_name:handoff.target_branch,
    priority:50,
    task_spec:handoff.devos_enqueue_proposal.args.p_spec,
    task_spec_sha256:'e'.repeat(64),
    state:'LEASED',
    lease_generation:3,
    lease_agent_id:'agent_12345678',
    lease_tab_id:'tab_12345678',
    lease_target_id:'webcontents:12',
    lease_agent_generation_epoch:4,
    authority_effect:false,
  };
  const claim={
    claim_id:7,
    task_id:TASK,
    workspace_id:COORD,
    point_id:handoff.point_id,
    base_sha:SOURCE,
    branch_name:handoff.target_branch,
    role:'IMPLEMENTER',
    claim_class:'MUTATING',
    agent_id:'agent_12345678',
    tab_id:'tab_12345678',
    target_id:'webcontents:12',
    agent_generation_epoch:4,
    lease_generation:3,
    state:'ACTIVE',
    expires_at:'2026-09-18T18:30:00.000Z',
    authority_effect:false,
  };
  const binding={
    schema:'metaengine.devos.workspace-binding.v1',
    state:'READY',
    workspace_id:PHYSICAL_WORKSPACE,
    workspace_generation:1,
    coordination_workspace_id:COORD,
    task_id:TASK,
    claim_id:7,
    point_id:handoff.point_id,
    claim_class:'MUTATING',
    base_sha:SOURCE,
    branch_name:handoff.target_branch,
    agent_id:'agent_12345678',
    tab_id:'tab_12345678',
    target_id:'webcontents:12',
    agent_generation_epoch:4,
    lease_generation:3,
    lease_expires_at:'2026-09-18T18:30:00.000Z',
    initial_head_sha:SOURCE,
    last_verified_head_sha:SOURCE,
    ambiguity_code:null,
    dirty_hold:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return {task,claim,binding};
}

test('runtime persists synthesis -> DevOS handoff -> exact workspace admission and replays the chain after restart',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-rsi-devos-runtime-'));
  const ledgerPath=path.join(root,'rsi.jsonl');
  try{
    const first=new RsiRuntimeService({source_sha:SOURCE,ledgerPath});
    await first.start();
    await first.observeBrainSnapshot(ambiguousBrain());
    const [frontier]=first.improvementFrontier({limit:32});
    assert.ok(frontier);

    const opened=await first.openLearningEpisodeFromOpportunity({
      opportunity_id:frontier.opportunity_id,
    });
    const episodeId=opened.episode.episode_id;

    const planned=await first.planContextAwareCandidateBuild({
      episode_id:episodeId,
      source_snapshot:sourceSnapshot(),
      proposal:proposal(),
      requested_backend:'VERCEL_SANDBOX',
    });
    assert.equal(planned.context_candidate_build.candidate_materialized,false);

    const handoff=await first.prepareDevosMaterializationHandoff({
      episode_id:episodeId,
      coordination_workspace_id:COORD,
      priority:50,
    });
    assert.equal(handoff.devos_enqueue_proposal.rpc,'devos_fleet_enqueue_v1');
    assert.equal(first.snapshot().devos_materialization.handoff_count,1);
    assert.equal(first.snapshot().devos_materialization.scheduler_rpc_invoked_by_rsi,false);

    const {task,claim,binding}=schedulerReadback(handoff);
    const admission=await first.admitDevosMaterializationReadback({
      handoff_digest:handoff.handoff_digest,
      task,
      claim,
      binding,
    });
    assert.equal(admission.exact_incarnation_verified,true);
    assert.equal(admission.repository_mutation_performed,false);
    assert.equal(admission.candidate_materialized,false);
    assert.equal(first.snapshot().devos_materialization.admission_count,1);

    const second=new RsiRuntimeService({source_sha:SOURCE,ledgerPath});
    await second.start();
    assert.equal(second.snapshot().candidate_synthesis.planned_build_count,1);
    assert.equal(second.snapshot().devos_materialization.handoff_count,1);
    assert.equal(second.snapshot().devos_materialization.admission_count,1);
    assert.equal(second.snapshot().devos_materialization.last_handoff_digest,handoff.handoff_digest);
    assert.equal(second.snapshot().devos_materialization.last_admission_digest,admission.admission_digest);
    assert.equal(second.snapshot().devos_materialization.repository_mutation_performed_by_rsi,false);
    assert.equal(second.snapshot().execution_authority,false);
  }finally{
    await fs.rm(root,{recursive:true,force:true});
  }
});

test('runtime refuses workspace admission for an unpersisted handoff digest',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-rsi-devos-missing-'));
  try{
    const runtime=new RsiRuntimeService({source_sha:SOURCE,ledgerPath:path.join(root,'rsi.jsonl')});
    await runtime.start();
    await assert.rejects(
      runtime.admitDevosMaterializationReadback({
        handoff_digest:d('f'),
        task:{},
        claim:{},
        binding:{},
      }),
      /materialization_handoff_not_persisted/,
    );
  }finally{
    await fs.rm(root,{recursive:true,force:true});
  }
});
