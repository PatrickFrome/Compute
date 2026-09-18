import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import {
  RSI_COMMAND_PLANE_LIVENESS_INPUT_SCHEMA,
  RsiCommandPlaneLivenessObserver,
} from '../src/rsi-command-plane-liveness-observer.mjs';
import { buildRsiDevosExperimentPlan } from '../src/rsi-devos-experiment-plan.mjs';
import {
  createRsiDevosImplementationAdoption,
  RSI_FRONTIER_REVIEW_RESULT_SCHEMA,
} from '../src/rsi-devos-implementation-adoption.mjs';
import {
  prepareRsiCandidateMaterializationGate,
  verifyRsiCandidateMaterializationGate,
} from '../src/rsi-candidate-materialization-gate.mjs';
import { buildRsiExperimentHypothesis } from '../src/supervisor-rsi-experiment-hypothesis.mjs';
import { buildRsiMutationContract } from '../src/supervisor-rsi-mutation-contract.mjs';

const SOURCE='46b7b838439120f796e932a4f71edcc3915228d8';
const WORKSPACE='11111111-1111-4111-8111-111111111111';
const COORDINATION='22222222-2222-4222-8222-222222222222';
const TASK='33333333-3333-4333-8333-333333333333';
const NOW=Date.parse('2026-09-18T12:00:00.000Z');

