import crypto from 'node:crypto';

import {
  verifyRsiSelfUpdateDownloadReadiness,
} from './rsi-self-update-download-readiness.mjs';
import {
  SELF_UPDATE_TRANSACTION_SCHEMA,
} from './self-update-transaction-journal.mjs';

export const RSI_SELF_UPDATE_RESTART_GATE_PROBE_ADMISSION_SCHEMA =
  'metaengine.rsi.self-update-restart-gate-probe-admission.v1';

const SHA40=/^[0-9a-f]{40}$/;
const SHA256=/^sha256:[0-9a-f]{64}$/;
const UTC=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const SAFE_ID=/^[A-Za-z0-9][A-Za-z0-9._:@/-]{2,255}$/;

function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.keys(value).sort().map((key)=>[key,stable(value[key])]));
}
function digest(value){
  return 'sha256:'+crypto.createHash('sha256').update(JSON.stringify(stable(value)),'utf8').digest('hex');
}
function exactSha(value,label){
  const out=String(value||'').trim().toLowerCase();
  if(!SHA40.test(out))throw new Error('rsi_restart_probe_'+label+'_sha_invalid');
  return out;
}
function exactDigest(value,label){
  const out=String(value||'').trim().toLowerCase();
  if(!SHA256.test(out))throw new Error('rsi_restart_probe_'+label+'_digest_invalid');
  return out;
}
function exactUtc(value,label){
  const out=String(value||'');
  if(!UTC.test(out)||!Number.isFinite(Date.parse(out)))throw new Error('rsi_restart_probe_'+label+'_time_invalid');
  return new Date(Date.parse(out)).toISOString();
}
function safeId(value,label){
  const out=String(value||'').trim();
  if(!SAFE_ID.test(out))throw new Error('rsi_restart_probe_'+label+'_invalid');
  return out;
}
function assertZero(value,label){
  for(const field of [
    'execution_authority','browser_authority','scheduler_authority','task_authority',
    'production_mutation_authority','promotion_authority','release_authority',
    'self_update_authority','authority_effect',
  ]){
    if(Object.hasOwn(value||{},field)&&value[field]!==false){
      throw new Error('rsi_restart_probe_'+label+'_'+field+'_invalid');
    }
  }
  if(Object.hasOwn(value||{},'automatic_retry_allowed')&&value.automatic_retry_allowed!==false){
    throw new Error('rsi_restart_probe_'+label+'_automatic_retry_invalid');
  }
}
function zero(extra={}){
  return Object.freeze({
    ...extra,
    execution_authority:false,browser_authority:false,scheduler_authority:false,task_authority:false,
    production_mutation_authority:false,promotion_authority:false,release_authority:false,
    self_update_authority:false,automatic_retry_allowed:false,authority_effect:false,
  });
}

function verifyHost(host){
  if(!host||typeof host!=='object'||Array.isArray(host)||host.schema!=='metaengine.host-resilience-runtime.v7'){
    throw new Error('rsi_restart_probe_host_schema_invalid');
  }
  if(host.authority_effect!==false)throw new Error('rsi_restart_probe_host_authority_invalid');
  if(
    host.state!=='ACTIVE'
    ||host.external_stop_requested!==false
    ||host.sentinel_worker_healthy!==true
    ||host.sentinel?.worker_ready!==true
    ||host.sentinel_bootstrap_retry_pending===true
  )throw new Error('rsi_restart_probe_host_not_ready');
  return Object.freeze({
    schema:host.schema,state:'ACTIVE',external_stop_requested:false,
    sentinel_worker_healthy:true,sentinel_worker_ready:true,sentinel_bootstrap_retry_pending:false,
    snapshot_digest:digest(host),authority_effect:false,
  });
}

function verifyPrior(prior,readiness){
  const expected=readiness?.prior_transaction;
  if(prior==null){
    if(expected?.present!==false||expected?.state!=='NONE'){
      throw new Error('rsi_restart_probe_prior_transaction_drift');
    }
    return Object.freeze({present:false,state:'NONE',transaction_id:null,target_version:null,authority_effect:false});
  }
  if(!prior||typeof prior!=='object'||Array.isArray(prior)||prior.schema!==SELF_UPDATE_TRANSACTION_SCHEMA){
    throw new Error('rsi_restart_probe_prior_transaction_schema_invalid');
  }
  if(prior.authority_effect!==false||prior.automatic_retry_allowed!==false){
    throw new Error('rsi_restart_probe_prior_transaction_authority_invalid');
  }
  const state=String(prior.state||'').toUpperCase();
  if(!['QUALIFIED','SUPERSEDED'].includes(state))throw new Error('rsi_restart_probe_unresolved_prior:'+state);
  const transactionId=safeId(prior.transaction_id,'prior_transaction_id');
  const targetVersion=prior.target_version==null?null:String(prior.target_version);
  if(
    expected?.present!==true
    ||expected.state!==state
    ||expected.transaction_id!==transactionId
    ||expected.target_version!==targetVersion
  )throw new Error('rsi_restart_probe_prior_transaction_drift');
  return Object.freeze({present:true,state,transaction_id:transactionId,target_version:targetVersion,authority_effect:false});
}

