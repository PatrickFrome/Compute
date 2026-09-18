import crypto from 'node:crypto';

import {
  verifyRsiSelfUpdateRestartGateProbeAdmission,
} from './rsi-self-update-restart-gate-probe-admission.mjs';
import {
  SELF_UPDATE_TRANSACTION_SCHEMA,
} from './self-update-transaction-journal.mjs';

export const RSI_SELF_UPDATE_RESTART_GATE_PROBE_INVOCATION_SCHEMA =
  'metaengine.rsi.self-update-restart-gate-probe-invocation.v1';
export const RSI_SELF_UPDATE_RESTART_GATE_PROBE_OUTCOME_SCHEMA =
  'metaengine.rsi.self-update-restart-gate-probe-outcome.v1';

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
function exactDigest(value,label){
  const out=String(value||'').trim().toLowerCase();
  if(!SHA256.test(out))throw new Error('rsi_restart_outcome_'+label+'_digest_invalid');
  return out;
}
function exactUtc(value,label){
  const out=String(value||'');
  if(!UTC.test(out)||!Number.isFinite(Date.parse(out)))throw new Error('rsi_restart_outcome_'+label+'_time_invalid');
  return new Date(Date.parse(out)).toISOString();
}
function safeId(value,label){
  const out=String(value||'').trim();
  if(!SAFE_ID.test(out))throw new Error('rsi_restart_outcome_'+label+'_invalid');
  return out;
}
function assertZero(value,label){
  for(const field of [
    'execution_authority','browser_authority','scheduler_authority','task_authority',
    'production_mutation_authority','promotion_authority','release_authority',
    'self_update_authority','authority_effect',
  ]){
    if(Object.hasOwn(value||{},field)&&value[field]!==false){
      throw new Error('rsi_restart_outcome_'+label+'_'+field+'_invalid');
    }
  }
  if(Object.hasOwn(value||{},'automatic_retry_allowed')&&value.automatic_retry_allowed!==false){
    throw new Error('rsi_restart_outcome_'+label+'_automatic_retry_invalid');
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
function positive(value,label){
  const out=Number(value);
  if(!Number.isSafeInteger(out)||out<1)throw new Error('rsi_restart_outcome_'+label+'_invalid');
  return out;
}

export function createRsiSelfUpdateRestartGateProbeInvocation({
  probe_admission,
  invoked_at,
  controller_id,
  post_runtime_snapshot_digest,
  external_controller_verified=false,
  authored_by_candidate=true,
}={}){
  const admission=verifyRsiSelfUpdateRestartGateProbeAdmission(probe_admission);
  if(external_controller_verified!==true||authored_by_candidate!==false){
    throw new Error('rsi_restart_outcome_external_controller_required');
  }
  const core=zero({
    schema:RSI_SELF_UPDATE_RESTART_GATE_PROBE_INVOCATION_SCHEMA,
    version:1,
    probe_admission_digest:admission.probe_admission_digest,
    candidate_sha:admission.candidate_sha,
    invoked_at:exactUtc(invoked_at,'invoked_at'),
    controller_id:safeId(controller_id,'controller_id'),
    runtime_method:'applyWhenSafe',
    invocation_count:1,
    pre_runtime_snapshot_digest:admission.runtime.runtime_snapshot_digest,
    post_runtime_snapshot_digest:exactDigest(post_runtime_snapshot_digest,'post_runtime_snapshot'),
    external_controller_verified:true,
    authored_by_candidate:false,
    physical_effect_attempted:false,
    quit_and_install_called:false,
    pre_install_receipt_persisted:false,
    installer_handoff_prepared:false,
    restart_effect_performed:false,
    second_cycle_invoked:false,
    physical_effect_replay_allowed:false,
  });
  return Object.freeze({...core,invocation_digest:digest(core)});
}

export function verifyRsiSelfUpdateRestartGateProbeInvocation(row,{probe_admission}={}){
  if(
    !row||typeof row!=='object'||Array.isArray(row)
    ||row.schema!==RSI_SELF_UPDATE_RESTART_GATE_PROBE_INVOCATION_SCHEMA||row.version!==1
  )throw new Error('rsi_restart_outcome_invocation_schema_invalid');
  assertZero(row,'invocation');
  const admission=verifyRsiSelfUpdateRestartGateProbeAdmission(probe_admission);
  if(
    row.probe_admission_digest!==admission.probe_admission_digest
    ||row.candidate_sha!==admission.candidate_sha
    ||row.runtime_method!=='applyWhenSafe'
    ||row.invocation_count!==1
    ||row.pre_runtime_snapshot_digest!==admission.runtime.runtime_snapshot_digest
    ||row.external_controller_verified!==true
    ||row.authored_by_candidate!==false
    ||row.physical_effect_attempted!==false
    ||row.quit_and_install_called!==false
    ||row.pre_install_receipt_persisted!==false
    ||row.installer_handoff_prepared!==false
    ||row.restart_effect_performed!==false
    ||row.second_cycle_invoked!==false
    ||row.physical_effect_replay_allowed!==false
  )throw new Error('rsi_restart_outcome_invocation_policy_invalid');
  exactUtc(row.invoked_at,'invoked_at');
  safeId(row.controller_id,'controller_id');
  exactDigest(row.post_runtime_snapshot_digest,'post_runtime_snapshot');
  const clone=structuredClone(row);
  const claimed=exactDigest(clone.invocation_digest,'invocation');
  delete clone.invocation_digest;
  if(digest(clone)!==claimed)throw new Error('rsi_restart_outcome_invocation_digest_mismatch');
  return row;
}

function verifyHost(host){
  if(!host||typeof host!=='object'||Array.isArray(host)||host.schema!=='metaengine.host-resilience-runtime.v7'){
    throw new Error('rsi_restart_outcome_host_schema_invalid');
  }
  if(host.authority_effect!==false)throw new Error('rsi_restart_outcome_host_authority_invalid');
  if(
    host.state!=='ACTIVE'||host.external_stop_requested!==false
    ||host.sentinel_worker_healthy!==true||host.sentinel?.worker_ready!==true
    ||host.sentinel_bootstrap_retry_pending===true
  )throw new Error('rsi_restart_outcome_host_not_ready');
  return Object.freeze({
    schema:host.schema,state:'ACTIVE',external_stop_requested:false,
    sentinel_worker_healthy:true,sentinel_worker_ready:true,sentinel_bootstrap_retry_pending:false,
    snapshot_digest:digest(host),authority_effect:false,
  });
}

function verifyPrior(prior,admission){
  const expected=admission.prior_transaction;
  if(prior==null){
    if(expected?.present!==false||expected?.state!=='NONE')throw new Error('rsi_restart_outcome_prior_transaction_drift');
    return Object.freeze({present:false,state:'NONE',transaction_id:null,target_version:null,authority_effect:false});
  }
  if(!prior||typeof prior!=='object'||Array.isArray(prior)||prior.schema!==SELF_UPDATE_TRANSACTION_SCHEMA){
    throw new Error('rsi_restart_outcome_prior_transaction_schema_invalid');
  }
  if(prior.authority_effect!==false||prior.automatic_retry_allowed!==false){
    throw new Error('rsi_restart_outcome_prior_transaction_authority_invalid');
  }
  const state=String(prior.state||'').toUpperCase();
  if(!['QUALIFIED','SUPERSEDED'].includes(state))throw new Error('rsi_restart_outcome_unresolved_prior:'+state);
  const transactionId=safeId(prior.transaction_id,'prior_transaction_id');
  const targetVersion=prior.target_version==null?null:String(prior.target_version);
  if(
    expected?.present!==true||expected.state!==state
    ||expected.transaction_id!==transactionId||expected.target_version!==targetVersion
  )throw new Error('rsi_restart_outcome_prior_transaction_drift');
  return Object.freeze({present:true,state,transaction_id:transactionId,target_version:targetVersion,authority_effect:false});
}

function verifyPostRuntime(snapshot,admission,host,observedAt){
  if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot)||snapshot.schema!=='metaengine.self-update-runtime.v8'){
    throw new Error('rsi_restart_outcome_runtime_schema_invalid');
  }
  if(snapshot.authority_effect!==false)throw new Error('rsi_restart_outcome_runtime_authority_invalid');
  if(!['READY_RESTART','RESTART_GRACE'].includes(snapshot.state)){
    throw new Error('rsi_restart_outcome_runtime_state_invalid');
  }
  if(
    snapshot.current_version!==admission.runtime.current_version
    ||snapshot.available_version!==admission.target_release_version
    ||snapshot.downloaded_version!==admission.target_release_version
    ||snapshot.resolved_git_sha!==admission.candidate_sha
    ||snapshot.metadata_verified!==true||snapshot.publisher_verified!==true
    ||snapshot.release_resolution!=='VERIFIED'
    ||snapshot.resolved_tag!==admission.target_release_tag
    ||snapshot.candidate_file_count!==1||Number(snapshot.download_percent)!==100
  )throw new Error('rsi_restart_outcome_runtime_binding_invalid');
  if(
    snapshot.control_plane_enabled!==true||snapshot.install_effect_quarantined===true
    ||snapshot.ci_test_feed_active===true||snapshot.developer_emergency_requested===true
    ||snapshot.developer_emergency_policy_bypass===true
    ||snapshot.install_attempted_version!=null||snapshot.pre_install_receipt_persisted!==false
    ||snapshot.installer_handoff_prepared!==false
  )throw new Error('rsi_restart_outcome_effect_or_policy_drift');
  if(digest(snapshot.host_resilience)!==host.snapshot_digest){
    throw new Error('rsi_restart_outcome_host_binding_mismatch');
  }

  if(snapshot.state==='READY_RESTART'){
    if(snapshot.restart_gate_safe!==false||snapshot.restart_gate_since!=null){
      throw new Error('rsi_restart_outcome_ready_restart_gate_state_invalid');
    }
    return Object.freeze({
      state:'HOLD_RESTART_GATE_UNSAFE',runtime_state:'READY_RESTART',
      restart_gate_safe:false,restart_gate_since:null,
      restart_grace_ms:positive(snapshot.restart_grace_ms||admission?.runtime?.restart_grace_ms||1,'restart_grace_ms'),
      grace_elapsed_ms:0,grace_satisfied:false,
      runtime_snapshot_digest:digest(snapshot),authority_effect:false,
    });
  }

  if(snapshot.restart_gate_safe!==true||snapshot.restart_gate_since==null){
    throw new Error('rsi_restart_outcome_restart_grace_state_invalid');
  }
  const since=Date.parse(exactUtc(snapshot.restart_gate_since,'restart_gate_since'));
  const observed=Date.parse(observedAt);
  if(since>observed)throw new Error('rsi_restart_outcome_restart_gate_future');
  const grace=positive(snapshot.restart_grace_ms,'restart_grace_ms');
  const elapsed=observed-since;
  return Object.freeze({
    state:elapsed>=grace?'READY_FOR_EXTERNAL_INSTALL_CYCLE_REVIEW':'WAITING_RESTART_GRACE',
    runtime_state:'RESTART_GRACE',restart_gate_safe:true,
    restart_gate_since:new Date(since).toISOString(),restart_grace_ms:grace,
    grace_elapsed_ms:elapsed,grace_satisfied:elapsed>=grace,
    runtime_snapshot_digest:digest(snapshot),authority_effect:false,
  });
}

