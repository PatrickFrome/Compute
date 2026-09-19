import crypto from 'node:crypto';

import { verifyRsiStepCreditReceipt } from './rsi-runtime-credit-assignment.mjs';

export const RSI_HELD_SKILL_CREDIT_ADMISSION_SCHEMA='metaengine.rsi.held-skill-credit-admission.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;

function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]))}
function digest(v){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`}
function exactSha(v,l){const o=String(v||'').trim().toLowerCase();if(!SHA40_RE.test(o))throw new Error(`rsi_held_credit_${l}_sha_invalid`);return o}
function exactDigest(v,l){const o=String(v||'').trim().toLowerCase();if(!SHA256_RE.test(o))throw new Error(`rsi_held_credit_${l}_digest_invalid`);return o}
function boundedId(v,l){const o=String(v||'').trim();if(!SAFE_ID_RE.test(o))throw new Error(`rsi_held_credit_${l}_invalid`);return o}
function iso(v,l){const ms=Date.parse(String(v||''));if(!Number.isFinite(ms))throw new Error(`rsi_held_credit_${l}_invalid`);return new Date(ms).toISOString()}
function assertFalse(v,l){if(v!==false)throw new Error(`rsi_held_credit_${l}_must_be_false`)}

function assertEpisode(episode){
  if(!episode||episode.schema!=='metaengine.rsi.browser-outcome-episode.v1'||episode.version!==1)throw new Error('rsi_held_credit_episode_invalid');
  if(episode.authority_effect!==false||episode.execution_authority!==false||episode.automatic_retry_allowed!==false
    ||episode.quarantined===true||episode.eligible_for_skill_evidence!==true){
    throw new Error('rsi_held_credit_episode_not_eligible');
  }
  exactDigest(episode.episode_digest,'episode');
  if(!Array.isArray(episode.skill_digests)||episode.skill_digests.length!==1)throw new Error('rsi_held_credit_exact_single_skill_required');
  return episode;
}

function assertProvenance(provenance,skillDigest){
  if(!provenance||provenance.schema!=='metaengine.rsi.admission-exposure-hold-provenance.v1'||provenance.version!==1){
    throw new Error('rsi_held_credit_admission_provenance_invalid');
  }
  if(exactDigest(provenance.skill_digest,'provenance_skill')!==skillDigest)throw new Error('rsi_held_credit_skill_mismatch');
  if(provenance.admission_state!=='CONFIRMED_APPLIED_STORAGE_ONLY'||provenance.exposure_hold_observed!==true
    ||provenance.dormant_cap_observed!==true||provenance.active_for_composition!==false
    ||provenance.retrieval_exposure_allowed!==false||provenance.release_authority!==false){
    throw new Error('rsi_held_credit_storage_only_provenance_required');
  }
  for(const field of ['execution_authority','browser_authority','task_authority','scheduler_authority','production_mutation_authority','promotion_authority','self_update_authority','automatic_retry_allowed','authority_effect']){
    assertFalse(provenance[field],`provenance_${field}`);
  }
  for(const field of ['provenance_digest','admission_attempt_digest','confirmed_transition_digest','current_library_digest','current_governance_digest','effect_executor_identity_digest']){
    exactDigest(provenance[field],`provenance_${field}`);
  }
  iso(provenance.confirmed_at,'admission_confirmed_at');
  return provenance;
}

export function createRsiHeldSkillCreditAdmission({
  admission_id,
  source_sha,
  episode,
  credit_receipt,
  admission_provenance,
  current_library_digest,
  current_governance_digest,
  target_consumer_snapshot_digest,
  evaluation_contract_digest,
  retention_evidence_digest,
  retention_non_regression_pass=false,
  negative_transfer_clear=false,
  same_consumer_context_pass=false,
  external_admission_owner=false,
  authored_by_candidate=true,
}={}){
  const e=assertEpisode(episode);
  const credit=verifyRsiStepCreditReceipt(credit_receipt,e);
  const skill=exactDigest(e.skill_digests[0],'skill');
  const provenance=assertProvenance(admission_provenance,skill);
  const libraryDigest=exactDigest(current_library_digest,'current_library');
  const governanceDigest=exactDigest(current_governance_digest,'current_governance');
  if(libraryDigest!==provenance.current_library_digest)throw new Error('rsi_held_credit_current_library_drift');
  if(governanceDigest!==provenance.current_governance_digest)throw new Error('rsi_held_credit_current_governance_drift');
  if(external_admission_owner!==true||authored_by_candidate!==false)throw new Error('rsi_held_credit_external_admission_owner_required');
  if(credit.evaluator_digest===provenance.effect_executor_identity_digest)throw new Error('rsi_held_credit_evaluator_effect_executor_collapse');

  const episodeAt=iso(e.recorded_at,'episode_recorded_at');
  const admittedAt=iso(provenance.confirmed_at,'admission_confirmed_at');
  if(Date.parse(episodeAt)<=Date.parse(admittedAt))throw new Error('rsi_held_credit_measurement_not_post_admission');

  let state='INSUFFICIENT_HELD_SKILL_CREDIT';
  if(credit.credit_sign==='NEGATIVE'){
    state='ADMISSIBLE_NEGATIVE_SAFETY_CREDIT';
  }else if(credit.credit_sign==='POSITIVE'
    &&retention_non_regression_pass===true&&negative_transfer_clear===true&&same_consumer_context_pass===true){
    state='ADMISSIBLE_POSITIVE_EXPLORATION_CREDIT';
  }

  const core={
    schema:RSI_HELD_SKILL_CREDIT_ADMISSION_SCHEMA,version:1,
    admission_id:boundedId(admission_id,'admission_id'),
    source_sha:exactSha(source_sha,'source'),
    skill_digest:skill,
    episode_digest:e.episode_digest,
    credit_receipt_digest:credit.receipt_digest,
    credit_sign:credit.credit_sign,
    credit_score:credit.credit_score,
    admission_provenance_digest:provenance.provenance_digest,
    admission_attempt_digest:provenance.admission_attempt_digest,
    confirmed_admission_transition_digest:provenance.confirmed_transition_digest,
    admission_confirmed_at:admittedAt,
    episode_recorded_at:episodeAt,
    current_library_digest:libraryDigest,
    current_governance_digest:governanceDigest,
    target_consumer_snapshot_digest:exactDigest(target_consumer_snapshot_digest,'target_consumer_snapshot'),
    evaluation_contract_digest:exactDigest(evaluation_contract_digest,'evaluation_contract'),
    retention_evidence_digest:exactDigest(retention_evidence_digest,'retention_evidence'),
    retention_non_regression_pass:retention_non_regression_pass===true,
    negative_transfer_clear:negative_transfer_clear===true,
    same_consumer_context_pass:same_consumer_context_pass===true,
    measurement_after_admission:true,
    exact_single_held_skill_required:true,
    storage_admission_is_not_credit:true,
    exposure_review_is_not_credit:true,
    neutral_credit_opens_exploration:false,
    state,
    positive_credit_eligible_for_lifecycle_evidence:state==='ADMISSIBLE_POSITIVE_EXPLORATION_CREDIT',
    negative_credit_eligible_for_safety_evidence:state==='ADMISSIBLE_NEGATIVE_SAFETY_CREDIT',
    credit_is_activation_authority:false,
    credit_is_exposure_release_authority:false,
    retrieval_exposure_changed:false,
    skill_activation_performed:false,
    external_admission_owner:true,authored_by_candidate:false,
    execution_authority:false,browser_authority:false,task_authority:false,scheduler_authority:false,
    production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...core,admission_digest:digest(core)});
}

export function verifyRsiHeldSkillCreditAdmission(row,args={}){
  if(!row||row.schema!==RSI_HELD_SKILL_CREDIT_ADMISSION_SCHEMA||row.version!==1)throw new Error('rsi_held_credit_admission_required');
  const canonical=createRsiHeldSkillCreditAdmission({
    ...args,
    admission_id:row.admission_id,
    retention_non_regression_pass:row.retention_non_regression_pass,
    negative_transfer_clear:row.negative_transfer_clear,
    same_consumer_context_pass:row.same_consumer_context_pass,
    external_admission_owner:true,
    authored_by_candidate:false,
  });
  if(canonical.admission_digest!==exactDigest(row.admission_digest,'admission'))throw new Error('rsi_held_credit_admission_digest_mismatch');
  return canonical;
}

export function rsiHeldSkillCreditAdmissionTrustRootSnapshot(){
  return Object.freeze({
    schema:'metaengine.rsi.held-skill-credit-admission-root.v1',version:1,
    policy_path:'apps/metaengine-browser/src/rsi-held-skill-credit-admission.mjs',
    exact_single_held_skill_required:true,
    confirmed_storage_admission_provenance_required:true,
    measurement_must_be_after_confirmed_admission:true,
    exact_current_library_and_governance_required:true,
    target_consumer_snapshot_required:true,
    evaluation_contract_required:true,
    retention_evidence_required:true,
    positive_credit_requires_retention_non_regression:true,
    positive_credit_requires_negative_transfer_clear:true,
    positive_credit_requires_same_consumer_context:true,
    neutral_credit_cannot_open_exploration:true,
    negative_credit_retained_as_safety_evidence:true,
    storage_admission_is_not_credit:true,
    exposure_review_is_not_credit:true,
    evaluator_separate_from_storage_effect_executor:true,
    credit_is_not_activation_authority:true,
    credit_is_not_exposure_release_authority:true,
    browser_authority:false,task_authority:false,scheduler_authority:false,execution_authority:false,
    promotion_authority:false,self_update_authority:false,authority_effect:false,
  });
}
