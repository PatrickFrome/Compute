import crypto from 'node:crypto';

import {
  verifyRsiSelfUpdateFinalInstallCycleAdmission,
} from './rsi-self-update-final-install-cycle-admission.mjs';
import {
  verifyRsiSelfUpdatePostEffectReadback,
} from './rsi-self-update-final-apply-readback.mjs';

export const RSI_SELF_UPDATE_SUCCESSOR_VERIFICATION_SCHEMA =
  'metaengine.rsi.self-update-successor-verification.v1';
export const RSI_INSTALLED_EXECUTABLE_READBACK_SCHEMA =
  'metaengine.rsi.installed-executable-readback.v1';

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
  if(!SHA40.test(o))throw new Error('rsi_successor_'+l+'_sha_invalid');
  return o;
}
function exactDigest(v,l){
  const o=String(v||'').trim().toLowerCase();
  if(!SHA256.test(o))throw new Error('rsi_successor_'+l+'_digest_invalid');
  return o;
}
function exactHex(v,l){
  const o=String(v||'').trim().toLowerCase().replace(/^sha256:/,'');
  if(!HEX64.test(o))throw new Error('rsi_successor_'+l+'_digest_invalid');
  return o;
}
function exactUtc(v,l){
  const o=String(v||'');
  if(!UTC.test(o)||!Number.isFinite(Date.parse(o)))throw new Error('rsi_successor_'+l+'_time_invalid');
  return new Date(Date.parse(o)).toISOString();
}
function safeId(v,l){
  const o=String(v||'').trim();
  if(!SAFE_ID.test(o))throw new Error('rsi_successor_'+l+'_invalid');
  return o;
}
function zero(extra={}){
  return Object.freeze({
    ...extra,
    execution_authority:false,browser_authority:false,scheduler_authority:false,task_authority:false,
    production_mutation_authority:false,promotion_authority:false,release_authority:false,
    self_update_authority:false,automatic_retry_allowed:false,authority_effect:false,
  });
}
function assertZero(v,l){
  for(const f of ['execution_authority','browser_authority','scheduler_authority','task_authority',
    'production_mutation_authority','promotion_authority','release_authority','self_update_authority','authority_effect']){
    if(Object.hasOwn(v||{},f)&&v[f]!==false)throw new Error('rsi_successor_'+l+'_'+f+'_invalid');
  }
  if(Object.hasOwn(v||{},'automatic_retry_allowed')&&v.automatic_retry_allowed!==false){
    throw new Error('rsi_successor_'+l+'_automatic_retry_invalid');
  }
}

function verifyTransaction(txn, admission, expectedState){
  if(!txn||typeof txn!=='object'||Array.isArray(txn)||txn.schema!=='metaengine.self-update.transaction.v1'){
    throw new Error('rsi_successor_transaction_schema_invalid');
  }
  if(txn.authority_effect!==false||txn.automatic_retry_allowed!==false){
    throw new Error('rsi_successor_transaction_authority_invalid');
  }
  if(
    String(txn.target_version||'')!==admission.target_release_version
    ||String(txn.source_version||'')!==admission.runtime.current_version
    ||exactSha(txn.resolved_git_sha,'transaction_source')!==admission.candidate_sha
    ||String(txn.state||'').toUpperCase()!==expectedState
  )throw new Error('rsi_successor_transaction_binding_mismatch');
  return Object.freeze({
    schema:txn.schema,
    transaction_id:safeId(txn.transaction_id,'transaction_id'),
    source_version:txn.source_version,target_version:txn.target_version,resolved_git_sha:admission.candidate_sha,
    state:expectedState,qualified:txn.qualified===true,quarantined:txn.quarantined===true,
    attempt_count:Number(txn.attempt_count||0),
    created_at:exactUtc(txn.created_at,'transaction_created_at'),
    updated_at:exactUtc(txn.updated_at,'transaction_updated_at'),
    transaction_digest:digest(txn),authority_effect:false,
  });
}

