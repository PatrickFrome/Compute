import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import {
  createRsiSelfUpdateCheckAdmission,
  verifyRsiSelfUpdateCheckAdmission,
  rsiSelfUpdateCheckAdmissionTrustRootSnapshot,
} from '../src/rsi-self-update-controller-admission.mjs';

function stable(value){
  if(Array.isArray(value)) return value.map(stable);
  if(!value||typeof value!=='object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key)=>[key,stable(value[key])]));
}
function digest(value){
  return 'sha256:'+crypto.createHash('sha256').update(JSON.stringify(stable(value)),'utf8').digest('hex');
}

const CANDIDATE_SHA='b'.repeat(40);
const PREVIOUS_SHA='a'.repeat(40);
const CURRENT_VERSION='0.7.0-dev.35330209177.1';
const TARGET_VERSION='0.7.0-dev.99999999999.1';
const NOW='2026-09-18T19:10:00.000Z';

function eligibilityReview(overrides={}){
  const core={
    schema:'metaengine.rsi.self-update-eligibility-review.v1',
    version:1,
    state:'READY_FOR_EXTERNAL_SELF_UPDATE_CHECK_REVIEW',
    candidate_sha:CANDIDATE_SHA,
    previous_authority_sha:PREVIOUS_SHA,
    release_tag:'v'+TARGET_VERSION,
    release_version:TARGET_VERSION,
    installer_name:'METAENGINE-Browser-Test-Setup-'+TARGET_VERSION+'-x64.exe',
    installer_sha256:'sha256:'+'1'.repeat(64),
    manifest_sha256:'sha256:'+'2'.repeat(64),
    dev_yml_sha256:'sha256:'+'3'.repeat(64),
    installed_executable_sha256:'sha256:'+'4'.repeat(64),
    journal_intent_digest:'sha256:'+'5'.repeat(64),
    authority_readback_digest:'sha256:'+'6'.repeat(64),
    release_promotion_confirmed:true,
    exact_release_authority_confirmed:true,
    trusted_release_reverified:true,
    installed_executable_binding_present:true,
    external_self_update_controller_required:true,
    existing_self_update_runtime_required:true,
    self_update_transaction_schema:'metaengine.self-update.transaction.v1',
    install_effect_barrier:'WRITE_AHEAD_V1',
    install_effect_scope:'BROWSER_RESTART',
    install_actuator:'ELECTRON_UPDATER_QUIT_AND_INSTALL',
    fresh_release_reverification_required_at_check:true,
    prior_self_update_transaction_readback_required:true,
    restart_gate_revalidation_required:true,
    host_resilience_revalidation_required:true,
    self_update_check_authorized:false,
    self_update_apply_authorized:false,
    self_update_handoff_authorized:false,
    installer_launch_authorized:false,
    direct_install_authorized:false,
    physical_effect_replay_allowed:false,
    execution_authority:false,browser_authority:false,scheduler_authority:false,task_authority:false,
    production_mutation_authority:false,promotion_authority:false,release_authority:false,self_update_authority:false,
    automatic_retry_allowed:false,authority_effect:false,
    ...overrides,
  };
  return {...core,eligibility_review_digest:digest(core)};
}

function host(overrides={}){
  return {
    schema:'metaengine.host-resilience-runtime.v7',
    state:'ACTIVE',
    external_stop_requested:false,
    sentinel_worker_healthy:true,
    sentinel:{worker_ready:true},
    sentinel_bootstrap_retry_pending:false,
    prevent_app_suspension:true,
    authority_effect:false,
    ...overrides,
  };
}

function runtime(overrides={}){
  const h=host();
  return {
    schema:'metaengine.self-update-runtime.v8',
    state:'IDLE',
    current_version:CURRENT_VERSION,
    control_plane_enabled:true,
    install_effect_quarantined:false,
    ci_test_feed_active:false,
    developer_emergency_requested:false,
    developer_emergency_policy_bypass:false,
    available_version:null,
    downloaded_version:null,
    install_attempted_version:null,
    pre_install_receipt_persisted:false,
    installer_handoff_prepared:false,
    restart_gate_safe:false,
    restart_gate_since:null,
    host_resilience:h,
    authority_effect:false,
    ...overrides,
  };
}

function qualifiedPrior(overrides={}){
  return {
    schema:'metaengine.self-update.transaction.v1',
    transaction_id:'prior-qualified-transaction-v1',
    source_version:'0.7.0-dev.35330209176.1',
    target_version:CURRENT_VERSION,
    resolved_git_sha:PREVIOUS_SHA,
    state:'QUALIFIED',
    automatic_retry_allowed:false,
    authority_effect:false,
    ...overrides,
  };
}

test('healthy idle runtime with no unresolved prior becomes only external check-invocation review material',()=>{
  const admission=createRsiSelfUpdateCheckAdmission({
    eligibility_review:eligibilityReview(),
    self_update_runtime_snapshot:runtime(),
    prior_transaction:qualifiedPrior(),
    observed_at:NOW,
    observer_id:'trusted-self-update-controller-v1',
  });
  verifyRsiSelfUpdateCheckAdmission(admission);
  assert.equal(admission.state,'READY_FOR_EXTERNAL_SELF_UPDATE_CHECK_INVOCATION_REVIEW');
  assert.equal(admission.runtime.state,'IDLE');
  assert.equal(admission.runtime.current_version,CURRENT_VERSION);
  assert.equal(admission.prior_transaction.state,'QUALIFIED');
  assert.equal(admission.host_resilience.state,'ACTIVE');
  assert.equal(admission.host_resilience.sentinel_worker_ready,true);
  assert.equal(admission.external_self_update_controller_required,true);
  assert.equal(admission.existing_self_update_runtime_method,'checkNow');
  assert.equal(admission.fresh_trusted_release_reverification_inside_runtime_required,true);
  assert.equal(admission.self_update_check_invoked,false);
  assert.equal(admission.self_update_check_authorized_by_rsi,false);
  assert.equal(admission.self_update_apply_authorized,false);
  assert.equal(admission.installer_launch_authorized,false);
});

test('first install with no prior transaction is admissible for external check review',()=>{
  const admission=createRsiSelfUpdateCheckAdmission({
    eligibility_review:eligibilityReview(),
    self_update_runtime_snapshot:runtime({state:'CURRENT'}),
    prior_transaction:null,
    observed_at:NOW,
    observer_id:'trusted-self-update-controller-v1',
  });
  assert.equal(admission.prior_transaction.present,false);
  assert.equal(admission.prior_transaction.state,'NONE');
  assert.equal(admission.prior_transaction.readback_safe_for_new_check,true);
});

test('unresolved prior transactions fail closed before check admission',()=>{
  for(const state of ['PREPARED','INSTALLING','SUCCESSOR_BOOTED','AMBIGUOUS_INSTALL','QUARANTINED']){
    assert.throws(
      ()=>createRsiSelfUpdateCheckAdmission({
        eligibility_review:eligibilityReview(),
        self_update_runtime_snapshot:runtime(),
        prior_transaction:qualifiedPrior({state}),
        observed_at:NOW,
        observer_id:'trusted-self-update-controller-v1',
      }),
      /unresolved_prior/,
    );
  }
});

test('qualified prior must describe the actually running current version',()=>{
  assert.throws(
    ()=>createRsiSelfUpdateCheckAdmission({
      eligibility_review:eligibilityReview(),
      self_update_runtime_snapshot:runtime(),
      prior_transaction:qualifiedPrior({target_version:'0.7.0-dev.11111111111.1'}),
      observed_at:NOW,
      observer_id:'trusted-self-update-controller-v1',
    }),
    /qualified_prior_current_version_mismatch/,
  );
});

test('degraded host resilience or sentinel worker blocks self-update check admission',()=>{
  for(const badHost of [
    host({state:'DEGRADED_SENTINEL'}),
    host({sentinel_worker_healthy:false}),
    host({sentinel:{worker_ready:false}}),
    host({external_stop_requested:true}),
    host({sentinel_bootstrap_retry_pending:true}),
  ]){
    assert.throws(
      ()=>createRsiSelfUpdateCheckAdmission({
        eligibility_review:eligibilityReview(),
        self_update_runtime_snapshot:runtime({host_resilience:badHost}),
        prior_transaction:qualifiedPrior(),
        observed_at:NOW,
        observer_id:'trusted-self-update-controller-v1',
      }),
      /host_resilience_not_ready/,
    );
  }
});

test('busy, test-feed, emergency-bypass or inflight runtime states cannot enter RSI check path',()=>{
  const bad=[
    runtime({state:'DOWNLOADING'}),
    runtime({state:'READY_RESTART'}),
    runtime({ci_test_feed_active:true}),
    runtime({developer_emergency_requested:true}),
    runtime({developer_emergency_policy_bypass:true}),
    runtime({available_version:TARGET_VERSION}),
    runtime({downloaded_version:TARGET_VERSION}),
    runtime({pre_install_receipt_persisted:true}),
    runtime({installer_handoff_prepared:true}),
    runtime({restart_gate_safe:true}),
  ];
  for(const snapshot of bad){
    assert.throws(
      ()=>createRsiSelfUpdateCheckAdmission({
        eligibility_review:eligibilityReview(),
        self_update_runtime_snapshot:snapshot,
        prior_transaction:qualifiedPrior(),
        observed_at:NOW,
        observer_id:'trusted-self-update-controller-v1',
      }),
      /(runtime_policy_hold|runtime_state_not_check_safe|runtime_has_inflight_update_state)/,
    );
  }
});

test('already installed target cannot be re-entered through RSI check admission',()=>{
  assert.throws(
    ()=>createRsiSelfUpdateCheckAdmission({
      eligibility_review:eligibilityReview(),
      self_update_runtime_snapshot:runtime({current_version:TARGET_VERSION}),
      prior_transaction:null,
      observed_at:NOW,
      observer_id:'trusted-self-update-controller-v1',
    }),
    /target_already_installed/,
  );
});

test('admission cannot be widened into check, apply, restart or installer authority',()=>{
  const admission=createRsiSelfUpdateCheckAdmission({
    eligibility_review:eligibilityReview(),
    self_update_runtime_snapshot:runtime(),
    prior_transaction:qualifiedPrior(),
    observed_at:NOW,
    observer_id:'trusted-self-update-controller-v1',
  });
  for(const mutate of [
    (x)=>{x.self_update_check_invoked=true;},
    (x)=>{x.self_update_check_authorized_by_rsi=true;},
    (x)=>{x.self_update_apply_authorized=true;},
    (x)=>{x.restart_gate_authorized=true;},
    (x)=>{x.pre_install_receipt_authorized=true;},
    (x)=>{x.installer_handoff_authorized=true;},
    (x)=>{x.installer_launch_authorized=true;},
    (x)=>{x.physical_effect_replay_allowed=true;},
  ]){
    const copy=structuredClone(admission);mutate(copy);
    assert.throws(()=>verifyRsiSelfUpdateCheckAdmission(copy),/policy_invalid/);
  }
});

test('check-admission trust root keeps runtime, transaction journal and host resilience outside candidate control',()=>{
  const root=rsiSelfUpdateCheckAdmissionTrustRootSnapshot();
  assert.equal(root.external_self_update_controller_required,true);
  assert.equal(root.current_runtime_state_must_be_idle_or_current,true);
  assert.equal(root.unresolved_prior_transaction_forbidden,true);
  assert.equal(root.host_resilience_active_required,true);
  assert.equal(root.sentinel_worker_ready_required,true);
  assert.equal(root.ci_test_feed_forbidden,true);
  assert.equal(root.developer_emergency_bypass_forbidden,true);
  assert.equal(root.fresh_release_reverification_inside_runtime_required,true);
  assert.equal(root.self_update_check_authorized_by_rsi,false);
  assert.equal(root.self_update_apply_authorized,false);
  assert.equal(root.installer_launch_authorized,false);
  assert.equal(root.candidate_can_modify_admission_root,false);
});
