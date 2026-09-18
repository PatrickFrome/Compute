import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import {
  createRsiInstalledExecutableReadback,
  createRsiSelfUpdateSuccessorVerification,
  verifyRsiSelfUpdateSuccessorVerification,
  rsiSelfUpdateSuccessorVerificationTrustRootSnapshot,
} from '../src/rsi-self-update-successor-verification.mjs';

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
const INSTALLED='6'.repeat(64);

function finalAdmission(){
  const core={
    schema:'metaengine.rsi.self-update-final-install-cycle-admission.v1',version:1,
    state:'READY_FOR_EXTERNAL_FINAL_APPLY_INVOCATION_REVIEW',
    probe_outcome_digest:'sha256:'+'1'.repeat(64),probe_admission_digest:'sha256:'+'2'.repeat(64),
    download_readiness_digest:'sha256:'+'3'.repeat(64),
    candidate_sha:CANDIDATE,previous_authority_sha:PREVIOUS,
    target_release_tag:'v'+TARGET,target_release_version:TARGET,
    target_installer_sha256:'sha256:'+'4'.repeat(64),target_manifest_sha256:'sha256:'+'5'.repeat(64),
    target_installed_executable_sha256:'sha256:'+INSTALLED,
    observed_at:'2026-09-18T19:39:59.000Z',observer_id:'trusted-self-update-controller-v1',
    runtime:{
      schema:'metaengine.self-update-runtime.v8',state:'RESTART_GRACE',current_version:CURRENT,target_version:TARGET,
      resolved_git_sha:CANDIDATE,restart_gate_safe:true,restart_gate_since:'2026-09-18T19:39:40.000Z',
      restart_grace_ms:12000,grace_elapsed_ms:19000,install_attempted_version:null,
      pre_install_receipt_persisted:false,installer_handoff_prepared:false,
      runtime_snapshot_digest:'sha256:'+'7'.repeat(64),authority_effect:false,
    },
    prior_transaction:{present:true,state:'QUALIFIED',transaction_id:'prior-qualified-v1',target_version:CURRENT,authority_effect:false},
    host_resilience:{
      schema:'metaengine.host-resilience-runtime.v7',state:'ACTIVE',external_stop_requested:false,
      sentinel_worker_healthy:true,sentinel_worker_ready:true,sentinel_bootstrap_retry_pending:false,
      snapshot_digest:'sha256:'+'8'.repeat(64),authority_effect:false,
    },
    trusted_release:{
      schema:'metaengine.trusted-dev-release.v1',version:TARGET,tag:'v'+TARGET,git_sha:CANDIDATE,
      feed_url:'https://github.com/PatrickFrome/Compute/releases/download/v'+TARGET+'/',
      installer_name:'METAENGINE-Browser-Test-Setup-'+TARGET+'-x64.exe',
      installer_sha256:'sha256:'+'4'.repeat(64),manifest_sha256:'sha256:'+'5'.repeat(64),
      installed_executable_sha256:'sha256:'+INSTALLED,target_present_proof_supported:true,authority_effect:false,
    },
    exact_candidate_chain_verified:true,restart_gate_safe_reverified:true,restart_grace_elapsed_reverified:true,
    no_install_effect_yet_verified:true,external_self_update_controller_required:true,
    existing_self_update_runtime_method:'applyWhenSafe',admitted_final_cycle_count:1,single_final_apply_cycle_only:true,
    final_apply_invoked:false,final_apply_authorized_by_rsi:false,before_install_receipt_required:true,
    self_update_transaction_schema:'metaengine.self-update.transaction.v1',
    install_effect_barrier:'WRITE_AHEAD_V1',install_effect_scope:'BROWSER_RESTART',
    install_actuator:'ELECTRON_UPDATER_QUIT_AND_INSTALL',
    expected_effect_order:[
      'PERSIST_PRE_INSTALL_RECEIPT_AND_TRANSACTION','PREPARE_EXPECTED_RESTART',
      'PREPARE_INSTALLER_HANDOFF','CROSS_WRITE_AHEAD_INSTALL_EFFECT_BARRIER','ELECTRON_QUIT_AND_INSTALL',
    ],
    one_attempt_physical_effect_required:true,post_effect_transaction_readback_required:true,
    successor_startup_readback_required:true,ambiguous_install_reconciliation_only:true,
    automatic_install_retry_allowed:false,installer_launch_authorized_by_rsi:false,physical_effect_replay_allowed:false,
    execution_authority:false,browser_authority:false,scheduler_authority:false,task_authority:false,
    production_mutation_authority:false,promotion_authority:false,release_authority:false,self_update_authority:false,
    automatic_retry_allowed:false,authority_effect:false,
  };
  return {...core,final_install_admission_digest:digest(core)};
}

