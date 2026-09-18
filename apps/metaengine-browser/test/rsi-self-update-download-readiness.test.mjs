import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import {
  createRsiSelfUpdateCheckAdmission,
} from '../src/rsi-self-update-controller-admission.mjs';
import {
  createRsiSelfUpdateDownloadReadiness,
  verifyRsiSelfUpdateDownloadReadiness,
  rsiSelfUpdateDownloadReadinessTrustRootSnapshot,
} from '../src/rsi-self-update-download-readiness.mjs';

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
const TAG='v'+TARGET_VERSION;
const FEED='https://github.com/PatrickFrome/Compute/releases/download/'+TAG+'/';
const INSTALLER='METAENGINE-Browser-Test-Setup-'+TARGET_VERSION+'-x64.exe';
const NOW='2026-09-18T19:20:00.000Z';

function eligibility(){
  const core={
    schema:'metaengine.rsi.self-update-eligibility-review.v1',version:1,
    state:'READY_FOR_EXTERNAL_SELF_UPDATE_CHECK_REVIEW',
    candidate_sha:CANDIDATE_SHA,previous_authority_sha:PREVIOUS_SHA,
    release_tag:TAG,release_version:TARGET_VERSION,installer_name:INSTALLER,
    installer_sha256:'sha256:'+'1'.repeat(64),manifest_sha256:'sha256:'+'2'.repeat(64),
    dev_yml_sha256:'sha256:'+'3'.repeat(64),installed_executable_sha256:'sha256:'+'4'.repeat(64),
    journal_intent_digest:'sha256:'+'5'.repeat(64),authority_readback_digest:'sha256:'+'6'.repeat(64),
    release_promotion_confirmed:true,exact_release_authority_confirmed:true,trusted_release_reverified:true,
    installed_executable_binding_present:true,external_self_update_controller_required:true,existing_self_update_runtime_required:true,
    self_update_transaction_schema:'metaengine.self-update.transaction.v1',
    install_effect_barrier:'WRITE_AHEAD_V1',install_effect_scope:'BROWSER_RESTART',install_actuator:'ELECTRON_UPDATER_QUIT_AND_INSTALL',
    fresh_release_reverification_required_at_check:true,prior_self_update_transaction_readback_required:true,
    restart_gate_revalidation_required:true,host_resilience_revalidation_required:true,
    self_update_check_authorized:false,self_update_apply_authorized:false,self_update_handoff_authorized:false,
    installer_launch_authorized:false,direct_install_authorized:false,physical_effect_replay_allowed:false,
    execution_authority:false,browser_authority:false,scheduler_authority:false,task_authority:false,
    production_mutation_authority:false,promotion_authority:false,release_authority:false,self_update_authority:false,
    automatic_retry_allowed:false,authority_effect:false,
  };
  return {...core,eligibility_review_digest:digest(core)};
}

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
    transaction_id:'prior-qualified-transaction-download-v1',
    source_version:'0.7.0-dev.35330209176.1',target_version:CURRENT_VERSION,
    resolved_git_sha:PREVIOUS_SHA,state:'QUALIFIED',automatic_retry_allowed:false,authority_effect:false,...overrides,
  };
}

function precheckRuntime(){
  return {
    schema:'metaengine.self-update-runtime.v8',state:'IDLE',current_version:CURRENT_VERSION,
    control_plane_enabled:true,install_effect_quarantined:false,ci_test_feed_active:false,
    developer_emergency_requested:false,developer_emergency_policy_bypass:false,
    available_version:null,downloaded_version:null,install_attempted_version:null,
    pre_install_receipt_persisted:false,installer_handoff_prepared:false,restart_gate_safe:false,restart_gate_since:null,
    host_resilience:host(),authority_effect:false,
  };
}

function admission(){
  return createRsiSelfUpdateCheckAdmission({
    eligibility_review:eligibility(),self_update_runtime_snapshot:precheckRuntime(),prior_transaction:prior(),
    observed_at:'2026-09-18T19:10:00.000Z',observer_id:'trusted-self-update-controller-v1',
  });
}

