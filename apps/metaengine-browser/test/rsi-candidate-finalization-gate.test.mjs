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
import { prepareRsiCandidateMaterializationGate } from '../src/rsi-candidate-materialization-gate.mjs';
import { finalizeRsiCandidateForEvaluation } from '../src/rsi-candidate-finalization-gate.mjs';
import { RSI_ISOLATED_CANDIDATE_MATERIALIZATION_SCHEMA } from '../src/rsi-isolated-candidate-builder.mjs';
import { buildRsiExperimentHypothesis } from '../src/supervisor-rsi-experiment-hypothesis.mjs';
import { buildRsiMutationContract } from '../src/supervisor-rsi-mutation-contract.mjs';

const SOURCE='46b7b838439120f796e932a4f71edcc3915228d8';
const CANDIDATE='b'.repeat(40);
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

function reviewAndAdoption(){
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
  return {review,adoption:createRsiDevosImplementationAdoption({review_result:review})};
}

function sourceSnapshot(){
  return {
    schema:'metaengine.devos.packaged-source-snapshot.v1',
    repository:'PatrickFrome/Compute',head:SOURCE,ref:SOURCE,
    bounded:true,arbitrary_path_copy:false,process_spawn_used:false,authority_effect:false,
    source_files:['apps/metaengine-browser/src/native-supervisor-client-base.mjs'],source_file_count:1,
  };
}

function binding(targetBranch,{leaseGeneration=4,updatedAt='2026-09-18T11:59:54.000Z'}={}){
  return {
    schema:'metaengine.devos.workspace-binding-snapshot.v1',
    state:'AVAILABLE',coordination_workspace_id:COORDINATION,observed_at:'2026-09-18T11:59:55.000Z',
    bindings:[{
      workspace_id:WORKSPACE,workspace_generation:7,coordination_workspace_id:COORDINATION,
      task_id:TASK,claim_id:71,point_id:'rsi.implement.test',repo_id:'PatrickFrome/Compute',
      base_sha:SOURCE,branch_name:targetBranch,agent_id:'agent_12345678',
      tab_id:'tab_00000000-0000-4000-8000-000000000123',target_id:'webcontents:7',
      agent_generation_epoch:28,lease_generation:leaseGeneration,
      lease_expires_at:'2026-09-18T12:15:00.000Z',lease_current:true,state:'READY',
      last_verified_head_sha:SOURCE,ambiguity_code:null,dirty_hold:false,updated_at:updatedAt,
      automatic_retry_allowed:false,scheduler_authority:false,browser_actuation_authority:false,
      page_data_authority:false,authority_effect:false,
    }],
    bounded_rows:64,filesystem_paths_exposed:false,scheduler_authority:false,
    browser_actuation_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
}

function prepared(){
  const {review,adoption}=reviewAndAdoption();
  const workspaceBinding=binding(adoption.target_branch);
  const inputs={
    review_result:review,adoption,source_snapshot:sourceSnapshot(),
    workspace_binding_snapshot:workspaceBinding,
    workspace_id:WORKSPACE,implementation_task_id:TASK,now_ms:NOW,
    requested_backend:'VERCEL_SANDBOX',
  };
  const gate=prepareRsiCandidateMaterializationGate(inputs);
  return {review,adoption,inputs,gate};
}

function receipt(gate,workspaceBinding){
  return {
    schema:RSI_ISOLATED_CANDIDATE_MATERIALIZATION_SCHEMA,
    plan_id:gate.targeted_build.generic_build_plan.plan_id,
    plan_digest:gate.targeted_build.generic_build_plan.plan_digest,
    experiment_id:gate.targeted_build.generic_build_plan.experiment_id,
    parent_sha:SOURCE,candidate_sha:CANDIDATE,target_branch:gate.target_branch,
    workspace:{
      workspace_id:WORKSPACE,isolated:true,host_repository_mounted:false,
      linked_git_worktree_exposed:false,source_snapshot_read_only:true,writable_layer_private:true,
      binding_snapshot:workspaceBinding,
    },
    input_manifest_digest:gate.targeted_build.generic_build_plan.source.source_snapshot_digest,
    output_manifest_digest:`sha256:${'d'.repeat(64)}`,
    components:[{
      path:'apps/metaengine-browser/src/result-delivery-transport.mjs',
      change:'CREATE',digest:`sha256:${'c'.repeat(64)}`,
    }],
    materialized_file_count:1,materialized_bytes:4096,
    execution_authority:false,production_mutation_authority:false,
    promotion_authority:false,self_update_authority:false,
    automatic_retry_allowed:false,authority_effect:false,
  };
}

test('exact materialization receipt becomes candidate handoff plus immutable evaluator plan only',()=>{
  const {inputs,gate}=prepared();
  const result=finalizeRsiCandidateForEvaluation({
    materialization_gate:gate,materialization_gate_inputs:inputs,
    materialization_receipt:receipt(gate,inputs.workspace_binding_snapshot),
    now_ms:NOW,
  });
  assert.equal(result.candidate_sha,CANDIDATE);
  assert.match(result.candidate_id,/^candidate_sha256_[0-9a-f]{64}$/);
  assert.match(result.candidate_handoff_digest,/^sha256:[0-9a-f]{64}$/);
  assert.match(result.evaluator_plan_digest,/^sha256:[0-9a-f]{64}$/);
  assert.equal(result.candidate_eligible_for_evaluation,true);
  assert.equal(result.candidate_eligible_for_promotion,false);
  assert.equal(result.archive_mutation_performed,false);
  assert.equal(result.verified_evaluator_admission_required_before_archive,true);
  assert.equal(result.materialization_replay_authorized,false);
  assert.equal(result.direct_promotion_enabled,false);
  assert.equal(result.direct_self_update_enabled,false);
  assert.equal(result.authority_effect,false);
});

test('workspace reincarnation between preflight and receipt is fenced before candidate handoff',()=>{
  const {inputs,gate}=prepared();
  const reincarnated=binding(gate.target_branch,{leaseGeneration:5});
  assert.throws(()=>finalizeRsiCandidateForEvaluation({
    materialization_gate:gate,materialization_gate_inputs:inputs,
    materialization_receipt:receipt(gate,reincarnated),now_ms:NOW,
  }),/workspace_incarnation_drift/);
});

test('materialization cannot widen files, replay parent SHA or bypass exact input snapshot',()=>{
  const {inputs,gate}=prepared();
  for(const mutate of [
    r=>{r.components.push({path:'apps/metaengine-browser/src/main.mjs',change:'MODIFY',digest:`sha256:${'e'.repeat(64)}`});r.materialized_file_count=2;},
    r=>{r.candidate_sha=SOURCE;},
    r=>{r.input_manifest_digest=`sha256:${'f'.repeat(64)}`;},
  ]){
    const row=receipt(gate,inputs.workspace_binding_snapshot);
    mutate(row);
    assert.throws(()=>finalizeRsiCandidateForEvaluation({
      materialization_gate:gate,materialization_gate_inputs:inputs,
      materialization_receipt:row,now_ms:NOW,
    }),/components_mismatch|noop|input_mismatch|immutable_path_forbidden/);
  }
});