export function createRsiSelfUpdateRestartGateProbeOutcome({
  probe_admission,
  invocation_receipt,
  post_probe_runtime_snapshot,
  prior_transaction=null,
  observed_at,
  observer_id,
}={}){
  const admission=verifyRsiSelfUpdateRestartGateProbeAdmission(probe_admission);
  const observedAt=exactUtc(observed_at,'observed_at');
  const invocation=verifyRsiSelfUpdateRestartGateProbeInvocation(invocation_receipt,{probe_admission:admission});
  const host=verifyHost(post_probe_runtime_snapshot?.host_resilience);
  const runtime=verifyPostRuntime(post_probe_runtime_snapshot,admission,host,observedAt);
  const prior=verifyPrior(prior_transaction,admission);
  if(invocation.post_runtime_snapshot_digest!==runtime.runtime_snapshot_digest){
    throw new Error('rsi_restart_outcome_invocation_post_snapshot_mismatch');
  }
  if(Date.parse(invocation.invoked_at)>Date.parse(observedAt)){
    throw new Error('rsi_restart_outcome_invocation_after_observation');
  }

  const ready=runtime.state==='READY_FOR_EXTERNAL_INSTALL_CYCLE_REVIEW';
  const core=zero({
    schema:RSI_SELF_UPDATE_RESTART_GATE_PROBE_OUTCOME_SCHEMA,
    version:1,
    state:runtime.state,
    probe_admission_digest:admission.probe_admission_digest,
    probe_invocation_digest:invocation.invocation_digest,
    candidate_sha:admission.candidate_sha,
    previous_authority_sha:admission.previous_authority_sha,
    target_release_tag:admission.target_release_tag,
    target_release_version:admission.target_release_version,
    observed_at:observedAt,
    observer_id:safeId(observer_id,'observer_id'),
    runtime,
    prior_transaction:prior,
    host_resilience:host,
    single_probe_cycle_verified:true,
    no_physical_effect_verified:true,
    no_pre_install_receipt_verified:true,
    no_installer_handoff_verified:true,
    no_installer_launch_verified:true,
    restart_gate_safe:runtime.restart_gate_safe,
    restart_grace_satisfied:runtime.grace_satisfied,
    ready_for_external_install_cycle_review:ready,
    external_self_update_controller_required:true,
    existing_self_update_runtime_method:'applyWhenSafe',
    install_cycle_invoked:false,
    install_cycle_authorized_by_rsi:false,
    final_runtime_revalidation_required:true,
    final_prior_transaction_revalidation_required:true,
    final_host_resilience_revalidation_required:true,
    transaction_write_ahead_barrier_required:true,
    installer_launch_authorized:false,
    physical_effect_replay_allowed:false,
  });
  return Object.freeze({...core,outcome_digest:digest(core)});
}

