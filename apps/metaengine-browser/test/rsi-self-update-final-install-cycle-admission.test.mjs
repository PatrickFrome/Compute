import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import { createRsiSelfUpdateRestartGateProbeAdmission } from '../src/rsi-self-update-restart-gate-probe-admission.mjs';
import {
  createRsiSelfUpdateRestartGateProbeInvocation,
  createRsiSelfUpdateRestartGateProbeOutcome,
} from '../src/rsi-self-update-restart-gate-probe-outcome.mjs';
import {
  createRsiSelfUpdateFinalInstallCycleAdmission,
  verifyRsiSelfUpdateFinalInstallCycleAdmission,
  rsiSelfUpdateFinalInstallCycleTrustRootSnapshot,
} from '../src/rsi-self-update-final-install-cycle-admission.mjs';

function stable(v){
  if(Array.isArray(v))return v.map(stable);
  if(!v||typeof v!=='object')return v;
  return Object.fromEntries(Object.keys(v).sort().map((k)=>[k,stable(v[k])]));
}
function digest(v){
  return 'sha256:'+crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex');
}

const CANDIDATE='b'.repeat(40);
const PREVIOUS='a'.repeat(40);
const CURRENT='0.7.0-dev.35330209177.1';
const TARGET='0.7.0-dev.99999999999.1';
const TAG='v'+TARGET;
const FEED='https://github.com/PatrickFrome/Compute/releases/download/'+TAG+'/';
const INSTALLER='METAENGINE-Browser-Test-Setup-'+TARGET+'-x64.exe';

