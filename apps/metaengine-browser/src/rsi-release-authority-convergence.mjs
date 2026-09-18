import crypto from 'node:crypto';

import { verifyRsiReleaseEffectReconciliation } from './rsi-release-effect-reconciliation.mjs';
import { verifyRsiReleaseAuthorityHandoff } from './rsi-release-authority-handoff.mjs';
import { verifyRsiExternalPromotionReviewResult } from './rsi-external-promotion-review.mjs';

export const RSI_EXTERNAL_RELEASE_AUTHORITY_READBACK_SCHEMA='metaengine.rsi.external-release-authority-readback.v1';
export const RSI_RELEASE_AUTHORITY_CONVERGENCE_SCHEMA='metaengine.rsi.release-authority-convergence.v1';
export const RSI_RELEASE_AUTHORITY_CONVERGENCE_ROOT_SCHEMA='metaengine.rsi.release-authority-convergence-root.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const HEX64_RE=/^[0-9a-f]{64}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:@/+-]{2,255}$/;
const MAX_PAYLOAD_BYTES=32*1024;

function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));
}
function digest(value){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)),'utf8').digest('hex')}`}
function bytes(value){return Buffer.byteLength(JSON.stringify(stable(value)),'utf8')}
function zeroAuthority(extra={}){return Object.freeze({...extra,execution_authority:false,browser_authority:false,scheduler_authority:false,task_authority:false,production_mutation_authority:false,promotion_authority:false,release_authority:false,self_update_authority:false,automatic_retry_allowed:false,authority_effect:false})}
function assertZeroAuthority(value,label){
  for(const key of ['execution_authority','browser_authority','scheduler_authority','task_authority','production_mutation_authority','promotion_authority','release_authority','self_update_authority','authority_effect']){
    if(Object.hasOwn(value||{},key)&&value[key]!==false)throw new Error(`rsi_release_convergence_${label}_${key}_invalid`);
  }
  if(Object.hasOwn(value||{},'automatic_retry_allowed')&&value.automatic_retry_allowed!==false)throw new Error(`rsi_release_convergence_${label}_retry_invalid`);
}
function sha(value,label){const out=String(value||'').trim().toLowerCase();if(!SHA40_RE.test(out))throw new Error(`rsi_release_convergence_${label}_sha_invalid`);return out}
function hex64(value,label){const out=String(value||'').trim().toLowerCase();if(!HEX64_RE.test(out))throw new Error(`rsi_release_convergence_${label}_hex_invalid`);return out}
function sha256(value,label){const out=String(value||'').trim().toLowerCase();if(!SHA256_RE.test(out))throw new Error(`rsi_release_convergence_${label}_digest_invalid`);return out}
function safeId(value,label){const out=String(value||'').trim();if(!SAFE_ID_RE.test(out))throw new Error(`rsi_release_convergence_${label}_invalid`);return out}
function iso(value,label){const raw=String(value||'').trim();const parsed=Date.parse(raw);if(!raw||!Number.isFinite(parsed))throw new Error(`rsi_release_convergence_${label}_time_invalid`);return new Date(parsed).toISOString()}
function positive(value,label){const out=Number(value);if(!Number.isSafeInteger(out)||out<1)throw new Error(`rsi_release_convergence_${label}_invalid`);return out}
function plain(value){return value&&typeof value==='object'&&!Array.isArray(value)}

export function createRsiExternalReleaseAuthorityReadback({
  verifier_id,
  observed_at,
  authority_source_id,
  authority_journal_ref,
  authority_journal_digest,
  authority_sha,
  release_version,
  release_tag,
  installed_executable_sha256,
  browser_generation,
  authoritative_source_readback=false,
  journal_append_verified=false,
  external_release_authority_verified=false,
}={}){
  if(authoritative_source_readback!==true||journal_append_verified!==true||external_release_authority_verified!==true){
    throw new Error('rsi_release_convergence_external_authority_proof_required');
  }
  const core=zeroAuthority({
    schema:RSI_EXTERNAL_RELEASE_AUTHORITY_READBACK_SCHEMA,
    version:1,
    verifier_id:safeId(verifier_id,'verifier'),
    observed_at:iso(observed_at,'observed_at'),
    authority_source_id:safeId(authority_source_id,'authority_source'),
    authority_journal_ref:safeId(authority_journal_ref,'journal_ref'),
    authority_journal_digest:sha256(authority_journal_digest,'journal'),
    authority_sha:sha(authority_sha,'authority'),
    release_version:safeId(release_version,'release_version'),
    release_tag:safeId(release_tag,'release_tag'),
    installed_executable_sha256:hex64(installed_executable_sha256,'installed_executable'),
    browser_generation:positive(browser_generation,'browser_generation'),
    authoritative_source_readback:true,
    journal_append_verified:true,
    external_release_authority_verified:true,
    page_or_model_output_is_authority:false,
    readback_is_authority_mutation:false,
    authority_store_mutated_by_readback:false,
  });
  return Object.freeze({...core,readback_digest:digest(core)});
}

export function verifyRsiExternalReleaseAuthorityReadback(row){
  if(!plain(row)||row.schema!==RSI_EXTERNAL_RELEASE_AUTHORITY_READBACK_SCHEMA||row.version!==1)throw new Error('rsi_release_convergence_readback_invalid');
  assertZeroAuthority(row,'readback');
  if(
    row.authoritative_source_readback!==true
    || row.journal_append_verified!==true
    || row.external_release_authority_verified!==true
    || row.page_or_model_output_is_authority!==false
    || row.readback_is_authority_mutation!==false
    || row.authority_store_mutated_by_readback!==false
  )throw new Error('rsi_release_convergence_readback_policy_invalid');
  const canonical=createRsiExternalReleaseAuthorityReadback({
    verifier_id:row.verifier_id,
    observed_at:row.observed_at,
    authority_source_id:row.authority_source_id,
    authority_journal_ref:row.authority_journal_ref,
    authority_journal_digest:row.authority_journal_digest,
    authority_sha:row.authority_sha,
    release_version:row.release_version,
    release_tag:row.release_tag,
    installed_executable_sha256:row.installed_executable_sha256,
    browser_generation:row.browser_generation,
    authoritative_source_readback:true,
    journal_append_verified:true,
    external_release_authority_verified:true,
  });
  if(canonical.readback_digest!==sha256(row.readback_digest,'readback'))throw new Error('rsi_release_convergence_readback_digest_mismatch');
  return canonical;
}

export function createRsiReleaseAuthorityConvergence({
  release_effect_reconciliation,
  release_handoff,
  promotion_review_result,
  promotion_review_request,
  external_authority_readback,
  converged_at,
}={}){
  const reconciliation=verifyRsiReleaseEffectReconciliation(release_effect_reconciliation);
  if(reconciliation.result!=='CONFIRMED'||reconciliation.physical_effect_confirmed!==true){
    throw new Error('rsi_release_convergence_confirmed_effect_required');
  }
  if(reconciliation.external_release_authority_convergence_still_required!==true){
    throw new Error('rsi_release_convergence_prior_gate_not_open');
  }
  const review=promotion_review_result;
  verifyRsiExternalPromotionReviewResult(review,promotion_review_request);
  const handoff=verifyRsiReleaseAuthorityHandoff(release_handoff,review,promotion_review_request);
  if(
    reconciliation.release_handoff_digest!==handoff.handoff_digest
    || reconciliation.candidate_sha!==handoff.candidate_sha
    || reconciliation.parent_sha!==handoff.parent_sha
  )throw new Error('rsi_release_convergence_effect_release_binding_mismatch');
  const readback=verifyRsiExternalReleaseAuthorityReadback(external_authority_readback);
  const convergedAt=iso(converged_at,'converged_at');
  if(Date.parse(readback.observed_at)>Date.parse(convergedAt))throw new Error('rsi_release_convergence_future_readback');

  const successor=reconciliation.successor_runtime_readback;
  if(!successor||successor.successor_qualification_state!=='QUALIFIED'){
    throw new Error('rsi_release_convergence_qualified_successor_required');
  }
  const expectedRelease=handoff.trusted_release;
  if(
    readback.authority_sha!==handoff.candidate_sha
    || readback.release_version!==expectedRelease.version
    || readback.release_tag!==expectedRelease.tag
    || readback.installed_executable_sha256!==String(expectedRelease.installed_executable_sha256).toLowerCase()
    || readback.browser_generation!==successor.browser_generation
    || readback.authority_sha!==successor.running_git_sha
    || readback.release_version!==successor.running_version
    || readback.installed_executable_sha256!==successor.installed_executable_sha256
  )throw new Error('rsi_release_convergence_authority_successor_mismatch');

  const core=zeroAuthority({
    schema:RSI_RELEASE_AUTHORITY_CONVERGENCE_SCHEMA,
    version:1,
    state:'EXTERNAL_RELEASE_AUTHORITY_CONVERGED',
    converged_at:convergedAt,
    candidate_sha:handoff.candidate_sha,
    predecessor_sha:handoff.parent_sha,
    release_version:expectedRelease.version,
    release_tag:expectedRelease.tag,
    installed_executable_sha256:String(expectedRelease.installed_executable_sha256).toLowerCase(),
    browser_generation:successor.browser_generation,
    release_effect_reconciliation_digest:reconciliation.reconciliation_digest,
    release_handoff_digest:handoff.handoff_digest,
    promotion_review_result_digest:review.result_digest,
    successor_runtime_readback_digest:successor.readback_digest,
    external_authority_readback:readback,
    external_authority_readback_digest:readback.readback_digest,
    authority_source_id:readback.authority_source_id,
    authority_journal_ref:readback.authority_journal_ref,
    authority_journal_digest:readback.authority_journal_digest,
    physical_successor_exact:true,
    external_authority_exact:true,
    source_and_physical_authority_converged:true,
    convergence_is_observation_only:true,
    authority_store_mutated_by_rsi:false,
    release_authority_advanced_by_rsi:false,
    self_update_effect_invoked_by_rsi:false,
    promotion_effect_invoked_by_rsi:false,
    rollback_effect_invoked_by_rsi:false,
    effect_reexecution_authorized:false,
    retry_authorized:false,
    ambiguous_effect_replay_allowed:false,
    post_deployment_learning_allowed_from_verified_outcome:true,
    direct_release_or_install_action_allowed:false,
  });
  const payloadBytes=bytes(core);
  if(payloadBytes>MAX_PAYLOAD_BYTES)throw new Error('rsi_release_convergence_payload_budget_exceeded');
  return Object.freeze({...core,payload_bytes:payloadBytes,max_payload_bytes:MAX_PAYLOAD_BYTES,convergence_digest:digest(core)});
}

export function verifyRsiReleaseAuthorityConvergence(row){
  if(!plain(row)||row.schema!==RSI_RELEASE_AUTHORITY_CONVERGENCE_SCHEMA||row.version!==1)throw new Error('rsi_release_convergence_invalid');
  assertZeroAuthority(row,'convergence');
  if(
    row.state!=='EXTERNAL_RELEASE_AUTHORITY_CONVERGED'
    || row.physical_successor_exact!==true
    || row.external_authority_exact!==true
    || row.source_and_physical_authority_converged!==true
    || row.convergence_is_observation_only!==true
    || row.authority_store_mutated_by_rsi!==false
    || row.release_authority_advanced_by_rsi!==false
    || row.self_update_effect_invoked_by_rsi!==false
    || row.promotion_effect_invoked_by_rsi!==false
    || row.rollback_effect_invoked_by_rsi!==false
    || row.effect_reexecution_authorized!==false
    || row.retry_authorized!==false
    || row.ambiguous_effect_replay_allowed!==false
    || row.post_deployment_learning_allowed_from_verified_outcome!==true
    || row.direct_release_or_install_action_allowed!==false
  )throw new Error('rsi_release_convergence_policy_invalid');
  sha(row.candidate_sha,'candidate');sha(row.predecessor_sha,'predecessor');hex64(row.installed_executable_sha256,'installed_executable');
  for(const [value,label] of [
    [row.release_effect_reconciliation_digest,'reconciliation'],
    [row.release_handoff_digest,'handoff'],
    [row.promotion_review_result_digest,'promotion_review'],
    [row.successor_runtime_readback_digest,'successor'],
    [row.external_authority_readback_digest,'authority_readback'],
    [row.authority_journal_digest,'authority_journal'],
  ])sha256(value,label);
  const readback=verifyRsiExternalReleaseAuthorityReadback(row.external_authority_readback);
  if(
    readback.readback_digest!==row.external_authority_readback_digest
    || readback.authority_source_id!==row.authority_source_id
    || readback.authority_journal_ref!==row.authority_journal_ref
    || readback.authority_journal_digest!==row.authority_journal_digest
    || readback.authority_sha!==row.candidate_sha
    || readback.release_version!==row.release_version
    || readback.release_tag!==row.release_tag
    || readback.installed_executable_sha256!==row.installed_executable_sha256
    || readback.browser_generation!==row.browser_generation
  )throw new Error('rsi_release_convergence_readback_binding_mismatch');
  const core={...structuredClone(row)};delete core.payload_bytes;delete core.max_payload_bytes;delete core.convergence_digest;
  const payloadBytes=bytes(core);
  if(payloadBytes!==Number(row.payload_bytes)||payloadBytes>Number(row.max_payload_bytes)||Number(row.max_payload_bytes)!==MAX_PAYLOAD_BYTES)throw new Error('rsi_release_convergence_size_mismatch');
  if(digest(core)!==sha256(row.convergence_digest,'convergence'))throw new Error('rsi_release_convergence_digest_mismatch');
  return row;
}

export function rsiReleaseAuthorityConvergenceTrustRootSnapshot(){
  const root=zeroAuthority({
    schema:RSI_RELEASE_AUTHORITY_CONVERGENCE_ROOT_SCHEMA,
    version:1,
    policy_path:'apps/metaengine-browser/src/rsi-release-authority-convergence.mjs',
    confirmed_physical_effect_required:true,
    exact_qualified_successor_required:true,
    trusted_release_version_sha_and_installed_executable_required:true,
    external_authority_source_readback_required:true,
    external_authority_journal_append_proof_required:true,
    successor_and_authority_browser_generation_exact:true,
    page_or_model_output_is_authority:false,
    convergence_is_observation_only:true,
    no_new_release_authority_store_created:true,
    authority_store_mutated_by_rsi:false,
    release_authority_advanced_by_rsi:false,
    self_update_effect_invoked_by_rsi:false,
    rollback_effect_invoked_by_rsi:false,
    post_deployment_learning_allowed_only_after_convergence:true,
    direct_release_or_install_action_allowed:false,
    effect_reexecution_authorized:false,
    retry_authorized:false,
    ambiguous_effect_replay_allowed:false,
    max_payload_bytes:MAX_PAYLOAD_BYTES,
    no_second_scheduler:true,
  });
  return Object.freeze({...root,convergence_root_digest:digest(root)});
}
