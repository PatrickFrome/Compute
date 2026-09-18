import crypto from 'node:crypto';

import { verifyRsiSelfUpdateDownloadReadiness } from './rsi-self-update-download-readiness.mjs';
import { verifyRsiSelfUpdateRestartGateProbeAdmission } from './rsi-self-update-restart-gate-probe-admission.mjs';
import { verifyRsiSelfUpdateRestartGateProbeOutcome } from './rsi-self-update-restart-gate-probe-outcome.mjs';
import {
  SELF_UPDATE_TRANSACTION_SCHEMA,
  SELF_UPDATE_INSTALL_EFFECT_BARRIER,
  SELF_UPDATE_INSTALL_EFFECT_SCOPE,
  SELF_UPDATE_INSTALL_ACTUATOR,
} from './self-update-transaction-journal.mjs';

export const RSI_SELF_UPDATE_FINAL_INSTALL_CYCLE_ADMISSION_SCHEMA =
  'metaengine.rsi.self-update-final-install-cycle-admission.v1';

const SHA40=/^[0-9a-f]{40}$/;
const SHA256=/^sha256:[0-9a-f]{64}$/;
const HEX64=/^[0-9a-f]{64}$/;
const UTC=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const SAFE_ID=/^[A-Za-z0-9][A-Za-z0-9._:@/-]{2,255}$/;

