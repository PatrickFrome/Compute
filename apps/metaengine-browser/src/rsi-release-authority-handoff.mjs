import crypto from 'node:crypto';

import {
  evaluateBrowserFabricReleaseAuthorityGate,
  browserFabricReleaseGateContract,
} from './browser-fabric-release-authority-gate.mjs';
import {
  verifyRsiExternalPromotionReviewResult,
} from './rsi-external-promotion-review.mjs';

export const RSI_RELEASE_AUTHORITY_READBACK_SCHEMA='metaengine.rsi.release-authority-readback.v1';
export const RSI_RELEASE_AUTHORITY_HANDOFF_SCHEMA='metaengine.rsi.release-authority-handoff.v1';
export const RSI_RELEASE_AUTHORITY_HANDOFF_ROOT_SCHEMA='metaengine.rsi.release-authority-handoff-root.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:@/+-]{2,255}$/;
const MAX_PAYLOAD_BYTES=48*1024;

function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.keys(value).sort().map((key)=>[key,stable(value[key])]));
}
function digest(value){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)),'utf8').digest('hex')}`}
function bytes(value){return Buffer.byteLength(JSON.stringify(stable(value)),'utf8')}
function zeroAuthority(extra={}){return Object.freeze({...extra,execution_authority:false,browser_authority:false,scheduler_authority:false,task_authority:false,production_mutation_authority:false,promotion_authority:false,release_authority:false,self_update_authority:false,automatic_retry_allowed:false,authority_effect:false})}
function assertZeroAuthority(value,label){
  for(const key of ['execution_authority','browser_authority','scheduler_authority','task_authority','production_mutation_authority','promotion_authority','release_authority','self_update_authority','authority_effect']){
    if(Object.hasOwn(value||{},key)&&value[key]!==false)throw new Error(`rsi_release_handoff_${label}_${key}_invalid`);
  }
  if(Object.hasOwn(value||{},'automatic_retry_allowed')&&value.automatic_retry_allowed!==false)throw new Error(`rsi_release_handoff_${label}_retry_invalid`);
}
function sha(value,label){const out=String(value||'').trim().toLowerCase();if(!SHA40_RE.test(out))throw new Error(`rsi_release_handoff_${label}_sha_invalid`);return out}
function sha256(value,label){const out=String(value||'').trim().toLowerCase();if(!SHA256_RE.test(out))throw new Error(`rsi_release_handoff_${label}_digest_invalid`);return out}
function safeId(value,label){const out=String(value||'').trim();if(!SAFE_ID_RE.test(out))throw new Error(`rsi_release_handoff_${label}_invalid`);return out}
function iso(value,label){const raw=String(value||'').trim();const parsed=Date.parse(raw);if(!raw||!Number.isFinite(parsed))throw new Error(`rsi_release_handoff_${label}_time_invalid`);return new Date(parsed).toISOString()}

export function createRsiReleaseAuthorityReadback({
  verifier_id,
  verified_at,
  current_authority_sha,
  current_version,
  browser_generation,
  exact_runtime_identity=false,
  externally_verified=false,
}={}){
  if(exact_runtime_identity!==true||externally_verified!==true)throw new Error('rsi_release_handoff_readback_external_exact_required');
  const generation=Number(browser_generation);
  if(!Number.isSafeInteger(generation)||generation<1)throw new Error('rsi_release_handoff_browser_generation_invalid');
  const core=zeroAuthority({
    schema:RSI_RELEASE_AUTHORITY_READBACK_SCHEMA,
    version:1,
    verifier_id:safeId(verifier_id,'readback_verifier'),
    verified_at:iso(verified_at,'readback_verified_at'),
    current_authority_sha:sha(current_authority_sha,'current_authority'),
    current_version:safeId(current_version,'current_version'),
    browser_generation:generation,
    exact_runtime_identity:true,
    externally_verified:true,
    page_or_model_claim_is_authority:false,
    readback_is_release_authority:false,
  });
  return Object.freeze({...core,readback_digest:digest(core)});
}

export function verifyRsiReleaseAuthorityReadback(row){
  if(!row||typeof row!=='object'||Array.isArray(row)||row.schema!==RSI_RELEASE_AUTHORITY_READBACK_SCHEMA||row.version!==1)throw new Error('rsi_release_handoff_readback_invalid');
  assertZeroAuthority(row,'readback');
  if(row.exact_runtime_identity!==true||row.externally_verified!==true||row.page_or_model_claim_is_authority!==false||row.readback_is_release_authority!==false)throw new Error('rsi_release_handoff_readback_policy_invalid');
  const canonical=createRsiReleaseAuthorityReadback({
    verifier_id:row.verifier_id,
    verified_at:row.verified_at,
    current_authority_sha:row.current_authority_sha,
    current_version:row.current_version,
    browser_generation:row.browser_generation,
    exact_runtime_identity:true,
    externally_verified:true,
  });
  if(canonical.readback_digest!==sha256(row.readback_digest,'readback'))throw new Error('rsi_release_handoff_readback_digest_mismatch');
  return canonical;
}

function reviewCandidate(reviewResult,reviewRequest){
  verifyRsiExternalPromotionReviewResult(reviewResult,reviewRequest);
  if(reviewResult.state!=='READY_FOR_EXTERNAL_PROMOTION_REVIEW'||reviewResult.ready_for_external_promotion_review!==true)throw new Error('rsi_release_handoff_review_not_ready');
  if(reviewResult.external_human_or_release_authority_still_required!==true||reviewResult.existing_self_update_handoff_authorized!==false||reviewResult.direct_install_authorized!==false||reviewResult.self_update_invocation_authorized!==false||reviewResult.promotion_token!==null)throw new Error('rsi_release_handoff_review_policy_invalid');
  return Object.freeze({
    candidate_sha:sha(reviewResult.candidate_sha,'review_candidate'),
    parent_sha:sha(reviewResult.parent_sha,'review_parent'),
    review_result_digest:sha256(reviewResult.result_digest,'review_result'),
    review_request_digest:sha256(reviewResult.request_digest,'review_request'),
  });
}

function recomputeReleaseGate({candidate,readback,trusted_release,immutable_release_evidence,provenance_evidence,source_ancestry_evidence,evaluated_at}){
  return evaluateBrowserFabricReleaseAuthorityGate({
    candidate_sha:candidate.candidate_sha,
    current_authority_sha:readback.current_authority_sha,
    trusted_release,
    immutable_release_evidence,
    provenance_evidence,
    source_ancestry_evidence,
    now:new Date(evaluated_at),
  });
}

export function createRsiReleaseAuthorityHandoff({
  promotion_review_result,
  promotion_review_request,
  authority_readback,
  trusted_release,
  immutable_release_evidence,
  provenance_evidence,
  source_ancestry_evidence,
  evaluated_at,
}={}){
  const candidate=reviewCandidate(promotion_review_result,promotion_review_request);
  const readback=verifyRsiReleaseAuthorityReadback(authority_readback);
  const evaluatedAt=iso(evaluated_at,'evaluated_at');
  if(Date.parse(readback.verified_at)>Date.parse(evaluatedAt))throw new Error('rsi_release_handoff_readback_from_future');
  if(candidate.parent_sha!==readback.current_authority_sha)throw new Error('rsi_release_handoff_parent_not_current_authority');
  const gate=recomputeReleaseGate({
    candidate,readback,trusted_release,immutable_release_evidence,provenance_evidence,source_ancestry_evidence,evaluated_at:evaluatedAt,
  });
  const ready=gate.action==='AUTHORITY_ADVANCE_CANDIDATE'
    && gate.authority_advance_candidate===true
    && gate.requires_separate_journaled_promotion_effect===true
    && gate.release_authority===false;
  const state=ready?'READY_FOR_EXTERNAL_RELEASE_EXECUTOR':'HELD';
  const blockers=ready?[]:[String(gate.reason||'RELEASE_GATE_HELD')];
  const core=zeroAuthority({
    schema:RSI_RELEASE_AUTHORITY_HANDOFF_SCHEMA,
    version:1,
    state,
    blockers:Object.freeze(blockers),
    evaluated_at:evaluatedAt,
    candidate_sha:candidate.candidate_sha,
    parent_sha:candidate.parent_sha,
    promotion_review_result_digest:candidate.review_result_digest,
    promotion_review_request_digest:candidate.review_request_digest,
    authority_readback:readback,
    authority_readback_digest:readback.readback_digest,
    release_gate_result:Object.freeze(structuredClone(gate)),
    release_gate_contract:Object.freeze(structuredClone(browserFabricReleaseGateContract())),
    trusted_release:Object.freeze(structuredClone(trusted_release)),
    immutable_release_evidence:Object.freeze(structuredClone(immutable_release_evidence)),
    provenance_evidence:Object.freeze(structuredClone(provenance_evidence)),
    source_ancestry_evidence:Object.freeze(structuredClone(source_ancestry_evidence)),
    ready_for_external_release_executor:ready,
    separate_journaled_promotion_effect_required:true,
    exact_live_readback_required_before_effect:true,
    external_release_executor_required:true,
    release_executor_identity_selected:false,
    release_transaction_created:false,
    installer_effect_started:false,
    self_update_check_invoked:false,
    self_update_apply_invoked:false,
    direct_install_authorized:false,
    direct_self_update_authorized:false,
    promotion_token:null,
    ambiguous_effect_replay_allowed:false,
  });
  const payloadBytes=bytes(core);
  if(payloadBytes>MAX_PAYLOAD_BYTES)throw new Error('rsi_release_handoff_payload_budget_exceeded');
  return Object.freeze({...core,payload_bytes:payloadBytes,max_payload_bytes:MAX_PAYLOAD_BYTES,handoff_digest:digest(core)});
}

export function verifyRsiReleaseAuthorityHandoff(row,promotionReviewResult,promotionReviewRequest){
  if(!row||typeof row!=='object'||Array.isArray(row)||row.schema!==RSI_RELEASE_AUTHORITY_HANDOFF_SCHEMA||row.version!==1)throw new Error('rsi_release_handoff_invalid');
  assertZeroAuthority(row,'handoff');
  if(!['READY_FOR_EXTERNAL_RELEASE_EXECUTOR','HELD'].includes(row.state))throw new Error('rsi_release_handoff_state_invalid');
  if(
    row.separate_journaled_promotion_effect_required!==true
    || row.exact_live_readback_required_before_effect!==true
    || row.external_release_executor_required!==true
    || row.release_executor_identity_selected!==false
    || row.release_transaction_created!==false
    || row.installer_effect_started!==false
    || row.self_update_check_invoked!==false
    || row.self_update_apply_invoked!==false
    || row.direct_install_authorized!==false
    || row.direct_self_update_authorized!==false
    || row.promotion_token!==null
    || row.ambiguous_effect_replay_allowed!==false
  )throw new Error('rsi_release_handoff_policy_invalid');
  const candidate=reviewCandidate(promotionReviewResult,promotionReviewRequest);
  if(row.candidate_sha!==candidate.candidate_sha||row.parent_sha!==candidate.parent_sha||row.promotion_review_result_digest!==candidate.review_result_digest||row.promotion_review_request_digest!==candidate.review_request_digest)throw new Error('rsi_release_handoff_review_binding_mismatch');
  const readback=verifyRsiReleaseAuthorityReadback(row.authority_readback);
  if(readback.readback_digest!==row.authority_readback_digest)throw new Error('rsi_release_handoff_readback_binding_mismatch');
  const canonical=createRsiReleaseAuthorityHandoff({
    promotion_review_result:promotionReviewResult,
    promotion_review_request:promotionReviewRequest,
    authority_readback:readback,
    trusted_release:row.trusted_release,
    immutable_release_evidence:row.immutable_release_evidence,
    provenance_evidence:row.provenance_evidence,
    source_ancestry_evidence:row.source_ancestry_evidence,
    evaluated_at:row.evaluated_at,
  });
  if(canonical.handoff_digest!==sha256(row.handoff_digest,'handoff'))throw new Error('rsi_release_handoff_digest_mismatch');
  if(canonical.payload_bytes!==Number(row.payload_bytes)||canonical.max_payload_bytes!==Number(row.max_payload_bytes))throw new Error('rsi_release_handoff_size_mismatch');
  return canonical;
}

export function rsiReleaseAuthorityHandoffTrustRootSnapshot(){
  const gate=browserFabricReleaseGateContract();
  const root=zeroAuthority({
    schema:RSI_RELEASE_AUTHORITY_HANDOFF_ROOT_SCHEMA,
    version:1,
    policy_path:'apps/metaengine-browser/src/rsi-release-authority-handoff.mjs',
    external_promotion_review_ready_required:true,
    exact_runtime_authority_readback_required:true,
    immutable_verified_release_required:true,
    slsa_provenance_required:true,
    source_fast_forward_proof_required:true,
    installed_executable_binding_required:true,
    browser_fabric_release_gate_reused:true,
    release_gate_direct_authority_mutation_allowed:gate.direct_authority_mutation_allowed,
    separate_journaled_promotion_effect_required:true,
    external_release_executor_required:true,
    direct_install_authorized:false,
    direct_self_update_authorized:false,
    ambiguous_effect_replay_allowed:false,
    max_payload_bytes:MAX_PAYLOAD_BYTES,
    no_second_scheduler:true,
  });
  return Object.freeze({...root,release_handoff_root_digest:digest(root)});
}
