import crypto from 'node:crypto';

import {
  verifyRsiCandidateSynthesisRequest,
  verifyRsiCandidateMutationProposal,
  verifyRsiContextAwareCandidateBuild,
} from './rsi-context-aware-candidate-synthesis.mjs';
import { assertMetaWorkspaceMutationAdmission } from './meta-orchestrator-workspace-admission.mjs';

export const RSI_DEVOS_MATERIALIZATION_HANDOFF_SCHEMA = 'metaengine.rsi.devos-materialization-handoff.v1';
export const RSI_DEVOS_MATERIALIZATION_ADMISSION_SCHEMA = 'metaengine.rsi.devos-materialization-admission.v1';
export const RSI_DEVOS_MATERIALIZATION_ROOT_SCHEMA = 'metaengine.rsi.devos-materialization-root.v1';

const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const HEX64_RE=/^[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const MAX_TASK_SPEC_BYTES=32*1024;

function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));
}
function digest(value){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)),'utf8').digest('hex')}`}
function bytes(value){return Buffer.byteLength(JSON.stringify(stable(value)),'utf8')}
function zeroAuthority(extra={}){return Object.freeze({...extra,execution_authority:false,browser_authority:false,scheduler_authority:false,task_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,automatic_retry_allowed:false,authority_effect:false})}
function assertZeroAuthority(value,label){
  for(const key of ['execution_authority','browser_authority','scheduler_authority','task_authority','production_mutation_authority','promotion_authority','self_update_authority','authority_effect']){
    if(Object.hasOwn(value||{},key)&&value[key]!==false)throw new Error(`rsi_devos_handoff_${label}_${key}_invalid`);
  }
  if(Object.hasOwn(value||{},'automatic_retry_allowed')&&value.automatic_retry_allowed!==false)throw new Error(`rsi_devos_handoff_${label}_retry_invalid`);
}
function uuid(value,label){const out=String(value||'').trim().toLowerCase();if(!UUID_RE.test(out))throw new Error(`rsi_devos_handoff_${label}_invalid`);return out}
function sha(value,label){const out=String(value||'').trim().toLowerCase();if(!SHA40_RE.test(out))throw new Error(`rsi_devos_handoff_${label}_sha_invalid`);return out}
function exactDigest(value,label){const out=String(value||'').trim().toLowerCase();if(!SHA256_RE.test(out))throw new Error(`rsi_devos_handoff_${label}_digest_invalid`);return out}
function safeId(value,label,max=255){const out=String(value||'').trim();if(!SAFE_ID_RE.test(out)||out.length>max)throw new Error(`rsi_devos_handoff_${label}_invalid`);return out}
function integer(value,label,min=1,max=1_000_000){const out=Number(value);if(!Number.isSafeInteger(out)||out<min||out>max)throw new Error(`rsi_devos_handoff_${label}_invalid`);return out}

function exactTaskSpecEqual(left,right){
  return JSON.stringify(stable(left))===JSON.stringify(stable(right));
}

function buildTaskSpec({episodeId,request,proposal,build}){
  const mutationManifest=build.exact_mutation_set.map(row=>Object.freeze({
    path:String(row.path),
    change:String(row.change).toUpperCase(),
  }));
  const spec=zeroAuthority({
    schema:'metaengine.rsi.devos-candidate-materialization-task-spec.v1',
    objective:`Materialize and verify one isolated RSI candidate for ${request.signal} on ${request.mutation_surface}; preserve the precommitted hypothesis, exact source identity and zero-authority RSI boundaries.`,
    constraints:Object.freeze([
      `exact_base_sha=${request.source_sha}`,
      `context_plan_digest=${request.context_plan_digest}`,
      `synthesis_request_digest=${request.synthesis_request_digest}`,
      `mutation_proposal_digest=${proposal.mutation_proposal_digest}`,
      `context_aware_build_digest=${build.context_aware_build_digest}`,
      'existing_devos_scheduler_only',
      'existing_devos_workspace_binding_only',
      'db_lease_required_before_any_repository_mutation',
      'exact_workspace_incarnation_readback_required',
      'no_main_or_production_promotion',
      'no_second_scheduler',
      'no_arbitrary_shell_or_eval',
      'no_raw_browser_or_page_authority',
      'no_blind_retry_after_ambiguous_effect',
      'candidate_cannot_modify_rsi_trust_roots',
    ]),
    deliverable:'Return an exact candidate SHA plus typed materialization/workspace/test evidence. Do not promote, install, self-update, or mutate production.',
    source_branch:'',
    target_branch:build.generic_build_plan.target_branch,
    required_capabilities:Object.freeze(['repo_read','repo_write','test']),
    rsi:Object.freeze({
      episode_id:episodeId,
      source_sha:request.source_sha,
      opportunity_id:request.opportunity_id,
      signal:request.signal,
      mutation_surface:request.mutation_surface,
      hypothesis_digest:request.hypothesis_digest,
      acceptance_contract_digest:request.acceptance_contract_digest,
      context_plan_digest:request.context_plan_digest,
      synthesis_request_digest:request.synthesis_request_digest,
      mutation_proposal_digest:proposal.mutation_proposal_digest,
      context_aware_build_digest:build.context_aware_build_digest,
      generic_build_plan_digest:build.generic_build_plan_digest,
      source_snapshot_digest:build.source_snapshot_digest,
      mutation_manifest:Object.freeze(mutationManifest),
      candidate_materialized:false,
      lease_created:false,
      workspace_created:false,
      execution_authority:false,
      production_mutation_authority:false,
      promotion_authority:false,
      self_update_authority:false,
      automatic_retry_allowed:false,
      authority_effect:false,
    }),
  });
  if(bytes(spec)>MAX_TASK_SPEC_BYTES)throw new Error('rsi_devos_handoff_task_spec_budget_exceeded');
  return spec;
}

export function createRsiDevosMaterializationHandoff({
  coordination_workspace_id,
  episode_id,
  synthesis_request,
  mutation_proposal,
  context_candidate_build,
  priority=50,
}={}){
  const workspace=uuid(coordination_workspace_id,'coordination_workspace_id');
  const episodeId=safeId(episode_id,'episode_id');
  const request=verifyRsiCandidateSynthesisRequest(synthesis_request);
  const proposal=verifyRsiCandidateMutationProposal(mutation_proposal,request);
  const build=verifyRsiContextAwareCandidateBuild(context_candidate_build,{
    synthesis_request:request,
    mutation_proposal:proposal,
  });
  if(build.source_sha!==request.source_sha)throw new Error('rsi_devos_handoff_source_binding_mismatch');
  if(build.context_plan_digest!==request.context_plan_digest)throw new Error('rsi_devos_handoff_context_binding_mismatch');
  const taskSpec=buildTaskSpec({episodeId,request,proposal,build});
  const point=`rsi.materialize.${build.context_aware_build_digest.slice(7,31)}`;
  const key=`rsi:materialize:${request.source_sha}:${build.context_aware_build_digest.slice(7,31)}`;
  const enqueueProposal=Object.freeze({
    schema:'metaengine.meta-orchestrator.devos-enqueue-proposal.v1',
    rpc:'devos_fleet_enqueue_v1',
    args:Object.freeze({
      p_workspace:workspace,
      p_point:point,
      p_role:'IMPLEMENTER',
      p_base:request.source_sha,
      p_spec:taskSpec,
      p_key:key,
      p_branch:build.generic_build_plan.target_branch,
      p_priority:integer(priority,'priority',-100000,100000),
    }),
    scheduler_admission_required:true,
    automatic_retry_allowed:false,
    task_content_authority:false,
    scheduler_authority:false,
    browser_authority:false,
    release_authority:false,
    authority_effect:false,
  });
  const core=zeroAuthority({
    schema:RSI_DEVOS_MATERIALIZATION_HANDOFF_SCHEMA,
    version:1,
    coordination_workspace_id:workspace,
    episode_id:episodeId,
    source_sha:request.source_sha,
    context_plan_digest:request.context_plan_digest,
    synthesis_request_digest:request.synthesis_request_digest,
    mutation_proposal_digest:proposal.mutation_proposal_digest,
    context_aware_build_digest:build.context_aware_build_digest,
    generic_build_plan_digest:build.generic_build_plan_digest,
    source_snapshot_digest:build.source_snapshot_digest,
    target_branch:build.generic_build_plan.target_branch,
    point_id:point,
    idempotency_key:key,
    task_spec_digest:digest(taskSpec),
    task_spec_bytes:bytes(taskSpec),
    max_task_spec_bytes:MAX_TASK_SPEC_BYTES,
    devos_enqueue_proposal:enqueueProposal,
    scheduler_selection_deferred:true,
    lease_creation_deferred:true,
    workspace_creation_deferred:true,
    repository_mutation_deferred:true,
    materialization_deferred:true,
    existing_devos_scheduler_required:true,
    existing_workspace_manager_required:true,
    db_lease_is_execution_authority:true,
    handoff_is_execution_authority:false,
  });
  return Object.freeze({...core,handoff_digest:digest(core)});
}

export function verifyRsiDevosMaterializationHandoff(handoff){
  if(!handoff||typeof handoff!=='object'||Array.isArray(handoff)||handoff.schema!==RSI_DEVOS_MATERIALIZATION_HANDOFF_SCHEMA||handoff.version!==1)throw new Error('rsi_devos_handoff_invalid');
  assertZeroAuthority(handoff,'handoff');
  if(
    handoff.scheduler_selection_deferred!==true
    || handoff.lease_creation_deferred!==true
    || handoff.workspace_creation_deferred!==true
    || handoff.repository_mutation_deferred!==true
    || handoff.materialization_deferred!==true
    || handoff.existing_devos_scheduler_required!==true
    || handoff.existing_workspace_manager_required!==true
    || handoff.db_lease_is_execution_authority!==true
    || handoff.handoff_is_execution_authority!==false
  )throw new Error('rsi_devos_handoff_policy_invalid');
  uuid(handoff.coordination_workspace_id,'coordination_workspace_id');
  sha(handoff.source_sha,'source');
  for(const [value,label] of [
    [handoff.context_plan_digest,'context'],
    [handoff.synthesis_request_digest,'synthesis'],
    [handoff.mutation_proposal_digest,'mutation_proposal'],
    [handoff.context_aware_build_digest,'build'],
    [handoff.generic_build_plan_digest,'generic_build'],
    [handoff.source_snapshot_digest,'source_snapshot'],
    [handoff.task_spec_digest,'task_spec'],
  ]) exactDigest(value,label);
  const proposal=handoff.devos_enqueue_proposal;
  if(
    proposal?.schema!=='metaengine.meta-orchestrator.devos-enqueue-proposal.v1'
    || proposal.rpc!=='devos_fleet_enqueue_v1'
    || proposal.scheduler_admission_required!==true
    || proposal.scheduler_authority!==false
    || proposal.browser_authority!==false
    || proposal.authority_effect!==false
  )throw new Error('rsi_devos_handoff_enqueue_proposal_invalid');
  if(
    proposal.args?.p_workspace!==handoff.coordination_workspace_id
    || proposal.args?.p_point!==handoff.point_id
    || proposal.args?.p_role!=='IMPLEMENTER'
    || proposal.args?.p_base!==handoff.source_sha
    || proposal.args?.p_branch!==handoff.target_branch
    || proposal.args?.p_key!==handoff.idempotency_key
  )throw new Error('rsi_devos_handoff_enqueue_binding_mismatch');
  if(digest(proposal.args.p_spec)!==handoff.task_spec_digest)throw new Error('rsi_devos_handoff_task_spec_digest_mismatch');
  if(bytes(proposal.args.p_spec)!==Number(handoff.task_spec_bytes)||Number(handoff.task_spec_bytes)>Number(handoff.max_task_spec_bytes))throw new Error('rsi_devos_handoff_task_spec_size_mismatch');
  const material={...structuredClone(handoff)};delete material.handoff_digest;
  if(digest(material)!==exactDigest(handoff.handoff_digest,'handoff'))throw new Error('rsi_devos_handoff_digest_mismatch');
  return handoff;
}

export function admitRsiDevosMaterialization({handoff,task,claim,binding}={}){
  const checked=verifyRsiDevosMaterializationHandoff(handoff);
  if(!task||typeof task!=='object'||Array.isArray(task))throw new Error('rsi_devos_handoff_task_invalid');
  if(!claim||typeof claim!=='object'||Array.isArray(claim))throw new Error('rsi_devos_handoff_claim_invalid');
  if(!binding||typeof binding!=='object'||Array.isArray(binding))throw new Error('rsi_devos_handoff_binding_invalid');
  if(String(task.claim_class||'').toUpperCase()!=='MUTATING'||String(task.role||'').toUpperCase()!=='IMPLEMENTER')throw new Error('rsi_devos_handoff_task_class_invalid');
  if(!exactTaskSpecEqual(task.task_spec,checked.devos_enqueue_proposal.args.p_spec))throw new Error('rsi_devos_handoff_task_spec_readback_mismatch');
  if(task.task_spec_sha256!=null&&!HEX64_RE.test(String(task.task_spec_sha256).toLowerCase()))throw new Error('rsi_devos_handoff_task_spec_sha_invalid');
  if(String(claim.state||'').toUpperCase()!=='ACTIVE')throw new Error('rsi_devos_handoff_claim_not_active');
  if(claim.authority_effect!==false)throw new Error('rsi_devos_handoff_claim_authority_invalid');

  const workspaceAdmission=assertMetaWorkspaceMutationAdmission({
    enqueue_proposal:checked.devos_enqueue_proposal,
    task,
    claim,
    binding,
  });
  const core=zeroAuthority({
    schema:RSI_DEVOS_MATERIALIZATION_ADMISSION_SCHEMA,
    version:1,
    handoff_digest:checked.handoff_digest,
    task_id:workspaceAdmission.task_id,
    coordination_workspace_id:workspaceAdmission.coordination_workspace_id,
    workspace_id:workspaceAdmission.workspace_id,
    binding_id:workspaceAdmission.binding_id,
    source_sha:checked.source_sha,
    base_sha:workspaceAdmission.base_sha,
    branch_name:workspaceAdmission.branch_name,
    workspace_generation:workspaceAdmission.workspace_generation,
    lease_generation:workspaceAdmission.lease_generation,
    agent_generation_epoch:workspaceAdmission.agent_generation_epoch,
    context_aware_build_digest:checked.context_aware_build_digest,
    generic_build_plan_digest:checked.generic_build_plan_digest,
    source_snapshot_digest:checked.source_snapshot_digest,
    exact_incarnation_verified:true,
    scheduler_selection_verified_not_created:true,
    current_active_claim_verified:true,
    workspace_ready_verified:true,
    mutation_executor_still_must_revalidate_lease:true,
    repository_mutation_performed:false,
    candidate_materialized:false,
    admission_is_execution_authority:false,
    db_lease_is_execution_authority:true,
    automatic_retry_allowed:false,
  });
  return Object.freeze({...core,admission_digest:digest(core)});
}

export function rsiDevosMaterializationTrustRootSnapshot(){
  const root=zeroAuthority({
    schema:RSI_DEVOS_MATERIALIZATION_ROOT_SCHEMA,
    version:1,
    policy_path:'apps/metaengine-browser/src/rsi-devos-materialization-handoff.mjs',
    existing_devos_enqueue_rpc_required:'devos_fleet_enqueue_v1',
    existing_workspace_admission_gate_reused:true,
    implementer_role_required:true,
    mutating_claim_required:true,
    active_claim_required:true,
    ready_workspace_binding_required:true,
    exact_source_branch_task_claim_workspace_binding_required:true,
    scheduler_selection_created_by_rsi:false,
    lease_created_by_rsi:false,
    workspace_created_by_rsi:false,
    repository_mutation_performed_by_handoff:false,
    candidate_materialized_by_handoff:false,
    db_lease_is_execution_authority:true,
    mutation_executor_must_revalidate_lease:true,
    no_second_scheduler:true,
    max_task_spec_bytes:MAX_TASK_SPEC_BYTES,
  });
  return Object.freeze({...root,materialization_root_digest:digest(root)});
}
