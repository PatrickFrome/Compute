import crypto from 'node:crypto';

import { verifyRsiVerifiedSkillLibrary } from './rsi-verified-skill-library.mjs';
import { verifyRsiSkillLibraryGovernance } from './rsi-skill-library-governance.mjs';
import { verifyRsiSkillExposureReleaseReview } from './rsi-skill-exposure-release-review.mjs';

export const RSI_SKILL_EXPOSURE_RELEASE_TRANSITION_PROOF_SCHEMA='metaengine.rsi.skill-exposure-release-transition-proof.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;

function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));
}
function digest(value){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)),'utf8').digest('hex')}`;}
function exactSha(value,label){const out=String(value||'').trim().toLowerCase();if(!SHA40_RE.test(out))throw new Error(`rsi_exposure_transition_${label}_sha_invalid`);return out;}
function exactDigest(value,label){const out=String(value||'').trim().toLowerCase();if(!SHA256_RE.test(out))throw new Error(`rsi_exposure_transition_${label}_digest_invalid`);return out;}
function boundedId(value,label){const out=String(value||'').trim();if(!SAFE_ID_RE.test(out))throw new Error(`rsi_exposure_transition_${label}_invalid`);return out;}
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
function assertZero(row,label){
  for(const field of ['execution_authority','browser_authority','task_authority','production_mutation_authority','promotion_authority','self_update_authority','scheduler_authority','signing_authority','direct_tool_execution_authority','authority_effect']){
    if(row?.[field]!==false)throw new Error(`rsi_exposure_transition_${label}_${field}_invalid`);
  }
  if(row?.automatic_retry_allowed!==false)throw new Error(`rsi_exposure_transition_${label}_automatic_retry_invalid`);
}
function holdSet(governance){
  const rows=governance?.admission_exposure_hold_skill_digests;
  return new Set(Array.isArray(rows)?rows:[]);
}
function entryByDigest(governance,skillDigest,label){
  const entry=governance.entries.find(row=>row.skill_digest===skillDigest);
  if(!entry)throw new Error(`rsi_exposure_transition_${label}_entry_missing`);
  return entry;
}
function stripTargetTransitionFields(entry){
  const out=structuredClone(entry);
  delete out.state;
  delete out.active_for_composition;
  delete out.admission_exposure_hold;
  return out;
}
function same(valueA,valueB){return JSON.stringify(stable(valueA))===JSON.stringify(stable(valueB));}

export function createRsiSkillExposureReleaseTransitionProof({
  proof_id,
  source_sha,
  library,
  current_governance,
  next_governance,
  review,
  skill_digest,
  external_release_owner_identity_digest,
  read_only_shadow_canary_digest,
  coalition_ablation_receipt_digest,
  memory_poisoning_scan_digest,
  read_only_shadow_canary_pass,
  coalition_ablation_pass,
  memory_poisoning_scan_pass,
  canary_effect_mode,
  external_release_owner=false,
  authored_by_candidate=true,
}={}){
  const sourceSha=exactSha(source_sha,'source');
  const checkedLibrary=verifyRsiVerifiedSkillLibrary(library);
  const current=verifyRsiSkillLibraryGovernance(current_governance,checkedLibrary);
  const next=verifyRsiSkillLibraryGovernance(next_governance,checkedLibrary);
  const checkedReview=verifyRsiSkillExposureReleaseReview(review,{library:checkedLibrary,current_governance:current});
  const skillDigest=exactDigest(skill_digest,'skill');

  if(checkedReview.skill_digest!==skillDigest
    ||checkedReview.current_governance_digest!==current.governance_digest
    ||checkedReview.library_digest!==checkedLibrary.library_digest
    ||checkedReview.eligible_for_external_exposure_release_review!==true
    ||checkedReview.state!=='ELIGIBLE_FOR_EXTERNAL_EXPOSURE_RELEASE_REVIEW'){
    throw new Error('rsi_exposure_transition_eligible_review_required');
  }
  if(external_release_owner!==true||authored_by_candidate!==false){
    throw new Error('rsi_exposure_transition_external_release_owner_required');
  }

  const currentEntry=entryByDigest(current,skillDigest,'current');
  const nextEntry=entryByDigest(next,skillDigest,'next');
  if(currentEntry.state!=='DORMANT_CAP'||currentEntry.active_for_composition!==false||currentEntry.admission_exposure_hold!==true){
    throw new Error('rsi_exposure_transition_current_hold_invalid');
  }

  const currentHolds=holdSet(current);
  const nextHolds=holdSet(next);
  if(!currentHolds.has(skillDigest)||nextHolds.has(skillDigest)){
    throw new Error('rsi_exposure_transition_target_hold_delta_invalid');
  }
  if(currentHolds.size-nextHolds.size!==1){
    throw new Error('rsi_exposure_transition_hold_count_delta_invalid');
  }
  for(const held of currentHolds){
    if(held!==skillDigest&&!nextHolds.has(held))throw new Error('rsi_exposure_transition_non_target_hold_changed');
  }
  for(const held of nextHolds){
    if(!currentHolds.has(held))throw new Error('rsi_exposure_transition_hold_added');
  }

  if(nextEntry.state!=='EXPLORATION_ACTIVE'||nextEntry.active_for_composition!==true||nextEntry.admission_exposure_hold===true){
    throw new Error('rsi_exposure_transition_exploration_only_required');
  }
  if(current.governance_id!==next.governance_id||!same(current.config,next.config)){
    throw new Error('rsi_exposure_transition_governance_policy_drift');
  }
  if(current.entry_count!==next.entry_count
    ||next.active_count-current.active_count!==1
    ||current.dormant_count-next.dormant_count!==1
    ||next.retired_count!==current.retired_count
    ||next.quarantined_count!==current.quarantined_count
    ||next.lifecycle_evidence_count!==current.lifecycle_evidence_count){
    throw new Error('rsi_exposure_transition_bounded_count_delta_invalid');
  }

  const currentByDigest=new Map(current.entries.map(row=>[row.skill_digest,row]));
  const nextByDigest=new Map(next.entries.map(row=>[row.skill_digest,row]));
  for(const [entryDigest,before] of currentByDigest){
    const after=nextByDigest.get(entryDigest);
    if(!after)throw new Error('rsi_exposure_transition_entry_set_drift');
    if(entryDigest===skillDigest){
      if(!same(stripTargetTransitionFields(before),stripTargetTransitionFields(after))){
        throw new Error('rsi_exposure_transition_target_non_state_drift');
      }
    }else if(!same(before,after)){
      throw new Error('rsi_exposure_transition_non_target_entry_changed');
    }
  }

  if(read_only_shadow_canary_pass!==true
    ||coalition_ablation_pass!==true
    ||memory_poisoning_scan_pass!==true
    ||String(canary_effect_mode||'').trim().toUpperCase()!=='READ_ONLY_SHADOW'){
    throw new Error('rsi_exposure_transition_external_safety_evidence_required');
  }

  const releaseOwner=exactDigest(external_release_owner_identity_digest,'release_owner_identity');
  const reviewIdentities=[
    checkedReview.governance_reviewer_identity_digest,
    checkedReview.matched_evaluator_identity_digest,
    checkedReview.security_reviewer_identity_digest,
  ];
  if(reviewIdentities.includes(releaseOwner))throw new Error('rsi_exposure_transition_release_owner_separation_required');

  const evidenceDigests=[
    exactDigest(read_only_shadow_canary_digest,'read_only_shadow_canary'),
    exactDigest(coalition_ablation_receipt_digest,'coalition_ablation_receipt'),
    exactDigest(memory_poisoning_scan_digest,'memory_poisoning_scan'),
  ];
  if(new Set(evidenceDigests).size!==evidenceDigests.length)throw new Error('rsi_exposure_transition_independent_evidence_roots_required');

  const core=zero({
    schema:RSI_SKILL_EXPOSURE_RELEASE_TRANSITION_PROOF_SCHEMA,
    version:1,
    proof_id:boundedId(proof_id,'proof_id'),
    source_sha:sourceSha,
    library_id:checkedLibrary.library_id,
    library_digest:checkedLibrary.library_digest,
    current_governance_digest:current.governance_digest,
    next_governance_digest:next.governance_digest,
    review_digest:checkedReview.review_digest,
    skill_digest:skillDigest,
    current_state:'DORMANT_CAP',
    next_state:'EXPLORATION_ACTIVE',
    active_count_delta:1,
    dormant_count_delta:-1,
    hold_count_delta:-1,
    only_target_governance_state_changed:true,
    exact_current_and_next_governance_bound:true,
    external_release_owner_identity_digest:releaseOwner,
    read_only_shadow_canary_digest:evidenceDigests[0],
    coalition_ablation_receipt_digest:evidenceDigests[1],
    memory_poisoning_scan_digest:evidenceDigests[2],
    read_only_shadow_canary_pass:true,
    coalition_ablation_pass:true,
    memory_poisoning_scan_pass:true,
    canary_effect_mode:'READ_ONLY_SHADOW',
    external_release_owner:true,
    authored_by_candidate:false,
    release_owner_separate_from_reviewers:true,
    review_must_be_eligible:true,
    exploration_only_transition:true,
    one_attempt_release_required:true,
    ambiguous_release_retry_allowed:false,
    eligible_for_external_release_attempt_review:true,
    hold_release_effect_authorized:false,
    hold_release_effect_performed:false,
    retrieval_exposure_change_authorized:false,
    retrieval_exposure_changed:false,
    skill_activation_authorized:false,
    skill_activation_performed:false,
    release_token:null,
  });
  return Object.freeze({...core,proof_digest:digest(core)});
}

export function verifyRsiSkillExposureReleaseTransitionProof(proof,args={}){
  if(!proof||typeof proof!=='object'||Array.isArray(proof)
    ||proof.schema!==RSI_SKILL_EXPOSURE_RELEASE_TRANSITION_PROOF_SCHEMA||proof.version!==1){
    throw new Error('rsi_exposure_transition_proof_invalid');
  }
  assertZero(proof,'proof');
  if(proof.current_state!=='DORMANT_CAP'||proof.next_state!=='EXPLORATION_ACTIVE'
    ||proof.active_count_delta!==1||proof.dormant_count_delta!==-1||proof.hold_count_delta!==-1
    ||proof.only_target_governance_state_changed!==true||proof.exact_current_and_next_governance_bound!==true
    ||proof.read_only_shadow_canary_pass!==true||proof.coalition_ablation_pass!==true||proof.memory_poisoning_scan_pass!==true
    ||proof.canary_effect_mode!=='READ_ONLY_SHADOW'||proof.external_release_owner!==true
    ||proof.authored_by_candidate!==false||proof.release_owner_separate_from_reviewers!==true
    ||proof.review_must_be_eligible!==true||proof.exploration_only_transition!==true
    ||proof.one_attempt_release_required!==true||proof.ambiguous_release_retry_allowed!==false
    ||proof.eligible_for_external_release_attempt_review!==true
    ||proof.hold_release_effect_authorized!==false||proof.hold_release_effect_performed!==false
    ||proof.retrieval_exposure_change_authorized!==false||proof.retrieval_exposure_changed!==false
    ||proof.skill_activation_authorized!==false||proof.skill_activation_performed!==false||proof.release_token!==null){
    throw new Error('rsi_exposure_transition_proof_policy_invalid');
  }
  const canonical=createRsiSkillExposureReleaseTransitionProof({
    ...args,
    proof_id:proof.proof_id,
    source_sha:proof.source_sha,
    skill_digest:proof.skill_digest,
    external_release_owner_identity_digest:proof.external_release_owner_identity_digest,
    read_only_shadow_canary_digest:proof.read_only_shadow_canary_digest,
    coalition_ablation_receipt_digest:proof.coalition_ablation_receipt_digest,
    memory_poisoning_scan_digest:proof.memory_poisoning_scan_digest,
    read_only_shadow_canary_pass:true,
    coalition_ablation_pass:true,
    memory_poisoning_scan_pass:true,
    canary_effect_mode:'READ_ONLY_SHADOW',
    external_release_owner:true,
    authored_by_candidate:false,
  });
  if(canonical.proof_digest!==exactDigest(proof.proof_digest,'proof'))throw new Error('rsi_exposure_transition_proof_digest_mismatch');
  return canonical;
}

export function rsiSkillExposureReleaseTransitionProofTrustRootSnapshot(){
  const root=zero({
    schema:'metaengine.rsi.skill-exposure-release-transition-proof-root.v1',
    version:1,
    policy_path:'apps/metaengine-browser/src/rsi-skill-exposure-release-transition-proof.mjs',
    eligible_external_review_required:true,
    exact_current_governance_required:true,
    exact_next_governance_required:true,
    held_dormant_skill_required:true,
    exploration_only_transition:true,
    only_target_governance_state_may_change:true,
    active_count_delta_required:1,
    hold_count_delta_required:-1,
    read_only_shadow_canary_required:true,
    coalition_ablation_required:true,
    memory_poisoning_scan_required:true,
    release_owner_separation_of_duties_required:true,
    proof_is_zero_effect:true,
    one_attempt_release_required:true,
    ambiguous_release_retry_allowed:false,
    hold_release_effect_authorized:false,
    retrieval_exposure_change_authorized:false,
    skill_activation_authorized:false,
  });
  return Object.freeze({...root,transition_proof_root_digest:digest(root)});
}