function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));
}
function digest(value){
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)),'utf8').digest('hex')}`;
}

function reviewed(){
  const observer=new RsiCommandPlaneLivenessObserver({
    source_sha:SOURCE,clock:()=>NOW,
    heartbeat_fresh_ms:15_000,perception_fresh_ms:15_000,command_stall_ms:120_000,
  });
  const observation=observer.observe({
    schema:RSI_COMMAND_PLANE_LIVENESS_INPUT_SCHEMA,
    observed_at:'2026-09-18T12:00:00.000Z',
    heartbeat_at:'2026-09-18T11:59:55.000Z',
    perception_at:'2026-09-18T11:59:56.000Z',
    command_progress_at:'2026-09-18T06:00:00.000Z',
    pending_command_count:3,
    active_command:{
      command_id:'44444444-4444-4444-8444-444444444444',
      action:'SCROLL',command_lane:'TAB_MUTATION',status:'LEASED',
      leased_at:'2026-09-18T05:59:58.000Z',
      effect_bound_at:'2026-09-18T06:00:00.000Z',
      receipt_recorded_at:null,
    },
    command_payload_exposed:false,page_text_exposed:false,input_values_exposed:false,raw_network_exposed:false,
    execution_authority:false,production_mutation_authority:false,automatic_retry_allowed:false,authority_effect:false,
  });
  const opportunity=observation.opportunities.find(x=>x.signal==='RESULT_DELIVERY_STALL_AFTER_EFFECT_BINDING');
  assert.ok(opportunity);
  const hypothesis=buildRsiExperimentHypothesis({observation,opportunity_id:opportunity.opportunity_id});
  const experiment_plan=buildRsiDevosExperimentPlan({observation,opportunity_id:opportunity.opportunity_id,hypothesis});
  const mutation_contract=buildRsiMutationContract({hypothesis});
  const core={
    schema:RSI_FRONTIER_REVIEW_RESULT_SCHEMA,version:1,verdict:'ACCEPT',
    source_sha:SOURCE,opportunity_id:opportunity.opportunity_id,
    hypothesis_digest:hypothesis.hypothesis_digest,
    plan_digest:experiment_plan.plan_digest,
    mutation_contract_digest:mutation_contract.contract_digest,
    hypothesis,experiment_plan,mutation_contract,
    reviewed_by_external_agent:true,authored_by_candidate:false,
    candidate_materialization_performed:false,implementation_dispatched:false,
    review_is_execution_authority:false,
    execution_authority:false,production_mutation_authority:false,
    promotion_authority:false,self_update_authority:false,
    automatic_retry_allowed:false,authority_effect:false,
  };
  const review={...core,review_digest:digest(core)};
  const adoption=createRsiDevosImplementationAdoption({review_result:review});
  return {review,adoption};
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
    source_files:['apps/metaengine-browser/src/native-supervisor-client-base.mjs'],
    source_file_count:1,
  };
}

function binding(targetBranch,overrides={}){
  return {
    schema:'metaengine.devos.workspace-binding-snapshot.v1',
    state:'AVAILABLE',
    coordination_workspace_id:COORDINATION,
    observed_at:'2026-09-18T11:59:55.000Z',
    bindings:[{
      workspace_id:WORKSPACE,workspace_generation:7,coordination_workspace_id:COORDINATION,
      task_id:TASK,claim_id:71,point_id:'rsi.implement.test',repo_id:'PatrickFrome/Compute',
      base_sha:SOURCE,branch_name:targetBranch,
      agent_id:'agent_12345678',tab_id:'tab_00000000-0000-4000-8000-000000000123',
      target_id:'webcontents:7',agent_generation_epoch:28,lease_generation:4,
      lease_expires_at:'2026-09-18T12:15:00.000Z',lease_current:true,state:'READY',
      last_verified_head_sha:SOURCE,ambiguity_code:null,dirty_hold:false,
      updated_at:'2026-09-18T11:59:54.000Z',
      automatic_retry_allowed:false,scheduler_authority:false,browser_actuation_authority:false,
      page_data_authority:false,authority_effect:false,
      ...overrides,
    }],
    bounded_rows:64,filesystem_paths_exposed:false,scheduler_authority:false,
    browser_actuation_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
}

test('fresh exact leased workspace admits only the frozen targeted build plan',()=>{
  const {review,adoption}=reviewed();
  const inputs={
    review_result:review,adoption,source_snapshot:sourceSnapshot(),
    workspace_binding_snapshot:binding(adoption.target_branch),
    workspace_id:WORKSPACE,implementation_task_id:TASK,now_ms:NOW,
    requested_backend:'VERCEL_SANDBOX',
  };
  const gate=prepareRsiCandidateMaterializationGate(inputs);
  assert.equal(gate.source_sha,SOURCE);
  assert.equal(gate.workspace_preflight.current_lease_verified,true);
  assert.equal(gate.workspace_preflight.exact_head_sha_verified,true);
  assert.deepEqual(gate.exact_mutation_set,review.mutation_contract.allowed_mutations);
  assert.equal(gate.ready_for_existing_devos_materializer,true);
  assert.equal(gate.materialization_not_yet_performed,true);
  assert.equal(gate.finalization_must_reverify_workspace_binding,true);
  assert.equal(gate.browser_materialization_authority,false);
  assert.equal(gate.execution_authority,false);
  assert.equal(verifyRsiCandidateMaterializationGate(gate,inputs).gate_digest,gate.gate_digest);
});

test('stale snapshot, expired lease, wrong task and source drift fail before materialization',()=>{
  const {review,adoption}=reviewed();
  const base={
    review_result:review,adoption,source_snapshot:sourceSnapshot(),
    workspace_id:WORKSPACE,implementation_task_id:TASK,now_ms:NOW,
  };
  assert.throws(()=>prepareRsiCandidateMaterializationGate({
    ...base,workspace_binding_snapshot:{...binding(adoption.target_branch),observed_at:'2026-09-18T11:00:00.000Z'},
  }),/snapshot_stale/);
  assert.throws(()=>prepareRsiCandidateMaterializationGate({
    ...base,workspace_binding_snapshot:binding(adoption.target_branch,{lease_expires_at:'2026-09-18T11:59:59.000Z'}),
  }),/lease_expired/);
  assert.throws(()=>prepareRsiCandidateMaterializationGate({
    ...base,workspace_binding_snapshot:binding(adoption.target_branch,{task_id:'55555555-5555-4555-8555-555555555555'}),
  }),/task_mismatch/);
  assert.throws(()=>prepareRsiCandidateMaterializationGate({
    ...base,source_snapshot:{...sourceSnapshot(),head:'f'.repeat(40)},
    workspace_binding_snapshot:binding(adoption.target_branch),
  }),/source_snapshot_head_mismatch/);
});

test('ambiguous, dirty, non-current or non-ready workspace is never a materialization authority',()=>{
  const {review,adoption}=reviewed();
  const base={
    review_result:review,adoption,source_snapshot:sourceSnapshot(),
    workspace_id:WORKSPACE,implementation_task_id:TASK,now_ms:NOW,
  };
  for(const patch of [
    {ambiguity_code:'UNCERTAIN'},
    {dirty_hold:true},
    {lease_current:false},
    {state:'FROZEN'},
    {last_verified_head_sha:'f'.repeat(40)},
  ]){
    assert.throws(()=>prepareRsiCandidateMaterializationGate({
      ...base,workspace_binding_snapshot:binding(adoption.target_branch,patch),
    }),/source_fence_invalid|workspace_not_ready/);
  }
});