function stable(v){
  if(Array.isArray(v))return v.map(stable);
  if(!v||typeof v!=='object')return v;
  return Object.fromEntries(Object.keys(v).sort().map((k)=>[k,stable(v[k])]));
}
function digest(v){
  return 'sha256:'+crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex');
}
function exactSha(v,l){
  const o=String(v||'').trim().toLowerCase();
  if(!SHA40.test(o))throw new Error('rsi_final_install_'+l+'_sha_invalid');
  return o;
}
function exactDigest(v,l){
  const o=String(v||'').trim().toLowerCase();
  if(!SHA256.test(o))throw new Error('rsi_final_install_'+l+'_digest_invalid');
  return o;
}
function exactHex(v,l){
  const o=String(v||'').trim().toLowerCase().replace(/^sha256:/,'');
  if(!HEX64.test(o))throw new Error('rsi_final_install_'+l+'_digest_invalid');
  return o;
}
function exactUtc(v,l){
  const o=String(v||'');
  if(!UTC.test(o)||!Number.isFinite(Date.parse(o)))throw new Error('rsi_final_install_'+l+'_time_invalid');
  return new Date(Date.parse(o)).toISOString();
}
function safeId(v,l){
  const o=String(v||'').trim();
  if(!SAFE_ID.test(o))throw new Error('rsi_final_install_'+l+'_invalid');
  return o;
}
function assertZero(v,l){
  for(const f of [
    'execution_authority','browser_authority','scheduler_authority','task_authority',
    'production_mutation_authority','promotion_authority','release_authority',
    'self_update_authority','authority_effect',
  ]){
    if(Object.hasOwn(v||{},f)&&v[f]!==false)throw new Error('rsi_final_install_'+l+'_'+f+'_invalid');
  }
  if(Object.hasOwn(v||{},'automatic_retry_allowed')&&v.automatic_retry_allowed!==false){
    throw new Error('rsi_final_install_'+l+'_automatic_retry_invalid');
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
function positive(v,l){
  const n=Number(v);
  if(!Number.isSafeInteger(n)||n<1)throw new Error('rsi_final_install_'+l+'_invalid');
  return n;
}

function verifyHost(host){
  if(!host||typeof host!=='object'||Array.isArray(host)||host.schema!=='metaengine.host-resilience-runtime.v7'){
    throw new Error('rsi_final_install_host_schema_invalid');
  }
  if(host.authority_effect!==false)throw new Error('rsi_final_install_host_authority_invalid');
  if(
    host.state!=='ACTIVE'||host.external_stop_requested!==false
    ||host.sentinel_worker_healthy!==true||host.sentinel?.worker_ready!==true
    ||host.sentinel_bootstrap_retry_pending===true
  )throw new Error('rsi_final_install_host_not_ready');
  return Object.freeze({
    schema:host.schema,state:'ACTIVE',external_stop_requested:false,
    sentinel_worker_healthy:true,sentinel_worker_ready:true,sentinel_bootstrap_retry_pending:false,
    snapshot_digest:digest(host),authority_effect:false,
  });
}

function verifyPrior(prior,outcome){
  const expected=outcome.prior_transaction;
  if(prior==null){
    if(expected?.present!==false||expected?.state!=='NONE')throw new Error('rsi_final_install_prior_transaction_drift');
    return Object.freeze({present:false,state:'NONE',transaction_id:null,target_version:null,authority_effect:false});
  }
  if(!prior||typeof prior!=='object'||Array.isArray(prior)||prior.schema!==SELF_UPDATE_TRANSACTION_SCHEMA){
    throw new Error('rsi_final_install_prior_transaction_schema_invalid');
  }
  if(prior.authority_effect!==false||prior.automatic_retry_allowed!==false){
    throw new Error('rsi_final_install_prior_transaction_authority_invalid');
  }
  const state=String(prior.state||'').toUpperCase();
  if(!['QUALIFIED','SUPERSEDED'].includes(state))throw new Error('rsi_final_install_unresolved_prior:'+state);
  const transactionId=safeId(prior.transaction_id,'prior_transaction_id');
  const targetVersion=prior.target_version==null?null:String(prior.target_version);
  if(
    expected?.present!==true||expected.state!==state
    ||expected.transaction_id!==transactionId||expected.target_version!==targetVersion
  )throw new Error('rsi_final_install_prior_transaction_drift');
  return Object.freeze({present:true,state,transaction_id:transactionId,target_version:targetVersion,authority_effect:false});
}

function verifyRelease(release,readiness){
  if(!release||typeof release!=='object'||Array.isArray(release)||release.schema!=='metaengine.trusted-dev-release.v1'){
    throw new Error('rsi_final_install_trusted_release_invalid');
  }
  if(release.authority_effect!==false)throw new Error('rsi_final_install_trusted_release_authority_invalid');
  if(
    release.version!==readiness.target_release_version
    ||release.tag!==readiness.target_release_tag
    ||exactSha(release.git_sha,'release_source')!==readiness.candidate_sha
    ||'sha256:'+exactHex(release.installer_sha256,'installer')!==readiness.target_installer_sha256
    ||'sha256:'+exactHex(release.manifest_sha256,'manifest')!==readiness.target_manifest_sha256
    ||'sha256:'+exactHex(release.installed_executable_sha256,'installed_executable')!==readiness.target_installed_executable_sha256
    ||release.target_present_proof_supported!==true
  )throw new Error('rsi_final_install_trusted_release_mismatch');
  return Object.freeze({
    schema:release.schema,version:release.version,tag:release.tag,git_sha:readiness.candidate_sha,
    installer_name:String(release.installer_name||''),
    installer_sha256:readiness.target_installer_sha256,
    manifest_sha256:readiness.target_manifest_sha256,
    installed_executable_sha256:readiness.target_installed_executable_sha256,
    target_present_proof_supported:true,authority_effect:false,
  });
}

function verifyRuntime(snapshot,readiness,outcome,host,observedAt){
  if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot)||snapshot.schema!=='metaengine.self-update-runtime.v8'){
    throw new Error('rsi_final_install_runtime_schema_invalid');
  }
  if(snapshot.authority_effect!==false)throw new Error('rsi_final_install_runtime_authority_invalid');
  if(
    snapshot.state!=='RESTART_GRACE'
    ||snapshot.current_version!==readiness.runtime.current_version
    ||snapshot.available_version!==readiness.target_release_version
    ||snapshot.downloaded_version!==readiness.target_release_version
    ||snapshot.metadata_verified!==true||snapshot.publisher_verified!==true
    ||snapshot.release_resolution!=='VERIFIED'||snapshot.resolved_tag!==readiness.target_release_tag
    ||exactSha(snapshot.resolved_git_sha,'resolved_source')!==readiness.candidate_sha
    ||snapshot.candidate_file_count!==1||Number(snapshot.download_percent)!==100
  )throw new Error('rsi_final_install_runtime_binding_invalid');
  if(
    snapshot.control_plane_enabled!==true||snapshot.install_effect_quarantined===true
    ||snapshot.ci_test_feed_active===true||snapshot.developer_emergency_requested===true
    ||snapshot.developer_emergency_policy_bypass===true
    ||snapshot.restart_gate_safe!==true||snapshot.restart_gate_since==null
    ||snapshot.install_attempted_version!=null||snapshot.pre_install_receipt_persisted!==false
    ||snapshot.installer_handoff_prepared!==false
  )throw new Error('rsi_final_install_runtime_effect_or_policy_drift');
  if(digest(snapshot.host_resilience)!==host.snapshot_digest)throw new Error('rsi_final_install_host_binding_mismatch');
  const since=Date.parse(exactUtc(snapshot.restart_gate_since,'restart_gate_since'));
  const observed=Date.parse(observedAt);
  if(since>observed)throw new Error('rsi_final_install_restart_gate_future');
  const grace=positive(snapshot.restart_grace_ms,'restart_grace_ms');
  const elapsed=observed-since;
  if(elapsed<grace)throw new Error('rsi_final_install_restart_grace_not_elapsed');
  if(
    outcome.runtime.restart_gate_since!==new Date(since).toISOString()
    ||outcome.runtime.restart_grace_ms!==grace
    ||outcome.restart_grace_satisfied!==true
  )throw new Error('rsi_final_install_probe_outcome_drift');
  return Object.freeze({
    schema:snapshot.schema,state:'RESTART_GRACE',
    current_version:snapshot.current_version,target_version:snapshot.downloaded_version,
    resolved_git_sha:snapshot.resolved_git_sha,restart_gate_safe:true,
    restart_gate_since:new Date(since).toISOString(),restart_grace_ms:grace,
    grace_elapsed_ms:elapsed,install_attempted_version:null,
    pre_install_receipt_persisted:false,installer_handoff_prepared:false,
    runtime_snapshot_digest:digest(snapshot),authority_effect:false,
  });
}