function verifyStartup(inspection, admission, transaction, expectedState){
  if(!inspection||typeof inspection!=='object'||Array.isArray(inspection)
    ||inspection.schema!=='metaengine.self-update.startup-inspection.v1'){
    throw new Error('rsi_successor_startup_schema_invalid');
  }
  if(inspection.authority_effect!==false||inspection.automatic_retry_allowed!==false){
    throw new Error('rsi_successor_startup_authority_invalid');
  }
  if(
    inspection.state!=='TARGET_INSTALLED'
    ||inspection.transaction_state!==expectedState
    ||String(inspection.transaction_id||'')!==transaction.transaction_id
    ||exactSha(inspection.target_git_sha,'startup_target')!==admission.candidate_sha
    ||String(inspection.current_version||'')!==admission.target_release_version
    ||String(inspection.target_version||'')!==admission.target_release_version
  )throw new Error('rsi_successor_startup_binding_mismatch');
  return Object.freeze({
    schema:inspection.schema,state:'TARGET_INSTALLED',transaction_state:expectedState,
    transaction_id:transaction.transaction_id,target_git_sha:admission.candidate_sha,
    current_version:admission.target_release_version,target_version:admission.target_release_version,
    startup_digest:digest(inspection),automatic_retry_allowed:false,authority_effect:false,
  });
}

function verifyRecovery(diagnostic, startup, expectedState){
  if(!diagnostic||typeof diagnostic!=='object'||Array.isArray(diagnostic)
    ||diagnostic.schema!=='metaengine.self-update.recovery-diagnostic.v1'){
    throw new Error('rsi_successor_recovery_schema_invalid');
  }
  if(diagnostic.authority_effect!==false||diagnostic.automatic_retry_allowed!==false
    ||diagnostic.recovery_installer_effect_allowed!==false){
    throw new Error('rsi_successor_recovery_authority_invalid');
  }
  if(
    diagnostic.state!==expectedState
    ||String(diagnostic.transaction_id||'')!==startup.transaction_id
    ||String(diagnostic.current_version||'')!==startup.current_version
    ||String(diagnostic.target_version||'')!==startup.target_version
    ||(diagnostic.target_git_sha&&exactSha(diagnostic.target_git_sha,'recovery_target')!==startup.target_git_sha)
  )throw new Error('rsi_successor_recovery_binding_mismatch');
  return Object.freeze({
    schema:diagnostic.schema,version:String(diagnostic.version||''),state:expectedState,
    transaction_id:startup.transaction_id,current_version:startup.current_version,target_version:startup.target_version,
    target_git_sha:startup.target_git_sha,qualification_resume_allowed:diagnostic.qualification_resume_allowed===true,
    recovery_installer_effect_allowed:false,recovery_digest:digest(diagnostic),
    automatic_retry_allowed:false,authority_effect:false,
  });
}

function verifySuccessorReceipt(receipt, admission, transaction){
  if(!receipt||typeof receipt!=='object'||Array.isArray(receipt)
    ||receipt.schema!=='metaengine.self-update.successor-receipt.v1'){
    throw new Error('rsi_successor_receipt_schema_invalid');
  }
  if(receipt.authority_effect!==false||receipt.primary_instance!==true
    ||receipt.qualification_state!=='BOOT_VERIFIED'){
    throw new Error('rsi_successor_receipt_invariant_invalid');
  }
  if(String(receipt.version||'')!==admission.target_release_version){
    throw new Error('rsi_successor_receipt_version_mismatch');
  }
  const pid=Number(receipt.pid);
  if(!Number.isSafeInteger(pid)||pid<1)throw new Error('rsi_successor_receipt_pid_invalid');
  const pre=String(receipt.pre_install_receipt_sha256||'').trim().toLowerCase();
  if(!HEX64.test(pre))throw new Error('rsi_successor_receipt_preinstall_digest_invalid');
  const recorded=exactUtc(receipt.recorded_at,'successor_receipt_recorded_at');
  if(Date.parse(recorded)<Date.parse(transaction.created_at||recorded)){
    throw new Error('rsi_successor_receipt_predates_transaction');
  }
  return Object.freeze({
    schema:receipt.schema,version:receipt.version,pid,primary_instance:true,
    app_id:receipt.app_id==null?null:String(receipt.app_id),
    successor_startup:String(receipt.successor_startup||''),
    qualification_state:'BOOT_VERIFIED',
    pre_install_receipt_sha256:pre,
    pre_install_recorded_at:String(receipt.pre_install_recorded_at||''),
    recorded_at:recorded,successor_receipt_digest:digest(receipt),authority_effect:false,
  });
}

