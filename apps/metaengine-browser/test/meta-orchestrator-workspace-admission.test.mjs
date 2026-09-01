import test from 'node:test';
import assert from 'node:assert/strict';
import { compileMetaPlan, reconcileMetaOrchestrator } from '../src/meta-orchestrator-core.mjs';
import { metaTaskProposalToDevosEnqueue } from '../src/meta-orchestrator-devos-adapter.mjs';
import { assertMetaWorkspaceMutationAdmission } from '../src/meta-orchestrator-workspace-admission.mjs';
import { createWorkspaceReservation, recordWorkspaceMaterializationReadback } from '../src/workspace-manager.mjs';

const BASE='d91e94b307ed60e890aabc53a2678a8ae9c6a79d';
const COORD='2de9f84b-7c0a-4091-911c-894ff1d6eaf4';
const TASK='cc891801-2adf-4561-8f7a-8091162032ff';
const WORKSPACE='11111111-2222-4333-8444-555555555555';
const WORKTREE='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const BINDING='bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';

function fixture(){
  const plan=compileMetaPlan({authority:{roadmap_id:'compute-unified-v1',active_milestone_key:'META_ORCHESTRATOR_V1',integration_line:'work/browser-meta-orchestrator-v1',baseline_sha:BASE,alignment_epoch:9},plan_generation:4,nodes:[{point_id:'browser.meta.workspace',role:'IMPLEMENTER',objective:'Integrate workspace admission',risk:'HIGH',priority:90,base_sha:BASE,target_branch:'work/browser-meta-orchestrator-v1',required_capabilities:['capability.repo_write'],evidence_contract:{required:['ci_green'],min_verified:1}}]});
  const result=reconcileMetaOrchestrator({plan,observed_alignment_epoch:9,observed_plan_generation:4,leader:{expected_epoch:3,observed_epoch:3},tasks:[],evidence:[],capacity:{available_slots:4},policy:{max_parallel_proposals:4}});
  const action=result.actions.find(row=>row.type==='PROPOSE_TASK'&&row.role==='IMPLEMENTER');
  const enqueue=metaTaskProposalToDevosEnqueue(action,{workspace_id:COORD});
  const claim={coordination_workspace_id:COORD,workspace_id:COORD,task_id:TASK,claim_id:46,point_id:action.point_id,claim_class:'MUTATING',base_sha:BASE,branch_name:action.target_branch,agent_id:'agent_a2bf77e6-66d3-4f10-9c9c-683df36f4510',tab_id:'tab_dcfb4a80-ca6d-4614-ad5f-4877391ab12d',target_id:'webcontents:7',agent_generation_epoch:9,lease_generation:2,lease_expires_at:'2026-09-01T14:30:00Z'};
  const task={task_id:TASK,workspace_id:COORD,point_id:action.point_id,role:action.role,base_sha:BASE,branch_name:action.target_branch,idempotency_key:enqueue.args.p_key,lease_agent_id:claim.agent_id,lease_tab_id:claim.tab_id,lease_target_id:claim.target_id,lease_agent_generation_epoch:claim.agent_generation_epoch,lease_generation:claim.lease_generation};
  const reserved=createWorkspaceReservation({claim,trusted_repo:{repo_id:'github:PatrickFrome/Compute',repo_root:'/trusted/compute'},workspace_root:'/managed/workspaces',workspace_id:WORKSPACE,worktree_id:WORKTREE,workspace_generation:5});
  const ready={...recordWorkspaceMaterializationReadback(reserved,{effect_state:'PROVEN',initial_head_sha:BASE,worktree_realpath:reserved.worktree_path}),binding_id:BINDING};
  return {enqueue_proposal:enqueue,task,claim,binding:ready};
}
function mutate(path,value){const f=fixture();const [root,key]=path.split('.');f[root]={...f[root],[key]:value};return f;}

