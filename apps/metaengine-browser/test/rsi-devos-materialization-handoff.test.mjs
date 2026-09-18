import assert from 'node:assert/strict';
import test from 'node:test';

import { BROWSER_BRAIN_WORKING_MEMORY_SCHEMA } from '../src/browser-brain-working-memory.mjs';
import { RsiShadowObserver } from '../src/rsi-shadow-observer.mjs';
import { RsiRuntimeImprovementFrontier } from '../src/rsi-runtime-improvement-frontier.mjs';
import { createRsiExperienceContextPlan } from '../src/rsi-experience-context-planner.mjs';
import {
  createRsiCandidateSynthesisRequest,
  createRsiCandidateMutationProposal,
  prepareRsiContextAwareCandidateBuild,
} from '../src/rsi-context-aware-candidate-synthesis.mjs';
import {
  createRsiDevosMaterializationHandoff,
  verifyRsiDevosMaterializationHandoff,
  admitRsiDevosMaterialization,
  rsiDevosMaterializationTrustRootSnapshot,
} from '../src/rsi-devos-materialization-handoff.mjs';

const SOURCE='a'.repeat(40);
const TARGET='apps/metaengine-browser/src/browser-brain-working-memory.mjs';
const COORD='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TASK='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PHYSICAL_WORKSPACE='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const d=(c)=>`sha256:${c.repeat(64)}`;

