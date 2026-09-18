import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import {
  createRsiSelfUpdateRestartGateProbeAdmission,
} from '../src/rsi-self-update-restart-gate-probe-admission.mjs';
import {
  createRsiSelfUpdateRestartGateProbeInvocation,
  verifyRsiSelfUpdateRestartGateProbeInvocation,
  createRsiSelfUpdateRestartGateProbeOutcome,
  verifyRsiSelfUpdateRestartGateProbeOutcome,
  rsiSelfUpdateRestartGateProbeOutcomeTrustRootSnapshot,
} from '../src/rsi-self-update-restart-gate-probe-outcome.mjs';

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
const PROBE_AT='2026-09-18T19:30:00.000Z';

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
    transaction_id:'prior-qualified-transaction-probe-outcome-v1',
    source_version:'0.7.0-dev.35330209176.1',target_version:CURRENT,resolved_git_sha:PREVIOUS,
    state:'QUALIFIED',automatic_retry_allowed:false,authority_effect:false,...overrides,
  };
}
function baseRuntime(overrides={}){
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
function readiness(){
  const h=host();
  const runtime=baseRuntime();
  const core={
    schema:'metaengine.rsi.self-update-download-readiness.v1',version:1,state:'READY_FOR_EXTERNAL_APPLY_CYCLE_REVIEW',
    check_admission_digest:'sha256:'+'1'.repeat(64),candidate_sha:CANDIDATE,previous_authority_sha:PREVIOUS,
    target_release_tag:TAG,target_release_version:TARGET,target_installer_sha256:'sha256:'+'2'.repeat(64),
    target_manifest_sha256:'sha256:'+'3'.repeat(64),target_installed_executable_sha256:'sha256:'+'4'.repeat(64),
    observed_at:'2026-09-18T19:29:00.000Z',observer_id:'trusted-self-update-controller-v1',
    runtime:{
      schema:'metaengine.self-update-runtime.v8',state:'READY_RESTART',current_version:CURRENT,
      available_version:TARGET,downloaded_version:TARGET,metadata_verified:true,publisher_verified:true,
      release_resolution:'VERIFIED',resolved_tag:TAG,resolved_git_sha:CANDIDATE,resolved_feed_url:FEED,
      candidate_file_count:1,download_percent:100,install_attempted_version:null,
      pre_install_receipt_persisted:false,installer_handoff_prepared:false,restart_gate_safe:false,restart_gate_since:null,
      runtime_snapshot_digest:digest(runtime),authority_effect:false,
    },
    prior_transaction:{present:true,state:'QUALIFIED',transaction_id:'prior-qualified-transaction-probe-outcome-v1',target_version:CURRENT,authority_effect:false},
    host_resilience:{
      schema:'metaengine.host-resilience-runtime.v7',state:'ACTIVE',external_stop_requested:false,
      sentinel_worker_healthy:true,sentinel_worker_ready:true,sentinel_bootstrap_retry_pending:false,
      snapshot_digest:digest(h),authority_effect:false,
    },
    trusted_release:{
      schema:'metaengine.trusted-dev-release.v1',version:TARGET,tag:TAG,git_sha:CANDIDATE,feed_url:FEED,
      installer_name:'METAENGINE-Browser-Test-Setup-'+TARGET+'-x64.exe',
      installer_sha256:'sha256:'+'2'.repeat(64),manifest_sha256:'sha256:'+'3'.repeat(64),
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
    download_readiness:readiness(),fresh_runtime_snapshot:baseRuntime(),prior_transaction:prior(),
    observed_at:PROBE_AT,observer_id:'trusted-self-update-controller-v1',
  });
}
function graceRuntime({since='2026-09-18T19:30:00.000Z',overrides={}}={}){
  return baseRuntime({
    state:'RESTART_GRACE',restart_gate_safe:true,restart_gate_since:since,...overrides,
  });
}
function invocation(admission,snapshot){
  return createRsiSelfUpdateRestartGateProbeInvocation({
    probe_admission:admission,invoked_at:'2026-09-18T19:30:00.100Z',
    controller_id:'trusted-self-update-controller-v1',
    post_runtime_snapshot_digest:digest(snapshot),
    external_controller_verified:true,authored_by_candidate:false,
  });
}

test('external single probe receipt is exact-bound and records no physical effect',()=>{
  const admission=probeAdmission();
  const snapshot=graceRuntime();
  const receipt=invocation(admission,snapshot);
  verifyRsiSelfUpdateRestartGateProbeInvocation(receipt,{probe_admission:admission});
  assert.equal(receipt.invocation_count,1);
  assert.equal(receipt.runtime_method,'applyWhenSafe');
  assert.equal(receipt.external_controller_verified,true);
  assert.equal(receipt.authored_by_candidate,false);
  assert.equal(receipt.physical_effect_attempted,false);
  assert.equal(receipt.quit_and_install_called,false);
  assert.equal(receipt.pre_install_receipt_persisted,false);
  assert.equal(receipt.installer_handoff_prepared,false);
  assert.equal(receipt.second_cycle_invoked,false);
});

test('unsafe restart probe becomes HOLD and cannot advance toward install review',()=>{
  const admission=probeAdmission();
  const snapshot=baseRuntime();
  const outcome=createRsiSelfUpdateRestartGateProbeOutcome({
    probe_admission:admission,invocation_receipt:invocation(admission,snapshot),
    post_probe_runtime_snapshot:snapshot,prior_transaction:prior(),
    observed_at:'2026-09-18T19:30:01.000Z',observer_id:'trusted-self-update-controller-v1',
  });
  verifyRsiSelfUpdateRestartGateProbeOutcome(outcome);
  assert.equal(outcome.state,'HOLD_RESTART_GATE_UNSAFE');
  assert.equal(outcome.restart_gate_safe,false);
  assert.equal(outcome.restart_grace_satisfied,false);
  assert.equal(outcome.ready_for_external_install_cycle_review,false);
  assert.equal(outcome.install_cycle_authorized_by_rsi,false);
});

test('safe probe must remain in restart grace until the full grace interval has elapsed',()=>{
  const admission=probeAdmission();
  const snapshot=graceRuntime();
  const waiting=createRsiSelfUpdateRestartGateProbeOutcome({
    probe_admission:admission,invocation_receipt:invocation(admission,snapshot),
    post_probe_runtime_snapshot:snapshot,prior_transaction:prior(),
    observed_at:'2026-09-18T19:30:05.000Z',observer_id:'trusted-self-update-controller-v1',
  });
  assert.equal(waiting.state,'WAITING_RESTART_GRACE');
  assert.equal(waiting.runtime.grace_elapsed_ms,5000);
  assert.equal(waiting.runtime.restart_grace_ms,12000);
  assert.equal(waiting.restart_grace_satisfied,false);
  assert.equal(waiting.ready_for_external_install_cycle_review,false);

  const ready=createRsiSelfUpdateRestartGateProbeOutcome({
    probe_admission:admission,invocation_receipt:invocation(admission,snapshot),
    post_probe_runtime_snapshot:snapshot,prior_transaction:prior(),
    observed_at:'2026-09-18T19:30:13.000Z',observer_id:'trusted-self-update-controller-v1',
  });
  assert.equal(ready.state,'READY_FOR_EXTERNAL_INSTALL_CYCLE_REVIEW');
  assert.equal(ready.runtime.grace_elapsed_ms,13000);
  assert.equal(ready.restart_grace_satisfied,true);
  assert.equal(ready.ready_for_external_install_cycle_review,true);
  assert.equal(ready.install_cycle_invoked,false);
  assert.equal(ready.installer_launch_authorized,false);
});

test('post-probe install effects, host degradation or prior drift fail closed',()=>{
  const admission=probeAdmission();
  const effectSnapshot=graceRuntime({overrides:{install_attempted_version:TARGET}});
  assert.throws(()=>createRsiSelfUpdateRestartGateProbeOutcome({
    probe_admission:admission,invocation_receipt:invocation(admission,effectSnapshot),
    post_probe_runtime_snapshot:effectSnapshot,prior_transaction:prior(),
    observed_at:'2026-09-18T19:30:13.000Z',observer_id:'trusted-self-update-controller-v1',
  }),/effect_or_policy_drift/);

  const badHost=graceRuntime({overrides:{host_resilience:host({sentinel_worker_healthy:false})}});
  assert.throws(()=>createRsiSelfUpdateRestartGateProbeOutcome({
    probe_admission:admission,invocation_receipt:invocation(admission,badHost),
    post_probe_runtime_snapshot:badHost,prior_transaction:prior(),
    observed_at:'2026-09-18T19:30:13.000Z',observer_id:'trusted-self-update-controller-v1',
  }),/host_not_ready/);

  const snapshot=graceRuntime();
  assert.throws(()=>createRsiSelfUpdateRestartGateProbeOutcome({
    probe_admission:admission,invocation_receipt:invocation(admission,snapshot),
    post_probe_runtime_snapshot:snapshot,prior_transaction:prior({state:'SUCCESSOR_BOOTED'}),
    observed_at:'2026-09-18T19:30:13.000Z',observer_id:'trusted-self-update-controller-v1',
  }),/unresolved_prior/);
});

test('invocation receipt must be external, single-cycle and exact post-snapshot bound',()=>{
  const admission=probeAdmission();
  const snapshot=graceRuntime();
  assert.throws(()=>createRsiSelfUpdateRestartGateProbeInvocation({
    probe_admission:admission,invoked_at:'2026-09-18T19:30:00.100Z',
    controller_id:'trusted-self-update-controller-v1',post_runtime_snapshot_digest:digest(snapshot),
    external_controller_verified:true,authored_by_candidate:true,
  }),/external_controller_required/);

  const receipt=invocation(admission,snapshot);
  const tampered=structuredClone(receipt);
  tampered.post_runtime_snapshot_digest='sha256:'+'f'.repeat(64);
  assert.throws(()=>verifyRsiSelfUpdateRestartGateProbeInvocation(tampered,{probe_admission:admission}),/digest_mismatch/);
});

test('ready outcome cannot be widened into install-cycle or installer authority',()=>{
  const admission=probeAdmission();
  const snapshot=graceRuntime();
  const base=createRsiSelfUpdateRestartGateProbeOutcome({
    probe_admission:admission,invocation_receipt:invocation(admission,snapshot),
    post_probe_runtime_snapshot:snapshot,prior_transaction:prior(),
    observed_at:'2026-09-18T19:30:13.000Z',observer_id:'trusted-self-update-controller-v1',
  });
  for(const mutate of [
    (x)=>{x.install_cycle_invoked=true;},
    (x)=>{x.install_cycle_authorized_by_rsi=true;},
    (x)=>{x.installer_launch_authorized=true;},
    (x)=>{x.physical_effect_replay_allowed=true;},
  ]){
    const copy=structuredClone(base);mutate(copy);
    assert.throws(()=>verifyRsiSelfUpdateRestartGateProbeOutcome(copy),/policy_invalid/);
  }
});

test('probe outcome trust root requires external receipt, elapsed grace and final revalidation',()=>{
  const root=rsiSelfUpdateRestartGateProbeOutcomeTrustRootSnapshot();
  assert.equal(root.external_probe_invocation_receipt_required,true);
  assert.equal(root.candidate_authored_probe_receipt_forbidden,true);
  assert.equal(root.single_probe_cycle_required,true);
  assert.equal(root.no_physical_effect_during_probe_required,true);
  assert.equal(root.restart_grace_observation_required,true);
  assert.equal(root.restart_grace_elapsed_required_before_install_review,true);
  assert.equal(root.final_revalidation_required,true);
  assert.equal(root.transaction_write_ahead_barrier_required,true);
  assert.equal(root.install_cycle_authorized_by_rsi,false);
  assert.equal(root.installer_launch_authorized,false);
});
