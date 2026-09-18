import crypto from 'node:crypto';

import { verifyRsiReleaseExecutorAdmission } from './rsi-release-executor-admission.mjs';
import {
  verifyRsiReleaseAuthorityHandoff,
} from './rsi-release-authority-handoff.mjs';
import {
  SELF_UPDATE_TRANSACTION_SCHEMA,
  SELF_UPDATE_INSTALL_EFFECT_BARRIER,
  SELF_UPDATE_INSTALL_EFFECT_SCOPE,
  SELF_UPDATE_INSTALL_ACTUATOR,
} from './self-update-transaction-journal.mjs';

export const RSI_RELEASE_EFFECT_COMMAND_READBACK_SCHEMA='metaengine.rsi.release-effect-command-readback.v1';
export const RSI_SELF_UPDATE_TRANSACTION_READBACK_SCHEMA='metaengine.rsi.self-update-transaction-readback.v1';
export const RSI_SUCCESSOR_RUNTIME_READBACK_SCHEMA='metaengine.rsi.successor-runtime-readback.v1';
export const RSI_RELEASE_EFFECT_RECONCILIATION_SCHEMA='metaengine.rsi.release-effect-reconciliation.v1';
export const RSI_RELEASE_EFFECT_RECONCILIATION_ROOT_SCHEMA='metaengine.rsi.release-effect-reconciliation-root.v1';

const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA40_RE=/^[0-9a-f]{40}$/;
const HEX64_RE=/^[0-9a-f]{64}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:@/+-]{2,255}$/;
const COMMAND_STATES=new Set(['LEASED','COMPLETED','FAILED','EXPIRED']);
const TRANSACTION_STATES=new Set(['PREPARED','INSTALLING','SUCCESSOR_BOOTED','QUALIFIED','AMBIGUOUS_INSTALL','QUARANTINED','SUPERSEDED']);
const EFFECT_OUTCOMES=new Set(['CONFIRMED','NO_EFFECT_PROVEN','AMBIGUOUS']);
const MAX_PAYLOAD_BYTES=48*1024;

