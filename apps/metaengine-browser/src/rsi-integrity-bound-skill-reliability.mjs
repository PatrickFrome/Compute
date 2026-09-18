import crypto from 'node:crypto';

import {
  createRsiContrastiveSkillRevision,
  createRsiSkillReliabilityEvaluation,
  finalizeRsiContrastiveSkillReliability,
} from './rsi-contrastive-skill-reliability.mjs';
import {
  verifyRsiSkillCapsule,
  verifyRsiSkillEvidence,
} from './rsi-verified-skill-library.mjs';

export const RSI_INTEGRITY_BOUND_SKILL_RELIABILITY_SCHEMA='metaengine.rsi.integrity-bound-skill-reliability.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;

function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]))}
function digest(v){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`}
function exactSha(v,l){const o=String(v||'').trim().toLowerCase();if(!SHA40_RE.test(o))throw new Error(`rsi_integrity_reliability_${l}_sha_invalid`);return o}
function exactDigest(v,l){const o=String(v||'').trim().toLowerCase();if(!SHA256_RE.test(o))throw new Error(`rsi_integrity_reliability_${l}_digest_invalid`);return o}
function boundedId(v,l){const o=String(v||'').trim();if(!SAFE_ID_RE.test(o))throw new Error(`rsi_integrity_reliability_${l}_invalid`);return o}
function assertZero(v,l){
  for(const f of ['execution_authority','production_mutation_authority','promotion_authority','self_update_authority','scheduler_authority','signing_authority','authority_effect']){
    if(v?.[f]!==false)throw new Error(`rsi_integrity_reliability_${l}_${f}_invalid`);
  }
  if(v?.automatic_retry_allowed!==false)throw new Error(`rsi_integrity_reliability_${l}_automatic_retry_invalid`);
}

function verifyIntegrityAdmission(admission){
  if(!admission||typeof admission!=='object'||Array.isArray(admission)||admission.schema!=='metaengine.rsi.skill-revision-integrity-admission.v1'||admission.version!==1){
    throw new Error('rsi_integrity_reliability_admission_invalid');
  }
  assertZero(admission,'admission');
  exactSha(admission.source_sha,'source');
  exactDigest(admission.admission_digest,'admission');
  exactDigest(admission.parent_skill_digest,'parent_skill');
  exactDigest(admission.successor_skill_digest,'successor_skill');
  exactDigest(admission.sealed_holdout_digest,'sealed_holdout');
  exactDigest(admission.validation_holdout_digest,'validation_holdout');
  exactDigest(admission.meta_holdout_digest,'meta_holdout');
  if(admission.state!=='INTEGRITY_ADMITTED'||admission.integrity_verified!==true||admission.eligible_for_existing_reliability_gate!==true){
    throw new Error('rsi_integrity_reliability_integrity_admission_required');
  }
  if(admission.self_authored_verification_sufficient!==false||admission.direct_library_replacement_allowed!==false
    ||admission.existing_reliability_gate_required!==true||admission.existing_scope_preservation_gate_required!==true){
    throw new Error('rsi_integrity_reliability_admission_policy_invalid');
  }
  return admission;
}

export function createRsiIntegrityBoundSkillReliability({
  source_sha,binding_id,integrity_admission,
  parent_skill,parent_skill_evidence,
  baseline_dataset,baseline_trajectory_receipts,
  successor_skill,successor_skill_evidence,
  successor_dataset,successor_trajectory_receipts,
  contrast_codes,contrast_evidence_digest,
  revision_evidence_refs,reliability_evidence_refs,
  hard_invariants_pass,max_potential_regression=0,
  external_curator=false,external_evaluator=false,authored_by_candidate=true,
}={}){
  const sourceSha=exactSha(source_sha,'source');
  const admission=verifyIntegrityAdmission(integrity_admission);
  if(admission.source_sha!==sourceSha)throw new Error('rsi_integrity_reliability_source_mismatch');

  const parent=verifyRsiSkillCapsule(parent_skill);
  verifyRsiSkillEvidence(parent_skill_evidence,parent);
  const successor=verifyRsiSkillCapsule(successor_skill);
  verifyRsiSkillEvidence(successor_skill_evidence,successor);
  if(parent.skill_digest!==admission.parent_skill_digest)throw new Error('rsi_integrity_reliability_parent_mismatch');
  if(successor.skill_digest!==admission.successor_skill_digest)throw new Error('rsi_integrity_reliability_successor_mismatch');
  if(external_curator!==true||external_evaluator!==true||authored_by_candidate!==false){
    throw new Error('rsi_integrity_reliability_external_origin_required');
  }

  const hiddenTrial=exactDigest(baseline_dataset?.hidden_repeated_trial_set_digest,'hidden_trial_set');
  if([
    admission.sealed_holdout_digest,
    admission.validation_holdout_digest,
    admission.meta_holdout_digest,
  ].includes(hiddenTrial))throw new Error('rsi_integrity_reliability_hidden_trial_alias');

  const revision=createRsiContrastiveSkillRevision({
    revision_id:`reliability.revision.${boundedId(binding_id,'binding_id')}`,
    parent_skill:parent,
    parent_skill_evidence,
    reliability_dataset:baseline_dataset,
    trajectory_receipts:baseline_trajectory_receipts,
    successor_skill:successor,
    contrast_codes,
    contrast_evidence_digest,
    evidence_refs:revision_evidence_refs,
    external_curator:true,
    authored_by_candidate:false,
  });

  const reliabilityEvaluation=createRsiSkillReliabilityEvaluation({
    evaluation_id:`reliability.evaluation.${boundedId(binding_id,'binding_id')}`,
    revision,
    parent_skill:parent,
    parent_skill_evidence,
    baseline_dataset,
    baseline_trajectory_receipts,
    successor_skill_evidence,
    successor_dataset,
    successor_trajectory_receipts,
    hard_invariants_pass,
    max_potential_regression,
    evidence_refs:reliability_evidence_refs,
    external_evaluator:true,
    authored_by_candidate:false,
  });
  const result=finalizeRsiContrastiveSkillReliability({revision,evaluation:reliabilityEvaluation});
  const pass=result.eligible_for_v126_scope_preservation===true;
  const core={
    schema:RSI_INTEGRITY_BOUND_SKILL_RELIABILITY_SCHEMA,version:1,
    source_sha:sourceSha,
    binding_id:boundedId(binding_id,'binding_id'),
    integrity_admission_digest:admission.admission_digest,
    integrity_state:admission.integrity_state,
    parent_skill_digest:parent.skill_digest,
    successor_skill_digest:successor.skill_digest,
    revision,
    reliability_evaluation:reliabilityEvaluation,
    reliability_result:result,
    hidden_repeated_trial_set_digest:hiddenTrial,
    hidden_trial_distinct_from_curation_and_integrity_holdouts:true,
    integrity_admission_required:true,
    repeated_trial_consistency_required:true,
    limit_awareness_required:true,
    pass_any_alone_is_not_sufficient:true,
    eligible_for_existing_scope_preservation_gate:pass,
    state:pass?'ELIGIBLE_FOR_EXISTING_SCOPE_PRESERVATION_GATE':'REJECTED_RELIABILITY_REVISION',
    existing_scope_preservation_gate_required:true,
    existing_external_library_evidence_required:true,
    direct_library_replacement_allowed:false,
    self_authored_reliability_sufficient:false,
    candidate_can_self_certify_reliability:false,
    binding_is_execution_authority:false,
    external_curator:true,external_evaluator:true,authored_by_candidate:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,signing_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...core,binding_digest:digest(core)});
}

export function verifyRsiIntegrityBoundSkillReliability(row,args={}){
  if(!row||typeof row!=='object'||Array.isArray(row)||row.schema!==RSI_INTEGRITY_BOUND_SKILL_RELIABILITY_SCHEMA||row.version!==1){
    throw new Error('rsi_integrity_reliability_binding_invalid');
  }
  assertZero(row,'binding');
  if(row.hidden_trial_distinct_from_curation_and_integrity_holdouts!==true||row.integrity_admission_required!==true
    ||row.repeated_trial_consistency_required!==true||row.limit_awareness_required!==true
    ||row.pass_any_alone_is_not_sufficient!==true||row.existing_scope_preservation_gate_required!==true
    ||row.existing_external_library_evidence_required!==true||row.direct_library_replacement_allowed!==false
    ||row.self_authored_reliability_sufficient!==false||row.candidate_can_self_certify_reliability!==false
    ||row.binding_is_execution_authority!==false||row.external_curator!==true||row.external_evaluator!==true
    ||row.authored_by_candidate!==false)throw new Error('rsi_integrity_reliability_binding_policy_invalid');
  const canonical=createRsiIntegrityBoundSkillReliability({...args,source_sha:row.source_sha,binding_id:row.binding_id,external_curator:true,external_evaluator:true,authored_by_candidate:false});
  if(canonical.binding_digest!==exactDigest(row.binding_digest,'binding'))throw new Error('rsi_integrity_reliability_binding_digest_mismatch');
  return canonical;
}

export function rsiIntegrityBoundSkillReliabilityTrustRootSnapshot(){
  const root={
    schema:'metaengine.rsi.integrity-bound-skill-reliability-root.v1',version:1,
    policy_path:'apps/metaengine-browser/src/rsi-integrity-bound-skill-reliability.mjs',
    existing_contrastive_reliability_gate_reused:true,
    prior_sealed_integrity_admission_required:true,
    hidden_repeated_trial_set_required:true,
    hidden_trial_distinct_from_curation_and_integrity_holdouts:true,
    repeated_trial_consistency_required:true,limit_awareness_required:true,
    pass_any_alone_is_not_sufficient:true,
    existing_scope_preservation_gate_required:true,existing_external_library_evidence_required:true,
    direct_library_replacement_allowed:false,self_authored_reliability_sufficient:false,
    candidate_can_self_certify_reliability:false,binding_is_execution_authority:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,signing_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...root,reliability_binding_root_digest:digest(root)});
}