export function createRsiSelfUpdateFinalInstallCycleAdmission({
  probe_outcome,
  probe_admission,
  download_readiness,
  fresh_runtime_snapshot,
  prior_transaction=null,
  trusted_release,
  observed_at,
  observer_id,
}={}){
  const outcome=verifyRsiSelfUpdateRestartGateProbeOutcome(probe_outcome);
  if(
    outcome.state!=='READY_FOR_EXTERNAL_INSTALL_CYCLE_REVIEW'
    ||outcome.ready_for_external_install_cycle_review!==true
  )throw new Error('rsi_final_install_probe_outcome_not_ready');
  const probe=verifyRsiSelfUpdateRestartGateProbeAdmission(probe_admission);
  const readiness=verifyRsiSelfUpdateDownloadReadiness(download_readiness);
  if(
    outcome.probe_admission_digest!==probe.probe_admission_digest
    ||probe.download_readiness_digest!==readiness.readiness_digest
    ||outcome.candidate_sha!==readiness.candidate_sha
    ||probe.candidate_sha!==readiness.candidate_sha
  )throw new Error('rsi_final_install_chain_binding_mismatch');

  const observedAt=exactUtc(observed_at,'observed_at');
  const host=verifyHost(fresh_runtime_snapshot?.host_resilience);
  const prior=verifyPrior(prior_transaction,outcome);
  const release=verifyRelease(trusted_release,readiness);
  const runtime=verifyRuntime(fresh_runtime_snapshot,readiness,outcome,host,observedAt);

  const core=zero({
    schema:RSI_SELF_UPDATE_FINAL_INSTALL_CYCLE_ADMISSION_SCHEMA,
    version:1,
    state:'READY_FOR_EXTERNAL_FINAL_APPLY_INVOCATION_REVIEW',
    probe_outcome_digest:outcome.outcome_digest,
    probe_admission_digest:probe.probe_admission_digest,
    download_readiness_digest:readiness.readiness_digest,
    candidate_sha:readiness.candidate_sha,
    previous_authority_sha:readiness.previous_authority_sha,
    target_release_tag:readiness.target_release_tag,
    target_release_version:readiness.target_release_version,
    target_installer_sha256:readiness.target_installer_sha256,
    target_manifest_sha256:readiness.target_manifest_sha256,
    target_installed_executable_sha256:readiness.target_installed_executable_sha256,
    observed_at:observedAt,observer_id:safeId(observer_id,'observer_id'),
    runtime,prior_transaction:prior,host_resilience:host,trusted_release:release,
    exact_candidate_chain_verified:true,
    restart_gate_safe_reverified:true,
    restart_grace_elapsed_reverified:true,
    no_install_effect_yet_verified:true,
    external_self_update_controller_required:true,
    existing_self_update_runtime_method:'applyWhenSafe',
    admitted_final_cycle_count:1,
    single_final_apply_cycle_only:true,
    final_apply_invoked:false,
    final_apply_authorized_by_rsi:false,
    before_install_receipt_required:true,
    self_update_transaction_schema:SELF_UPDATE_TRANSACTION_SCHEMA,
    install_effect_barrier:SELF_UPDATE_INSTALL_EFFECT_BARRIER,
    install_effect_scope:SELF_UPDATE_INSTALL_EFFECT_SCOPE,
    install_actuator:SELF_UPDATE_INSTALL_ACTUATOR,
    expected_effect_order:Object.freeze([
      'PERSIST_PRE_INSTALL_RECEIPT_AND_TRANSACTION',
      'PREPARE_EXPECTED_RESTART',
      'PREPARE_INSTALLER_HANDOFF',
      'CROSS_WRITE_AHEAD_INSTALL_EFFECT_BARRIER',
      'ELECTRON_QUIT_AND_INSTALL',
    ]),
    one_attempt_physical_effect_required:true,
    post_effect_transaction_readback_required:true,
    successor_startup_readback_required:true,
    ambiguous_install_reconciliation_only:true,
    automatic_install_retry_allowed:false,
    installer_launch_authorized_by_rsi:false,
    physical_effect_replay_allowed:false,
  });
  return Object.freeze({...core,final_install_admission_digest:digest(core)});
}