export function createRsiInstalledExecutableReadback({
  candidate_sha,version,sha256,observed_at,observer_id,path_digest=null,
  external_observer=false,authored_by_candidate=true,
}={}){
  if(external_observer!==true||authored_by_candidate!==false){
    throw new Error('rsi_successor_external_executable_observer_required');
  }
  const core=zero({
    schema:RSI_INSTALLED_EXECUTABLE_READBACK_SCHEMA,version:1,
    candidate_sha:exactSha(candidate_sha,'executable_candidate'),
    installed_version:String(version||''),
    installed_executable_sha256:'sha256:'+exactHex(sha256,'installed_executable'),
    observed_at:exactUtc(observed_at,'executable_observed_at'),
    observer_id:safeId(observer_id,'executable_observer_id'),
    path_digest:path_digest==null?null:exactDigest(path_digest,'path'),
    external_observer:true,authored_by_candidate:false,
    filesystem_readback:true,installer_success_inferred:false,
  });
  return Object.freeze({...core,readback_digest:digest(core)});
}

function verifyExecutable(row,admission){
  if(!row||row.schema!==RSI_INSTALLED_EXECUTABLE_READBACK_SCHEMA||row.version!==1){
    throw new Error('rsi_successor_executable_readback_schema_invalid');
  }
  assertZero(row,'executable_readback');
  if(row.external_observer!==true||row.authored_by_candidate!==false
    ||row.filesystem_readback!==true||row.installer_success_inferred!==false){
    throw new Error('rsi_successor_executable_readback_policy_invalid');
  }
  if(
    exactSha(row.candidate_sha,'executable_candidate')!==admission.candidate_sha
    ||String(row.installed_version||'')!==admission.target_release_version
    ||exactDigest(row.installed_executable_sha256,'installed_executable')!==admission.target_installed_executable_sha256
  )throw new Error('rsi_successor_executable_readback_binding_mismatch');
  const clone=structuredClone(row);
  const claimed=exactDigest(clone.readback_digest,'executable_readback');
  delete clone.readback_digest;
  if(digest(clone)!==claimed)throw new Error('rsi_successor_executable_readback_digest_mismatch');
  return row;
}