function transaction(state){
  return {
    schema:'metaengine.self-update.transaction.v1',transaction_id:'successor-transaction-v1',
    source_version:CURRENT,target_version:TARGET,resolved_git_sha:CANDIDATE,state,
    swapping:state==='INSTALLING',qualified:state==='QUALIFIED',quarantined:state==='QUARANTINED',
    attempt_count:1,automatic_retry_allowed:false,
    created_at:'2026-09-18T19:40:00.100Z',updated_at:'2026-09-18T19:41:00.000Z',
    evidence:{
      effect_barrier_contract:'WRITE_AHEAD_V1',effect_scope:'BROWSER_RESTART',
      actuator_type:'ELECTRON_UPDATER_QUIT_AND_INSTALL',physical_effect_attempted:true,
      effect_barrier_crossed:true,effect_must_be_single_shot:true,post_effect_readback_required:true,
    },
    authority_effect:false,
  };
}

function postEffect(state){
  const txnState=state==='QUALIFIED_SUCCESSOR'?'QUALIFIED':
    state==='SUCCESSOR_BOOTED_PENDING_QUALIFICATION'?'SUCCESSOR_BOOTED':
    state==='QUARANTINED_SUCCESSOR'?'QUARANTINED':
    state==='SUPERSEDED_ATTEMPT'?'SUPERSEDED':
    state==='AMBIGUOUS_INSTALL_RECONCILIATION_ONLY'?'AMBIGUOUS_INSTALL':'INSTALLING';
  const txn=state==='RECONCILIATION_ONLY'?null:transaction(txnState);
  const core={
    schema:'metaengine.rsi.self-update-post-effect-readback.v1',version:1,state,
    reason:'fixture',final_install_admission_digest:finalAdmission().final_install_admission_digest,
    invocation_receipt_digest:'sha256:'+'9'.repeat(64),invocation_id:'final-apply-invocation-v1',
    candidate_sha:CANDIDATE,previous_authority_sha:PREVIOUS,target_release_version:TARGET,
    observed_at:'2026-09-18T19:41:10.000Z',observer_id:'trusted-transaction-reader-v1',
    external_transaction_reader:true,authored_by_candidate:false,
    transaction:txn,transaction_present:txn!=null,
    transaction_terminal:['QUALIFIED_SUCCESSOR','QUARANTINED_SUCCESSOR','SUPERSEDED_ATTEMPT'].includes(state),
    physical_effect_status:txn?'ATTEMPTED':'UNKNOWN',
    effect_barrier_crossed:txn!=null,complete_effect_evidence:txn!=null,
    qualified_successor:state==='QUALIFIED_SUCCESSOR',
    successor_qualification_resume_allowed:['SUCCESSOR_BOOTED_PENDING_QUALIFICATION','QUARANTINED_SUCCESSOR'].includes(state),
    terminal_reconciliation_required:state==='AMBIGUOUS_INSTALL_RECONCILIATION_ONLY',
    ambiguous_or_pending_effect:state==='AMBIGUOUS_INSTALL_RECONCILIATION_ONLY',
    same_invocation_retry_allowed:false,fresh_physical_effect_retry_allowed:false,automatic_install_retry_allowed:false,
    successor_startup_readback_required:state!=='QUALIFIED_SUCCESSOR',
    existing_successor_qualification_pipeline_required:['SUCCESSOR_BOOTED_PENDING_QUALIFICATION','QUARANTINED_SUCCESSOR'].includes(state),
    existing_ambiguous_recovery_pipeline_required:state==='AMBIGUOUS_INSTALL_RECONCILIATION_ONLY',
    installer_success_claimed_from_invocation_receipt:false,physical_effect_replay_allowed:false,
    execution_authority:false,browser_authority:false,scheduler_authority:false,task_authority:false,
    production_mutation_authority:false,promotion_authority:false,release_authority:false,self_update_authority:false,
    automatic_retry_allowed:false,authority_effect:false,
  };
  return {...core,post_effect_readback_digest:digest(core)};
}