export function verifyRsiSelfUpdateFinalInstallCycleAdmission(row){
  if(
    !row||typeof row!=='object'||Array.isArray(row)
    ||row.schema!==RSI_SELF_UPDATE_FINAL_INSTALL_CYCLE_ADMISSION_SCHEMA||row.version!==1
  )throw new Error('rsi_final_install_schema_invalid');
  assertZero(row,'admission');
  if(
    row.state!=='READY_FOR_EXTERNAL_FINAL_APPLY_INVOCATION_REVIEW'
    ||row.exact_candidate_chain_verified!==true
    ||row.restart_gate_safe_reverified!==true||row.restart_grace_elapsed_reverified!==true
    ||row.no_install_effect_yet_verified!==true
    ||row.external_self_update_controller_required!==true
    ||row.existing_self_update_runtime_method!=='applyWhenSafe'
    ||row.admitted_final_cycle_count!==1||row.single_final_apply_cycle_only!==true
    ||row.final_apply_invoked!==false||row.final_apply_authorized_by_rsi!==false
    ||row.before_install_receipt_required!==true
    ||row.self_update_transaction_schema!==SELF_UPDATE_TRANSACTION_SCHEMA
    ||row.install_effect_barrier!==SELF_UPDATE_INSTALL_EFFECT_BARRIER
    ||row.install_effect_scope!==SELF_UPDATE_INSTALL_EFFECT_SCOPE
    ||row.install_actuator!==SELF_UPDATE_INSTALL_ACTUATOR
    ||JSON.stringify(row.expected_effect_order)!==JSON.stringify([
      'PERSIST_PRE_INSTALL_RECEIPT_AND_TRANSACTION',
      'PREPARE_EXPECTED_RESTART','PREPARE_INSTALLER_HANDOFF',
      'CROSS_WRITE_AHEAD_INSTALL_EFFECT_BARRIER','ELECTRON_QUIT_AND_INSTALL',
    ])
    ||row.one_attempt_physical_effect_required!==true
    ||row.post_effect_transaction_readback_required!==true
    ||row.successor_startup_readback_required!==true
    ||row.ambiguous_install_reconciliation_only!==true
    ||row.automatic_install_retry_allowed!==false
    ||row.installer_launch_authorized_by_rsi!==false
    ||row.physical_effect_replay_allowed!==false
  )throw new Error('rsi_final_install_policy_invalid');

  for(const f of ['probe_outcome_digest','probe_admission_digest','download_readiness_digest',
    'target_installer_sha256','target_manifest_sha256','target_installed_executable_sha256']){
    exactDigest(row[f],f);
  }
  exactSha(row.candidate_sha,'candidate');
  exactSha(row.previous_authority_sha,'previous_authority');
  exactUtc(row.observed_at,'observed_at');
  safeId(row.observer_id,'observer_id');
  if(
    row.runtime?.state!=='RESTART_GRACE'||row.runtime?.restart_gate_safe!==true
    ||row.runtime?.install_attempted_version!==null
    ||row.runtime?.pre_install_receipt_persisted!==false
    ||row.runtime?.installer_handoff_prepared!==false
  )throw new Error('rsi_final_install_runtime_summary_invalid');
  if(
    row.host_resilience?.state!=='ACTIVE'||row.host_resilience?.sentinel_worker_healthy!==true
    ||row.host_resilience?.sentinel_worker_ready!==true
  )throw new Error('rsi_final_install_host_summary_invalid');
  if(!['NONE','QUALIFIED','SUPERSEDED'].includes(row.prior_transaction?.state)){
    throw new Error('rsi_final_install_prior_summary_invalid');
  }
  const clone=structuredClone(row);
  const claimed=exactDigest(clone.final_install_admission_digest,'final_install_admission');
  delete clone.final_install_admission_digest;
  if(digest(clone)!==claimed)throw new Error('rsi_final_install_digest_mismatch');
  return row;
}