function host(overrides={}){
  return {
    schema:'metaengine.host-resilience-runtime.v7',state:'ACTIVE',external_stop_requested:false,
    sentinel_worker_healthy:true,sentinel:{worker_ready:true},sentinel_bootstrap_retry_pending:false,
    prevent_app_suspension:true,authority_effect:false,...overrides,
  };
}
function prior(overrides={}){
  return {
    schema:'metaengine.self-update.transaction.v1',
    transaction_id:'prior-qualified-transaction-final-install-v1',
    source_version:'0.7.0-dev.35330209176.1',target_version:CURRENT,resolved_git_sha:PREVIOUS,
    state:'QUALIFIED',automatic_retry_allowed:false,authority_effect:false,...overrides,
  };
}
function runtime(overrides={}){
  return {
    schema:'metaengine.self-update-runtime.v8',state:'READY_RESTART',current_version:CURRENT,
    available_version:TARGET,downloaded_version:TARGET,metadata_verified:true,publisher_verified:true,
    release_resolution:'VERIFIED',resolved_tag:TAG,resolved_git_sha:CANDIDATE,resolved_feed_url:FEED,
    candidate_file_count:1,download_percent:100,restart_grace_ms:12000,
    control_plane_enabled:true,install_effect_quarantined:false,ci_test_feed_active:false,
    developer_emergency_requested:false,developer_emergency_policy_bypass:false,
    install_attempted_version:null,pre_install_receipt_persisted:false,installer_handoff_prepared:false,
    restart_gate_safe:false,restart_gate_since:null,host_resilience:host(),authority_effect:false,...overrides,
  };
}
function release(overrides={}){
  return {
    schema:'metaengine.trusted-dev-release.v1',version:TARGET,tag:TAG,git_sha:CANDIDATE,feed_url:FEED,
    installer_name:INSTALLER,installer_sha256:'1'.repeat(64),manifest_sha256:'2'.repeat(64),
    dev_yml_sha256:'3'.repeat(64),installed_executable_sha256:'4'.repeat(64),
    target_present_proof_supported:true,authority_effect:false,...overrides,
  };
}
function readiness(){
  const h=host();
  const snap=runtime();
  const core={
    schema:'metaengine.rsi.self-update-download-readiness.v1',version:1,state:'READY_FOR_EXTERNAL_APPLY_CYCLE_REVIEW',
    check_admission_digest:'sha256:'+'5'.repeat(64),candidate_sha:CANDIDATE,previous_authority_sha:PREVIOUS,
    target_release_tag:TAG,target_release_version:TARGET,target_installer_sha256:'sha256:'+'1'.repeat(64),
    target_manifest_sha256:'sha256:'+'2'.repeat(64),target_installed_executable_sha256:'sha256:'+'4'.repeat(64),
    observed_at:'2026-09-18T19:29:00.000Z',observer_id:'trusted-self-update-controller-v1',
    runtime:{
      schema:snap.schema,state:'READY_RESTART',current_version:CURRENT,available_version:TARGET,downloaded_version:TARGET,
      metadata_verified:true,publisher_verified:true,release_resolution:'VERIFIED',resolved_tag:TAG,resolved_git_sha:CANDIDATE,
      resolved_feed_url:FEED,candidate_file_count:1,download_percent:100,install_attempted_version:null,
      pre_install_receipt_persisted:false,installer_handoff_prepared:false,restart_gate_safe:false,restart_gate_since:null,
      runtime_snapshot_digest:digest(snap),authority_effect:false,
    },
    prior_transaction:{present:true,state:'QUALIFIED',transaction_id:'prior-qualified-transaction-final-install-v1',target_version:CURRENT,authority_effect:false},
    host_resilience:{
      schema:h.schema,state:'ACTIVE',external_stop_requested:false,sentinel_worker_healthy:true,sentinel_worker_ready:true,
      sentinel_bootstrap_retry_pending:false,snapshot_digest:digest(h),authority_effect:false,
    },
    trusted_release:{
      schema:'metaengine.trusted-dev-release.v1',version:TARGET,tag:TAG,git_sha:CANDIDATE,feed_url:FEED,
      installer_name:INSTALLER,installer_sha256:'sha256:'+'1'.repeat(64),manifest_sha256:'sha256:'+'2'.repeat(64),
      installed_executable_sha256:'sha256:'+'4'.repeat(64),target_present_proof_supported:true,authority_effect:false,
    },
    exact_downloaded_candidate_verified:true,metadata_verified:true,publisher_verified:true,
    trusted_release_reverified_after_download:true,no_install_effect_attempted:true,
    external_self_update_controller_required:true,existing_self_update_runtime_method:'applyWhenSafe',
    restart_gate_must_be_evaluated_inside_existing_runtime:true,restart_grace_must_be_honored:true,
    prior_transaction_must_be_rechecked_before_install:true,host_resilience_must_be_rechecked_before_installer_handoff:true,
    apply_cycle_invoked:false,apply_cycle_authorized_by_rsi:false,restart_authorized:false,
    pre_install_receipt_authorized:false,installer_handoff_authorized:false,installer_launch_authorized:false,
    physical_effect_replay_allowed:false,execution_authority:false,browser_authority:false,scheduler_authority:false,
    task_authority:false,production_mutation_authority:false,promotion_authority:false,release_authority:false,
    self_update_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return {...core,readiness_digest:digest(core)};
}
function probeAdmission(){
  return createRsiSelfUpdateRestartGateProbeAdmission({
    download_readiness:readiness(),fresh_runtime_snapshot:runtime(),prior_transaction:prior(),
    observed_at:'2026-09-18T19:30:00.000Z',observer_id:'trusted-self-update-controller-v1',
  });
}
function graceRuntime(overrides={}){
  return runtime({
    state:'RESTART_GRACE',restart_gate_safe:true,restart_gate_since:'2026-09-18T19:30:00.000Z',...overrides,
  });
}
function readyOutcome(){
  const probe=probeAdmission();
  const snap=graceRuntime();
  const receipt=createRsiSelfUpdateRestartGateProbeInvocation({
    probe_admission:probe,invoked_at:'2026-09-18T19:30:00.100Z',
    controller_id:'trusted-self-update-controller-v1',post_runtime_snapshot_digest:digest(snap),
    external_controller_verified:true,authored_by_candidate:false,
  });
  return {
    probe,
    outcome:createRsiSelfUpdateRestartGateProbeOutcome({
      probe_admission:probe,invocation_receipt:receipt,post_probe_runtime_snapshot:snap,
      prior_transaction:prior(),observed_at:'2026-09-18T19:30:13.000Z',
      observer_id:'trusted-self-update-controller-v1',
    }),
  };
}

test('elapsed restart grace plus fresh exact bindings becomes only external final-apply review material',()=>{
  const {probe,outcome}=readyOutcome();
  const row=createRsiSelfUpdateFinalInstallCycleAdmission({
    probe_outcome:outcome,probe_admission:probe,download_readiness:readiness(),
    fresh_runtime_snapshot:graceRuntime(),prior_transaction:prior(),trusted_release:release(),
    observed_at:'2026-09-18T19:30:14.000Z',observer_id:'trusted-self-update-controller-v1',
  });
  verifyRsiSelfUpdateFinalInstallCycleAdmission(row);
  assert.equal(row.state,'READY_FOR_EXTERNAL_FINAL_APPLY_INVOCATION_REVIEW');
  assert.equal(row.exact_candidate_chain_verified,true);
  assert.equal(row.restart_gate_safe_reverified,true);
  assert.equal(row.restart_grace_elapsed_reverified,true);
  assert.equal(row.no_install_effect_yet_verified,true);
  assert.equal(row.admitted_final_cycle_count,1);
  assert.equal(row.single_final_apply_cycle_only,true);
  assert.equal(row.final_apply_invoked,false);
  assert.equal(row.final_apply_authorized_by_rsi,false);
  assert.equal(row.before_install_receipt_required,true);
  assert.equal(row.install_effect_barrier,'WRITE_AHEAD_V1');
  assert.equal(row.one_attempt_physical_effect_required,true);
  assert.equal(row.post_effect_transaction_readback_required,true);
  assert.equal(row.successor_startup_readback_required,true);
  assert.equal(row.ambiguous_install_reconciliation_only,true);
  assert.equal(row.installer_launch_authorized_by_rsi,false);
});

test('final install review rejects stale or regressed restart-grace state',()=>{
  const {probe,outcome}=readyOutcome();
  for(const snap of [
    runtime(),
    graceRuntime({restart_gate_since:'2026-09-18T19:30:10.000Z'}),
    graceRuntime({restart_gate_safe:false,restart_gate_since:null}),
    graceRuntime({install_attempted_version:TARGET}),
    graceRuntime({pre_install_receipt_persisted:true}),
    graceRuntime({installer_handoff_prepared:true}),
  ]){
    assert.throws(
      ()=>createRsiSelfUpdateFinalInstallCycleAdmission({
        probe_outcome:outcome,probe_admission:probe,download_readiness:readiness(),
        fresh_runtime_snapshot:snap,prior_transaction:prior(),trusted_release:release(),
        observed_at:'2026-09-18T19:30:14.000Z',observer_id:'trusted-self-update-controller-v1',
      }),
      /(runtime_binding_invalid|runtime_effect_or_policy_drift|restart_grace_not_elapsed|probe_outcome_drift)/,
    );
  }
});

test('candidate-chain, trusted-release, prior-transaction and host drift fail closed',()=>{
  const {probe,outcome}=readyOutcome();
  assert.throws(()=>createRsiSelfUpdateFinalInstallCycleAdmission({
    probe_outcome:outcome,probe_admission:probe,download_readiness:readiness(),
    fresh_runtime_snapshot:graceRuntime(),prior_transaction:prior(),trusted_release:release({git_sha:'f'.repeat(40)}),
    observed_at:'2026-09-18T19:30:14.000Z',observer_id:'trusted-self-update-controller-v1',
  }),/trusted_release_mismatch/);

  assert.throws(()=>createRsiSelfUpdateFinalInstallCycleAdmission({
    probe_outcome:outcome,probe_admission:probe,download_readiness:readiness(),
    fresh_runtime_snapshot:graceRuntime(),prior_transaction:prior({state:'SUCCESSOR_BOOTED'}),trusted_release:release(),
    observed_at:'2026-09-18T19:30:14.000Z',observer_id:'trusted-self-update-controller-v1',
  }),/unresolved_prior/);

  assert.throws(()=>createRsiSelfUpdateFinalInstallCycleAdmission({
    probe_outcome:outcome,probe_admission:probe,download_readiness:readiness(),
    fresh_runtime_snapshot:graceRuntime({host_resilience:host({sentinel_worker_healthy:false})}),
    prior_transaction:prior(),trusted_release:release(),
    observed_at:'2026-09-18T19:30:14.000Z',observer_id:'trusted-self-update-controller-v1',
  }),/host_not_ready/);
});

test('non-ready probe outcome cannot produce final install-cycle review',()=>{
  const probe=probeAdmission();
  const snap=graceRuntime();
  const receipt=createRsiSelfUpdateRestartGateProbeInvocation({
    probe_admission:probe,invoked_at:'2026-09-18T19:30:00.100Z',
    controller_id:'trusted-self-update-controller-v1',post_runtime_snapshot_digest:digest(snap),
    external_controller_verified:true,authored_by_candidate:false,
  });
  const waiting=createRsiSelfUpdateRestartGateProbeOutcome({
    probe_admission:probe,invocation_receipt:receipt,post_probe_runtime_snapshot:snap,
    prior_transaction:prior(),observed_at:'2026-09-18T19:30:05.000Z',observer_id:'trusted-self-update-controller-v1',
  });
  assert.throws(()=>createRsiSelfUpdateFinalInstallCycleAdmission({
    probe_outcome:waiting,probe_admission:probe,download_readiness:readiness(),
    fresh_runtime_snapshot:snap,prior_transaction:prior(),trusted_release:release(),
    observed_at:'2026-09-18T19:30:14.000Z',observer_id:'trusted-self-update-controller-v1',
  }),/probe_outcome_not_ready/);
});

test('final install admission cannot be widened into apply, install or replay authority',()=>{
  const {probe,outcome}=readyOutcome();
  const base=createRsiSelfUpdateFinalInstallCycleAdmission({
    probe_outcome:outcome,probe_admission:probe,download_readiness:readiness(),
    fresh_runtime_snapshot:graceRuntime(),prior_transaction:prior(),trusted_release:release(),
    observed_at:'2026-09-18T19:30:14.000Z',observer_id:'trusted-self-update-controller-v1',
  });
  for(const mutate of [
    (x)=>{x.final_apply_invoked=true;},
    (x)=>{x.final_apply_authorized_by_rsi=true;},
    (x)=>{x.installer_launch_authorized_by_rsi=true;},
    (x)=>{x.automatic_install_retry_allowed=true;},
    (x)=>{x.physical_effect_replay_allowed=true;},
  ]){
    const copy=structuredClone(base);mutate(copy);
    assert.throws(()=>verifyRsiSelfUpdateFinalInstallCycleAdmission(copy),/policy_invalid/);
  }
});

test('final install trust root preserves external controller and write-ahead one-attempt effect semantics',()=>{
  const root=rsiSelfUpdateFinalInstallCycleTrustRootSnapshot();
  assert.equal(root.exact_candidate_chain_required,true);
  assert.equal(root.restart_gate_and_elapsed_grace_reverification_required,true);
  assert.equal(root.fresh_prior_transaction_and_host_readback_required,true);
  assert.equal(root.external_self_update_controller_required,true);
  assert.equal(root.single_final_apply_cycle_only,true);
  assert.equal(root.write_ahead_install_effect_barrier_required,true);
  assert.equal(root.one_attempt_physical_effect_required,true);
  assert.equal(root.post_effect_transaction_readback_required,true);
  assert.equal(root.successor_startup_readback_required,true);
  assert.equal(root.ambiguous_install_reconciliation_only,true);
  assert.equal(root.final_apply_authorized_by_rsi,false);
  assert.equal(root.installer_launch_authorized_by_rsi,false);
  assert.equal(root.candidate_can_modify_final_install_root,false);
});