function startup(state){
  return {
    schema:'metaengine.self-update.startup-inspection.v1',state:'TARGET_INSTALLED',
    transaction_state:state,transaction_id:'successor-transaction-v1',target_git_sha:CANDIDATE,
    current_version:TARGET,target_version:TARGET,automatic_retry_allowed:false,authority_effect:false,
  };
}
function recovery(state){
  return {
    schema:'metaengine.self-update.recovery-diagnostic.v1',version:'1.1.0',state,
    recovery_active:true,startup_state:'TARGET_INSTALLED',
    transaction_state:state==='QUALIFIED'?'QUALIFIED':'SUCCESSOR_BOOTED',
    transaction_id:'successor-transaction-v1',target_git_sha:CANDIDATE,
    current_version:TARGET,target_version:TARGET,reason:null,
    qualification_resume_allowed:state==='TARGET_INSTALLED_PENDING_QUALIFICATION',
    recovery_installer_effect_allowed:false,automatic_retry_allowed:false,authority_effect:false,
  };
}
function receipt(){
  return {
    schema:'metaengine.self-update.successor-receipt.v1',version:TARGET,pid:4242,primary_instance:true,
    app_id:'metaengine-browser',successor_startup:'NORMAL',qualification_state:'BOOT_VERIFIED',
    pre_install_receipt_sha256:'a'.repeat(64),pre_install_recorded_at:'2026-09-18T19:39:59.500Z',
    recorded_at:'2026-09-18T19:40:05.000Z',authority_effect:false,
  };
}
function executable(overrides={}){
  return createRsiInstalledExecutableReadback({
    candidate_sha:CANDIDATE,version:TARGET,sha256:INSTALLED,
    observed_at:'2026-09-18T19:40:06.000Z',observer_id:'trusted-installed-exe-reader-v1',
    external_observer:true,authored_by_candidate:false,...overrides,
  });
}

test('exact successor boot evidence stays pending until existing qualification pipeline finishes',()=>{
  const row=createRsiSelfUpdateSuccessorVerification({
    final_install_admission:finalAdmission(),
    post_effect_readback:postEffect('SUCCESSOR_BOOTED_PENDING_QUALIFICATION'),
    startup_inspection:startup('SUCCESSOR_BOOTED'),
    transaction_readback:transaction('SUCCESSOR_BOOTED'),
    successor_receipt:receipt(),
    recovery_diagnostic:recovery('TARGET_INSTALLED_PENDING_QUALIFICATION'),
    installed_executable_readback:executable(),
    observed_at:'2026-09-18T19:41:20.000Z',observer_id:'trusted-successor-verifier-v1',
  });
  verifyRsiSelfUpdateSuccessorVerification(row);
  assert.equal(row.state,'SUCCESSOR_VERIFIED_PENDING_QUALIFICATION');
  assert.equal(row.exact_successor_identity_verified,true);
  assert.equal(row.installed_executable_digest_verified,true);
  assert.equal(row.qualification_resume_allowed,true);
  assert.equal(row.existing_successor_qualification_pipeline_required,true);
  assert.equal(row.eligible_for_post_adoption_measurement,false);
  assert.equal(row.new_installer_effect_allowed,false);
});