export function rsiSelfUpdateFinalInstallCycleTrustRootSnapshot(){
  const root={
    schema:'metaengine.rsi.self-update-final-install-cycle-root.v1',version:1,
    adapter_path:'apps/metaengine-browser/src/rsi-self-update-final-install-cycle-admission.mjs',
    probe_outcome_path:'apps/metaengine-browser/src/rsi-self-update-restart-gate-probe-outcome.mjs',
    download_readiness_path:'apps/metaengine-browser/src/rsi-self-update-download-readiness.mjs',
    self_update_runtime_path:'apps/metaengine-browser/src/self-update-runtime-v8.mjs',
    transaction_journal_path:'apps/metaengine-browser/src/self-update-transaction-journal.mjs',
    host_resilience_runtime_path:'apps/metaengine-browser/src/host-resilience-runtime.mjs',
    exact_candidate_chain_required:true,restart_gate_and_elapsed_grace_reverification_required:true,
    fresh_prior_transaction_and_host_readback_required:true,
    external_self_update_controller_required:true,single_final_apply_cycle_only:true,
    write_ahead_install_effect_barrier_required:true,one_attempt_physical_effect_required:true,
    post_effect_transaction_readback_required:true,successor_startup_readback_required:true,
    ambiguous_install_reconciliation_only:true,final_apply_authorized_by_rsi:false,
    installer_launch_authorized_by_rsi:false,candidate_can_modify_final_install_root:false,
    physical_effect_replay_allowed:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,
    release_authority:false,self_update_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...root,final_install_cycle_root_digest:digest(root)});
}