export function createRsiSelfUpdateSuccessorVerification({
  final_install_admission,
  post_effect_readback,
  startup_inspection=null,
  transaction_readback=null,
  successor_receipt=null,
  recovery_diagnostic=null,
  installed_executable_readback=null,
  observed_at,
  observer_id,
}={}){
  const admission=verifyRsiSelfUpdateFinalInstallCycleAdmission(final_install_admission);
  const post=verifyRsiSelfUpdatePostEffectReadback(post_effect_readback);
  if(post.final_install_admission_digest!==admission.final_install_admission_digest
    ||post.candidate_sha!==admission.candidate_sha
    ||post.target_release_version!==admission.target_release_version){
    throw new Error('rsi_successor_post_effect_binding_mismatch');
  }
  const observedAt=exactUtc(observed_at,'observed_at');
  const observer=safeId(observer_id,'observer_id');

  let state='RECONCILIATION_ONLY';
  let reason=post.state;
  let startup=null,transaction=null,recovery=null,receipt=null,executable=null;
  let eligible=false;
  let qualificationResume=false;

  if(post.state==='SUCCESSOR_BOOTED_PENDING_QUALIFICATION'||post.state==='QUALIFIED_SUCCESSOR'){
    const expectedTxn=post.state==='QUALIFIED_SUCCESSOR'?'QUALIFIED':'SUCCESSOR_BOOTED';
    transaction=verifyTransaction(transaction_readback,admission,expectedTxn);
    startup=verifyStartup(startup_inspection,admission,transaction,expectedTxn);
    recovery=verifyRecovery(
      recovery_diagnostic,
      startup,
      expectedTxn==='QUALIFIED'?'QUALIFIED':'TARGET_INSTALLED_PENDING_QUALIFICATION',
    );
    receipt=verifySuccessorReceipt(successor_receipt,admission,transaction);
    executable=verifyExecutable(installed_executable_readback,admission);

    if(expectedTxn==='QUALIFIED'){
      if(transaction.qualified!==true||transaction.quarantined===true
        ||recovery.qualification_resume_allowed===true){
        throw new Error('rsi_successor_qualified_invariant_invalid');
      }
      state='QUALIFIED_DEPLOYMENT_VERIFIED';
      reason='EXACT_SUCCESSOR_QUALIFIED_WITH_EXECUTABLE_READBACK';
      eligible=true;
    }else{
      if(transaction.qualified===true||transaction.quarantined===true
        ||recovery.qualification_resume_allowed!==true){
        throw new Error('rsi_successor_pending_invariant_invalid');
      }
      state='SUCCESSOR_VERIFIED_PENDING_QUALIFICATION';
      reason='EXACT_SUCCESSOR_BOOTED_PENDING_EXISTING_QUALIFICATION';
      qualificationResume=true;
    }
  }else if(post.state==='QUARANTINED_SUCCESSOR'){
    state='QUARANTINED_SUCCESSOR_HOLD';
    reason='EXISTING_QUALIFICATION_HEAL_PATH_ONLY';
    qualificationResume=true;
  }else if(post.state==='SUPERSEDED_ATTEMPT'){
    state='SUPERSEDED_SUCCESSOR';
    reason='TRANSACTION_SUPERSEDED';
  }else if(post.state==='NO_EFFECT_BARRIER_NOT_CROSSED'){
    state='NO_EFFECT_TERMINAL_RECONCILIATION_REQUIRED';
    reason='NO_INSTALL_EFFECT_RECORDED';
  }else{
    state='RECONCILIATION_ONLY';
    reason=post.state;
  }

  const core=zero({
    schema:RSI_SELF_UPDATE_SUCCESSOR_VERIFICATION_SCHEMA,version:1,state,reason,
    final_install_admission_digest:admission.final_install_admission_digest,
    post_effect_readback_digest:post.post_effect_readback_digest,
    candidate_sha:admission.candidate_sha,previous_authority_sha:admission.previous_authority_sha,
    target_release_version:admission.target_release_version,
    observed_at:observedAt,observer_id:observer,
    startup_inspection:startup,transaction_readback:transaction,recovery_diagnostic:recovery,
    successor_receipt:receipt,installed_executable_readback:executable,
    exact_successor_identity_verified:state==='QUALIFIED_DEPLOYMENT_VERIFIED'||state==='SUCCESSOR_VERIFIED_PENDING_QUALIFICATION',
    installed_executable_digest_verified:executable!=null,
    qualified_deployment_verified:state==='QUALIFIED_DEPLOYMENT_VERIFIED',
    eligible_for_post_adoption_measurement:eligible,
    eligible_for_experience_graph:eligible,
    eligible_for_skill_evolution:eligible,
    qualification_resume_allowed:qualificationResume,
    existing_successor_qualification_pipeline_required:qualificationResume,
    existing_ambiguous_recovery_pipeline_required:state==='RECONCILIATION_ONLY',
    new_installer_effect_allowed:false,same_invocation_retry_allowed:false,
    fresh_physical_effect_retry_allowed:false,physical_effect_replay_allowed:false,
  });
  return Object.freeze({...core,successor_verification_digest:digest(core)});
}

