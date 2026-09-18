import crypto from 'node:crypto';

import {
  finalizeRsiIsolatedCandidateBuild,
  verifyRsiIsolatedCandidateBuildPlan,
} from './rsi-isolated-candidate-builder.mjs';
import {
  verifyRsiCandidateSynthesisRequest,
  verifyRsiCandidateMutationProposal,
  verifyRsiContextAwareCandidateBuild,
} from './rsi-context-aware-candidate-synthesis.mjs';
import { RSI_DEVOS_MATERIALIZATION_ADMISSION_SCHEMA } from './rsi-devos-materialization-handoff.mjs';

export const RSI_VERIFIED_CANDIDATE_MATERIALIZATION_SCHEMA = 'metaengine.rsi.verified-candidate-materialization.v1';
export const RSI_VERIFIED_CANDIDATE_MATERIALIZATION_ROOT_SCHEMA = 'metaengine.rsi.verified-candidate-materialization-root.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CANDIDATE_ID_RE=/^candidate_sha256_[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const MAX_LEDGER_BYTES=48*1024;

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
    if(Object.hasOwn(value||{},key)&&value[key]!==false)throw new Error(`rsi_verified_materialization_${label}_${key}_invalid`);
  }
  if(Object.hasOwn(value||{},'automatic_retry_allowed')&&value.automatic_retry_allowed!==false)throw new Error(`rsi_verified_materialization_${label}_retry_invalid`);
}
function exactSha(value,label){const out=String(value||'').trim().toLowerCase();if(!SHA40_RE.test(out))throw new Error(`rsi_verified_materialization_${label}_sha_invalid`);return out}
function exactDigest(value,label){const out=String(value||'').trim().toLowerCase();if(!SHA256_RE.test(out))throw new Error(`rsi_verified_materialization_${label}_digest_invalid`);return out}
function uuid(value,label){const out=String(value||'').trim().toLowerCase();if(!UUID_RE.test(out))throw new Error(`rsi_verified_materialization_${label}_invalid`);return out}
function safeId(value,label){const out=String(value||'').trim();if(!SAFE_ID_RE.test(out))throw new Error(`rsi_verified_materialization_${label}_invalid`);return out}
function positive(value,label){const out=Number(value);if(!Number.isSafeInteger(out)||out<1)throw new Error(`rsi_verified_materialization_${label}_invalid`);return out}

function verifyAdmission(admission){
  if(!admission||typeof admission!=='object'||Array.isArray(admission)||admission.schema!==RSI_DEVOS_MATERIALIZATION_ADMISSION_SCHEMA||admission.version!==1)throw new Error('rsi_verified_materialization_admission_invalid');
  assertZeroAuthority(admission,'admission');
  if(
    admission.exact_incarnation_verified!==true
    || admission.scheduler_selection_verified_not_created!==true
    || admission.current_active_claim_verified!==true
    || admission.workspace_ready_verified!==true
    || admission.mutation_executor_still_must_revalidate_lease!==true
    || admission.repository_mutation_performed!==false
    || admission.candidate_materialized!==false
    || admission.admission_is_execution_authority!==false
    || admission.db_lease_is_execution_authority!==true
  )throw new Error('rsi_verified_materialization_admission_policy_invalid');
  uuid(admission.task_id,'task_id');
  uuid(admission.coordination_workspace_id,'coordination_workspace_id');
  uuid(admission.workspace_id,'workspace_id');
  exactSha(admission.source_sha,'admission_source');
  exactSha(admission.base_sha,'admission_base');
  if(admission.source_sha!==admission.base_sha)throw new Error('rsi_verified_materialization_admission_source_mismatch');
  exactDigest(admission.handoff_digest,'handoff');
  exactDigest(admission.context_aware_build_digest,'context_build');
  exactDigest(admission.generic_build_plan_digest,'generic_build');
  exactDigest(admission.source_snapshot_digest,'source_snapshot');
  positive(admission.workspace_generation,'workspace_generation');
  positive(admission.lease_generation,'lease_generation');
  positive(admission.agent_generation_epoch,'agent_generation_epoch');
  return admission;
}

