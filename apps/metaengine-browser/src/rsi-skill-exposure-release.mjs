import crypto from 'node:crypto';

import { verifyRsiVerifiedSkillLibrary } from './rsi-verified-skill-library.mjs';
import { verifyRsiSkillLibraryGovernance } from './rsi-skill-library-governance.mjs';

export const RSI_SKILL_EXPOSURE_RELEASE_PREVIEW_SCHEMA='metaengine.rsi.skill-exposure-release-preview.v1';
export const RSI_SKILL_EXPOSURE_RELEASE_CERTIFICATE_SCHEMA='metaengine.rsi.skill-exposure-release-certificate.v1';

const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const RELEASE_MODE='EXPLORATION_ACTIVE_ONLY';

function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]));}
function digest(v){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`;}
function exactDigest(v,l){const x=String(v||'').trim().toLowerCase();if(!SHA256_RE.test(x))throw new Error(`rsi_exposure_release_${l}_digest_invalid`);return x;}
function id(v,l){const x=String(v||'').trim();if(!SAFE_ID_RE.test(x))throw new Error(`rsi_exposure_release_${l}_invalid`);return x;}
function positiveInt(v,l,max=1000000){const n=Number(v);if(!Number.isSafeInteger(n)||n<1||n>max)throw new Error(`rsi_exposure_release_${l}_invalid`);return n;}
function zero(extra={}){return Object.freeze({...extra,execution_authority:false,browser_authority:false,task_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,scheduler_authority:false,signing_authority:false,direct_tool_execution_authority:false,automatic_retry_allowed:false,authority_effect:false});}
function assertZero(v,l){for(const f of ['execution_authority','browser_authority','task_authority','production_mutation_authority','promotion_authority','self_update_authority','scheduler_authority','signing_authority','direct_tool_execution_authority','authority_effect'])if(v?.[f]!==false)throw new Error(`rsi_exposure_release_${l}_${f}_invalid`);if(v?.automatic_retry_allowed!==false)throw new Error(`rsi_exposure_release_${l}_automatic_retry_invalid`);}
function exactBool(v){return v===true;}

function verifyPreview(preview,{library,current_governance,skill_digest}={}){
  if(!preview||preview.schema!==RSI_SKILL_EXPOSURE_RELEASE_PREVIEW_SCHEMA||preview.version!==1)throw new Error('rsi_exposure_release_preview_invalid');
  assertZero(preview,'preview');
  const checkedLibrary=verifyRsiVerifiedSkillLibrary(library);
  const checkedGovernance=verifyRsiSkillLibraryGovernance(current_governance,checkedLibrary);
  const skillDigest=exactDigest(skill_digest,'skill');
  if(preview.library_digest!==checkedLibrary.library_digest||preview.current_governance_digest!==checkedGovernance.governance_digest||preview.skill_digest!==skillDigest)throw new Error('rsi_exposure_release_preview_binding_mismatch');
  if(preview.current_state!=='DORMANT_CAP'||preview.current_active_for_composition!==false||preview.current_admission_exposure_held!==true)throw new Error('rsi_exposure_release_preview_current_hold_invalid');
  if(preview.next_state!=='EXPLORATION_ACTIVE'||preview.next_active_for_composition!==true||preview.next_admission_exposure_held!==false)throw new Error('rsi_exposure_release_preview_exploration_only_required');
  if(preview.only_target_state_changed!==true||preview.active_count_delta!==1||preview.hold_count_delta!==-1)throw new Error('rsi_exposure_release_preview_bounded_transition_invalid');
  exactDigest(preview.next_governance_digest,'next_governance');
  const clone=structuredClone(preview);delete clone.preview_digest;
  if(digest(clone)!==exactDigest(preview.preview_digest,'preview'))throw new Error('rsi_exposure_release_preview_digest_mismatch');
  return preview;
}

export function createRsiSkillExposureReleaseCertificate({
  certificate_id,
  library,
  current_governance,
  release_preview,
  skill_digest,
  routing_context_manifest_digest,
  retrieval_profile_digest,
  shadow_routing_manifest_digest,
  no_skill_ablation_receipt_digest,
  coalition_ablation_receipt_digest,
  memory_poisoning_scan_digest,
  source_grounding_receipt_digest,
  bounded_canary_policy_digest,
  bounded_canary_result_digest,
  negative_transfer_memory_digest,
  shadow_context_count,
  shadow_success_count,
  shadow_hard_invariants_pass,
  no_skill_ablation_pass,
  coalition_ablation_pass,
  negative_transfer_clear,
  memory_poisoning_scan_pass,
  source_grounding_pass,
  bounded_canary_pass,
  canary_effect_mode,
  external_governance_owner_identity_digest,
  external_shadow_evaluator_identity_digest,
  external_security_reviewer_identity_digest,
  external_canary_evaluator_identity_digest,
  external_governance_owner=false,
  external_shadow_evaluator=false,
  external_security_reviewer=false,
  external_canary_evaluator=false,
  authored_by_candidate=true,
}={}){
  const checkedLibrary=verifyRsiVerifiedSkillLibrary(library);
  const checkedGovernance=verifyRsiSkillLibraryGovernance(current_governance,checkedLibrary);
  const skillDigest=exactDigest(skill_digest,'skill');
  const preview=verifyPreview(release_preview,{library:checkedLibrary,current_governance:checkedGovernance,skill_digest:skillDigest});
  if(external_governance_owner!==true||external_shadow_evaluator!==true||external_security_reviewer!==true||external_canary_evaluator!==true||authored_by_candidate!==false)throw new Error('rsi_exposure_release_external_ownership_required');

  const identities=[
    exactDigest(external_governance_owner_identity_digest,'governance_owner_identity'),
    exactDigest(external_shadow_evaluator_identity_digest,'shadow_evaluator_identity'),
    exactDigest(external_security_reviewer_identity_digest,'security_reviewer_identity'),
    exactDigest(external_canary_evaluator_identity_digest,'canary_evaluator_identity'),
  ];
  if(new Set(identities).size!==identities.length)throw new Error('rsi_exposure_release_separation_of_duties_required');

  const count=positiveInt(shadow_context_count,'shadow_context_count',10000);
  const successes=positiveInt(shadow_success_count,'shadow_success_count',count);
  const blockers=[];
  if(count<3)blockers.push('INSUFFICIENT_SHADOW_CONTEXTS');
  if(successes!==count)blockers.push('SHADOW_CONTEXT_FAILURE');
  if(shadow_hard_invariants_pass!==true)blockers.push('SHADOW_HARD_INVARIANT_FAILURE');
  if(no_skill_ablation_pass!==true)blockers.push('NO_SKILL_ABLATION_FAILURE');
  if(coalition_ablation_pass!==true)blockers.push('COALITION_ABLATION_FAILURE');
  if(negative_transfer_clear!==true)blockers.push('NEGATIVE_TRANSFER_PRESENT');
  if(memory_poisoning_scan_pass!==true)blockers.push('MEMORY_POISONING_RISK');
  if(source_grounding_pass!==true)blockers.push('SOURCE_GROUNDING_FAILURE');
  if(bounded_canary_pass!==true)blockers.push('BOUNDED_CANARY_FAILURE');
  if(String(canary_effect_mode||'').trim().toUpperCase()!=='READ_ONLY_SHADOW')blockers.push('CANARY_NOT_READ_ONLY_SHADOW');
  const eligible=blockers.length===0;

  const evidenceRoots=[
    exactDigest(routing_context_manifest_digest,'routing_context_manifest'),
    exactDigest(retrieval_profile_digest,'retrieval_profile'),
    exactDigest(shadow_routing_manifest_digest,'shadow_routing_manifest'),
    exactDigest(no_skill_ablation_receipt_digest,'no_skill_ablation'),
    exactDigest(coalition_ablation_receipt_digest,'coalition_ablation'),
    exactDigest(memory_poisoning_scan_digest,'memory_poisoning_scan'),
    exactDigest(source_grounding_receipt_digest,'source_grounding'),
    exactDigest(bounded_canary_policy_digest,'bounded_canary_policy'),
    exactDigest(bounded_canary_result_digest,'bounded_canary_result'),
    exactDigest(negative_transfer_memory_digest,'negative_transfer_memory'),
  ];
  if(new Set(evidenceRoots).size!==evidenceRoots.length)throw new Error('rsi_exposure_release_independent_evidence_roots_required');

  const core=zero({
    schema:RSI_SKILL_EXPOSURE_RELEASE_CERTIFICATE_SCHEMA,version:1,
    certificate_id:id(certificate_id,'certificate_id'),
    library_id:checkedLibrary.library_id,library_digest:checkedLibrary.library_digest,
    current_governance_digest:checkedGovernance.governance_digest,next_governance_digest:preview.next_governance_digest,
    release_preview_digest:preview.preview_digest,skill_digest:skillDigest,
    release_mode:RELEASE_MODE,
    routing_context_manifest_digest:evidenceRoots[0],retrieval_profile_digest:evidenceRoots[1],
    shadow_routing_manifest_digest:evidenceRoots[2],no_skill_ablation_receipt_digest:evidenceRoots[3],
    coalition_ablation_receipt_digest:evidenceRoots[4],memory_poisoning_scan_digest:evidenceRoots[5],
    source_grounding_receipt_digest:evidenceRoots[6],bounded_canary_policy_digest:evidenceRoots[7],
    bounded_canary_result_digest:evidenceRoots[8],negative_transfer_memory_digest:evidenceRoots[9],
    shadow_context_count:count,shadow_success_count:successes,
    shadow_hard_invariants_pass:exactBool(shadow_hard_invariants_pass),
    no_skill_ablation_pass:exactBool(no_skill_ablation_pass),coalition_ablation_pass:exactBool(coalition_ablation_pass),
    negative_transfer_clear:exactBool(negative_transfer_clear),memory_poisoning_scan_pass:exactBool(memory_poisoning_scan_pass),
    source_grounding_pass:exactBool(source_grounding_pass),bounded_canary_pass:exactBool(bounded_canary_pass),
    canary_effect_mode:'READ_ONLY_SHADOW',
    blockers:Object.freeze(blockers.sort()),
    state:eligible?'ELIGIBLE_FOR_ONE_ATTEMPT_EXPOSURE_RELEASE':'REJECTED_EXPOSURE_RELEASE',
    eligible_for_one_attempt_exposure_release:eligible,
    external_governance_owner_identity_digest:identities[0],external_shadow_evaluator_identity_digest:identities[1],
    external_security_reviewer_identity_digest:identities[2],external_canary_evaluator_identity_digest:identities[3],
    external_governance_owner:true,external_shadow_evaluator:true,external_security_reviewer:true,external_canary_evaluator:true,
    authored_by_candidate:false,
    held_skill_required:true,current_state_must_be_dormant:true,next_state_must_be_exploration_active:true,
    only_target_governance_state_may_change:true,automatic_full_activation_allowed:false,
    release_does_not_grant_browser_authority:true,release_does_not_grant_tool_authority:true,
    one_attempt_release_required:true,ambiguous_release_retry_allowed:false,
    release_token:null,
  });
  return Object.freeze({...core,certificate_digest:digest(core)});
}

export function verifyRsiSkillExposureReleaseCertificate(certificate,args={}){
  if(!certificate||certificate.schema!==RSI_SKILL_EXPOSURE_RELEASE_CERTIFICATE_SCHEMA||certificate.version!==1)throw new Error('rsi_exposure_release_certificate_invalid');
  assertZero(certificate,'certificate');
  if(certificate.release_mode!==RELEASE_MODE||certificate.held_skill_required!==true||certificate.current_state_must_be_dormant!==true
    ||certificate.next_state_must_be_exploration_active!==true||certificate.only_target_governance_state_may_change!==true
    ||certificate.automatic_full_activation_allowed!==false||certificate.release_does_not_grant_browser_authority!==true
    ||certificate.release_does_not_grant_tool_authority!==true||certificate.one_attempt_release_required!==true
    ||certificate.ambiguous_release_retry_allowed!==false||certificate.release_token!==null
    ||certificate.external_governance_owner!==true||certificate.external_shadow_evaluator!==true
    ||certificate.external_security_reviewer!==true||certificate.external_canary_evaluator!==true||certificate.authored_by_candidate!==false){
    throw new Error('rsi_exposure_release_certificate_policy_invalid');
  }
  const canonical=createRsiSkillExposureReleaseCertificate({
    ...args,
    certificate_id:certificate.certificate_id,
    skill_digest:certificate.skill_digest,
    routing_context_manifest_digest:certificate.routing_context_manifest_digest,
    retrieval_profile_digest:certificate.retrieval_profile_digest,
    shadow_routing_manifest_digest:certificate.shadow_routing_manifest_digest,
    no_skill_ablation_receipt_digest:certificate.no_skill_ablation_receipt_digest,
    coalition_ablation_receipt_digest:certificate.coalition_ablation_receipt_digest,
    memory_poisoning_scan_digest:certificate.memory_poisoning_scan_digest,
    source_grounding_receipt_digest:certificate.source_grounding_receipt_digest,
    bounded_canary_policy_digest:certificate.bounded_canary_policy_digest,
    bounded_canary_result_digest:certificate.bounded_canary_result_digest,
    negative_transfer_memory_digest:certificate.negative_transfer_memory_digest,
    shadow_context_count:certificate.shadow_context_count,shadow_success_count:certificate.shadow_success_count,
    shadow_hard_invariants_pass:certificate.shadow_hard_invariants_pass,no_skill_ablation_pass:certificate.no_skill_ablation_pass,
    coalition_ablation_pass:certificate.coalition_ablation_pass,negative_transfer_clear:certificate.negative_transfer_clear,
    memory_poisoning_scan_pass:certificate.memory_poisoning_scan_pass,source_grounding_pass:certificate.source_grounding_pass,
    bounded_canary_pass:certificate.bounded_canary_pass,canary_effect_mode:certificate.canary_effect_mode,
    external_governance_owner_identity_digest:certificate.external_governance_owner_identity_digest,
    external_shadow_evaluator_identity_digest:certificate.external_shadow_evaluator_identity_digest,
    external_security_reviewer_identity_digest:certificate.external_security_reviewer_identity_digest,
    external_canary_evaluator_identity_digest:certificate.external_canary_evaluator_identity_digest,
    external_governance_owner:true,external_shadow_evaluator:true,external_security_reviewer:true,external_canary_evaluator:true,
    authored_by_candidate:false,
  });
  if(canonical.certificate_digest!==exactDigest(certificate.certificate_digest,'certificate'))throw new Error('rsi_exposure_release_certificate_digest_mismatch');
  return canonical;
}

export function rsiSkillExposureReleaseTrustRootSnapshot(){
  const root={
    schema:'metaengine.rsi.skill-exposure-release-root.v1',version:1,
    policy_path:'apps/metaengine-browser/src/rsi-skill-exposure-release.mjs',
    exact_current_library_required:true,exact_current_governance_required:true,exact_next_governance_preview_required:true,
    held_dormant_skill_required:true,exploration_only_release:true,only_target_governance_state_may_change:true,
    minimum_shadow_context_count:3,all_shadow_contexts_must_pass:true,shadow_hard_invariants_required:true,
    no_skill_ablation_required:true,coalition_ablation_required:true,negative_transfer_clear_required:true,
    memory_poisoning_scan_required:true,source_grounding_required:true,read_only_shadow_canary_required:true,
    reviewer_separation_of_duties_required:true,automatic_full_activation_allowed:false,
    one_attempt_release_required:true,ambiguous_release_retry_allowed:false,
    execution_authority:false,browser_authority:false,task_authority:false,production_mutation_authority:false,
    promotion_authority:false,self_update_authority:false,scheduler_authority:false,signing_authority:false,
    direct_tool_execution_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...root,exposure_release_root_digest:digest(root)});
}