function release(overrides={}){
  return {
    schema:'metaengine.trusted-dev-release.v1',version:TARGET_VERSION,tag:TAG,git_sha:CANDIDATE_SHA,
    feed_url:FEED,installer_name:INSTALLER,installer_sha256:'1'.repeat(64),manifest_sha256:'2'.repeat(64),
    dev_yml_sha256:'3'.repeat(64),installed_executable_sha256:'4'.repeat(64),
    target_present_proof_supported:true,authority_effect:false,...overrides,
  };
}

function downloaded(overrides={}){
  return {
    schema:'metaengine.self-update-runtime.v8',
    state:'READY_RESTART',current_version:CURRENT_VERSION,
    control_plane_enabled:true,install_effect_quarantined:false,ci_test_feed_active:false,
    developer_emergency_requested:false,developer_emergency_policy_bypass:false,
    available_version:TARGET_VERSION,downloaded_version:TARGET_VERSION,metadata_verified:true,
    publisher_verified:true,release_resolution:'VERIFIED',resolved_tag:TAG,resolved_git_sha:CANDIDATE_SHA,
    resolved_feed_url:FEED,candidate_file_count:1,download_percent:100,
    install_attempted_version:null,pre_install_receipt_persisted:false,installer_handoff_prepared:false,
    restart_gate_safe:false,restart_gate_since:null,host_resilience:host(),authority_effect:false,...overrides,
  };
}

test('exact trusted downloaded candidate becomes only external apply-cycle review readiness',()=>{
  const row=createRsiSelfUpdateDownloadReadiness({
    check_admission:admission(),post_check_runtime_snapshot:downloaded(),prior_transaction:prior(),
    trusted_release:release(),observed_at:NOW,observer_id:'trusted-self-update-controller-v1',
  });
  verifyRsiSelfUpdateDownloadReadiness(row);
  assert.equal(row.state,'READY_FOR_EXTERNAL_APPLY_CYCLE_REVIEW');
  assert.equal(row.exact_downloaded_candidate_verified,true);
  assert.equal(row.metadata_verified,true);
  assert.equal(row.publisher_verified,true);
  assert.equal(row.trusted_release_reverified_after_download,true);
  assert.equal(row.no_install_effect_attempted,true);
  assert.equal(row.runtime.state,'READY_RESTART');
  assert.equal(row.runtime.download_percent,100);
  assert.equal(row.apply_cycle_invoked,false);
  assert.equal(row.apply_cycle_authorized_by_rsi,false);
  assert.equal(row.installer_launch_authorized,false);
});

test('download candidate identity drift fails closed',()=>{
  for(const snapshot of [
    downloaded({available_version:'0.7.0-dev.88888888888.1'}),
    downloaded({downloaded_version:'0.7.0-dev.88888888888.1'}),
    downloaded({metadata_verified:false}),
    downloaded({publisher_verified:false}),
    downloaded({resolved_git_sha:'f'.repeat(40)}),
    downloaded({resolved_tag:'v0.7.0-dev.88888888888.1'}),
    downloaded({candidate_file_count:2}),
    downloaded({download_percent:99}),
  ]){
    assert.throws(
      ()=>createRsiSelfUpdateDownloadReadiness({
        check_admission:admission(),post_check_runtime_snapshot:snapshot,prior_transaction:prior(),
        trusted_release:release(),observed_at:NOW,observer_id:'trusted-self-update-controller-v1',
      }),
      /(runtime_state_invalid|candidate_binding_invalid)/,
    );
  }
});

test('any pre-install or restart-gate effect before readiness fails closed',()=>{
  for(const snapshot of [
    downloaded({state:'RESTART_GRACE',restart_gate_safe:true,restart_gate_since:'2026-09-18T19:19:59.000Z'}),
    downloaded({install_attempted_version:TARGET_VERSION}),
    downloaded({pre_install_receipt_persisted:true}),
    downloaded({installer_handoff_prepared:true}),
    downloaded({restart_gate_safe:true,restart_gate_since:'2026-09-18T19:19:59.000Z'}),
  ]){
    assert.throws(
      ()=>createRsiSelfUpdateDownloadReadiness({
        check_admission:admission(),post_check_runtime_snapshot:snapshot,prior_transaction:prior(),
        trusted_release:release(),observed_at:NOW,observer_id:'trusted-self-update-controller-v1',
      }),
      /(runtime_state_invalid|install_effect_already_started)/,
    );
  }
});