export function verifyRsiSelfUpdateRestartGateProbeOutcome(row){
  if(
    !row||typeof row!=='object'||Array.isArray(row)
    ||row.schema!==RSI_SELF_UPDATE_RESTART_GATE_PROBE_OUTCOME_SCHEMA||row.version!==1
  )throw new Error('rsi_restart_outcome_schema_invalid');
  assertZero(row,'outcome');
  if(!['HOLD_RESTART_GATE_UNSAFE','WAITING_RESTART_GRACE','READY_FOR_EXTERNAL_INSTALL_CYCLE_REVIEW'].includes(row.state)){
    throw new Error('rsi_restart_outcome_state_invalid');
  }
  if(
    row.single_probe_cycle_verified!==true||row.no_physical_effect_verified!==true
    ||row.no_pre_install_receipt_verified!==true||row.no_installer_handoff_verified!==true
    ||row.no_installer_launch_verified!==true
    ||row.ready_for_external_install_cycle_review!==(row.state==='READY_FOR_EXTERNAL_INSTALL_CYCLE_REVIEW')
    ||row.external_self_update_controller_required!==true
    ||row.existing_self_update_runtime_method!=='applyWhenSafe'
    ||row.install_cycle_invoked!==false||row.install_cycle_authorized_by_rsi!==false
    ||row.final_runtime_revalidation_required!==true
    ||row.final_prior_transaction_revalidation_required!==true
    ||row.final_host_resilience_revalidation_required!==true
    ||row.transaction_write_ahead_barrier_required!==true
    ||row.installer_launch_authorized!==false||row.physical_effect_replay_allowed!==false
  )throw new Error('rsi_restart_outcome_policy_invalid');
  exactDigest(row.probe_admission_digest,'probe_admission');
  exactDigest(row.probe_invocation_digest,'probe_invocation');
  exactUtc(row.observed_at,'observed_at');
  safeId(row.observer_id,'observer_id');
  if(row.state==='READY_FOR_EXTERNAL_INSTALL_CYCLE_REVIEW'&&row.restart_grace_satisfied!==true){
    throw new Error('rsi_restart_outcome_ready_without_grace');
  }
  if(row.state!=='READY_FOR_EXTERNAL_INSTALL_CYCLE_REVIEW'&&row.ready_for_external_install_cycle_review!==false){
    throw new Error('rsi_restart_outcome_hold_marked_ready');
  }
  const clone=structuredClone(row);
  const claimed=exactDigest(clone.outcome_digest,'outcome');
  delete clone.outcome_digest;
  if(digest(clone)!==claimed)throw new Error('rsi_restart_outcome_digest_mismatch');
  return row;
}