function brain(){
  return {
    schema:BROWSER_BRAIN_WORKING_MEMORY_SCHEMA,
    global:{process_revision:2,cognitive_sequence:3,dropped_events:0},
    cells:[{
      tab_id:'tab_00000000-0000-4000-8000-000000000123',
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

function fixture(){
  const observer=new RsiShadowObserver({source_sha:SOURCE,clock:()=>Date.parse('2026-09-18T18:00:00Z')});
  const observation=observer.observeBrainSnapshot(brain());
  const frontier=new RsiRuntimeImprovementFrontier();
  const [entry]=frontier.prepare(observation);
  const context=createRsiExperienceContextPlan({frontier_entry:entry});
  const request=createRsiCandidateSynthesisRequest({context_plan:context,frontier_entry:entry});
  const proposal=createRsiCandidateMutationProposal({
    synthesis_request:request,
    proposal:{
      proposal_id:'proposal:devos-handoff:1',
      mutations:[{path:TARGET,change:'MODIFY'}],
      proposal_evidence_digest:d('1'),
      producer_receipt_digest:d('2'),
      proposer_class:'EXTERNAL_DEVOS_PLANNER',
      external_proposer_verified:true,
      authored_by_candidate:false,
    },
  });
  const sourceSnapshot={
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
  const build=prepareRsiContextAwareCandidateBuild({
    synthesis_request:request,
    frontier_entry:entry,
    source_snapshot:sourceSnapshot,
    mutation_proposal:proposal,
    requested_backend:'VERCEL_SANDBOX',
  });
  const handoff=createRsiDevosMaterializationHandoff({
    coordination_workspace_id:COORD,
    episode_id:'episode:rsi:111111111111111111111111',
    synthesis_request:request,
    mutation_proposal:proposal,
    context_candidate_build:build,
    priority:70,
  });
  return {entry,context,request,proposal,build,handoff};
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
    priority:70,
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
    repo_id:'PatrickFrome/Compute',
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

test('RSI handoff targets only the existing DevOS enqueue RPC and defers all scheduler identity',()=>{
  const {handoff}=fixture();
  verifyRsiDevosMaterializationHandoff(handoff);
  assert.equal(handoff.devos_enqueue_proposal.rpc,'devos_fleet_enqueue_v1');
  assert.equal(handoff.devos_enqueue_proposal.args.p_role,'IMPLEMENTER');
  assert.equal(handoff.devos_enqueue_proposal.args.p_base,SOURCE);
  assert.equal(handoff.devos_enqueue_proposal.args.p_branch,handoff.target_branch);
  assert.equal(handoff.scheduler_selection_deferred,true);
  assert.equal(handoff.lease_creation_deferred,true);
  assert.equal(handoff.workspace_creation_deferred,true);
  assert.equal(handoff.repository_mutation_deferred,true);
  assert.equal(handoff.materialization_deferred,true);
  assert.equal(handoff.handoff_is_execution_authority,false);
  assert.ok(handoff.task_spec_bytes<handoff.max_task_spec_bytes);

  const serialized=JSON.stringify(handoff.devos_enqueue_proposal.args.p_spec);
  assert.doesNotMatch(serialized,/"agent_id"|"tab_id"|"target_id"|"lease_generation"|"claim_id"/);
});

test('exact task claim and READY workspace readback admit the existing DevOS incarnation without creating authority',()=>{
  const {handoff}=fixture();
  const {task,claim,binding}=schedulerReadback(handoff);
  const admission=admitRsiDevosMaterialization({handoff,task,claim,binding});
  assert.equal(admission.task_id,TASK);
  assert.equal(admission.workspace_id,PHYSICAL_WORKSPACE);
  assert.equal(admission.source_sha,SOURCE);
  assert.equal(admission.lease_generation,3);
  assert.equal(admission.agent_generation_epoch,4);
  assert.equal(admission.exact_incarnation_verified,true);
  assert.equal(admission.scheduler_selection_verified_not_created,true);
  assert.equal(admission.current_active_claim_verified,true);
  assert.equal(admission.workspace_ready_verified,true);
  assert.equal(admission.mutation_executor_still_must_revalidate_lease,true);
  assert.equal(admission.repository_mutation_performed,false);
  assert.equal(admission.candidate_materialized,false);
  assert.equal(admission.admission_is_execution_authority,false);
  assert.equal(admission.execution_authority,false);
});

test('stale lease or workspace incarnation fails before materialization admission',()=>{
  const {handoff}=fixture();
  const {task,claim,binding}=schedulerReadback(handoff);
  assert.throws(()=>admitRsiDevosMaterialization({
    handoff,
    task,
    claim:{...claim,lease_generation:2},
    binding,
  }),/lease_generation_mismatch|binding_lease_generation_mismatch/);
  assert.throws(()=>admitRsiDevosMaterialization({
    handoff,
    task,
    claim,
    binding:{...binding,base_sha:'f'.repeat(40)},
  }),/binding_base_mismatch/);
  assert.throws(()=>admitRsiDevosMaterialization({
    handoff,
    task,
    claim:{...claim,state:'EXPIRED'},
    binding,
  }),/claim_not_active/);
});

test('task-spec drift fails closed even when task identity is otherwise correct',()=>{
  const {handoff}=fixture();
  const {task,claim,binding}=schedulerReadback(handoff);
  const drifted={...task,task_spec:{...task.task_spec,objective:'tampered objective'}};
  assert.throws(()=>admitRsiDevosMaterialization({handoff,task:drifted,claim,binding}),/task_spec_readback_mismatch/);
});

test('materialization handoff trust root cannot become a scheduler or executor',()=>{
  const root=rsiDevosMaterializationTrustRootSnapshot();
  assert.equal(root.existing_devos_enqueue_rpc_required,'devos_fleet_enqueue_v1');
  assert.equal(root.existing_workspace_admission_gate_reused,true);
  assert.equal(root.scheduler_selection_created_by_rsi,false);
  assert.equal(root.lease_created_by_rsi,false);
  assert.equal(root.workspace_created_by_rsi,false);
  assert.equal(root.repository_mutation_performed_by_handoff,false);
  assert.equal(root.candidate_materialized_by_handoff,false);
  assert.equal(root.db_lease_is_execution_authority,true);
  assert.equal(root.no_second_scheduler,true);
  assert.equal(root.execution_authority,false);
  assert.equal(root.promotion_authority,false);
  assert.equal(root.self_update_authority,false);
});
