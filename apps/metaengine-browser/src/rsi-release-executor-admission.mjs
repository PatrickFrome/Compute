import crypto from 'node:crypto';

import {
  verifyRsiReleaseAuthorityHandoff,
  verifyRsiReleaseAuthorityReadback,
} from './rsi-release-authority-handoff.mjs';

export const RSI_RELEASE_EXECUTOR_READBACK_SCHEMA='metaengine.rsi.release-executor-readback.v1';
export const RSI_RELEASE_EXECUTOR_ADMISSION_SCHEMA='metaengine.rsi.release-executor-admission.v1';
export const RSI_RELEASE_EXECUTOR_ADMISSION_ROOT_SCHEMA='metaengine.rsi.release-executor-admission-root.v1';

const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:@/+-]{2,255}$/;
const IDEMPOTENCY_RE=/^[A-Za-z0-9._:-]{16,160}$/;
const MAX_FRESHNESS_MS=15_000;
const MAX_LEASE_AGE_MS=120_000;
const MAX_PAYLOAD_BYTES=32*1024;
const EXPECTED_WORKSPACE_ID='2de9f84b-7c0a-4091-911c-894ff1d6eaf4';

function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.keys(value).sort().map((key)=>[key,stable(value[key])]));
}
function digest(value){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)),'utf8').digest('hex')}`}
function bytes(value){return Buffer.byteLength(JSON.stringify(stable(value)),'utf8')}
function zeroAuthority(extra={}){return Object.freeze({...extra,execution_authority:false,browser_authority:false,scheduler_authority:false,task_authority:false,production_mutation_authority:false,promotion_authority:false,release_authority:false,self_update_authority:false,automatic_retry_allowed:false,authority_effect:false})}
function assertZeroAuthority(value,label){
  for(const key of ['execution_authority','browser_authority','scheduler_authority','task_authority','production_mutation_authority','promotion_authority','release_authority','self_update_authority','authority_effect']){
    if(Object.hasOwn(value||{},key)&&value[key]!==false)throw new Error(`rsi_release_executor_${label}_${key}_invalid`);
  }
  if(Object.hasOwn(value||{},'automatic_retry_allowed')&&value.automatic_retry_allowed!==false)throw new Error(`rsi_release_executor_${label}_retry_invalid`);
}
function uuid(value,label){const out=String(value||'').trim().toLowerCase();if(!UUID_RE.test(out))throw new Error(`rsi_release_executor_${label}_invalid`);return out}
function sha(value,label){const out=String(value||'').trim().toLowerCase();if(!SHA40_RE.test(out))throw new Error(`rsi_release_executor_${label}_sha_invalid`);return out}
function sha256(value,label){const out=String(value||'').trim().toLowerCase();if(!SHA256_RE.test(out))throw new Error(`rsi_release_executor_${label}_digest_invalid`);return out}
function safeId(value,label){const out=String(value||'').trim();if(!SAFE_ID_RE.test(out))throw new Error(`rsi_release_executor_${label}_invalid`);return out}
function idempotency(value){const out=String(value||'').trim();if(!IDEMPOTENCY_RE.test(out))throw new Error('rsi_release_executor_idempotency_invalid');return out}
function iso(value,label){const raw=String(value||'').trim();const ms=Date.parse(raw);if(!raw||!Number.isFinite(ms))throw new Error(`rsi_release_executor_${label}_time_invalid`);return new Date(ms).toISOString()}
function ms(value,label){const parsed=Date.parse(String(value||''));if(!Number.isFinite(parsed))throw new Error(`rsi_release_executor_${label}_time_invalid`);return parsed}

export function expectedRsiReleaseExecutorIdempotencyKey(releaseHandoff){
  const digestValue=sha256(releaseHandoff?.handoff_digest,'release_handoff').slice('sha256:'.length);
  const candidate=sha(releaseHandoff?.candidate_sha,'candidate');
  return `rsi-release-effect:${candidate.slice(0,16)}:${digestValue.slice(0,24)}`;
}

export function createRsiReleaseExecutorReadback({
  verifier_id,
  verified_at,
  workspace_id,
  command_id,
  target_client_id,
  leased_by,
  issued_by,
  action,
  status,
  payload,
  issued_at,
  leased_at,
  expires_at,
  idempotency_key,
  command_lane,
  effect_key,
  supervisor_mode,
  armed,
  continuous_service_admitted,
  current_command_id,
  browser_generation,
  current_authority_sha,
  command_row_authority_effect=false,
  db_row_externally_verified=false,
  native_runtime_externally_verified=false,
}={}){
  if(db_row_externally_verified!==true||native_runtime_externally_verified!==true)throw new Error('rsi_release_executor_external_readback_required');
  const workspace=uuid(workspace_id,'workspace_id');
  if(workspace!==EXPECTED_WORKSPACE_ID)throw new Error('rsi_release_executor_workspace_mismatch');
  const command=uuid(command_id,'command_id');
  const client=safeId(leased_by,'leased_by');
  if(safeId(target_client_id,'target_client_id')!==client)throw new Error('rsi_release_executor_target_lease_holder_mismatch');
  const issuer=safeId(issued_by,'issued_by');
  if(String(action||'').trim().toUpperCase()!=='SELF_UPDATE_APPLY')throw new Error('rsi_release_executor_action_invalid');
  if(String(status||'').trim().toUpperCase()!=='LEASED')throw new Error('rsi_release_executor_command_not_leased');
  if(payload==null||typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).length!==0)throw new Error('rsi_release_executor_payload_must_be_empty');
  if(String(command_lane||'').trim().toUpperCase()!=='GLOBAL_MUTATION')throw new Error('rsi_release_executor_lane_invalid');
  if(String(effect_key||'').trim()!=='global:control-plane')throw new Error('rsi_release_executor_effect_key_invalid');
  if(String(supervisor_mode||'').trim().toUpperCase()!=='CONTROL')throw new Error('rsi_release_executor_control_mode_required');
  if(armed!==true||continuous_service_admitted!==true)throw new Error('rsi_release_executor_runtime_admission_required');
  if(uuid(current_command_id,'current_command_id')!==command)throw new Error('rsi_release_executor_current_command_mismatch');
  if(command_row_authority_effect!==false)throw new Error('rsi_release_executor_leased_row_authority_drift');
  const generation=Number(browser_generation);
  if(!Number.isSafeInteger(generation)||generation<1)throw new Error('rsi_release_executor_browser_generation_invalid');
  const issuedAt=iso(issued_at,'issued_at');
  const leasedAt=iso(leased_at,'leased_at');
  const expiresAt=iso(expires_at,'expires_at');
  const verifiedAt=iso(verified_at,'verified_at');
  if(ms(issuedAt,'issued_at')>ms(leasedAt,'leased_at')||ms(leasedAt,'leased_at')>ms(verifiedAt,'verified_at')||ms(verifiedAt,'verified_at')>=ms(expiresAt,'expires_at'))throw new Error('rsi_release_executor_lease_timeline_invalid');
  if(ms(verifiedAt,'verified_at')-ms(leasedAt,'leased_at')>MAX_LEASE_AGE_MS)throw new Error('rsi_release_executor_lease_too_old');
  const core=zeroAuthority({
    schema:RSI_RELEASE_EXECUTOR_READBACK_SCHEMA,
    version:1,
    verifier_id:safeId(verifier_id,'verifier_id'),
    verified_at:verifiedAt,
    workspace_id:workspace,
    command_id:command,
    target_client_id:client,
    leased_by:client,
    issued_by:issuer,
    action:'SELF_UPDATE_APPLY',
    status:'LEASED',
    payload:Object.freeze({}),
    issued_at:issuedAt,
    leased_at:leasedAt,
    expires_at:expiresAt,
    idempotency_key:idempotency(idempotency_key),
    command_lane:'GLOBAL_MUTATION',
    effect_key:'global:control-plane',
    supervisor_mode:'CONTROL',
    armed:true,
    continuous_service_admitted:true,
    current_command_id:command,
    browser_generation:generation,
    current_authority_sha:sha(current_authority_sha,'current_authority'),
    command_row_authority_effect:false,
    db_row_externally_verified:true,
    native_runtime_externally_verified:true,
    db_lease_is_execution_authority:true,
    readback_is_execution_authority:false,
    effect_started:false,
  });
  return Object.freeze({...core,readback_digest:digest(core)});
}

export function verifyRsiReleaseExecutorReadback(row){
  if(!row||typeof row!=='object'||Array.isArray(row)||row.schema!==RSI_RELEASE_EXECUTOR_READBACK_SCHEMA||row.version!==1)throw new Error('rsi_release_executor_readback_invalid');
  assertZeroAuthority(row,'readback');
  if(
    row.db_row_externally_verified!==true
    || row.native_runtime_externally_verified!==true
    || row.db_lease_is_execution_authority!==true
    || row.readback_is_execution_authority!==false
    || row.effect_started!==false
  )throw new Error('rsi_release_executor_readback_policy_invalid');
  const canonical=createRsiReleaseExecutorReadback({
    verifier_id:row.verifier_id,verified_at:row.verified_at,workspace_id:row.workspace_id,command_id:row.command_id,
    target_client_id:row.target_client_id,leased_by:row.leased_by,issued_by:row.issued_by,action:row.action,status:row.status,payload:row.payload,
    issued_at:row.issued_at,leased_at:row.leased_at,expires_at:row.expires_at,idempotency_key:row.idempotency_key,
    command_lane:row.command_lane,effect_key:row.effect_key,supervisor_mode:row.supervisor_mode,armed:row.armed,
    continuous_service_admitted:row.continuous_service_admitted,current_command_id:row.current_command_id,
    browser_generation:row.browser_generation,current_authority_sha:row.current_authority_sha,
    command_row_authority_effect:row.command_row_authority_effect,db_row_externally_verified:true,native_runtime_externally_verified:true,
  });
  if(canonical.readback_digest!==sha256(row.readback_digest,'readback'))throw new Error('rsi_release_executor_readback_digest_mismatch');
  return canonical;
}

export function createRsiReleaseExecutorAdmission({
  release_handoff,
  promotion_review_result,
  promotion_review_request,
  executor_readback,
  pre_effect_authority_readback,
  evaluated_at,
}={}){
  const releaseHandoff=verifyRsiReleaseAuthorityHandoff(release_handoff,promotion_review_result,promotion_review_request);
  if(releaseHandoff.state!=='READY_FOR_EXTERNAL_RELEASE_EXECUTOR'||releaseHandoff.ready_for_external_release_executor!==true)throw new Error('rsi_release_executor_release_handoff_not_ready');
  const lease=verifyRsiReleaseExecutorReadback(executor_readback);
  const authorityReadback=verifyRsiReleaseAuthorityReadback(pre_effect_authority_readback);
  const evaluatedAt=iso(evaluated_at,'evaluated_at');
  const evaluatedMs=ms(evaluatedAt,'evaluated_at');
  const leaseVerifiedMs=ms(lease.verified_at,'lease_verified_at');
  const authorityVerifiedMs=ms(authorityReadback.verified_at,'authority_verified_at');
  if(evaluatedMs<leaseVerifiedMs||evaluatedMs<authorityVerifiedMs)throw new Error('rsi_release_executor_future_readback');
  if(evaluatedMs-leaseVerifiedMs>MAX_FRESHNESS_MS||evaluatedMs-authorityVerifiedMs>MAX_FRESHNESS_MS)throw new Error('rsi_release_executor_readback_stale');
  if(lease.current_authority_sha!==releaseHandoff.parent_sha||authorityReadback.current_authority_sha!==releaseHandoff.parent_sha)throw new Error('rsi_release_executor_authority_sha_drift');
  if(lease.browser_generation!==authorityReadback.browser_generation)throw new Error('rsi_release_executor_browser_generation_drift');
  if(lease.idempotency_key!==expectedRsiReleaseExecutorIdempotencyKey(releaseHandoff))throw new Error('rsi_release_executor_idempotency_binding_mismatch');
  if(lease.issued_by!==safeId(promotion_review_result?.gate_result?.qualification_digest||promotion_review_result?.request_digest,'external_release_authority_id')){
    // Do not accept a release command whose issuer identity is unrelated to this
    // review lineage. External executors should issue with the exact review digest
    // as issued_by so the DB lease has a deterministic, auditable authority source.
    throw new Error('rsi_release_executor_issuer_review_binding_mismatch');
  }
  const core=zeroAuthority({
    schema:RSI_RELEASE_EXECUTOR_ADMISSION_SCHEMA,
    version:1,
    state:'READY_FOR_ONE_ATTEMPT_EXTERNAL_EFFECT',
    evaluated_at:evaluatedAt,
    candidate_sha:releaseHandoff.candidate_sha,
    parent_sha:releaseHandoff.parent_sha,
    release_handoff_digest:releaseHandoff.handoff_digest,
    promotion_review_result_digest:releaseHandoff.promotion_review_result_digest,
    command_id:lease.command_id,
    workspace_id:lease.workspace_id,
    leased_by:lease.leased_by,
    leased_at:lease.leased_at,
    expires_at:lease.expires_at,
    idempotency_key:lease.idempotency_key,
    external_release_authority_id:lease.issued_by,
    executor_readback:lease,
    pre_effect_authority_readback:authorityReadback,
    executor_readback_digest:lease.readback_digest,
    pre_effect_authority_readback_digest:authorityReadback.readback_digest,
    browser_generation:lease.browser_generation,
    current_authority_sha:lease.current_authority_sha,
    db_lease_is_execution_authority:true,
    admission_is_execution_authority:false,
    scheduler_selected_externally:true,
    command_created_by_rsi:false,
    command_leased_by_rsi:false,
    command_completed_by_rsi:false,
    release_transaction_created:false,
    installer_effect_started:false,
    self_update_check_invoked:false,
    self_update_apply_invoked:false,
    effect_invoked_by_admission:false,
    exactly_one_external_effect_attempt_per_command:true,
    effect_result_must_be_reconciled_from_same_command_receipt:true,
    ambiguous_result_requires_reconciliation:true,
    ambiguous_effect_replay_allowed:false,
  });
  const payloadBytes=bytes(core);
  if(payloadBytes>MAX_PAYLOAD_BYTES)throw new Error('rsi_release_executor_admission_budget_exceeded');
  return Object.freeze({...core,payload_bytes:payloadBytes,max_payload_bytes:MAX_PAYLOAD_BYTES,admission_digest:digest(core)});
}

export function verifyRsiReleaseExecutorAdmission(row){
  if(!row||typeof row!=='object'||Array.isArray(row)||row.schema!==RSI_RELEASE_EXECUTOR_ADMISSION_SCHEMA||row.version!==1)throw new Error('rsi_release_executor_admission_invalid');
  assertZeroAuthority(row,'admission');
  if(
    row.state!=='READY_FOR_ONE_ATTEMPT_EXTERNAL_EFFECT'
    || row.db_lease_is_execution_authority!==true
    || row.admission_is_execution_authority!==false
    || row.scheduler_selected_externally!==true
    || row.command_created_by_rsi!==false
    || row.command_leased_by_rsi!==false
    || row.command_completed_by_rsi!==false
    || row.release_transaction_created!==false
    || row.installer_effect_started!==false
    || row.self_update_check_invoked!==false
    || row.self_update_apply_invoked!==false
    || row.effect_invoked_by_admission!==false
    || row.exactly_one_external_effect_attempt_per_command!==true
    || row.effect_result_must_be_reconciled_from_same_command_receipt!==true
    || row.ambiguous_result_requires_reconciliation!==true
    || row.ambiguous_effect_replay_allowed!==false
  )throw new Error('rsi_release_executor_admission_policy_invalid');
  uuid(row.command_id,'command_id');uuid(row.workspace_id,'workspace_id');safeId(row.leased_by,'leased_by');idempotency(row.idempotency_key);
  safeId(row.external_release_authority_id,'external_release_authority_id');
  sha(row.candidate_sha,'candidate');sha(row.parent_sha,'parent');sha(row.current_authority_sha,'current_authority');
  const lease=verifyRsiReleaseExecutorReadback(row.executor_readback);
  const authorityReadback=verifyRsiReleaseAuthorityReadback(row.pre_effect_authority_readback);
  if(
    lease.readback_digest!==row.executor_readback_digest
    || authorityReadback.readback_digest!==row.pre_effect_authority_readback_digest
    || lease.command_id!==row.command_id
    || lease.workspace_id!==row.workspace_id
    || lease.leased_by!==row.leased_by
    || lease.idempotency_key!==row.idempotency_key
    || lease.issued_by!==row.external_release_authority_id
    || lease.browser_generation!==row.browser_generation
    || authorityReadback.browser_generation!==row.browser_generation
    || lease.current_authority_sha!==row.current_authority_sha
    || authorityReadback.current_authority_sha!==row.current_authority_sha
  )throw new Error('rsi_release_executor_admission_readback_binding_mismatch');
  for(const [value,label] of [
    [row.release_handoff_digest,'release_handoff'],[row.promotion_review_result_digest,'promotion_review'],
    [row.executor_readback_digest,'executor_readback'],[row.pre_effect_authority_readback_digest,'authority_readback'],
  ])sha256(value,label);
  const core={...structuredClone(row)};delete core.payload_bytes;delete core.max_payload_bytes;delete core.admission_digest;
  const payloadBytes=bytes(core);
  if(payloadBytes!==Number(row.payload_bytes)||payloadBytes>Number(row.max_payload_bytes)||Number(row.max_payload_bytes)!==MAX_PAYLOAD_BYTES)throw new Error('rsi_release_executor_admission_size_mismatch');
  if(digest(core)!==sha256(row.admission_digest,'admission'))throw new Error('rsi_release_executor_admission_digest_mismatch');
  return row;
}

export function rsiReleaseExecutorAdmissionTrustRootSnapshot(){
  const root=zeroAuthority({
    schema:RSI_RELEASE_EXECUTOR_ADMISSION_ROOT_SCHEMA,
    version:1,
    policy_path:'apps/metaengine-browser/src/rsi-release-executor-admission.mjs',
    existing_command_table:'public.compute_fabric_a2_browser_supervisor_command_h205f22',
    existing_issue_rpc:'h205f22_a2_browser_supervisor_issue_native_v1',
    existing_lease_rpc:'h205f22_a2_browser_supervisor_lease_batch_v1',
    existing_completion_rpc:'h205f22_a2_browser_supervisor_complete_v5',
    required_action:'SELF_UPDATE_APPLY',
    required_command_lane:'GLOBAL_MUTATION',
    required_effect_key:'global:control-plane',
    command_payload_must_be_empty:true,
    db_lease_is_execution_authority:true,
    external_scheduler_selection_required:true,
    control_mode_required:true,
    armed_required:true,
    fresh_pre_effect_authority_readback_required:true,
    max_readback_age_ms:MAX_FRESHNESS_MS,
    max_lease_age_ms:MAX_LEASE_AGE_MS,
    rsi_can_issue_command:false,
    rsi_can_lease_command:false,
    rsi_can_complete_command:false,
    rsi_can_invoke_effect:false,
    release_transaction_created_by_admission:false,
    installer_effect_started_by_admission:false,
    ambiguous_effect_replay_allowed:false,
    same_command_receipt_reconciliation_required:true,
    no_second_scheduler:true,
  });
  return Object.freeze({...root,release_executor_root_digest:digest(root)});
}