function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));
}
function digest(value){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)),'utf8').digest('hex')}`}
function bytes(value){return Buffer.byteLength(JSON.stringify(stable(value)),'utf8')}
function zeroAuthority(extra={}){return Object.freeze({...extra,execution_authority:false,browser_authority:false,scheduler_authority:false,task_authority:false,production_mutation_authority:false,promotion_authority:false,release_authority:false,self_update_authority:false,automatic_retry_allowed:false,authority_effect:false})}
function assertZeroAuthority(value,label){
  for(const key of ['execution_authority','browser_authority','scheduler_authority','task_authority','production_mutation_authority','promotion_authority','release_authority','self_update_authority','authority_effect']){
    if(Object.hasOwn(value||{},key)&&value[key]!==false)throw new Error(`rsi_effect_reconcile_${label}_${key}_invalid`);
  }
  if(Object.hasOwn(value||{},'automatic_retry_allowed')&&value.automatic_retry_allowed!==false)throw new Error(`rsi_effect_reconcile_${label}_retry_invalid`);
}
function uuid(value,label){const out=String(value||'').trim().toLowerCase();if(!UUID_RE.test(out))throw new Error(`rsi_effect_reconcile_${label}_invalid`);return out}
function sha(value,label){const out=String(value||'').trim().toLowerCase();if(!SHA40_RE.test(out))throw new Error(`rsi_effect_reconcile_${label}_sha_invalid`);return out}
function hex64(value,label){const out=String(value||'').trim().toLowerCase();if(!HEX64_RE.test(out))throw new Error(`rsi_effect_reconcile_${label}_hex_invalid`);return out}
function sha256(value,label){const out=String(value||'').trim().toLowerCase();if(!SHA256_RE.test(out))throw new Error(`rsi_effect_reconcile_${label}_digest_invalid`);return out}
function safeId(value,label){const out=String(value||'').trim();if(!SAFE_ID_RE.test(out))throw new Error(`rsi_effect_reconcile_${label}_invalid`);return out}
function iso(value,label){const raw=String(value||'').trim();const parsed=Date.parse(raw);if(!raw||!Number.isFinite(parsed))throw new Error(`rsi_effect_reconcile_${label}_time_invalid`);return new Date(parsed).toISOString()}
function optionalIso(value,label){return value==null?null:iso(value,label)}
function bool(value,label){if(value!==true&&value!==false)throw new Error(`rsi_effect_reconcile_${label}_boolean_invalid`);return value}
function plain(value){return value&&typeof value==='object'&&!Array.isArray(value)}
function boundedError(value){if(value==null)return null;const out=String(value).slice(0,500);return out||null}
function safeSelfUpdateResult(value){
  if(value==null)return null;
  if(!plain(value))return Object.freeze({});
  const allowed=[
    'state','current_version','available_version','downloaded_version','install_attempted_version',
    'version','resolved_git_sha','metadata_verified','restart_gate_safe','pre_install_receipt_persisted',
    'installer_handoff_prepared','pending_prior_qualification','last_error','effect_outcome',
  ];
  const out={};
  for(const key of allowed){
    const raw=value[key];
    if(raw==null||['string','number','boolean'].includes(typeof raw))out[key]=raw??null;
  }
  return Object.freeze(out);
}

function canonicalReceipt(receipt,commandId){
  if(receipt==null)return null;
  if(!plain(receipt)||receipt.schema!=='metaengine.native-supervisor.command-receipt.v2')throw new Error('rsi_effect_reconcile_receipt_schema_invalid');
  if(uuid(receipt.command_id,'receipt_command')!==commandId)throw new Error('rsi_effect_reconcile_receipt_command_mismatch');
  if(String(receipt.action||'').toUpperCase()!=='SELF_UPDATE_APPLY')throw new Error('rsi_effect_reconcile_receipt_action_invalid');
  const outcome=String(receipt.effect_outcome||'').toUpperCase();
  if(!EFFECT_OUTCOMES.has(outcome))throw new Error('rsi_effect_reconcile_receipt_effect_outcome_invalid');
  return Object.freeze({
    schema:'metaengine.native-supervisor.command-receipt.v2',
    command_id:commandId,
    action:'SELF_UPDATE_APPLY',
    platform:receipt.platform==null?null:String(receipt.platform).slice(0,64),
    result:safeSelfUpdateResult(receipt.result),
    effect_outcome:outcome,
    lane:receipt.lane==null?null:String(receipt.lane).toUpperCase(),
    effect_key:receipt.effect_key==null?null:String(receipt.effect_key),
    execution_ms:Number.isFinite(Number(receipt.execution_ms))?Number(receipt.execution_ms):null,
    recorded_at:iso(receipt.recorded_at,'receipt_recorded_at'),
    authority_effect:receipt.authority_effect===true,
  });
}

export function createRsiReleaseEffectCommandReadback({
  verifier_id,
  observed_at,
  workspace_id,
  command_id,
  leased_by,
  action,
  status,
  idempotency_key,
  command_lane,
  effect_key,
  leased_at,
  expires_at,
  completed_at=null,
  receipt=null,
  error=null,
  command_row_authority_effect=false,
  db_row_externally_verified=false,
}={}){
  if(db_row_externally_verified!==true)throw new Error('rsi_effect_reconcile_command_external_readback_required');
  const command=uuid(command_id,'command_id');
  const state=String(status||'').trim().toUpperCase();
  if(!COMMAND_STATES.has(state))throw new Error('rsi_effect_reconcile_command_state_invalid');
  if(uuid(workspace_id,'workspace_id')!=='2de9f84b-7c0a-4091-911c-894ff1d6eaf4')throw new Error('rsi_effect_reconcile_workspace_mismatch');
  if(String(action||'').trim().toUpperCase()!=='SELF_UPDATE_APPLY')throw new Error('rsi_effect_reconcile_command_action_invalid');
  if(String(command_lane||'').trim().toUpperCase()!=='GLOBAL_MUTATION')throw new Error('rsi_effect_reconcile_command_lane_invalid');
  if(String(effect_key||'').trim()!=='global:control-plane')throw new Error('rsi_effect_reconcile_command_effect_key_invalid');
  const observedAt=iso(observed_at,'command_observed_at');
  const leasedAt=iso(leased_at,'command_leased_at');
  const expiresAt=iso(expires_at,'command_expires_at');
  const completedAt=optionalIso(completed_at,'command_completed_at');
  if(completedAt&&Date.parse(completedAt)<Date.parse(leasedAt))throw new Error('rsi_effect_reconcile_command_completion_before_lease');
  if(completedAt&&Date.parse(completedAt)>Date.parse(observedAt))throw new Error('rsi_effect_reconcile_command_completion_after_observation');
  const canonical=canonicalReceipt(receipt,command);
  if(state==='COMPLETED'&&canonical==null)throw new Error('rsi_effect_reconcile_completed_receipt_required');
  if(state==='FAILED'&&canonical==null&&boundedError(error)==null)throw new Error('rsi_effect_reconcile_failed_evidence_required');
  const core=zeroAuthority({
    schema:RSI_RELEASE_EFFECT_COMMAND_READBACK_SCHEMA,
    version:1,
    verifier_id:safeId(verifier_id,'command_verifier'),
    observed_at:observedAt,
    workspace_id:'2de9f84b-7c0a-4091-911c-894ff1d6eaf4',
    command_id:command,
    leased_by:safeId(leased_by,'leased_by'),
    action:'SELF_UPDATE_APPLY',
    status:state,
    idempotency_key:safeId(idempotency_key,'idempotency_key'),
    command_lane:'GLOBAL_MUTATION',
    effect_key:'global:control-plane',
    leased_at:leasedAt,
    expires_at:expiresAt,
    completed_at:completedAt,
    receipt:canonical,
    error:boundedError(error),
    command_row_authority_effect:bool(command_row_authority_effect,'command_authority_effect'),
    db_row_externally_verified:true,
    db_authority_effect_is_physical_success_proof:false,
    physical_effect_replay_allowed:false,
  });
  return Object.freeze({...core,readback_digest:digest(core)});
}

export function verifyRsiReleaseEffectCommandReadback(row){
  if(!plain(row)||row.schema!==RSI_RELEASE_EFFECT_COMMAND_READBACK_SCHEMA||row.version!==1)throw new Error('rsi_effect_reconcile_command_readback_invalid');
  assertZeroAuthority(row,'command_readback');
  if(row.db_row_externally_verified!==true||row.db_authority_effect_is_physical_success_proof!==false||row.physical_effect_replay_allowed!==false)throw new Error('rsi_effect_reconcile_command_readback_policy_invalid');
  const canonical=createRsiReleaseEffectCommandReadback({
    verifier_id:row.verifier_id,observed_at:row.observed_at,workspace_id:row.workspace_id,command_id:row.command_id,
    leased_by:row.leased_by,action:row.action,status:row.status,idempotency_key:row.idempotency_key,
    command_lane:row.command_lane,effect_key:row.effect_key,leased_at:row.leased_at,expires_at:row.expires_at,
    completed_at:row.completed_at,receipt:row.receipt,error:row.error,
    command_row_authority_effect:row.command_row_authority_effect,db_row_externally_verified:true,
  });
  if(canonical.readback_digest!==sha256(row.readback_digest,'command_readback'))throw new Error('rsi_effect_reconcile_command_readback_digest_mismatch');
  return canonical;
}

function canonicalTransaction(transaction){
  if(!plain(transaction)||transaction.schema!==SELF_UPDATE_TRANSACTION_SCHEMA)throw new Error('rsi_effect_reconcile_transaction_schema_invalid');
  const state=String(transaction.state||'').toUpperCase();
  if(!TRANSACTION_STATES.has(state))throw new Error('rsi_effect_reconcile_transaction_state_invalid');
  const attempt=Number(transaction.attempt_count);
  if(!Number.isSafeInteger(attempt)||attempt<1)throw new Error('rsi_effect_reconcile_transaction_attempt_invalid');
  if(transaction.automatic_retry_allowed!==false||transaction.authority_effect!==false)throw new Error('rsi_effect_reconcile_transaction_policy_invalid');
  const evidence=plain(transaction.evidence)?Object.freeze(structuredClone(transaction.evidence)):Object.freeze({});
  return Object.freeze({
    schema:SELF_UPDATE_TRANSACTION_SCHEMA,
    transaction_id:uuid(transaction.transaction_id,'transaction_id'),
    source_version:safeId(transaction.source_version,'transaction_source_version'),
    target_version:safeId(transaction.target_version,'transaction_target_version'),
    resolved_git_sha:transaction.resolved_git_sha==null?null:sha(transaction.resolved_git_sha,'transaction_git_sha'),
    state,
    swapping:transaction.swapping===true,
    qualified:transaction.qualified===true,
    quarantined:transaction.quarantined===true,
    attempt_count:attempt,
    automatic_retry_allowed:false,
    created_at:iso(transaction.created_at,'transaction_created_at'),
    updated_at:iso(transaction.updated_at,'transaction_updated_at'),
    evidence,
    authority_effect:false,
  });
}

export function createRsiSelfUpdateTransactionReadback({
  verifier_id,
  observed_at,
  transaction_present,
  transaction=null,
  filesystem_read_verified=false,
}={}){
  if(filesystem_read_verified!==true)throw new Error('rsi_effect_reconcile_transaction_external_readback_required');
  const present=transaction_present===true;
  if(present!==Boolean(transaction))throw new Error('rsi_effect_reconcile_transaction_presence_mismatch');
  const tx=present?canonicalTransaction(transaction):null;
  const core=zeroAuthority({
    schema:RSI_SELF_UPDATE_TRANSACTION_READBACK_SCHEMA,
    version:1,
    verifier_id:safeId(verifier_id,'transaction_verifier'),
    observed_at:iso(observed_at,'transaction_observed_at'),
    transaction_present:present,
    transaction:tx,
    filesystem_read_verified:true,
    transaction_readback_is_execution_authority:false,
    effect_replay_allowed:false,
  });
  return Object.freeze({...core,readback_digest:digest(core)});
}

export function verifyRsiSelfUpdateTransactionReadback(row){
  if(!plain(row)||row.schema!==RSI_SELF_UPDATE_TRANSACTION_READBACK_SCHEMA||row.version!==1)throw new Error('rsi_effect_reconcile_transaction_readback_invalid');
  assertZeroAuthority(row,'transaction_readback');
  if(row.filesystem_read_verified!==true||row.transaction_readback_is_execution_authority!==false||row.effect_replay_allowed!==false)throw new Error('rsi_effect_reconcile_transaction_readback_policy_invalid');
  const canonical=createRsiSelfUpdateTransactionReadback({
    verifier_id:row.verifier_id,observed_at:row.observed_at,transaction_present:row.transaction_present,
    transaction:row.transaction,filesystem_read_verified:true,
  });
  if(canonical.readback_digest!==sha256(row.readback_digest,'transaction_readback'))throw new Error('rsi_effect_reconcile_transaction_readback_digest_mismatch');
  return canonical;
}

export function createRsiSuccessorRuntimeReadback({
  verifier_id,
  observed_at,
  transaction_id,
  running_version,
  running_git_sha,
  installed_executable_sha256,
  browser_generation,
  successor_qualification_state,
  exact_runtime_identity=false,
  installed_executable_hash_verified=false,
  trusted_release_verified=false,
  external_successor_verifier=false,
}={}){
  if(exact_runtime_identity!==true||installed_executable_hash_verified!==true||trusted_release_verified!==true||external_successor_verifier!==true)throw new Error('rsi_effect_reconcile_successor_external_exact_required');
  const generation=Number(browser_generation);
  if(!Number.isSafeInteger(generation)||generation<1)throw new Error('rsi_effect_reconcile_successor_generation_invalid');
  const state=String(successor_qualification_state||'').toUpperCase();
  if(!['QUALIFIED','SUPERSEDED_TRUSTED_SUCCESSOR'].includes(state))throw new Error('rsi_effect_reconcile_successor_state_invalid');
  const core=zeroAuthority({
    schema:RSI_SUCCESSOR_RUNTIME_READBACK_SCHEMA,
    version:1,
    verifier_id:safeId(verifier_id,'successor_verifier'),
    observed_at:iso(observed_at,'successor_observed_at'),
    transaction_id:uuid(transaction_id,'successor_transaction_id'),
    running_version:safeId(running_version,'successor_version'),
    running_git_sha:sha(running_git_sha,'successor_git_sha'),
    installed_executable_sha256:hex64(installed_executable_sha256,'successor_executable'),
    browser_generation:generation,
    successor_qualification_state:state,
    exact_runtime_identity:true,
    installed_executable_hash_verified:true,
    trusted_release_verified:true,
    external_successor_verifier:true,
    readback_is_release_authority:false,
  });
  return Object.freeze({...core,readback_digest:digest(core)});
}

export function verifyRsiSuccessorRuntimeReadback(row){
  if(!plain(row)||row.schema!==RSI_SUCCESSOR_RUNTIME_READBACK_SCHEMA||row.version!==1)throw new Error('rsi_effect_reconcile_successor_readback_invalid');
  assertZeroAuthority(row,'successor_readback');
  if(row.exact_runtime_identity!==true||row.installed_executable_hash_verified!==true||row.trusted_release_verified!==true||row.external_successor_verifier!==true||row.readback_is_release_authority!==false)throw new Error('rsi_effect_reconcile_successor_readback_policy_invalid');
  const canonical=createRsiSuccessorRuntimeReadback({
    verifier_id:row.verifier_id,observed_at:row.observed_at,transaction_id:row.transaction_id,
    running_version:row.running_version,running_git_sha:row.running_git_sha,installed_executable_sha256:row.installed_executable_sha256,
    browser_generation:row.browser_generation,successor_qualification_state:row.successor_qualification_state,
    exact_runtime_identity:true,installed_executable_hash_verified:true,trusted_release_verified:true,external_successor_verifier:true,
  });
  if(canonical.readback_digest!==sha256(row.readback_digest,'successor_readback'))throw new Error('rsi_effect_reconcile_successor_readback_digest_mismatch');
  return canonical;
}

function transactionEffectBarrierCrossed(tx){
  return tx?.state==='INSTALLING'
    || tx?.state==='SUCCESSOR_BOOTED'
    || tx?.state==='QUALIFIED'
    || tx?.state==='AMBIGUOUS_INSTALL'
    || tx?.state==='QUARANTINED'
    || tx?.state==='SUPERSEDED'
    || tx?.evidence?.effect_barrier_crossed===true
    || tx?.evidence?.physical_effect_attempted===true;
}

function classify({admission,releaseHandoff,command,transactionReadback,successor}){
  const tx=transactionReadback.transaction;
  const expectedVersion=String(releaseHandoff.trusted_release?.version||'');
  const expectedInstalledSha=String(releaseHandoff.trusted_release?.installed_executable_sha256||'').toLowerCase();
  const txBound=tx
    && tx.target_version===expectedVersion
    && tx.resolved_git_sha===admission.candidate_sha;
  const successorBound=successor
    && tx
    && successor.transaction_id===tx.transaction_id
    && successor.running_version===expectedVersion
    && successor.running_git_sha===admission.candidate_sha
    && successor.installed_executable_sha256===expectedInstalledSha
    && successor.successor_qualification_state==='QUALIFIED';
  if(txBound&&tx.state==='QUALIFIED'&&successorBound){
    return Object.freeze({
      result:'CONFIRMED',
      reason:'EXACT_QUALIFIED_SUCCESSOR_PROVEN',
      physical_effect_confirmed:true,
      no_effect_proven:false,
      ambiguous:false,
    });
  }
  const noEffectJournalProof=!tx
    || (txBound&&tx.state==='PREPARED'&&!transactionEffectBarrierCrossed(tx));
  const commandNoEffect=(
    (command.status==='FAILED'||command.status==='EXPIRED')
    && command.command_row_authority_effect===false
    && noEffectJournalProof
    && successor==null
  );
  if(commandNoEffect){
    return Object.freeze({
      result:'NO_EFFECT_PROVEN',
      reason:'COMMAND_TERMINAL_WITHOUT_INSTALL_EFFECT_BARRIER',
      physical_effect_confirmed:false,
      no_effect_proven:true,
      ambiguous:false,
    });
  }
  return Object.freeze({
    result:'AMBIGUOUS',
    reason:tx?.state==='AMBIGUOUS_INSTALL'
      ? 'TRANSACTION_AMBIGUOUS_INSTALL'
      : tx?.state==='QUARANTINED'
        ? 'SUCCESSOR_QUARANTINED'
        : tx?.state==='INSTALLING'||tx?.state==='SUCCESSOR_BOOTED'
          ? 'INSTALL_EFFECT_STARTED_SUCCESSOR_NOT_QUALIFIED'
          : command.status==='LEASED'
            ? 'COMMAND_STILL_LEASED_EFFECT_NOT_RECONCILED'
            : 'PHYSICAL_EFFECT_NOT_PROVEN',
    physical_effect_confirmed:false,
    no_effect_proven:false,
    ambiguous:true,
  });
}

export function createRsiReleaseEffectReconciliation({
  executor_admission,
  release_handoff,
  promotion_review_result,
  promotion_review_request,
  command_readback,
  transaction_readback,
  successor_runtime_readback=null,
  reconciled_at,
}={}){
  const admission=verifyRsiReleaseExecutorAdmission(executor_admission);
  const handoff=verifyRsiReleaseAuthorityHandoff(release_handoff,promotion_review_result,promotion_review_request);
  if(admission.release_handoff_digest!==handoff.handoff_digest||admission.candidate_sha!==handoff.candidate_sha||admission.parent_sha!==handoff.parent_sha)throw new Error('rsi_effect_reconcile_admission_release_binding_mismatch');
  const command=verifyRsiReleaseEffectCommandReadback(command_readback);
  const transactionReadback=verifyRsiSelfUpdateTransactionReadback(transaction_readback);
  const successor=successor_runtime_readback==null?null:verifyRsiSuccessorRuntimeReadback(successor_runtime_readback);
  if(command.command_id!==admission.command_id||command.workspace_id!==admission.workspace_id||command.leased_by!==admission.leased_by||command.idempotency_key!==admission.idempotency_key)throw new Error('rsi_effect_reconcile_same_command_binding_mismatch');
  if(command.action!=='SELF_UPDATE_APPLY'||command.command_lane!=='GLOBAL_MUTATION'||command.effect_key!=='global:control-plane')throw new Error('rsi_effect_reconcile_command_contract_drift');
  const reconciledAt=iso(reconciled_at,'reconciled_at');
  for(const observed of [command.observed_at,transactionReadback.observed_at,successor?.observed_at].filter(Boolean)){
    if(Date.parse(observed)>Date.parse(reconciledAt))throw new Error('rsi_effect_reconcile_future_readback');
  }
  const tx=transactionReadback.transaction;
  if(tx){
    if(tx.source_version!==handoff.authority_readback.current_version)throw new Error('rsi_effect_reconcile_transaction_source_version_mismatch');
    if(tx.target_version!==handoff.trusted_release.version)throw new Error('rsi_effect_reconcile_transaction_target_version_mismatch');
    if(tx.resolved_git_sha!=null&&tx.resolved_git_sha!==handoff.candidate_sha)throw new Error('rsi_effect_reconcile_transaction_candidate_mismatch');
    if(transactionEffectBarrierCrossed(tx)){
      if(tx.evidence?.effect_barrier_contract!=null&&tx.evidence.effect_barrier_contract!==SELF_UPDATE_INSTALL_EFFECT_BARRIER)throw new Error('rsi_effect_reconcile_effect_barrier_contract_mismatch');
      if(tx.evidence?.effect_scope!=null&&tx.evidence.effect_scope!==SELF_UPDATE_INSTALL_EFFECT_SCOPE)throw new Error('rsi_effect_reconcile_effect_scope_mismatch');
      if(tx.evidence?.actuator_type!=null&&tx.evidence.actuator_type!==SELF_UPDATE_INSTALL_ACTUATOR)throw new Error('rsi_effect_reconcile_actuator_mismatch');
    }
  }
  const outcome=classify({admission,releaseHandoff:handoff,command,transactionReadback,successor});
  const core=zeroAuthority({
    schema:RSI_RELEASE_EFFECT_RECONCILIATION_SCHEMA,
    version:1,
    reconciled_at:reconciledAt,
    result:outcome.result,
    reason:outcome.reason,
    candidate_sha:admission.candidate_sha,
    parent_sha:admission.parent_sha,
    release_handoff_digest:admission.release_handoff_digest,
    executor_admission_digest:admission.admission_digest,
    command_id:admission.command_id,
    command_readback:command,
    command_readback_digest:command.readback_digest,
    transaction_readback:transactionReadback,
    transaction_readback_digest:transactionReadback.readback_digest,
    successor_runtime_readback:successor,
    successor_runtime_readback_digest:successor?.readback_digest||null,
    physical_effect_confirmed:outcome.physical_effect_confirmed,
    no_effect_proven:outcome.no_effect_proven,
    ambiguous:outcome.ambiguous,
    db_command_completion_is_not_physical_success_proof:true,
    db_authority_effect_is_not_physical_success_proof:true,
    transaction_effect_barrier_is_attempt_evidence_not_success_proof:true,
    exact_qualified_successor_required_for_confirmed_success:true,
    same_command_receipt_required:true,
    effect_reexecution_authorized:false,
    retry_authorized:false,
    reconciliation_is_release_authority:false,
    external_release_authority_convergence_still_required:outcome.result==='CONFIRMED',
  });
  const payloadBytes=bytes(core);
  if(payloadBytes>MAX_PAYLOAD_BYTES)throw new Error('rsi_effect_reconcile_payload_budget_exceeded');
  return Object.freeze({...core,payload_bytes:payloadBytes,max_payload_bytes:MAX_PAYLOAD_BYTES,reconciliation_digest:digest(core)});
}

export function verifyRsiReleaseEffectReconciliation(row){
  if(!plain(row)||row.schema!==RSI_RELEASE_EFFECT_RECONCILIATION_SCHEMA||row.version!==1)throw new Error('rsi_effect_reconcile_invalid');
  assertZeroAuthority(row,'reconciliation');
  if(!EFFECT_OUTCOMES.has(row.result))throw new Error('rsi_effect_reconcile_result_invalid');
  if(
    row.db_command_completion_is_not_physical_success_proof!==true
    || row.db_authority_effect_is_not_physical_success_proof!==true
    || row.transaction_effect_barrier_is_attempt_evidence_not_success_proof!==true
    || row.exact_qualified_successor_required_for_confirmed_success!==true
    || row.same_command_receipt_required!==true
    || row.effect_reexecution_authorized!==false
    || row.retry_authorized!==false
    || row.reconciliation_is_release_authority!==false
  )throw new Error('rsi_effect_reconcile_policy_invalid');
  const command=verifyRsiReleaseEffectCommandReadback(row.command_readback);
  const tx=verifyRsiSelfUpdateTransactionReadback(row.transaction_readback);
  const successor=row.successor_runtime_readback==null?null:verifyRsiSuccessorRuntimeReadback(row.successor_runtime_readback);
  if(command.readback_digest!==row.command_readback_digest||tx.readback_digest!==row.transaction_readback_digest||(successor?.readback_digest||null)!==row.successor_runtime_readback_digest)throw new Error('rsi_effect_reconcile_readback_binding_mismatch');
  if(command.command_id!==row.command_id)throw new Error('rsi_effect_reconcile_command_id_mismatch');
  if(row.result==='CONFIRMED'&&(row.physical_effect_confirmed!==true||row.no_effect_proven!==false||row.ambiguous!==false||row.external_release_authority_convergence_still_required!==true))throw new Error('rsi_effect_reconcile_confirmed_policy_invalid');
  if(row.result==='NO_EFFECT_PROVEN'&&(row.physical_effect_confirmed!==false||row.no_effect_proven!==true||row.ambiguous!==false||row.external_release_authority_convergence_still_required!==false))throw new Error('rsi_effect_reconcile_no_effect_policy_invalid');
  if(row.result==='AMBIGUOUS'&&(row.physical_effect_confirmed!==false||row.no_effect_proven!==false||row.ambiguous!==true||row.external_release_authority_convergence_still_required!==false))throw new Error('rsi_effect_reconcile_ambiguous_policy_invalid');
  const core={...structuredClone(row)};delete core.payload_bytes;delete core.max_payload_bytes;delete core.reconciliation_digest;
  const payloadBytes=bytes(core);
  if(payloadBytes!==Number(row.payload_bytes)||payloadBytes>Number(row.max_payload_bytes)||Number(row.max_payload_bytes)!==MAX_PAYLOAD_BYTES)throw new Error('rsi_effect_reconcile_size_mismatch');
  if(digest(core)!==sha256(row.reconciliation_digest,'reconciliation'))throw new Error('rsi_effect_reconcile_digest_mismatch');
  return row;
}

export function rsiReleaseEffectReconciliationTrustRootSnapshot(){
  const root=zeroAuthority({
    schema:RSI_RELEASE_EFFECT_RECONCILIATION_ROOT_SCHEMA,
    version:1,
    policy_path:'apps/metaengine-browser/src/rsi-release-effect-reconciliation.mjs',
    same_db_command_identity_required:true,
    native_receipt_schema:'metaengine.native-supervisor.command-receipt.v2',
    self_update_transaction_schema:SELF_UPDATE_TRANSACTION_SCHEMA,
    install_effect_barrier:SELF_UPDATE_INSTALL_EFFECT_BARRIER,
    install_effect_scope:SELF_UPDATE_INSTALL_EFFECT_SCOPE,
    install_actuator:SELF_UPDATE_INSTALL_ACTUATOR,
    db_command_completion_is_not_physical_success_proof:true,
    db_authority_effect_is_not_physical_success_proof:true,
    exact_qualified_successor_required_for_confirmed_success:true,
    failed_or_expired_without_effect_barrier_can_prove_no_effect:true,
    installer_started_without_qualified_successor_is_ambiguous:true,
    effect_reexecution_authorized:false,
    retry_authorized:false,
    ambiguous_effect_replay_allowed:false,
    external_release_authority_convergence_required_after_confirmed_success:true,
    max_payload_bytes:MAX_PAYLOAD_BYTES,
    no_second_scheduler:true,
  });
  return Object.freeze({...root,reconciliation_root_digest:digest(root)});
}
