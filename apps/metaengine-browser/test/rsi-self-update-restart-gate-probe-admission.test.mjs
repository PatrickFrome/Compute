import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import {
  createRsiSelfUpdateRestartGateProbeAdmission,
  verifyRsiSelfUpdateRestartGateProbeAdmission,
  rsiSelfUpdateRestartGateProbeTrustRootSnapshot,
} from '../src/rsi-self-update-restart-gate-probe-admission.mjs';

function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.keys(value).sort().map((key)=>[key,stable(value[key])]));
}
function digest(value){
  return 'sha256:'+crypto.createHash('sha256').update(JSON.stringify(stable(value)),'utf8').digest('hex');
}

const CANDIDATE='b'.repeat(40);
const PREVIOUS='a'.repeat(40);
const CURRENT='0.7.0-dev.35330209177.1';
const TARGET='0.7.0-dev.99999999999.1';
const TAG='v'+TARGET;
const FEED='https://github.com/PatrickFrome/Compute/releases/download/'+TAG+'/';
const NOW='2026-09-18T19:30:00.000Z';

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
    transaction_id:'prior-qualified-transaction-restart-probe-v1',
    source_version:'0.7.0-dev.35330209176.1',target_version:CURRENT,resolved_git_sha:PREVIOUS,
    state:'QUALIFIED',automatic_retry_allowed:false,authority_effect:false,...overrides,
  };
}
function freshRuntime(overrides={}){
  return {
    schema:'metaengine.self-update-runtime.v8',state:'READY_RESTART',current_version:CURRENT,
    available_version:TARGET,downloaded_version:TARGET,metadata_verified:true,publisher_verified:true,
    release_resolution:'VERIFIED',resolved_tag:TAG,resolved_git_sha:CANDIDATE,resolved_feed_url:FEED,
    candidate_file_count:1,download_percent:100,control_plane_enabled:true,install_effect_quarantined:false,
    ci_test_feed_active:false,developer_emergency_requested:false,developer_emergency_policy_bypass:false,
    install_attempted_version:null,pre_install_receipt_persisted:false,installer_handoff_prepared:false,
    restart_gate_safe:false,restart_gate_since:null,host_resilience:host(),authority_effect:false,...overrides,
  };
}
function readiness(){
  const h=host();
  const runtimeSummary={
    schema:'metaengine.self-update-runtime.v8',state:'READY_RESTART',current_version:CURRENT,
    available_version:TARGET,downloaded_version:TARGET,metadata_verified:true,publisher_verified:true,
    release_resolution:'VERIFIED',resolved_tag:TAG,resolved_git_sha:CANDIDATE,resolved_feed_url:FEED,
    candidate_file_count:1,download_percent:100,install_attempted_version:null,
    pre_install_receipt_persisted:false,installer_handoff_prepared:false,restart_gate_safe:false,restart_gate_since:null,
    runtime_snapshot_digest:digest(freshRuntime()),authority_effect:false,
  };
  const hostSummary={
    schema:'metaengine.host-resilience-runtime.v7',state:'ACTIVE',external_stop_requested:false,
    sentinel_worker_healthy:true,sentinel_worker_ready:true,sentinel_bootstrap_retry_pending:false,
    snapshot_digest:digest(h),authority_effect:false,
  };
  const release={
    schema:'metaengine.trusted-dev-release.v1',version:TARGET,tag:TAG,git_sha:CANDIDATE,feed_url:FEED,
    installer_name:'METAENGINE-Browser-Test-Setup-'+TARGET+'-x64.exe',
    installer_sha256:'sha256:'+'1'.repeat(64),manifest_sha256:'sha256:'+'2'.repeat(64),
    installed_executable_sha256:'sha256:'+'3'.repeat(64),target_present_proof_supported:true,authority_effect:false,
  };
  const core={
    schema:'metaengine.rsi.self-update-download-readiness.v1',version:1,state:'READY_FOR_EXTERNAL_APPLY_CYCLE_REVIEW',
    check_admission_digest:'sha256:'+'4'.repeat(64),candidate_sha:CANDIDATE,previous_authority_sha:PREVIOUS,
    target_release_tag:TAG,target_release_version:TARGET,target_installer_sha256:'sha256:'+'1'.repeat(64),
    target_manifest_sha256:'sha256:'+'2'.repeat(64),target_installed_executable_sha256:'sha256:'+'3'.repeat(64),
    observed_at:'2026-09-18T19:25:00.000Z',observer_id:'trusted-self-update-controller-v1',
    runtime:runtimeSummary,
    prior_transaction:{present:true,state:'QUALIFIED',transaction_id:'prior-qualified-transaction-restart-probe-v1',target_version:CURRENT,authority_effect:false},
    host_resilience:hostSummary,trusted_release:release,
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

test('fresh READY_RESTART state becomes only a single external restart-gate probe review',()=>{
  const row=createRsiSelfUpdateRestartGateProbeAdmission({
    download_readiness:readiness(),fresh_runtime_snapshot:freshRuntime(),prior_transaction:prior(),
    observed_at:NOW,observer_id:'trusted-self-update-controller-v1',
  });
  verifyRsiSelfUpdateRestartGateProbeAdmission(row);
  assert.equal(row.state,'READY_FOR_EXTERNAL_RESTART_GATE_PROBE');
  assert.equal(row.admitted_cycle_count,1);
  assert.equal(row.single_probe_cycle_only,true);
  assert.equal(row.precondition_restart_gate_safe,false);
  assert.equal(row.precondition_restart_gate_since,null);
  assert.equal(row.precondition_install_attempt_absent,true);
  assert.equal(row.first_cycle_installer_launch_forbidden_by_verified_state,true);
  assert.deepEqual(row.allowed_post_probe_states,['READY_RESTART','RESTART_GRACE']);
  assert.equal(row.probe_cycle_invoked,false);
  assert.equal(row.probe_cycle_authorized_by_rsi,false);
  assert.equal(row.second_cycle_authorized,false);
  assert.equal(row.installer_launch_authorized,false);
});

test('restart gate, grace or install-effect drift before the probe fails closed',()=>{
  const bad=[
    freshRuntime({state:'RESTART_GRACE',restart_gate_safe:true,restart_gate_since:'2026-09-18T19:29:59.000Z'}),
    freshRuntime({restart_gate_safe:true,restart_gate_since:'2026-09-18T19:29:59.000Z'}),
    freshRuntime({install_attempted_version:TARGET}),
    freshRuntime({pre_install_receipt_persisted:true}),
    freshRuntime({installer_handoff_prepared:true}),
    freshRuntime({downloaded_version:'0.7.0-dev.88888888888.1'}),
  ];
  for(const snapshot of bad){
    assert.throws(
      ()=>createRsiSelfUpdateRestartGateProbeAdmission({
        download_readiness:readiness(),fresh_runtime_snapshot:snapshot,prior_transaction:prior(),
        observed_at:NOW,observer_id:'trusted-self-update-controller-v1',
      }),
      /(runtime_binding_invalid|effect_already_started)/,
    );
  }
});

test('host degradation and prior transaction drift block restart-gate probe review',()=>{
  assert.throws(
    ()=>createRsiSelfUpdateRestartGateProbeAdmission({
      download_readiness:readiness(),
      fresh_runtime_snapshot:freshRuntime({host_resilience:host({sentinel_worker_healthy:false})}),
      prior_transaction:prior(),observed_at:NOW,observer_id:'trusted-self-update-controller-v1',
    }),
    /host_not_ready/,
  );
  assert.throws(
    ()=>createRsiSelfUpdateRestartGateProbeAdmission({
      download_readiness:readiness(),fresh_runtime_snapshot:freshRuntime(),
      prior_transaction:prior({state:'SUCCESSOR_BOOTED'}),observed_at:NOW,observer_id:'trusted-self-update-controller-v1',
    }),
    /unresolved_prior/,
  );
  assert.throws(
    ()=>createRsiSelfUpdateRestartGateProbeAdmission({
      download_readiness:readiness(),fresh_runtime_snapshot:freshRuntime(),
      prior_transaction:prior({transaction_id:'different-prior-transaction-v1'}),observed_at:NOW,observer_id:'trusted-self-update-controller-v1',
    }),
    /prior_transaction_drift/,
  );
});

test('probe admission cannot be widened into apply, restart, second-cycle or installer authority',()=>{
  const base=createRsiSelfUpdateRestartGateProbeAdmission({
    download_readiness:readiness(),fresh_runtime_snapshot:freshRuntime(),prior_transaction:prior(),
    observed_at:NOW,observer_id:'trusted-self-update-controller-v1',
  });
  for(const mutate of [
    (x)=>{x.probe_cycle_invoked=true;},
    (x)=>{x.probe_cycle_authorized_by_rsi=true;},
    (x)=>{x.restart_authorized=true;},
    (x)=>{x.pre_install_receipt_authorized=true;},
    (x)=>{x.installer_handoff_authorized=true;},
    (x)=>{x.installer_launch_authorized=true;},
    (x)=>{x.second_cycle_authorized=true;},
    (x)=>{x.physical_effect_replay_allowed=true;},
  ]){
    const copy=structuredClone(base);mutate(copy);
    assert.throws(()=>verifyRsiSelfUpdateRestartGateProbeAdmission(copy),/policy_invalid/);
  }
});

test('restart-gate probe trust root freezes the first-cycle no-installer contract',()=>{
  const root=rsiSelfUpdateRestartGateProbeTrustRootSnapshot();
  assert.equal(root.precondition_ready_restart,true);
  assert.equal(root.precondition_restart_gate_clear,true);
  assert.equal(root.single_probe_cycle_only,true);
  assert.equal(root.first_cycle_must_not_launch_installer,true);
  assert.equal(root.post_probe_readback_required,true);
  assert.equal(root.external_self_update_controller_required,true);
  assert.equal(root.probe_cycle_authorized_by_rsi,false);
  assert.equal(root.second_cycle_authorized,false);
  assert.equal(root.installer_launch_authorized,false);
  assert.equal(root.candidate_can_modify_probe_root,false);
});