test('only exact qualified successor plus executable readback becomes learning-eligible deployment',()=>{
  const row=createRsiSelfUpdateSuccessorVerification({
    final_install_admission:finalAdmission(),post_effect_readback:postEffect('QUALIFIED_SUCCESSOR'),
    startup_inspection:startup('QUALIFIED'),transaction_readback:transaction('QUALIFIED'),
    successor_receipt:receipt(),recovery_diagnostic:recovery('QUALIFIED'),
    installed_executable_readback:executable(),
    observed_at:'2026-09-18T19:42:00.000Z',observer_id:'trusted-successor-verifier-v1',
  });
  verifyRsiSelfUpdateSuccessorVerification(row);
  assert.equal(row.state,'QUALIFIED_DEPLOYMENT_VERIFIED');
  assert.equal(row.qualified_deployment_verified,true);
  assert.equal(row.eligible_for_post_adoption_measurement,true);
  assert.equal(row.eligible_for_experience_graph,true);
  assert.equal(row.eligible_for_skill_evolution,true);
  assert.equal(row.qualification_resume_allowed,false);
  assert.equal(row.new_installer_effect_allowed,false);
});

test('candidate-authored or wrong installed executable readback fails closed',()=>{
  assert.throws(()=>createRsiInstalledExecutableReadback({
    candidate_sha:CANDIDATE,version:TARGET,sha256:INSTALLED,
    observed_at:'2026-09-18T19:40:06.000Z',observer_id:'trusted-installed-exe-reader-v1',
    external_observer:true,authored_by_candidate:true,
  }),/external_executable_observer_required/);

  assert.throws(()=>createRsiSelfUpdateSuccessorVerification({
    final_install_admission:finalAdmission(),post_effect_readback:postEffect('QUALIFIED_SUCCESSOR'),
    startup_inspection:startup('QUALIFIED'),transaction_readback:transaction('QUALIFIED'),
    successor_receipt:receipt(),recovery_diagnostic:recovery('QUALIFIED'),
    installed_executable_readback:executable({sha256:'f'.repeat(64)}),
    observed_at:'2026-09-18T19:42:00.000Z',observer_id:'trusted-successor-verifier-v1',
  }),/executable_readback_binding_mismatch/);
});

test('startup, transaction or recovery identity drift cannot verify a successor',()=>{
  const badStartup={...startup('QUALIFIED'),target_git_sha:'f'.repeat(40)};
  assert.throws(()=>createRsiSelfUpdateSuccessorVerification({
    final_install_admission:finalAdmission(),post_effect_readback:postEffect('QUALIFIED_SUCCESSOR'),
    startup_inspection:badStartup,transaction_readback:transaction('QUALIFIED'),
    successor_receipt:receipt(),recovery_diagnostic:recovery('QUALIFIED'),
    installed_executable_readback:executable(),observed_at:'2026-09-18T19:42:00.000Z',
    observer_id:'trusted-successor-verifier-v1',
  }),/startup_binding_mismatch/);

  assert.throws(()=>createRsiSelfUpdateSuccessorVerification({
    final_install_admission:finalAdmission(),post_effect_readback:postEffect('QUALIFIED_SUCCESSOR'),
    startup_inspection:startup('QUALIFIED'),
    transaction_readback:{...transaction('QUALIFIED'),transaction_id:'other-successor-transaction-v1'},
    successor_receipt:receipt(),recovery_diagnostic:recovery('QUALIFIED'),
    installed_executable_readback:executable(),observed_at:'2026-09-18T19:42:00.000Z',
    observer_id:'trusted-successor-verifier-v1',
  }),/startup_binding_mismatch/);

  const badRecovery={...recovery('QUALIFIED'),current_version:CURRENT};
  assert.throws(()=>createRsiSelfUpdateSuccessorVerification({
    final_install_admission:finalAdmission(),post_effect_readback:postEffect('QUALIFIED_SUCCESSOR'),
    startup_inspection:startup('QUALIFIED'),transaction_readback:transaction('QUALIFIED'),
    successor_receipt:receipt(),recovery_diagnostic:badRecovery,
    installed_executable_readback:executable(),observed_at:'2026-09-18T19:42:00.000Z',
    observer_id:'trusted-successor-verifier-v1',
  }),/recovery_binding_mismatch/);
});

