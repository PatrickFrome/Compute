import crypto from 'node:crypto';

import { verifyRsiVerifiedSkillLibrary } from './rsi-verified-skill-library.mjs';
import { verifyRsiSkillLibraryGovernance } from './rsi-skill-library-governance.mjs';
import { verifyRsiSkillExposureReleaseReview } from './rsi-skill-exposure-release-review.mjs';

export const RSI_SKILL_EXPOSURE_RELEASE_PREVIEW_SCHEMA='metaengine.rsi.skill-exposure-release-preview.v1';
export const RSI_SKILL_EXPOSURE_RELEASE_CERTIFICATE_SCHEMA='metaengine.rsi.skill-exposure-release-certificate.v2';

const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const RELEASE_MODE='EXPLORATION_ACTIVE_ONLY';

function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));
}
function digest(value){
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)),'utf8').digest('hex')}`;
}
function exactDigest(value,label){
  const out=String(value||'').trim().toLowerCase();
  if(!SHA256_RE.test(out))throw new Error(`rsi_exposure_release_${label}_digest_invalid`);
  return out;
}
function boundedId(value,label){
  const out=String(value||'').trim();
  if(!SAFE_ID_RE.test(out))throw new Error(`rsi_exposure_release_${label}_invalid`);
  return out;
}
function positiveInt(value,label,max=1000000){
  const n=Number(value);
  if(!Number.isSafeInteger(n)||n<1||n>max)throw new Error(`rsi_exposure_release_${label}_invalid`);
  return n;
}
function zero(extra={}){
  return Object.freeze({
    ...extra,
    execution_authority:false,
    browser_authority:false,
    task_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    signing_authority:false,
    direct_tool_execution_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  });
}
function assertZero(value,label){
  for(const field of [
    'execution_authority','browser_authority','task_authority','production_mutation_authority',
    'promotion_authority','self_update_authority','scheduler_authority','signing_authority',
    'direct_tool_execution_authority','authority_effect',
  ]){
    if(value?.[field]!==false)throw new Error(`rsi_exposure_release_${label}_${field}_invalid`);
  }
  if(value?.automatic_retry_allowed!==false)throw new Error(`rsi_exposure_release_${label}_automatic_retry_invalid`);
}
function targetEvidenceCore(row){
  const clone=structuredClone(row);
  delete clone.state;
  delete clone.active_for_composition;
  delete clone.admission_exposure_hold;
  return clone;
}
function peerInvariantCore(row){
  const clone=structuredClone(row);
  delete clone.admission_exposure_hold;
  return clone;
}
function exactHoldSet(governance){
  const raw=governance.admission_exposure_hold_skill_digests??[];
  if(!Array.isArray(raw))throw new Error('rsi_exposure_release_governance_holds_invalid');
  return raw.map(value=>exactDigest(value,'governance_hold')).sort();
}

export function createRsiSkillExposureReleasePreview({
  library,
  current_governance,
  next_governance,
  skill_digest,
  external_governance_owner=false,
  authored_by_candidate=true,
}={}){
  const checkedLibrary=verifyRsiVerifiedSkillLibrary(library);
  const current=verifyRsiSkillLibraryGovernance(current_governance,checkedLibrary);
  const next=verifyRsiSkillLibraryGovernance(next_governance,checkedLibrary);
  if(external_governance_owner!==true||authored_by_candidate!==false){
    throw new Error('rsi_exposure_release_preview_external_governance_required');
  }
  if(current.library_id!==next.library_id||current.library_digest!==next.library_digest){
    throw new Error('rsi_exposure_release_preview_library_drift');
  }
  const skillDigest=exactDigest(skill_digest,'skill');
  const currentHolds=exactHoldSet(current);
  const nextHolds=exactHoldSet(next);
  if(!currentHolds.includes(skillDigest))throw new Error('rsi_exposure_release_preview_current_hold_required');
  if(nextHolds.includes(skillDigest))throw new Error('rsi_exposure_release_preview_target_hold_not_released');
  const expectedNextHolds=currentHolds.filter(value=>value!==skillDigest);
  if(JSON.stringify(nextHolds)!==JSON.stringify(expectedNextHolds)){
    throw new Error('rsi_exposure_release_preview_unrelated_hold_drift');
  }

  const currentRow=current.entries.find(row=>row.skill_digest===skillDigest);
  const nextRow=next.entries.find(row=>row.skill_digest===skillDigest);
  if(!currentRow||!nextRow)throw new Error('rsi_exposure_release_preview_skill_missing');
  if(currentRow.state!=='DORMANT_CAP'||currentRow.active_for_composition!==false||currentRow.admission_exposure_hold!==true){
    throw new Error('rsi_exposure_release_preview_current_hold_invalid');
  }
  if(nextRow.state!=='EXPLORATION_ACTIVE'||nextRow.active_for_composition!==true||nextRow.admission_exposure_hold===true){
    throw new Error('rsi_exposure_release_preview_exploration_only_required');
  }
  if(JSON.stringify(stable(targetEvidenceCore(currentRow)))!==JSON.stringify(stable(targetEvidenceCore(nextRow)))){
    throw new Error('rsi_exposure_release_preview_target_evidence_drift');
  }

  const nextByDigest=new Map(next.entries.map(row=>[row.skill_digest,row]));
  for(const row of current.entries){
    if(row.skill_digest===skillDigest)continue;
    const peer=nextByDigest.get(row.skill_digest);
    if(!peer||JSON.stringify(stable(peerInvariantCore(row)))!==JSON.stringify(stable(peerInvariantCore(peer)))){
      throw new Error('rsi_exposure_release_preview_non_target_state_drift');
    }
  }
  if(next.active_count-current.active_count!==1||nextHolds.length-currentHolds.length!==-1){
    throw new Error('rsi_exposure_release_preview_bounded_transition_invalid');
  }

  const core=zero({
    schema:RSI_SKILL_EXPOSURE_RELEASE_PREVIEW_SCHEMA,
    version:1,
    library_id:checkedLibrary.library_id,
    library_digest:checkedLibrary.library_digest,
    current_governance_digest:current.governance_digest,
    next_governance_digest:next.governance_digest,
    skill_digest:skillDigest,
    current_state:currentRow.state,
    current_active_for_composition:currentRow.active_for_composition,
    current_admission_exposure_hold:true,
    next_state:nextRow.state,
    next_active_for_composition:nextRow.active_for_composition,
    next_admission_exposure_hold:false,
    changed_skill_digests:Object.freeze([skillDigest]),
    only_target_state_changed:true,
    active_count_delta:1,
    hold_count_delta:-1,
    release_mode:RELEASE_MODE,
    preview_is_effect_authority:false,
    exposure_effect_performed:false,
    release_authorized:false,
    external_governance_owner:true,
    authored_by_candidate:false,
  });
  return Object.freeze({...core,preview_digest:digest(core)});
}

export function verifyRsiSkillExposureReleasePreview(preview,{
  library,current_governance,next_governance,skill_digest,
}={}){
  if(!preview||preview.schema!==RSI_SKILL_EXPOSURE_RELEASE_PREVIEW_SCHEMA||preview.version!==1){
    throw new Error('rsi_exposure_release_preview_invalid');
  }
  assertZero(preview,'preview');
  if(preview.preview_is_effect_authority!==false||preview.exposure_effect_performed!==false||preview.release_authorized!==false
    ||preview.release_mode!==RELEASE_MODE||preview.only_target_state_changed!==true
    ||preview.external_governance_owner!==true||preview.authored_by_candidate!==false){
    throw new Error('rsi_exposure_release_preview_policy_invalid');
  }
  const canonical=createRsiSkillExposureReleasePreview({
    library,current_governance,next_governance,skill_digest:skill_digest||preview.skill_digest,
    external_governance_owner:true,authored_by_candidate:false,
  });
  if(canonical.preview_digest!==exactDigest(preview.preview_digest,'preview')){
    throw new Error('rsi_exposure_release_preview_digest_mismatch');
  }
  return canonical;
}

export function createRsiSkillExposureReleaseCertificate({
  certificate_id,
  library,
  current_governance,
  next_governance,
  release_preview,
  release_review,
  admission_provenance,
  skill_digest,
  shadow_routing_manifest_digest,
  no_skill_ablation_receipt_digest,
  coalition_ablation_receipt_digest,
  bounded_canary_policy_digest,
  bounded_canary_result_digest,
  shadow_context_count,
  shadow_success_count,
  shadow_hard_invariants_pass=false,
  no_skill_ablation_pass=false,
  coalition_ablation_pass=false,
  bounded_canary_pass=false,
  canary_effect_mode='',
  external_release_certifier_identity_digest,
  external_shadow_evaluator_identity_digest,
  external_canary_evaluator_identity_digest,
  external_release_certifier=false,
  external_shadow_evaluator=false,
  external_canary_evaluator=false,
  authored_by_candidate=true,
}={}){
  const checkedLibrary=verifyRsiVerifiedSkillLibrary(library);
  const checkedCurrent=verifyRsiSkillLibraryGovernance(current_governance,checkedLibrary);
  const checkedNext=verifyRsiSkillLibraryGovernance(next_governance,checkedLibrary);
  const skillDigest=exactDigest(skill_digest,'skill');
  const preview=verifyRsiSkillExposureReleasePreview(release_preview,{
    library:checkedLibrary,current_governance:checkedCurrent,next_governance:checkedNext,skill_digest:skillDigest,
  });
  const review=verifyRsiSkillExposureReleaseReview(release_review,{
    library:checkedLibrary,current_governance:checkedCurrent,admission_provenance,
  });
  if(review.skill_digest!==skillDigest||review.library_digest!==checkedLibrary.library_digest
    ||review.current_governance_digest!==checkedCurrent.governance_digest
    ||review.state!=='ELIGIBLE_FOR_EXTERNAL_EXPOSURE_RELEASE_REVIEW'
    ||review.eligible_for_external_exposure_release_review!==true){
    throw new Error('rsi_exposure_release_review_not_eligible_or_mismatched');
  }
  const admissionProvenanceDigest=exactDigest(admission_provenance?.provenance_digest,'admission_provenance');
  if(review.admission_provenance_digest!==admissionProvenanceDigest){
    throw new Error('rsi_exposure_release_admission_provenance_mismatch');
  }
  if(external_release_certifier!==true||external_shadow_evaluator!==true||external_canary_evaluator!==true||authored_by_candidate!==false){
    throw new Error('rsi_exposure_release_external_ownership_required');
  }

  const identities=[
    exactDigest(external_release_certifier_identity_digest,'release_certifier_identity'),
    exactDigest(external_shadow_evaluator_identity_digest,'shadow_evaluator_identity'),
    exactDigest(external_canary_evaluator_identity_digest,'canary_evaluator_identity'),
  ];
  if(new Set(identities).size!==identities.length)throw new Error('rsi_exposure_release_separation_of_duties_required');
  const upstreamIdentities=new Set([
    review.governance_reviewer_identity_digest,
    review.matched_evaluator_identity_digest,
    review.security_reviewer_identity_digest,
    review.admission_effect_executor_identity_digest,
  ]);
  if(identities.some(identity=>upstreamIdentities.has(identity))){
    throw new Error('rsi_exposure_release_cross_stage_identity_separation_required');
  }

  const count=positiveInt(shadow_context_count,'shadow_context_count',10000);
  const successes=positiveInt(shadow_success_count,'shadow_success_count',count);
  const blockers=[];
  if(count<3)blockers.push('INSUFFICIENT_SHADOW_CONTEXTS');
  if(successes!==count)blockers.push('SHADOW_CONTEXT_FAILURE');
  if(shadow_hard_invariants_pass!==true)blockers.push('SHADOW_HARD_INVARIANT_FAILURE');
  if(no_skill_ablation_pass!==true)blockers.push('NO_SKILL_ABLATION_FAILURE');
  if(coalition_ablation_pass!==true)blockers.push('COALITION_ABLATION_FAILURE');
  if(bounded_canary_pass!==true)blockers.push('BOUNDED_CANARY_FAILURE');
  if(String(canary_effect_mode||'').trim().toUpperCase()!=='READ_ONLY_SHADOW'){
    blockers.push('CANARY_NOT_READ_ONLY_SHADOW');
  }
  const eligible=blockers.length===0;
  const evidenceRoots=[
    exactDigest(review.review_digest,'review'),
    admissionProvenanceDigest,
    exactDigest(shadow_routing_manifest_digest,'shadow_routing_manifest'),
    exactDigest(no_skill_ablation_receipt_digest,'no_skill_ablation'),
    exactDigest(coalition_ablation_receipt_digest,'coalition_ablation'),
    exactDigest(bounded_canary_policy_digest,'bounded_canary_policy'),
    exactDigest(bounded_canary_result_digest,'bounded_canary_result'),
  ];
  if(new Set(evidenceRoots).size!==evidenceRoots.length){
    throw new Error('rsi_exposure_release_independent_evidence_roots_required');
  }

  const core=zero({
    schema:RSI_SKILL_EXPOSURE_RELEASE_CERTIFICATE_SCHEMA,
    version:2,
    certificate_id:boundedId(certificate_id,'certificate_id'),
    library_id:checkedLibrary.library_id,
    library_digest:checkedLibrary.library_digest,
    current_governance_digest:checkedCurrent.governance_digest,
    next_governance_digest:checkedNext.governance_digest,
    release_preview_digest:preview.preview_digest,
    release_review_digest:review.review_digest,
    admission_provenance_digest:admissionProvenanceDigest,
    admission_attempt_id:review.admission_attempt_id,
    admission_attempt_digest:review.admission_attempt_digest,
    admission_certificate_digest:review.admission_certificate_digest,
    confirmed_admission_transition_digest:review.confirmed_admission_transition_digest,
    skill_digest:skillDigest,
    release_mode:RELEASE_MODE,
    consumer_model_family:review.consumer_model_family,
    environment_fingerprint:review.environment_fingerprint,
    task_signature_digest:review.task_signature_digest,
    routing_context_manifest_digest:review.routing_context_manifest_digest,
    retrieval_profile_digest:review.retrieval_profile_digest,
    memory_context_digest:review.memory_context_digest,
    matched_comparison_receipt_digest:review.matched_comparison_receipt_digest,
    negative_transfer_receipt_digest:review.negative_transfer_receipt_digest,
    cost_latency_receipt_digest:review.cost_latency_receipt_digest,
    harness_integrity_digest:review.harness_integrity_digest,
    benchmark_provenance_digest:review.benchmark_provenance_digest,
    source_grounding_receipt_digest:review.source_grounding_receipt_digest,
    shadow_routing_manifest_digest:evidenceRoots[2],
    no_skill_ablation_receipt_digest:evidenceRoots[3],
    coalition_ablation_receipt_digest:evidenceRoots[4],
    bounded_canary_policy_digest:evidenceRoots[5],
    bounded_canary_result_digest:evidenceRoots[6],
    shadow_context_count:count,
    shadow_success_count:successes,
    shadow_hard_invariants_pass:shadow_hard_invariants_pass===true,
    no_skill_ablation_pass:no_skill_ablation_pass===true,
    coalition_ablation_pass:coalition_ablation_pass===true,
    bounded_canary_pass:bounded_canary_pass===true,
    canary_effect_mode:'READ_ONLY_SHADOW',
    blockers:Object.freeze(blockers.sort()),
    state:eligible?'ELIGIBLE_FOR_ONE_ATTEMPT_EXPOSURE_RELEASE':'REJECTED_EXPOSURE_RELEASE',
    eligible_for_one_attempt_exposure_release:eligible,
    external_release_certifier_identity_digest:identities[0],
    external_shadow_evaluator_identity_digest:identities[1],
    external_canary_evaluator_identity_digest:identities[2],
    external_release_certifier:true,
    external_shadow_evaluator:true,
    external_canary_evaluator:true,
    authored_by_candidate:false,
    exact_zero_effect_release_review_required:true,
    release_review_must_be_eligible:true,
    confirmed_storage_admission_provenance_required:true,
    exact_next_governance_preview_required:true,
    only_target_governance_state_may_change:true,
    current_state_must_be_dormant:true,
    next_state_must_be_exploration_active:true,
    automatic_full_activation_allowed:false,
    one_attempt_release_required:true,
    ambiguous_release_retry_allowed:false,
    certificate_is_effect_authority:false,
    release_effect_authorized:false,
    release_effect_performed:false,
    release_token:null,
  });
  return Object.freeze({...core,certificate_digest:digest(core)});
}

export function verifyRsiSkillExposureReleaseCertificate(certificate,args={}){
  if(!certificate||certificate.schema!==RSI_SKILL_EXPOSURE_RELEASE_CERTIFICATE_SCHEMA||certificate.version!==2){
    throw new Error('rsi_exposure_release_certificate_invalid');
  }
  assertZero(certificate,'certificate');
  if(certificate.release_mode!==RELEASE_MODE
    ||certificate.exact_zero_effect_release_review_required!==true
    ||certificate.release_review_must_be_eligible!==true
    ||certificate.confirmed_storage_admission_provenance_required!==true
    ||certificate.exact_next_governance_preview_required!==true
    ||certificate.only_target_governance_state_may_change!==true
    ||certificate.current_state_must_be_dormant!==true
    ||certificate.next_state_must_be_exploration_active!==true
    ||certificate.automatic_full_activation_allowed!==false
    ||certificate.one_attempt_release_required!==true
    ||certificate.ambiguous_release_retry_allowed!==false
    ||certificate.certificate_is_effect_authority!==false
    ||certificate.release_effect_authorized!==false
    ||certificate.release_effect_performed!==false
    ||certificate.release_token!==null
    ||certificate.external_release_certifier!==true
    ||certificate.external_shadow_evaluator!==true
    ||certificate.external_canary_evaluator!==true
    ||certificate.authored_by_candidate!==false){
    throw new Error('rsi_exposure_release_certificate_policy_invalid');
  }
  const canonical=createRsiSkillExposureReleaseCertificate({
    ...args,
    certificate_id:certificate.certificate_id,
    skill_digest:certificate.skill_digest,
    shadow_routing_manifest_digest:certificate.shadow_routing_manifest_digest,
    no_skill_ablation_receipt_digest:certificate.no_skill_ablation_receipt_digest,
    coalition_ablation_receipt_digest:certificate.coalition_ablation_receipt_digest,
    bounded_canary_policy_digest:certificate.bounded_canary_policy_digest,
    bounded_canary_result_digest:certificate.bounded_canary_result_digest,
    shadow_context_count:certificate.shadow_context_count,
    shadow_success_count:certificate.shadow_success_count,
    shadow_hard_invariants_pass:certificate.shadow_hard_invariants_pass,
    no_skill_ablation_pass:certificate.no_skill_ablation_pass,
    coalition_ablation_pass:certificate.coalition_ablation_pass,
    bounded_canary_pass:certificate.bounded_canary_pass,
    canary_effect_mode:certificate.canary_effect_mode,
    external_release_certifier_identity_digest:certificate.external_release_certifier_identity_digest,
    external_shadow_evaluator_identity_digest:certificate.external_shadow_evaluator_identity_digest,
    external_canary_evaluator_identity_digest:certificate.external_canary_evaluator_identity_digest,
    external_release_certifier:true,
    external_shadow_evaluator:true,
    external_canary_evaluator:true,
    authored_by_candidate:false,
  });
  if(canonical.certificate_digest!==exactDigest(certificate.certificate_digest,'certificate')){
    throw new Error('rsi_exposure_release_certificate_digest_mismatch');
  }
  return canonical;
}

export function rsiSkillExposureReleaseTrustRootSnapshot(){
  const root=zero({
    schema:'metaengine.rsi.skill-exposure-release-root.v2',
    version:2,
    policy_path:'apps/metaengine-browser/src/rsi-skill-exposure-release.mjs',
    exact_current_library_required:true,
    exact_current_governance_required:true,
    exact_next_governance_preview_required:true,
    exact_zero_effect_release_review_required:true,
    confirmed_storage_admission_provenance_required:true,
    release_review_must_be_eligible:true,
    held_dormant_skill_required:true,
    exploration_only_release:true,
    only_target_governance_state_may_change:true,
    minimum_shadow_context_count:3,
    all_shadow_contexts_must_pass:true,
    no_skill_ablation_required:true,
    coalition_ablation_required:true,
    read_only_shadow_canary_required:true,
    cross_stage_identity_separation_required:true,
    automatic_full_activation_allowed:false,
    one_attempt_release_required:true,
    ambiguous_release_retry_allowed:false,
    certificate_is_effect_authority:false,
    release_effect_authorized:false,
  });
  return Object.freeze({...root,exposure_release_root_digest:digest(root)});
}