export function rsiSelfUpdateRestartGateProbeOutcomeTrustRootSnapshot(){
  const root={
    schema:'metaengine.rsi.self-update-restart-gate-probe-outcome-root.v1',
    version:1,
    adapter_path:'apps/metaengine-browser/src/rsi-self-update-restart-gate-probe-outcome.mjs',
    probe_admission_path:'apps/metaengine-browser/src/rsi-self-update-restart-gate-probe-admission.mjs',
    self_update_runtime_path:'apps/metaengine-browser/src/self-update-runtime-v8.mjs',
    transaction_journal_path:'apps/metaengine-browser/src/self-update-transaction-journal.mjs',
    external_probe_invocation_receipt_required:true,
    candidate_authored_probe_receipt_forbidden:true,
    single_probe_cycle_required:true,
    no_physical_effect_during_probe_required:true,
    restart_grace_observation_required:true,
    restart_grace_elapsed_required_before_install_review:true,
    final_revalidation_required:true,
    transaction_write_ahead_barrier_required:true,
    install_cycle_authorized_by_rsi:false,
    installer_launch_authorized:false,
    candidate_can_modify_outcome_root:false,
    physical_effect_replay_allowed:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,
    release_authority:false,self_update_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...root,restart_gate_probe_outcome_root_digest:digest(root)});
}