function exactWorkspaceBindingFromReceipt(receipt,admission,buildPlan){
  const workspace=receipt?.workspace;
  if(!workspace||typeof workspace!=='object'||Array.isArray(workspace))throw new Error('rsi_verified_materialization_workspace_receipt_invalid');
  if(uuid(workspace.workspace_id,'receipt_workspace_id')!==admission.workspace_id)throw new Error('rsi_verified_materialization_workspace_id_mismatch');
  const snapshot=workspace.binding_snapshot;
  if(!snapshot||snapshot.schema!=='metaengine.devos.workspace-binding-snapshot.v1'||snapshot.state!=='AVAILABLE')throw new Error('rsi_verified_materialization_binding_snapshot_invalid');
  if(snapshot.filesystem_paths_exposed!==false||snapshot.scheduler_authority!==false||snapshot.browser_actuation_authority!==false||snapshot.automatic_retry_allowed!==false||snapshot.authority_effect!==false)throw new Error('rsi_verified_materialization_binding_snapshot_authority_invalid');
  if(uuid(snapshot.coordination_workspace_id,'snapshot_coordination_workspace_id')!==admission.coordination_workspace_id)throw new Error('rsi_verified_materialization_coordination_workspace_mismatch');
  const rows=Array.isArray(snapshot.bindings)?snapshot.bindings:[];
  const matches=rows.filter(row=>String(row?.workspace_id||'').toLowerCase()===admission.workspace_id);
  if(matches.length!==1)throw new Error('rsi_verified_materialization_binding_not_unique');
  const row=matches[0];
  if(uuid(row.task_id,'binding_task_id')!==admission.task_id)throw new Error('rsi_verified_materialization_task_id_mismatch');
  if(exactSha(row.base_sha,'binding_base')!==admission.source_sha)throw new Error('rsi_verified_materialization_binding_base_mismatch');
  if(String(row.branch_name||'')!==admission.branch_name||String(row.branch_name||'')!==buildPlan.target_branch)throw new Error('rsi_verified_materialization_binding_branch_mismatch');
  if(positive(row.workspace_generation,'binding_workspace_generation')!==admission.workspace_generation)throw new Error('rsi_verified_materialization_workspace_generation_mismatch');
  if(positive(row.lease_generation,'binding_lease_generation')!==admission.lease_generation)throw new Error('rsi_verified_materialization_lease_generation_mismatch');
  if(positive(row.agent_generation_epoch,'binding_agent_generation_epoch')!==admission.agent_generation_epoch)throw new Error('rsi_verified_materialization_agent_generation_mismatch');
  if(row.lease_current!==true)throw new Error('rsi_verified_materialization_lease_not_current');
  if(String(row.state||'').toUpperCase()!=='READY')throw new Error('rsi_verified_materialization_workspace_not_ready');
  if(row.ambiguity_code!=null||row.dirty_hold===true)throw new Error('rsi_verified_materialization_workspace_ambiguous_or_dirty');
  if(exactSha(row.last_verified_head_sha,'binding_verified_head')!==admission.source_sha)throw new Error('rsi_verified_materialization_verified_head_mismatch');
  return row;
}

export function createRsiVerifiedCandidateMaterialization({
  episode_id,
  materialization_admission,
  synthesis_request,
  mutation_proposal,
  context_candidate_build,
  materialization_receipt,
}={}){
  const episodeId=safeId(episode_id,'episode_id');
  const admission=verifyAdmission(materialization_admission);
  const request=verifyRsiCandidateSynthesisRequest(synthesis_request);
  const proposal=verifyRsiCandidateMutationProposal(mutation_proposal,request);
  const build=verifyRsiContextAwareCandidateBuild(context_candidate_build,{
    synthesis_request:request,
    mutation_proposal:proposal,
  });
  verifyRsiIsolatedCandidateBuildPlan(build.generic_build_plan);
  if(
    admission.source_sha!==request.source_sha
    || admission.context_aware_build_digest!==build.context_aware_build_digest
    || admission.generic_build_plan_digest!==build.generic_build_plan_digest
    || admission.source_snapshot_digest!==build.source_snapshot_digest
  )throw new Error('rsi_verified_materialization_admission_build_binding_mismatch');

  exactWorkspaceBindingFromReceipt(materialization_receipt,admission,build.generic_build_plan);
  const isolated=finalizeRsiIsolatedCandidateBuild({
    build_plan:build.generic_build_plan,
    materialization_receipt,
  });
  if(
    isolated.parent_sha!==request.source_sha
    || isolated.target_branch!==admission.branch_name
    || isolated.build_plan_digest!==build.generic_build_plan_digest
    || isolated.eligible_for_evaluation!==true
    || isolated.eligible_for_promotion!==false
    || isolated.materialization_replay_authorized!==false
  )throw new Error('rsi_verified_materialization_isolated_handoff_policy_invalid');
  const candidateId=String(isolated.candidate_capsule?.candidate_id||'').toLowerCase();
  if(!CANDIDATE_ID_RE.test(candidateId))throw new Error('rsi_verified_materialization_candidate_id_invalid');
  const candidateSha=exactSha(isolated.candidate_sha,'candidate');
  if(candidateSha===request.source_sha)throw new Error('rsi_verified_materialization_noop_candidate');

  const registration=zeroAuthority({
    episode_id:episodeId,
    candidate_id:candidateId,
    candidate_sha:candidateSha,
    parent_sha:request.source_sha,
    build_plan_digest:build.generic_build_plan_digest,
    mutation_surface:request.mutation_surface,
  });
  const evaluatorHandoff=zeroAuthority({
    schema:'metaengine.rsi.external-evaluator-handoff.v1',
    version:1,
    episode_id:episodeId,
    candidate_id:candidateId,
    candidate_sha:candidateSha,
    parent_sha:request.source_sha,
    mutation_surface:request.mutation_surface,
    candidate_handoff:isolateSafe(isolated),
    isolated_candidate_handoff_digest:isolated.handoff_digest,
    external_evaluation_required:true,
    candidate_can_edit_evaluator:false,
    candidate_can_self_certify:false,
    eligible_for_promotion:false,
  });
  const core=zeroAuthority({
    schema:RSI_VERIFIED_CANDIDATE_MATERIALIZATION_SCHEMA,
    version:1,
    episode_id:episodeId,
    materialization_admission_digest:admission.admission_digest,
    source_sha:request.source_sha,
    candidate_id:candidateId,
    candidate_sha:candidateSha,
    target_branch:admission.branch_name,
    context_aware_build_digest:build.context_aware_build_digest,
    generic_build_plan_digest:build.generic_build_plan_digest,
    source_snapshot_digest:build.source_snapshot_digest,
    isolated_candidate_handoff_digest:isolated.handoff_digest,
    workspace_id:admission.workspace_id,
    task_id:admission.task_id,
    lease_generation:admission.lease_generation,
    agent_generation_epoch:admission.agent_generation_epoch,
    episode_candidate_registration:registration,
    evaluator_handoff:evaluatorHandoff,
    exact_workspace_incarnation_verified:true,
    exact_candidate_source_verified:true,
    candidate_registered_in_episode:false,
    evaluation_started:false,
    eligible_for_external_evaluation:true,
    eligible_for_promotion:false,
    materialization_replay_authorized:false,
    db_lease_was_execution_authority:true,
    verified_materialization_is_execution_authority:false,
  });
  const payloadBytes=bytes(core);
  if(payloadBytes>MAX_LEDGER_BYTES)throw new Error('rsi_verified_materialization_ledger_budget_exceeded');
  return Object.freeze({
    ...core,
    payload_bytes:payloadBytes,
    max_payload_bytes:MAX_LEDGER_BYTES,
    verified_materialization_digest:digest(core),
  });
}