test('ambiguous and quarantined outcomes stay out of deployment learning and cannot trigger installer retry',()=>{
  const ambiguous=createRsiSelfUpdateSuccessorVerification({
    final_install_admission:finalAdmission(),
    post_effect_readback:postEffect('AMBIGUOUS_INSTALL_RECONCILIATION_ONLY'),
    observed_at:'2026-09-18T19:42:00.000Z',observer_id:'trusted-successor-verifier-v1',
  });
  assert.equal(ambiguous.state,'RECONCILIATION_ONLY');
  assert.equal(ambiguous.eligible_for_experience_graph,false);
  assert.equal(ambiguous.new_installer_effect_allowed,false);
  assert.equal(ambiguous.fresh_physical_effect_retry_allowed,false);

  const quarantined=createRsiSelfUpdateSuccessorVerification({
    final_install_admission:finalAdmission(),
    post_effect_readback:postEffect('QUARANTINED_SUCCESSOR'),
    observed_at:'2026-09-18T19:42:00.000Z',observer_id:'trusted-successor-verifier-v1',
  });
  assert.equal(quarantined.state,'QUARANTINED_SUCCESSOR_HOLD');
  assert.equal(quarantined.qualification_resume_allowed,true);
  assert.equal(quarantined.eligible_for_skill_evolution,false);
  assert.equal(quarantined.new_installer_effect_allowed,false);
});

test('verified deployment eligibility cannot be widened or replayed',()=>{
  const base=createRsiSelfUpdateSuccessorVerification({
    final_install_admission:finalAdmission(),post_effect_readback:postEffect('QUALIFIED_SUCCESSOR'),
    startup_inspection:startup('QUALIFIED'),transaction_readback:transaction('QUALIFIED'),
    successor_receipt:receipt(),recovery_diagnostic:recovery('QUALIFIED'),
    installed_executable_readback:executable(),
    observed_at:'2026-09-18T19:42:00.000Z',observer_id:'trusted-successor-verifier-v1',
  });
  for(const mutate of [
    x=>{x.new_installer_effect_allowed=true;},
    x=>{x.same_invocation_retry_allowed=true;},
    x=>{x.fresh_physical_effect_retry_allowed=true;},
    x=>{x.physical_effect_replay_allowed=true;},
    x=>{x.self_update_authority=true;},
  ]){
    const copy=structuredClone(base);mutate(copy);
    assert.throws(()=>verifyRsiSelfUpdateSuccessorVerification(copy),/(retry_policy_invalid|self_update_authority_invalid)/);
  }
});

test('successor verification trust root permits learning only from qualified exact deployments',()=>{
  const root=rsiSelfUpdateSuccessorVerificationTrustRootSnapshot();
  assert.equal(root.exact_startup_transaction_receipt_binding_required,true);
  assert.equal(root.external_installed_executable_readback_required_for_verified_successor,true);
  assert.equal(root.qualified_transaction_required_for_post_adoption_measurement,true);
  assert.equal(root.pending_successor_uses_existing_qualification_pipeline,true);
  assert.equal(root.ambiguous_successor_uses_existing_recovery_pipeline,true);
  assert.equal(root.qualified_only_experience_admission,true);
  assert.equal(root.candidate_authored_executable_readback_forbidden,true);
  assert.equal(root.new_installer_effect_allowed,false);
  assert.equal(root.fresh_physical_effect_retry_allowed,false);
  assert.equal(root.candidate_can_modify_verification_root,false);
});
