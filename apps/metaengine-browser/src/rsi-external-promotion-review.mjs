import crypto from 'node:crypto';

import {
  verifyRsiExternalPromotionQualification,
  evaluateRsiPromotionAdmission,
  rsiPromotionGateTrustRootSnapshot,
} from './rsi-promotion-admission-gate.mjs';
import {
  evaluateRsiShadowTournament,
  verifyRsiShadowTournamentPlan,
  verifyRsiShadowTournamentResult,
} from './rsi-shadow-tournament.mjs';
import { verifyRsiExternalEvaluationBundle } from './rsi-external-evaluation-evidence-adapter.mjs';

export const RSI_EXTERNAL_PROMOTION_REVIEW_REQUEST_SCHEMA='metaengine.rsi.external-promotion-review-request.v1';
export const RSI_EXTERNAL_PROMOTION_REVIEW_RESULT_SCHEMA='metaengine.rsi.external-promotion-review-result.v1';
export const RSI_EXTERNAL_PROMOTION_REVIEW_ROOT_SCHEMA='metaengine.rsi.external-promotion-review-root.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const CANDIDATE_ID_RE=/^candidate_sha256_[0-9a-f]{64}$/;
const MAX_REQUEST_BYTES=52*1024;

function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));
}
function digest(value){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)),'utf8').digest('hex')}`}
function bytes(value){return Buffer.byteLength(JSON.stringify(stable(value)),'utf8')}
function same(left,right){return JSON.stringify(stable(left))===JSON.stringify(stable(right))}
function zeroAuthority(extra={}){return Object.freeze({...extra,execution_authority:false,browser_authority:false,scheduler_authority:false,task_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,automatic_retry_allowed:false,authority_effect:false})}
function assertZeroAuthority(value,label){
  for(const key of ['execution_authority','browser_authority','scheduler_authority','task_authority','production_mutation_authority','promotion_authority','self_update_authority','authority_effect']){
    if(Object.hasOwn(value||{},key)&&value[key]!==false)throw new Error(`rsi_promotion_review_${label}_${key}_invalid`);
  }
  if(Object.hasOwn(value||{},'automatic_retry_allowed')&&value.automatic_retry_allowed!==false)throw new Error(`rsi_promotion_review_${label}_retry_invalid`);
}
function exactSha(value,label){const out=String(value||'').trim().toLowerCase();if(!SHA40_RE.test(out))throw new Error(`rsi_promotion_review_${label}_sha_invalid`);return out}
function exactDigest(value,label){const out=String(value||'').trim().toLowerCase();if(!SHA256_RE.test(out))throw new Error(`rsi_promotion_review_${label}_digest_invalid`);return out}
function candidateId(value){const out=String(value||'').trim().toLowerCase();if(!CANDIDATE_ID_RE.test(out))throw new Error('rsi_promotion_review_candidate_id_invalid');return out}

function candidateFromHandoff(handoff,bundle){
  if(!handoff||typeof handoff!=='object'||Array.isArray(handoff))throw new Error('rsi_promotion_review_candidate_handoff_invalid');
  assertZeroAuthority(handoff,'candidate_handoff');
  const core=structuredClone(handoff);
  delete core.handoff_digest;
  const handoffDigest=digest(core);
  if(handoffDigest!==bundle.isolated_candidate_handoff_digest||handoff.handoff_digest!==handoffDigest)throw new Error('rsi_promotion_review_candidate_handoff_digest_mismatch');
  const candidate=Object.freeze({
    candidate_id:candidateId(handoff.candidate_capsule?.candidate_id),
    candidate_sha:exactSha(handoff.candidate_sha,'candidate'),
    parent_sha:exactSha(handoff.parent_sha,'parent'),
    handoff_digest:handoffDigest,
  });
  if(candidate.candidate_id!==bundle.candidate_id||candidate.candidate_sha!==bundle.candidate_sha||candidate.parent_sha!==bundle.parent_sha)throw new Error('rsi_promotion_review_candidate_bundle_mismatch');
  if(handoff.eligible_for_evaluation!==true||handoff.eligible_for_promotion!==false||handoff.materialization_replay_authorized!==false)throw new Error('rsi_promotion_review_candidate_policy_invalid');
  return candidate;
}

export function createRsiExternalPromotionReviewRequest({
  evaluation_bundle,
  candidate_handoff,
  tournament_plan,
  tournament_result,
  tournament_receipts,
  qualification,
}={}){
  const bundle=verifyRsiExternalEvaluationBundle(evaluation_bundle);
  if(bundle.all_classes_pass!==true||bundle.any_class_ambiguous!==false)throw new Error('rsi_promotion_review_candidate_not_nomination_ready');
  const candidate=candidateFromHandoff(candidate_handoff,bundle);
  verifyRsiShadowTournamentPlan(tournament_plan);
  if(tournament_plan.plan_digest!==bundle.tournament_plan_digest)throw new Error('rsi_promotion_review_tournament_plan_mismatch');
  const canonicalTournament=evaluateRsiShadowTournament({plan:tournament_plan,receipts:tournament_receipts});
  verifyRsiShadowTournamentResult({plan:tournament_plan,result:tournament_result});
  if(!same(canonicalTournament,tournament_result)||canonicalTournament.result_digest!==bundle.tournament_result_digest)throw new Error('rsi_promotion_review_tournament_result_not_canonical');
  if(canonicalTournament.relation!=='PARETO_ADVANCE')throw new Error('rsi_promotion_review_tournament_not_pareto_advance');
  if(canonicalTournament.candidate?.candidate_id!==candidate.candidate_id||canonicalTournament.candidate?.candidate_sha!==candidate.candidate_sha)throw new Error('rsi_promotion_review_tournament_candidate_mismatch');
  const verifiedQualification=verifyRsiExternalPromotionQualification(qualification,candidate);
  const root=rsiPromotionGateTrustRootSnapshot();
  const core=zeroAuthority({
    schema:RSI_EXTERNAL_PROMOTION_REVIEW_REQUEST_SCHEMA,
    version:1,
    candidate_id:candidate.candidate_id,
    candidate_sha:candidate.candidate_sha,
    parent_sha:candidate.parent_sha,
    isolated_candidate_handoff_digest:candidate.handoff_digest,
    evaluation_bundle_digest:bundle.bundle_digest,
    tournament_plan:tournament_plan,
    tournament_result:canonicalTournament,
    tournament_receipts:Object.freeze(structuredClone(tournament_receipts)),
    tournament_plan_digest:tournament_plan.plan_digest,
    tournament_result_digest:canonicalTournament.result_digest,
    qualification:verifiedQualification,
    qualification_digest:verifiedQualification.qualification_digest,
    promotion_gate_root_digest:root.promotion_gate_root_digest,
    required_workflows:Object.freeze([...root.required_workflows]),
    candidate_can_promote:false,
    candidate_can_invoke_self_update:false,
    review_is_promotion_authority:false,
    review_is_self_update_authority:false,
    direct_install_authorized:false,
    self_update_invocation_authorized:false,
    promotion_token:null,
    external_review_required:true,
  });
  const payloadBytes=bytes(core);
  if(payloadBytes>MAX_REQUEST_BYTES)throw new Error('rsi_promotion_review_request_budget_exceeded');
  return Object.freeze({...core,payload_bytes:payloadBytes,max_payload_bytes:MAX_REQUEST_BYTES,request_digest:digest(core)});
}

export function verifyRsiExternalPromotionReviewRequest(request){
  if(!request||typeof request!=='object'||Array.isArray(request)||request.schema!==RSI_EXTERNAL_PROMOTION_REVIEW_REQUEST_SCHEMA||request.version!==1)throw new Error('rsi_promotion_review_request_invalid');
  assertZeroAuthority(request,'request');
  if(
    request.candidate_can_promote!==false
    || request.candidate_can_invoke_self_update!==false
    || request.review_is_promotion_authority!==false
    || request.review_is_self_update_authority!==false
    || request.direct_install_authorized!==false
    || request.self_update_invocation_authorized!==false
    || request.promotion_token!==null
    || request.external_review_required!==true
  )throw new Error('rsi_promotion_review_request_policy_invalid');
  candidateId(request.candidate_id);
  exactSha(request.candidate_sha,'candidate');
  exactSha(request.parent_sha,'parent');
  for(const [value,label] of [
    [request.isolated_candidate_handoff_digest,'handoff'],
    [request.evaluation_bundle_digest,'evaluation_bundle'],
    [request.tournament_plan_digest,'tournament_plan'],
    [request.tournament_result_digest,'tournament_result'],
    [request.qualification_digest,'qualification'],
    [request.promotion_gate_root_digest,'promotion_root'],
  ])exactDigest(value,label);
  verifyRsiShadowTournamentPlan(request.tournament_plan);
  const canonicalTournament=evaluateRsiShadowTournament({plan:request.tournament_plan,receipts:request.tournament_receipts});
  if(!same(canonicalTournament,request.tournament_result)||canonicalTournament.result_digest!==request.tournament_result_digest)throw new Error('rsi_promotion_review_request_tournament_not_canonical');
  const candidate={
    candidate_id:request.candidate_id,
    candidate_sha:request.candidate_sha,
    parent_sha:request.parent_sha,
    handoff_digest:request.isolated_candidate_handoff_digest,
  };
  const qualification=verifyRsiExternalPromotionQualification(request.qualification,candidate);
  if(qualification.qualification_digest!==request.qualification_digest)throw new Error('rsi_promotion_review_request_qualification_mismatch');
  const root=rsiPromotionGateTrustRootSnapshot();
  if(root.promotion_gate_root_digest!==request.promotion_gate_root_digest||JSON.stringify(root.required_workflows)!==JSON.stringify(request.required_workflows))throw new Error('rsi_promotion_review_request_root_drift');
  const core={...structuredClone(request)};delete core.payload_bytes;delete core.max_payload_bytes;delete core.request_digest;
  const payloadBytes=bytes(core);
  if(payloadBytes!==Number(request.payload_bytes)||payloadBytes>Number(request.max_payload_bytes)||Number(request.max_payload_bytes)!==MAX_REQUEST_BYTES)throw new Error('rsi_promotion_review_request_size_mismatch');
  if(digest(core)!==exactDigest(request.request_digest,'request'))throw new Error('rsi_promotion_review_request_digest_mismatch');
  return request;
}

export function finalizeRsiExternalPromotionReview({
  request,
  candidate_handoff,
  archive_admission,
}={}){
  const checked=verifyRsiExternalPromotionReviewRequest(request);
  const candidate=candidateFromHandoff(candidate_handoff,{
    isolated_candidate_handoff_digest:checked.isolated_candidate_handoff_digest,
    candidate_id:checked.candidate_id,
    candidate_sha:checked.candidate_sha,
    parent_sha:checked.parent_sha,
  });
  const gate=evaluateRsiPromotionAdmission({
    candidate_handoff,
    tournament_plan:checked.tournament_plan,
    tournament_result:checked.tournament_result,
    archive_admission,
    qualification:checked.qualification,
  });
  const core=zeroAuthority({
    schema:RSI_EXTERNAL_PROMOTION_REVIEW_RESULT_SCHEMA,
    version:1,
    request_digest:checked.request_digest,
    candidate_id:candidate.candidate_id,
    candidate_sha:candidate.candidate_sha,
    parent_sha:candidate.parent_sha,
    archive_admission_digest:archive_admission.admission_digest,
    gate_result:gate,
    gate_digest:gate.gate_digest,
    state:gate.state,
    blockers:Object.freeze([...gate.blockers]),
    ready_for_external_promotion_review:gate.ready_for_external_promotion_review===true,
    existing_self_update_handoff_authorized:false,
    direct_install_authorized:false,
    self_update_invocation_authorized:false,
    promotion_token:null,
    external_human_or_release_authority_still_required:true,
  });
  return Object.freeze({...core,result_digest:digest(core)});
}

export function verifyRsiExternalPromotionReviewResult(result,request){
  if(!result||typeof result!=='object'||Array.isArray(result)||result.schema!==RSI_EXTERNAL_PROMOTION_REVIEW_RESULT_SCHEMA||result.version!==1)throw new Error('rsi_promotion_review_result_invalid');
  assertZeroAuthority(result,'result');
  const checked=verifyRsiExternalPromotionReviewRequest(request);
  if(
    result.request_digest!==checked.request_digest
    || result.candidate_id!==checked.candidate_id
    || result.candidate_sha!==checked.candidate_sha
    || result.parent_sha!==checked.parent_sha
    || result.existing_self_update_handoff_authorized!==false
    || result.direct_install_authorized!==false
    || result.self_update_invocation_authorized!==false
    || result.promotion_token!==null
    || result.external_human_or_release_authority_still_required!==true
  )throw new Error('rsi_promotion_review_result_policy_invalid');
  exactDigest(result.archive_admission_digest,'archive_admission');
  exactDigest(result.gate_digest,'gate');
  if(result.gate_result?.gate_digest!==result.gate_digest||result.gate_result?.state!==result.state)throw new Error('rsi_promotion_review_result_gate_mismatch');
  assertZeroAuthority(result.gate_result,'gate_result');
  if(
    result.gate_result?.candidate_id!==checked.candidate_id
    || result.gate_result?.candidate_sha!==checked.candidate_sha
    || result.gate_result?.parent_sha!==checked.parent_sha
    || result.gate_result?.existing_self_update_handoff_authorized!==false
    || result.gate_result?.direct_install_authorized!==false
    || result.gate_result?.promotion_token!==null
  )throw new Error('rsi_promotion_review_result_gate_policy_invalid');
  const gateCore={...structuredClone(result.gate_result)};delete gateCore.gate_digest;
  if(digest(gateCore)!==result.gate_digest)throw new Error('rsi_promotion_review_result_gate_digest_invalid');
  const core={...structuredClone(result)};delete core.result_digest;
  if(digest(core)!==exactDigest(result.result_digest,'result'))throw new Error('rsi_promotion_review_result_digest_mismatch');
  return result;
}

export function rsiExternalPromotionReviewTrustRootSnapshot(){
  const promotion=rsiPromotionGateTrustRootSnapshot();
  const root=zeroAuthority({
    schema:RSI_EXTERNAL_PROMOTION_REVIEW_ROOT_SCHEMA,
    version:1,
    policy_path:'apps/metaengine-browser/src/rsi-external-promotion-review.mjs',
    promotion_gate_root_digest:promotion.promotion_gate_root_digest,
    required_workflows:[...promotion.required_workflows],
    nomination_ready_required:true,
    six_external_evidence_classes_required:true,
    canonical_tournament_recomputation_required:true,
    verified_archive_admission_required:true,
    signed_artifact_required:true,
    slsa_provenance_required:true,
    exact_candidate_head_ci_required:true,
    shadow_canary_required:true,
    rollback_ready_required:true,
    candidate_can_promote:false,
    candidate_can_invoke_self_update:false,
    external_review_required:true,
    direct_install_authorized:false,
    self_update_invocation_authorized:false,
    max_request_bytes:MAX_REQUEST_BYTES,
    no_second_scheduler:true,
  });
  return Object.freeze({...root,external_promotion_review_root_digest:digest(root)});
}