function verifyFreshRuntime(snapshot,readiness,host){
  if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot)||snapshot.schema!=='metaengine.self-update-runtime.v8'){
    throw new Error('rsi_restart_probe_runtime_schema_invalid');
  }
  if(snapshot.authority_effect!==false)throw new Error('rsi_restart_probe_runtime_authority_invalid');
  if(
    snapshot.state!=='READY_RESTART'
    ||snapshot.current_version!==readiness.runtime.current_version
    ||snapshot.available_version!==readiness.target_release_version
    ||snapshot.downloaded_version!==readiness.target_release_version
    ||snapshot.metadata_verified!==true
    ||snapshot.publisher_verified!==true
    ||snapshot.release_resolution!=='VERIFIED'
    ||snapshot.resolved_tag!==readiness.target_release_tag
    ||exactSha(snapshot.resolved_git_sha,'resolved_source')!==readiness.candidate_sha
    ||snapshot.resolved_feed_url!==readiness.trusted_release.feed_url
    ||snapshot.candidate_file_count!==1
    ||Number(snapshot.download_percent)!==100
  )throw new Error('rsi_restart_probe_runtime_binding_invalid');
  if(
    snapshot.control_plane_enabled!==true
    ||snapshot.install_effect_quarantined===true
    ||snapshot.ci_test_feed_active===true
    ||snapshot.developer_emergency_requested===true
    ||snapshot.developer_emergency_policy_bypass===true
  )throw new Error('rsi_restart_probe_runtime_policy_hold');
  if(
    snapshot.install_attempted_version!=null
    ||snapshot.pre_install_receipt_persisted!==false
    ||snapshot.installer_handoff_prepared!==false
    ||snapshot.restart_gate_safe!==false
    ||snapshot.restart_gate_since!=null
  )throw new Error('rsi_restart_probe_effect_already_started');
  if(digest(snapshot.host_resilience)!==host.snapshot_digest){
    throw new Error('rsi_restart_probe_host_binding_mismatch');
  }
  return Object.freeze({
    schema:snapshot.schema,state:'READY_RESTART',
    current_version:snapshot.current_version,
    target_version:snapshot.downloaded_version,
    resolved_git_sha:snapshot.resolved_git_sha,
    restart_gate_safe:false,restart_gate_since:null,
    install_attempted_version:null,pre_install_receipt_persisted:false,
    installer_handoff_prepared:false,
    runtime_snapshot_digest:digest(snapshot),
    authority_effect:false,
  });
}

export function createRsiSelfUpdateRestartGateProbeAdmission({
  download_readiness,
  fresh_runtime_snapshot,
  prior_transaction=null,
  observed_at,
  observer_id,
}={}){
  const readiness=verifyRsiSelfUpdateDownloadReadiness(download_readiness);
  const host=verifyHost(fresh_runtime_snapshot?.host_resilience);
  const runtime=verifyFreshRuntime(fresh_runtime_snapshot,readiness,host);
  const prior=verifyPrior(prior_transaction,readiness);

  const core=zero({
    schema:RSI_SELF_UPDATE_RESTART_GATE_PROBE_ADMISSION_SCHEMA,
    version:1,
    state:'READY_FOR_EXTERNAL_RESTART_GATE_PROBE',
    download_readiness_digest:readiness.readiness_digest,
    candidate_sha:readiness.candidate_sha,
    previous_authority_sha:readiness.previous_authority_sha,
    target_release_tag:readiness.target_release_tag,
    target_release_version:readiness.target_release_version,
    observed_at:exactUtc(observed_at,'observed_at'),
    observer_id:safeId(observer_id,'observer_id'),
    runtime,
    prior_transaction:prior,
    host_resilience:host,
    external_self_update_controller_required:true,
    existing_self_update_runtime_method:'applyWhenSafe',
    admitted_cycle_count:1,
    single_probe_cycle_only:true,
    precondition_restart_gate_safe:false,
    precondition_restart_gate_since:null,
    precondition_install_attempt_absent:true,
    first_cycle_installer_launch_forbidden_by_verified_state:true,
    allowed_post_probe_states:Object.freeze(['READY_RESTART','RESTART_GRACE']),
    post_probe_runtime_readback_required:true,
    post_probe_prior_transaction_readback_required:true,
    post_probe_host_resilience_readback_required:true,
    probe_cycle_invoked:false,
    probe_cycle_authorized_by_rsi:false,
    restart_authorized:false,
    pre_install_receipt_authorized:false,
    installer_handoff_authorized:false,
    installer_launch_authorized:false,
    second_cycle_authorized:false,
    physical_effect_replay_allowed:false,
  });
  return Object.freeze({...core,probe_admission_digest:digest(core)});
}