test('exact scheduler claim + READY binding admits mutation without creating authority',()=>{const proof=assertMetaWorkspaceMutationAdmission(fixture());assert.equal(proof.admitted,true);assert.equal(proof.exact_incarnation_verified,true);assert.equal(proof.scheduler_selection_verified_not_created,true);assert.equal(proof.mutation_executor_still_must_revalidate_lease,true);assert.equal(proof.authority_effect,false);assert.equal(proof.automatic_retry_allowed,false);});
test('proposal must still route through the one existing DevOS enqueue RPC',()=>{const f=fixture();f.enqueue_proposal={...f.enqueue_proposal,rpc:'another_scheduler'};assert.throws(()=>assertMetaWorkspaceMutationAdmission(f),/proposal_route_invalid/);});
test('workspace binding must be READY',()=>assert.throws(()=>assertMetaWorkspaceMutationAdmission(mutate('binding.state','FROZEN')),/binding_not_ready/));
test('binding with authority effect is rejected',()=>assert.throws(()=>assertMetaWorkspaceMutationAdmission(mutate('binding.authority_effect',true)),/binding_authority_effect_invalid/));
test('task semantic point drift is rejected',()=>assert.throws(()=>assertMetaWorkspaceMutationAdmission(mutate('task.point_id','other.point')),/task_point_mismatch/));
test('task role drift is rejected',()=>assert.throws(()=>assertMetaWorkspaceMutationAdmission(mutate('task.role','RESEARCHER')),/task_role_mismatch/));
test('task base SHA drift is rejected',()=>assert.throws(()=>assertMetaWorkspaceMutationAdmission(mutate('task.base_sha','1'.repeat(40))),/task_base_mismatch/));
test('task branch drift is rejected',()=>assert.throws(()=>assertMetaWorkspaceMutationAdmission(mutate('task.branch_name','work/other')),/task_branch_mismatch/));
test('task idempotency drift is rejected',()=>assert.throws(()=>assertMetaWorkspaceMutationAdmission(mutate('task.idempotency_key','meta:wrong')),/task_idempotency_mismatch/));
test('claim coordination workspace drift is rejected',()=>assert.throws(()=>assertMetaWorkspaceMutationAdmission(mutate('claim.workspace_id','33333333-3333-4333-8333-333333333333')),/claim_workspace_mismatch/));
test('claim task drift is rejected',()=>assert.throws(()=>assertMetaWorkspaceMutationAdmission(mutate('claim.task_id','44444444-4444-4444-8444-444444444444')),/claim_task_mismatch/));
test('claim base drift is rejected',()=>assert.throws(()=>assertMetaWorkspaceMutationAdmission(mutate('claim.base_sha','2'.repeat(40))),/claim_base_mismatch/));
test('binding coordination workspace drift is rejected',()=>assert.throws(()=>assertMetaWorkspaceMutationAdmission(mutate('binding.coordination_workspace_id','55555555-5555-4555-8555-555555555555')),/binding_coordination_workspace_mismatch/));
test('binding task drift is rejected',()=>assert.throws(()=>assertMetaWorkspaceMutationAdmission(mutate('binding.task_id','66666666-6666-4666-8666-666666666666')),/binding_task_mismatch/));
test('binding claim drift is rejected',()=>assert.throws(()=>assertMetaWorkspaceMutationAdmission(mutate('binding.claim_id',99)),/binding_claim_mismatch/));
test('binding agent drift is rejected',()=>assert.throws(()=>assertMetaWorkspaceMutationAdmission(mutate('binding.agent_id','agent_12345678-abcd')),/binding_agent_mismatch/));
test('binding tab drift is rejected',()=>assert.throws(()=>assertMetaWorkspaceMutationAdmission(mutate('binding.tab_id','tab_12345678-abcd')),/binding_tab_mismatch/));
test('binding target drift is rejected',()=>assert.throws(()=>assertMetaWorkspaceMutationAdmission(mutate('binding.target_id','webcontents:99')),/binding_target_mismatch/));
test('binding agent generation drift is rejected',()=>assert.throws(()=>assertMetaWorkspaceMutationAdmission(mutate('binding.agent_generation_epoch',10)),/binding_agent_generation_mismatch/));
test('binding lease generation drift is rejected',()=>assert.throws(()=>assertMetaWorkspaceMutationAdmission(mutate('binding.lease_generation',3)),/binding_lease_generation_mismatch/));
test('binding initial head drift is rejected',()=>assert.throws(()=>assertMetaWorkspaceMutationAdmission(mutate('binding.initial_head_sha','3'.repeat(40))),/binding_initial_head_mismatch/));
test('ambiguity code blocks mutation admission',()=>assert.throws(()=>assertMetaWorkspaceMutationAdmission(mutate('binding.ambiguity_code','LEASE_LOST_AFTER_EFFECT')),/binding_ambiguous/));
test('dirty hold blocks mutation admission',()=>assert.throws(()=>assertMetaWorkspaceMutationAdmission(mutate('binding.dirty_hold',true)),/binding_dirty_hold/));
test('retry-enabled workspace binding is impossible to admit',()=>assert.throws(()=>assertMetaWorkspaceMutationAdmission(mutate('binding.automatic_retry_allowed',true)),/binding_retry_policy_invalid/));
