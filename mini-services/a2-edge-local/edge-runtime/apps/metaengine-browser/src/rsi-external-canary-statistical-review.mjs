import crypto from 'node:crypto';

import {
  RSI_META_PROFILE_CANARY_ADMISSION_SCHEMA,
  RSI_META_PROFILE_CANARY_MANIFEST_SCHEMA,
  verifyRsiMetaProfileCanaryManifest,
} from './rsi-meta-profile-canary-admission.mjs';

export const RSI_EXTERNAL_CANARY_STATISTICAL_REVIEW_SCHEMA='metaengine.rsi.external-canary-statistical-review.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const METHODS=new Set(['E_VALUE_EXTERNAL_V1','PAIRED_CONFIDENCE_SEQUENCE_EXTERNAL_V1']);
const GLOBAL_ALPHA=0.01;
const EPS=1e-12;

function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]));}
function digest(v){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`;}
function exactSha(v,l){const x=String(v||'').trim().toLowerCase();if(!SHA40_RE.test(x))throw new Error(`rsi_external_canary_review_${l}_sha_invalid`);return x;}
function exactDigest(v,l){const x=String(v||'').trim().toLowerCase();if(!SHA256_RE.test(x))throw new Error(`rsi_external_canary_review_${l}_digest_invalid`);return x;}
function id(v,l){const x=String(v||'').trim();if(!SAFE_ID_RE.test(x))throw new Error(`rsi_external_canary_review_${l}_invalid`);return x;}
function positiveInt(v,l){const n=Number(v);if(!Number.isSafeInteger(n)||n<1)throw new Error(`rsi_external_canary_review_${l}_invalid`);return n;}
function probability(v,l){const n=Number(v);if(!Number.isFinite(n)||n<=0||n>=1)throw new Error(`rsi_external_canary_review_${l}_invalid`);return n;}
function allocation(index){const i=positiveInt(index,'confirmation_index');return GLOBAL_ALPHA/(i*(i+1));}
function assertZero(v,l){for(const f of ['execution_authority','browser_authority','task_authority','production_mutation_authority','promotion_authority','self_update_authority','scheduler_authority','authority_effect'])if(v?.[f]!==false)throw new Error(`rsi_external_canary_review_${l}_${f}_invalid`);if(v?.automatic_retry_allowed!==false)throw new Error(`rsi_external_canary_review_${l}_retry_invalid`);}

function verifyAdmission(admission,manifest){
  if(!admission||admission.schema!==RSI_META_PROFILE_CANARY_ADMISSION_SCHEMA||admission.version!==1)throw new Error('rsi_external_canary_review_admission_invalid');
  assertZero(admission,'admission');
  if(admission.manifest_digest!==manifest.manifest_digest
    ||admission.canary_identity_digest!==manifest.canary_identity_digest
    ||admission.state!=='READY_FOR_EXTERNAL_CANARY_REVIEW'
    ||admission.ready_for_external_canary_review!==true
    ||admission.complete_evidence!==true
    ||admission.challenger_activation_authorized!==false
    ||admission.live_profile_replacement_authorized!==false
    ||admission.canary_token!==null)throw new Error('rsi_external_canary_review_admission_not_ready');
  const clone=structuredClone(admission);
  delete clone.admission_digest;
  delete clone.durable_ledger_readback_required;
  delete clone.durable_ledger_incident_latched;
  delete clone.durable_ledger_state_digest;
  if(digest(clone)!==exactDigest(admission.admission_digest,'admission'))throw new Error('rsi_external_canary_review_admission_digest_mismatch');
  if(admission.durable_ledger_readback_required!==true
    ||admission.durable_ledger_incident_latched!==false)throw new Error('rsi_external_canary_review_durable_ledger_required');
  exactDigest(admission.durable_ledger_state_digest,'ledger_state');
  return Object.freeze(structuredClone(admission));
}

export function createRsiExternalCanaryStatisticalReview({
  review_id,
  source_sha,
  manifest,
  selection,
  admission,
  confirmation_index,
  method='E_VALUE_EXTERNAL_V1',
  alpha_used,
  independent_holdout_digest,
  evaluator_root_digest,
  sample_count,
  safety_noninferiority_certified,
  security_noninferiority_certified,
  utility_noninferiority_certified,
  material_improvement_certified,
  familywise_valid,
  independent_holdout,
  stopping_rule_precommitted,
  optional_stopping_used,
  external_verifier=false,
  authored_by_candidate=true,
}={}){
  if(external_verifier!==true||authored_by_candidate!==false)throw new Error('rsi_external_canary_review_external_verifier_required');
  if(!manifest||manifest.schema!==RSI_META_PROFILE_CANARY_MANIFEST_SCHEMA)throw new Error('rsi_external_canary_review_manifest_invalid');
  const checkedManifest=verifyRsiMetaProfileCanaryManifest(manifest,{selection});
  const checkedAdmission=verifyAdmission(admission,checkedManifest);
  const source=exactSha(source_sha,'source');
  if(source!==checkedManifest.source_sha||source!==checkedAdmission.source_sha)throw new Error('rsi_external_canary_review_source_mismatch');
  const index=positiveInt(confirmation_index,'confirmation_index');
  const allocated=allocation(index);
  const used=probability(alpha_used,'alpha_used');
  if(used-allocated>EPS)throw new Error('rsi_external_canary_review_alpha_over_budget');
  const normalizedMethod=String(method||'').trim().toUpperCase();
  if(!METHODS.has(normalizedMethod))throw new Error('rsi_external_canary_review_method_invalid');
  if(familywise_valid!==true||independent_holdout!==true||stopping_rule_precommitted!==true||optional_stopping_used!==false){
    throw new Error('rsi_external_canary_review_statistical_policy_invalid');
  }
  const holdout=exactDigest(independent_holdout_digest,'holdout');
  const evaluator=exactDigest(evaluator_root_digest,'evaluator_root');
  if([
    checkedManifest.cohort_digest,
    checkedManifest.comparator_root_digest,
    checkedManifest.security_holdout_digest,
    checkedManifest.monitor_root_digest,
  ].includes(holdout)||[
    checkedManifest.comparator_root_digest,
    checkedManifest.monitor_root_digest,
    holdout,
  ].includes(evaluator)){
    throw new Error('rsi_external_canary_review_independent_evaluator_required');
  }
  const pass=safety_noninferiority_certified===true
    &&security_noninferiority_certified===true
    &&utility_noninferiority_certified===true
    &&material_improvement_certified===true;
  const core={
    schema:RSI_EXTERNAL_CANARY_STATISTICAL_REVIEW_SCHEMA,
    version:1,
    source_sha:source,
    review_id:id(review_id,'review_id'),
    manifest_digest:checkedManifest.manifest_digest,
    admission_digest:checkedAdmission.admission_digest,
    canary_identity_digest:checkedManifest.canary_identity_digest,
    incumbent_profile_digest:checkedManifest.incumbent_profile_digest,
    challenger_profile_digest:checkedManifest.challenger_profile_digest,
    durable_ledger_state_digest:checkedAdmission.durable_ledger_state_digest,
    confirmation_index:index,
    global_alpha:GLOBAL_ALPHA,
    allocated_alpha:allocated,
    alpha_used:used,
    method:normalizedMethod,
    independent_holdout_digest:holdout,
    evaluator_root_digest:evaluator,
    sample_count:positiveInt(sample_count,'sample_count'),
    safety_noninferiority_certified:safety_noninferiority_certified===true,
    security_noninferiority_certified:security_noninferiority_certified===true,
    utility_noninferiority_certified:utility_noninferiority_certified===true,
    material_improvement_certified:material_improvement_certified===true,
    familywise_valid:true,
    independent_holdout:true,
    stopping_rule_precommitted:true,
    optional_stopping_used:false,
    risk_spending_policy:'TELESCOPING_ANYTIME_V1',
    state:pass?'ELIGIBLE_FOR_EXTERNAL_READ_ONLY_CANARY_CONTROLLER':'STATISTICAL_REVIEW_REJECTED',
    eligible_for_external_read_only_canary_controller:pass,
    project_policy_global_alpha:true,
    candidate_can_choose_alpha:false,
    candidate_can_choose_confirmation_index:false,
    candidate_can_choose_holdout:false,
    candidate_can_choose_evaluator:false,
    candidate_can_author_review:false,
    review_is_canary_activation_authority:false,
    canary_token:null,
    execution_authority:false,
    browser_authority:false,
    task_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...core,review_digest:digest(core)});
}

export function verifyRsiExternalCanaryStatisticalReview(review,{manifest,selection,admission}={}){
  if(!review||review.schema!==RSI_EXTERNAL_CANARY_STATISTICAL_REVIEW_SCHEMA||review.version!==1)throw new Error('rsi_external_canary_review_invalid');
  assertZero(review,'review');
  if(review.familywise_valid!==true||review.independent_holdout!==true||review.stopping_rule_precommitted!==true||review.optional_stopping_used!==false
    ||review.risk_spending_policy!=='TELESCOPING_ANYTIME_V1'||review.global_alpha!==GLOBAL_ALPHA
    ||review.project_policy_global_alpha!==true||review.candidate_can_choose_alpha!==false
    ||review.candidate_can_choose_confirmation_index!==false||review.candidate_can_choose_holdout!==false
    ||review.candidate_can_choose_evaluator!==false||review.candidate_can_author_review!==false
    ||review.review_is_canary_activation_authority!==false||review.canary_token!==null)throw new Error('rsi_external_canary_review_policy_invalid');
  const canonical=createRsiExternalCanaryStatisticalReview({
    review_id:review.review_id,
    source_sha:review.source_sha,
    manifest,
    selection,
    admission,
    confirmation_index:review.confirmation_index,
    method:review.method,
    alpha_used:review.alpha_used,
    independent_holdout_digest:review.independent_holdout_digest,
    evaluator_root_digest:review.evaluator_root_digest,
    sample_count:review.sample_count,
    safety_noninferiority_certified:review.safety_noninferiority_certified,
    security_noninferiority_certified:review.security_noninferiority_certified,
    utility_noninferiority_certified:review.utility_noninferiority_certified,
    material_improvement_certified:review.material_improvement_certified,
    familywise_valid:true,
    independent_holdout:true,
    stopping_rule_precommitted:true,
    optional_stopping_used:false,
    external_verifier:true,
    authored_by_candidate:false,
  });
  if(canonical.review_digest!==exactDigest(review.review_digest,'review'))throw new Error('rsi_external_canary_review_digest_mismatch');
  return canonical;
}

export function rsiExternalCanaryStatisticalReviewTrustRootSnapshot(){
  const root={
    schema:'metaengine.rsi.external-canary-statistical-review-root.v1',
    version:1,
    phase19_durable_clean_admission_required:true,
    allowed_methods:Object.freeze([...METHODS].sort()),
    global_alpha:GLOBAL_ALPHA,
    global_alpha_is_project_policy:true,
    telescoping_anytime_risk_spending_required:true,
    familywise_validity_required:true,
    independent_holdout_required:true,
    precommitted_stopping_required:true,
    optional_stopping_forbidden:true,
    safety_noninferiority_required:true,
    security_noninferiority_required:true,
    utility_noninferiority_required:true,
    material_improvement_required:true,
    external_verifier_required:true,
    candidate_can_choose_alpha:false,
    candidate_can_choose_holdout:false,
    candidate_can_choose_evaluator:false,
    candidate_can_author_review:false,
    review_only_not_activation_authority:true,
    execution_authority:false,
    browser_authority:false,
    task_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...root,statistical_review_root_digest:digest(root)});
}