export function verifyRsiSelfUpdateRestartGateProbeAdmission(row){
  if(
    !row||typeof row!=='object'||Array.isArray(row)
    ||row.schema!==RSI_SELF_UPDATE_RESTART_GATE_PROBE_ADMISSION_SCHEMA||row.version!==1
  )throw new Error('rsi_restart_probe_schema_invalid');
  assertZero(row,'admission');
  if(
    row.state!=='READY_FOR_EXTERNAL_RESTART_GATE_PROBE'
    ||row.external_self_update_controller_required!==true
    ||row.existing_self_update_runtime_method!=='applyWhenSafe'
    ||row.admitted_cycle_count!==1
    ||row.single_probe_cycle_only!==true
    ||row.precondition_restart_gate_safe!==false
    ||row.precondition_restart_gate_since!==null
    ||row.precondition_install_attempt_absent!==true
    ||row.first_cycle_installer_launch_forbidden_by_verified_state!==true
    ||JSON.stringify(row.allowed_post_probe_states)!==JSON.stringify(['READY_RESTART','RESTART_GRACE'])
    ||row.post_probe_runtime_readback_required!==true
    ||row.post_probe_prior_transaction_readback_required!==true
    ||row.post_probe_host_resilience_readback_required!==true
    ||row.probe_cycle_invoked!==false
    ||row.probe_cycle_authorized_by_rsi!==false
    ||row.restart_authorized!==false
    ||row.pre_install_receipt_authorized!==false
    ||row.installer_handoff_authorized!==false
    ||row.installer_launch_authorized!==false
    ||row.second_cycle_authorized!==false
    ||row.physical_effect_replay_allowed!==false
  )throw new Error('rsi_restart_probe_policy_invalid');

  exactDigest(row.download_readiness_digest,'download_readiness');
  exactSha(row.candidate_sha,'candidate');
  exactSha(row.previous_authority_sha,'previous_authority');
  exactUtc(row.observed_at,'observed_at');
  safeId(row.observer_id,'observer_id');
  if(
    row.runtime?.state!=='READY_RESTART'
    ||row.runtime?.restart_gate_safe!==false
    ||row.runtime?.restart_gate_since!==null
    ||row.runtime?.install_attempted_version!==null
    ||row.runtime?.pre_install_receipt_persisted!==false
    ||row.runtime?.installer_handoff_prepared!==false
  )throw new Error('rsi_restart_probe_runtime_summary_invalid');
  if(
    row.host_resilience?.state!=='ACTIVE'
    ||row.host_resilience?.sentinel_worker_healthy!==true
    ||row.host_resilience?.sentinel_worker_ready!==true
  )throw new Error('rsi_restart_probe_host_summary_invalid');
  if(!['NONE','QUALIFIED','SUPERSEDED'].includes(row.prior_transaction?.state)){
    throw new Error('rsi_restart_probe_prior_summary_invalid');
  }

  const clone=structuredClone(row);
  const claimed=exactDigest(clone.probe_admission_digest,'probe_admission');
  delete clone.probe_admission_digest;
  if(digest(clone)!==claimed)throw new Error('rsi_restart_probe_digest_mismatch');
  return row;
}

export function rsiSelfUpdateRestartGateProbeTrustRootSnapshot(){
  const root={
    schema:'metaengine.rsi.self-update-restart-gate-probe-root.v1',
    version:1,
    adapter_path:'apps/metaengine-browser/src/rsi-self-update-restart-gate-probe-admission.mjs',
    download_readiness_path:'apps/metaengine-browser/src/rsi-self-update-download-readiness.mjs',
    self_update_runtime_path:'apps/metaengine-browser/src/self-update-runtime-v8.mjs',
    self_update_runtime_contract_test_path:'apps/metaengine-browser/test/self-update-runtime.test.mjs',
    transaction_journal_path:'apps/metaengine-browser/src/self-update-transaction-journal.mjs',
    host_resilience_runtime_path:'apps/metaengine-browser/src/host-resilience-runtime.mjs',
    precondition_ready_restart:true,
    precondition_restart_gate_clear:true,
    single_probe_cycle_only:true,
    first_cycle_must_not_launch_installer:true,
    post_probe_readback_required:true,
    external_self_update_controller_required:true,
    probe_cycle_authorized_by_rsi:false,
    second_cycle_authorized:false,
    installer_launch_authorized:false,
    candidate_can_modify_probe_root:false,
    physical_effect_replay_allowed:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,
    release_authority:false,self_update_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...root,restart_gate_probe_root_digest:digest(root)});
}