test('trusted release is reverified after download and exact digest/source drift is rejected',()=>{
  for(const trusted of [
    release({git_sha:'f'.repeat(40)}),
    release({installer_sha256:'9'.repeat(64)}),
    release({manifest_sha256:'9'.repeat(64)}),
    release({installed_executable_sha256:'9'.repeat(64)}),
    release({target_present_proof_supported:false}),
    release({feed_url:'https://example.invalid/'}),
  ]){
    assert.throws(
      ()=>createRsiSelfUpdateDownloadReadiness({
        check_admission:admission(),post_check_runtime_snapshot:downloaded(),prior_transaction:prior(),
        trusted_release:trusted,observed_at:NOW,observer_id:'trusted-self-update-controller-v1',
      }),
      /(trusted_release_identity_mismatch|trusted_release_digest_mismatch|release_feed_invalid)/,
    );
  }
});

test('prior transaction must remain the same terminal readback seen at check admission',()=>{
  for(const p of [
    prior({state:'SUCCESSOR_BOOTED'}),
    prior({transaction_id:'different-prior-transaction-v1'}),
    prior({target_version:'0.7.0-dev.35330209176.1'}),
  ]){
    assert.throws(
      ()=>createRsiSelfUpdateDownloadReadiness({
        check_admission:admission(),post_check_runtime_snapshot:downloaded(),prior_transaction:p,
        trusted_release:release(),observed_at:NOW,observer_id:'trusted-self-update-controller-v1',
      }),
      /(unresolved_prior|prior_transaction_drift)/,
    );
  }
});

test('host degradation after download blocks readiness before apply-cycle review',()=>{
  for(const h of [
    host({state:'DEGRADED_SENTINEL'}),
    host({sentinel_worker_healthy:false}),
    host({sentinel:{worker_ready:false}}),
    host({external_stop_requested:true}),
  ]){
    assert.throws(
      ()=>createRsiSelfUpdateDownloadReadiness({
        check_admission:admission(),post_check_runtime_snapshot:downloaded({host_resilience:h}),prior_transaction:prior(),
        trusted_release:release(),observed_at:NOW,observer_id:'trusted-self-update-controller-v1',
      }),
      /host_not_ready/,
    );
  }
});

test('readiness cannot be widened into apply, restart, handoff, installer or replay authority',()=>{
  const base=createRsiSelfUpdateDownloadReadiness({
    check_admission:admission(),post_check_runtime_snapshot:downloaded(),prior_transaction:prior(),
    trusted_release:release(),observed_at:NOW,observer_id:'trusted-self-update-controller-v1',
  });
  for(const mutate of [
    (x)=>{x.apply_cycle_invoked=true;},
    (x)=>{x.apply_cycle_authorized_by_rsi=true;},
    (x)=>{x.restart_authorized=true;},
    (x)=>{x.pre_install_receipt_authorized=true;},
    (x)=>{x.installer_handoff_authorized=true;},
    (x)=>{x.installer_launch_authorized=true;},
    (x)=>{x.physical_effect_replay_allowed=true;},
  ]){
    const copy=structuredClone(base);mutate(copy);
    assert.throws(()=>verifyRsiSelfUpdateDownloadReadiness(copy),/policy_invalid/);
  }
});

test('download-readiness trust root keeps apply and installer effects outside RSI',()=>{
  const root=rsiSelfUpdateDownloadReadinessTrustRootSnapshot();
  assert.equal(root.exact_downloaded_candidate_required,true);
  assert.equal(root.publisher_and_metadata_verification_required,true);
  assert.equal(root.no_install_effect_before_readiness,true);
  assert.equal(root.external_apply_controller_required,true);
  assert.equal(root.restart_gate_owned_by_existing_runtime,true);
  assert.equal(root.restart_grace_required,true);
  assert.equal(root.prior_transaction_recheck_required,true);
  assert.equal(root.host_resilience_recheck_required,true);
  assert.equal(root.apply_cycle_authorized_by_rsi,false);
  assert.equal(root.installer_launch_authorized,false);
  assert.equal(root.candidate_can_modify_readiness_root,false);
});