function isolateSafe(value){
  return Object.freeze(structuredClone(value));
}

export function verifyRsiVerifiedCandidateMaterialization(row){
  if(!row||typeof row!=='object'||Array.isArray(row)||row.schema!==RSI_VERIFIED_CANDIDATE_MATERIALIZATION_SCHEMA||row.version!==1)throw new Error('rsi_verified_materialization_invalid');
  assertZeroAuthority(row,'verified');
  if(
    row.exact_workspace_incarnation_verified!==true
    || row.exact_candidate_source_verified!==true
    || row.candidate_registered_in_episode!==false
    || row.evaluation_started!==false
    || row.eligible_for_external_evaluation!==true
    || row.eligible_for_promotion!==false
    || row.materialization_replay_authorized!==false
    || row.db_lease_was_execution_authority!==true
    || row.verified_materialization_is_execution_authority!==false
  )throw new Error('rsi_verified_materialization_policy_invalid');
  if(!CANDIDATE_ID_RE.test(String(row.candidate_id||'')))throw new Error('rsi_verified_materialization_candidate_id_invalid');
  exactSha(row.source_sha,'source');
  exactSha(row.candidate_sha,'candidate');
  exactDigest(row.materialization_admission_digest,'admission');
  exactDigest(row.context_aware_build_digest,'context_build');
  exactDigest(row.generic_build_plan_digest,'generic_build');
  exactDigest(row.source_snapshot_digest,'source_snapshot');
  exactDigest(row.isolated_candidate_handoff_digest,'isolated_handoff');
  if(bytes((()=>{const x={...structuredClone(row)};delete x.payload_bytes;delete x.max_payload_bytes;delete x.verified_materialization_digest;return x})())!==Number(row.payload_bytes))throw new Error('rsi_verified_materialization_payload_size_mismatch');
  if(Number(row.payload_bytes)>Number(row.max_payload_bytes)||Number(row.max_payload_bytes)!==MAX_LEDGER_BYTES)throw new Error('rsi_verified_materialization_payload_budget_invalid');
  const core={...structuredClone(row)};delete core.payload_bytes;delete core.max_payload_bytes;delete core.verified_materialization_digest;
  if(digest(core)!==exactDigest(row.verified_materialization_digest,'verified'))throw new Error('rsi_verified_materialization_digest_mismatch');
  return row;
}

export function rsiVerifiedCandidateMaterializationTrustRootSnapshot(){
  const root=zeroAuthority({
    schema:RSI_VERIFIED_CANDIDATE_MATERIALIZATION_ROOT_SCHEMA,
    version:1,
    policy_path:'apps/metaengine-browser/src/rsi-verified-candidate-materialization.mjs',
    prior_devos_materialization_admission_required:true,
    exact_workspace_task_lease_generation_binding_required:true,
    current_ready_workspace_binding_required:true,
    exact_verified_parent_head_required:true,
    existing_isolated_candidate_finalizer_reused:true,
    candidate_capsule_required:true,
    sandbox_plan_required:true,
    external_evaluation_required:true,
    candidate_can_edit_evaluator:false,
    candidate_can_self_certify:false,
    candidate_registered_automatically:false,
    evaluation_started_automatically:false,
    eligible_for_promotion:false,
    materialization_replay_authorized:false,
    max_ledger_payload_bytes:MAX_LEDGER_BYTES,
    no_second_scheduler:true,
  });
  return Object.freeze({...root,verified_materialization_root_digest:digest(root)});
}