export function verifyRsiSelfUpdateSuccessorVerification(row){
  if(!row||typeof row!=='object'||Array.isArray(row)
    ||row.schema!==RSI_SELF_UPDATE_SUCCESSOR_VERIFICATION_SCHEMA||row.version!==1){
    throw new Error('rsi_successor_verification_schema_invalid');
  }
  assertZero(row,'verification');
  if(![
    'QUALIFIED_DEPLOYMENT_VERIFIED','SUCCESSOR_VERIFIED_PENDING_QUALIFICATION',
    'QUARANTINED_SUCCESSOR_HOLD','SUPERSEDED_SUCCESSOR',
    'NO_EFFECT_TERMINAL_RECONCILIATION_REQUIRED','RECONCILIATION_ONLY',
  ].includes(row.state))throw new Error('rsi_successor_verification_state_invalid');
  if(row.new_installer_effect_allowed!==false||row.same_invocation_retry_allowed!==false
    ||row.fresh_physical_effect_retry_allowed!==false||row.physical_effect_replay_allowed!==false){
    throw new Error('rsi_successor_verification_retry_policy_invalid');
  }
  const qualified=row.state==='QUALIFIED_DEPLOYMENT_VERIFIED';
  if(
    row.qualified_deployment_verified!==qualified
    ||row.eligible_for_post_adoption_measurement!==qualified
    ||row.eligible_for_experience_graph!==qualified
    ||row.eligible_for_skill_evolution!==qualified
  )throw new Error('rsi_successor_verification_eligibility_invalid');
  exactDigest(row.final_install_admission_digest,'final_install_admission');
  exactDigest(row.post_effect_readback_digest,'post_effect_readback');
  exactSha(row.candidate_sha,'candidate');
  exactSha(row.previous_authority_sha,'previous_authority');
  exactUtc(row.observed_at,'observed_at');
  safeId(row.observer_id,'observer_id');
  const clone=structuredClone(row);
  const claimed=exactDigest(clone.successor_verification_digest,'successor_verification');
  delete clone.successor_verification_digest;
  if(digest(clone)!==claimed)throw new Error('rsi_successor_verification_digest_mismatch');
  return row;
}

export function rsiSelfUpdateSuccessorVerificationTrustRootSnapshot(){
  const root={
    schema:'metaengine.rsi.self-update-successor-verification-root.v1',version:1,
    adapter_path:'apps/metaengine-browser/src/rsi-self-update-successor-verification.mjs',
    startup_inspection_path:'apps/metaengine-browser/src/self-update-handoff.mjs',
    successor_recovery_path:'apps/metaengine-browser/src/self-update-successor-recovery.mjs',
    successor_qualification_path:'apps/metaengine-browser/src/self-update-successor-qualification.mjs',
    ambiguous_recovery_path:'apps/metaengine-browser/src/self-update-ambiguous-successor-recovery.mjs',
    exact_startup_transaction_receipt_binding_required:true,
    external_installed_executable_readback_required_for_verified_successor:true,
    qualified_transaction_required_for_post_adoption_measurement:true,
    pending_successor_uses_existing_qualification_pipeline:true,
    ambiguous_successor_uses_existing_recovery_pipeline:true,
    qualified_only_experience_admission:true,
    candidate_authored_executable_readback_forbidden:true,
    new_installer_effect_allowed:false,same_invocation_retry_allowed:false,
    fresh_physical_effect_retry_allowed:false,candidate_can_modify_verification_root:false,
    physical_effect_replay_allowed:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,
    release_authority:false,self_update_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...root,successor_verification_root_digest:digest(root)});
}
