import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  RSI_VERIFIER_EVOLUTION_ADMISSION_SCHEMA,
  RSI_VERIFIER_EVOLUTION_RECEIPT_SCHEMA,
  verifyRsiVerifierEvolutionAdmission,
  verifyRsiVerifierEvolutionReceipt,
} from './rsi-verifier-evolution-admission.mjs';

export const RSI_VERIFIER_SHADOW_EVALUATION_SCHEMA='metaengine.rsi.verifier-shadow-evaluation.v1';
export const RSI_VERIFIER_SHADOW_REVIEW_SCHEMA='metaengine.rsi.verifier-shadow-review.v1';
export const RSI_VERIFIER_SHADOW_ARCHIVE_SCHEMA='metaengine.rsi.verifier-shadow-archive.v1';

const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const SAFE_TAG_RE=/^[A-Z0-9][A-Z0-9_.:-]{1,63}$/;
const METRICS=Object.freeze([
  'anchor_agreement_rate',
  'heldout_anchor_agreement_rate',
  'consensus_agreement_rate',
  'construction_audit_pass_rate',
]);
const MAX_ROWS=512;

function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]));}
function digest(v){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`;}
function exactDigest(v,l){const x=String(v||'').trim().toLowerCase();if(!SHA256_RE.test(x))throw new Error(`rsi_verifier_shadow_${l}_digest_invalid`);return x;}
function id(v,l){const x=String(v||'').trim();if(!SAFE_ID_RE.test(x))throw new Error(`rsi_verifier_shadow_${l}_invalid`);return x;}
function rate(v,l){const n=Number(v);if(!Number.isFinite(n)||n<0||n>1)throw new Error(`rsi_verifier_shadow_${l}_invalid`);return n;}
function assertZero(v,l){for(const f of ['execution_authority','browser_authority','task_authority','production_mutation_authority','promotion_authority','self_update_authority','scheduler_authority','authority_effect'])if(v?.[f]!==false)throw new Error(`rsi_verifier_shadow_${l}_${f}_invalid`);if(v?.automatic_retry_allowed!==false)throw new Error(`rsi_verifier_shadow_${l}_retry_invalid`);}
function zero(extra={}){return Object.freeze({...extra,execution_authority:false,browser_authority:false,task_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false});}
function metricObject(value,label){
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(`rsi_verifier_shadow_${label}_metrics_invalid`);
  const keys=Object.keys(value).sort();
  if(keys.length!==METRICS.length||METRICS.some(k=>!keys.includes(k)))throw new Error(`rsi_verifier_shadow_${label}_metric_set_invalid`);
  return Object.freeze(Object.fromEntries(METRICS.map(k=>[k,rate(value[k],`${label}_${k}`)])));
}
function tags(value){
  if(!Array.isArray(value)||value.length<1||value.length>16)throw new Error('rsi_verifier_shadow_specialty_tags_invalid');
  const out=[...new Set(value.map(v=>String(v||'').trim().toUpperCase()))].sort();
  if(out.length!==value.length||out.some(v=>!SAFE_TAG_RE.test(v)))throw new Error('rsi_verifier_shadow_specialty_tags_invalid');
  return Object.freeze(out);
}
function verifyPhase21(admission,receipt){
  if(!admission||admission.schema!==RSI_VERIFIER_EVOLUTION_ADMISSION_SCHEMA)throw new Error('rsi_verifier_shadow_phase21_admission_invalid');
  if(!receipt||receipt.schema!==RSI_VERIFIER_EVOLUTION_RECEIPT_SCHEMA)throw new Error('rsi_verifier_shadow_phase21_receipt_invalid');
  const checkedReceipt=verifyRsiVerifierEvolutionReceipt(receipt);
  const checkedAdmission=verifyRsiVerifierEvolutionAdmission(admission,{receipt:checkedReceipt});
  if(checkedAdmission.state!=='QUALIFIED_FOR_VERIFIER_SHADOW'||checkedAdmission.qualified_for_verifier_shadow!==true)throw new Error('rsi_verifier_shadow_phase21_qualification_required');
  return Object.freeze({admission:checkedAdmission,receipt:checkedReceipt});
}

export function createRsiVerifierShadowEvaluation({
  evaluation_id,
  admission,
  receipt,
  trusted_runtime_digest,
  anchor_set_digest,
  heldout_anchor_digest,
  semantic_audit_digest,
  freshness_probe_digest,
  incumbent_metrics,
  candidate_metrics,
  specialty_tags,
  contamination_detected,
  trusted_runtime_integrity_pass,
  sealed_anchor_integrity_pass,
  semantic_construction_audit_pass,
  external_observer=false,
  authored_by_candidate=true,
}={}){
  if(external_observer!==true||authored_by_candidate!==false)throw new Error('rsi_verifier_shadow_external_observer_required');
  const phase21=verifyPhase21(admission,receipt);
  const roots=[
    exactDigest(trusted_runtime_digest,'trusted_runtime'),
    exactDigest(anchor_set_digest,'anchor_set'),
    exactDigest(heldout_anchor_digest,'heldout_anchor'),
    exactDigest(semantic_audit_digest,'semantic_audit'),
    exactDigest(freshness_probe_digest,'freshness_probe'),
    phase21.receipt.sealed_benchmark_root_digest,
    phase21.receipt.transfer_holdout_digest,
    phase21.receipt.reward_hack_suite_digest,
    phase21.receipt.external_evaluator_root_digest,
  ];
  if(new Set(roots).size!==roots.length)throw new Error('rsi_verifier_shadow_independent_roots_required');
  const incumbent=metricObject(incumbent_metrics,'incumbent');
  const candidate=metricObject(candidate_metrics,'candidate');
  const regressed=METRICS.filter(k=>candidate[k]<incumbent[k]).sort();
  const improved=METRICS.filter(k=>candidate[k]>incumbent[k]).sort();
  const blockers=[];
  if(regressed.length>0)blockers.push('SHADOW_METRIC_REGRESSION');
  if(improved.length===0)blockers.push('NO_SHADOW_IMPROVEMENT');
  if(contamination_detected===true)blockers.push('BENCHMARK_CONTAMINATION_DETECTED');
  if(trusted_runtime_integrity_pass!==true)blockers.push('TRUSTED_RUNTIME_INTEGRITY_FAILURE');
  if(sealed_anchor_integrity_pass!==true)blockers.push('SEALED_ANCHOR_INTEGRITY_FAILURE');
  if(semantic_construction_audit_pass!==true)blockers.push('SEMANTIC_CONSTRUCTION_AUDIT_FAILURE');
  const core=zero({
    schema:RSI_VERIFIER_SHADOW_EVALUATION_SCHEMA,
    version:1,
    evaluation_id:id(evaluation_id,'evaluation_id'),
    source_sha:phase21.admission.source_sha,
    admission_digest:phase21.admission.admission_digest,
    receipt_digest:phase21.receipt.receipt_digest,
    incumbent_verifier_root_digest:phase21.admission.incumbent_verifier_root_digest,
    candidate_verifier_root_digest:phase21.admission.candidate_verifier_root_digest,
    trusted_runtime_digest:roots[0],
    anchor_set_digest:roots[1],
    heldout_anchor_digest:roots[2],
    semantic_audit_digest:roots[3],
    freshness_probe_digest:roots[4],
    incumbent_metrics:incumbent,
    candidate_metrics:candidate,
    specialty_tags:tags(specialty_tags),
    regressed_metrics:Object.freeze(regressed),
    improved_metrics:Object.freeze(improved),
    contamination_detected:contamination_detected===true,
    trusted_runtime_integrity_pass:trusted_runtime_integrity_pass===true,
    sealed_anchor_integrity_pass:sealed_anchor_integrity_pass===true,
    semantic_construction_audit_pass:semantic_construction_audit_pass===true,
    blockers:Object.freeze(blockers.sort()),
    clean_shadow_evidence:blockers.length===0,
    external_observer:true,
    authored_by_candidate:false,
    candidate_can_read_heldout_anchor:false,
    candidate_can_read_semantic_audit:false,
    candidate_can_modify_trusted_runtime:false,
    candidate_can_choose_anchor:false,
    candidate_can_choose_freshness_probe:false,
    candidate_can_choose_specialty_tags:false,
    evaluation_is_activation_authority:false,
  });
  return Object.freeze({...core,evaluation_digest:digest(core)});
}

export function verifyRsiVerifierShadowEvaluation(evaluation,{admission,receipt}={}){
  if(!evaluation||evaluation.schema!==RSI_VERIFIER_SHADOW_EVALUATION_SCHEMA||evaluation.version!==1)throw new Error('rsi_verifier_shadow_evaluation_invalid');
  assertZero(evaluation,'evaluation');
  if(evaluation.external_observer!==true||evaluation.authored_by_candidate!==false
    ||evaluation.candidate_can_read_heldout_anchor!==false||evaluation.candidate_can_read_semantic_audit!==false
    ||evaluation.candidate_can_modify_trusted_runtime!==false||evaluation.candidate_can_choose_anchor!==false
    ||evaluation.candidate_can_choose_freshness_probe!==false||evaluation.candidate_can_choose_specialty_tags!==false
    ||evaluation.evaluation_is_activation_authority!==false)throw new Error('rsi_verifier_shadow_evaluation_policy_invalid');
  const canonical=createRsiVerifierShadowEvaluation({
    evaluation_id:evaluation.evaluation_id,
    admission,
    receipt,
    trusted_runtime_digest:evaluation.trusted_runtime_digest,
    anchor_set_digest:evaluation.anchor_set_digest,
    heldout_anchor_digest:evaluation.heldout_anchor_digest,
    semantic_audit_digest:evaluation.semantic_audit_digest,
    freshness_probe_digest:evaluation.freshness_probe_digest,
    incumbent_metrics:evaluation.incumbent_metrics,
    candidate_metrics:evaluation.candidate_metrics,
    specialty_tags:evaluation.specialty_tags,
    contamination_detected:evaluation.contamination_detected,
    trusted_runtime_integrity_pass:evaluation.trusted_runtime_integrity_pass,
    sealed_anchor_integrity_pass:evaluation.sealed_anchor_integrity_pass,
    semantic_construction_audit_pass:evaluation.semantic_construction_audit_pass,
    external_observer:true,
    authored_by_candidate:false,
  });
  if(canonical.evaluation_digest!==exactDigest(evaluation.evaluation_digest,'evaluation'))throw new Error('rsi_verifier_shadow_evaluation_digest_mismatch');
  return canonical;
}

export function createRsiVerifierShadowReview({
  review_id,
  evaluation,
  admission,
  receipt,
  external_reviewer=false,
  authored_by_candidate=true,
}={}){
  if(external_reviewer!==true||authored_by_candidate!==false)throw new Error('rsi_verifier_shadow_external_reviewer_required');
  const checked=verifyRsiVerifierShadowEvaluation(evaluation,{admission,receipt});
  const eligible=checked.clean_shadow_evidence===true&&checked.blockers.length===0;
  const archiveIdentity={
    source_sha:checked.source_sha,
    candidate_verifier_root_digest:checked.candidate_verifier_root_digest,
    evaluation_digest:checked.evaluation_digest,
    specialty_tags:checked.specialty_tags,
  };
  const core=zero({
    schema:RSI_VERIFIER_SHADOW_REVIEW_SCHEMA,
    version:1,
    review_id:id(review_id,'review_id'),
    source_sha:checked.source_sha,
    evaluation_digest:checked.evaluation_digest,
    admission_digest:checked.admission_digest,
    incumbent_verifier_root_digest:checked.incumbent_verifier_root_digest,
    candidate_verifier_root_digest:checked.candidate_verifier_root_digest,
    specialty_tags:checked.specialty_tags,
    archive_identity_digest:digest(archiveIdentity),
    state:eligible?'ELIGIBLE_FOR_VERIFIER_ARCHIVE':'VERIFIER_SHADOW_REJECTED',
    eligible_for_verifier_archive:eligible,
    incumbent_verifier_remains_active:true,
    archive_preserves_multiple_candidates:true,
    greedy_replacement_forbidden:true,
    candidate_can_self_archive:false,
    candidate_can_become_active_verifier:false,
    review_is_activation_authority:false,
    external_activation_gate_required:true,
    external_reviewer:true,
    authored_by_candidate:false,
  });
  return Object.freeze({...core,review_digest:digest(core)});
}

export function verifyRsiVerifierShadowReview(review,{evaluation,admission,receipt}={}){
  if(!review||review.schema!==RSI_VERIFIER_SHADOW_REVIEW_SCHEMA||review.version!==1)throw new Error('rsi_verifier_shadow_review_invalid');
  assertZero(review,'review');
  if(review.incumbent_verifier_remains_active!==true||review.archive_preserves_multiple_candidates!==true
    ||review.greedy_replacement_forbidden!==true||review.candidate_can_self_archive!==false
    ||review.candidate_can_become_active_verifier!==false||review.review_is_activation_authority!==false
    ||review.external_activation_gate_required!==true||review.external_reviewer!==true||review.authored_by_candidate!==false)throw new Error('rsi_verifier_shadow_review_policy_invalid');
  const canonical=createRsiVerifierShadowReview({
    review_id:review.review_id,
    evaluation,
    admission,
    receipt,
    external_reviewer:true,
    authored_by_candidate:false,
  });
  if(canonical.review_digest!==exactDigest(review.review_digest,'review'))throw new Error('rsi_verifier_shadow_review_digest_mismatch');
  return canonical;
}

function archiveState(sourceSha,rows){
  const eligible=rows.filter(r=>r.review.eligible_for_verifier_archive===true);
  const niches=[...new Set(eligible.flatMap(r=>r.review.specialty_tags))].sort();
  const core=zero({
    schema:RSI_VERIFIER_SHADOW_ARCHIVE_SCHEMA,
    version:1,
    source_sha:sourceSha,
    rows,
    row_count:rows.length,
    eligible_count:eligible.length,
    represented_niches:Object.freeze(niches),
    append_only:true,
    archive_preserves_multiple_candidates:true,
    archive_has_scalar_winner:false,
    active_verifier_root_digest:null,
    candidate_can_delete:false,
    candidate_can_rewrite:false,
    archive_can_activate_verifier:false,
    archive_can_gate_canary:false,
    archive_can_gate_promotion:false,
  });
  return {...core,state_digest:digest(core)};
}

export class RsiVerifierShadowArchive{
  #path;#sourceSha;#rows=[];#initialized=false;
  constructor({statePath,source_sha}={}){if(!statePath)throw new Error('rsi_verifier_shadow_archive_path_required');this.#path=path.resolve(statePath);this.#sourceSha=String(source_sha||'').trim().toLowerCase();if(!/^[0-9a-f]{40}$/.test(this.#sourceSha))throw new Error('rsi_verifier_shadow_source_sha_invalid');}
  async init(){
    if(this.#initialized)return this.snapshot();
    await fs.mkdir(path.dirname(this.#path),{recursive:true});
    try{
      const parsed=JSON.parse(await fs.readFile(this.#path,'utf8'));assertZero(parsed,'archive');
      if(parsed.schema!==RSI_VERIFIER_SHADOW_ARCHIVE_SCHEMA||parsed.version!==1||parsed.source_sha!==this.#sourceSha||parsed.append_only!==true
        ||parsed.archive_preserves_multiple_candidates!==true||parsed.archive_has_scalar_winner!==false||parsed.active_verifier_root_digest!==null
        ||parsed.candidate_can_delete!==false||parsed.candidate_can_rewrite!==false||parsed.archive_can_activate_verifier!==false
        ||parsed.archive_can_gate_canary!==false||parsed.archive_can_gate_promotion!==false)throw new Error('rsi_verifier_shadow_archive_state_invalid');
      const clone=structuredClone(parsed);delete clone.state_digest;if(digest(clone)!==exactDigest(parsed.state_digest,'archive'))throw new Error('rsi_verifier_shadow_archive_digest_mismatch');
      if(!Array.isArray(parsed.rows)||parsed.rows.length>MAX_ROWS)throw new Error('rsi_verifier_shadow_archive_rows_invalid');
      const ids=new Set();
      for(const row of parsed.rows){
        if(row.source_sha!==this.#sourceSha)throw new Error('rsi_verifier_shadow_archive_source_mismatch');
        const ec=structuredClone(row.evaluation);delete ec.evaluation_digest;if(digest(ec)!==exactDigest(row.evaluation.evaluation_digest,'archive_evaluation'))throw new Error('rsi_verifier_shadow_archive_evaluation_digest_mismatch');
        const rc=structuredClone(row.review);delete rc.review_digest;if(digest(rc)!==exactDigest(row.review.review_digest,'archive_review'))throw new Error('rsi_verifier_shadow_archive_review_digest_mismatch');
        if(row.review.evaluation_digest!==row.evaluation.evaluation_digest)throw new Error('rsi_verifier_shadow_archive_binding_mismatch');
        if(ids.has(row.review.archive_identity_digest))throw new Error('rsi_verifier_shadow_archive_identity_duplicate');
        ids.add(row.review.archive_identity_digest);
      }
      this.#rows=parsed.rows;
    }catch(error){if(error?.code!=='ENOENT')throw error;}
    this.#initialized=true;return this.snapshot();
  }
  async #persist(){
    const state=archiveState(this.#sourceSha,this.#rows);const tmp=`${this.#path}.tmp`;const h=await fs.open(tmp,'w',0o600);
    try{await h.writeFile(`${JSON.stringify(state)}\n`,'utf8');await h.sync();}finally{await h.close();}
    await fs.rename(tmp,this.#path);
  }
  async add({evaluation,review}={}){
    if(!this.#initialized)throw new Error('rsi_verifier_shadow_archive_not_initialized');
    if(!evaluation||evaluation.schema!==RSI_VERIFIER_SHADOW_EVALUATION_SCHEMA)throw new Error('rsi_verifier_shadow_evaluation_invalid');
    if(!review||review.schema!==RSI_VERIFIER_SHADOW_REVIEW_SCHEMA)throw new Error('rsi_verifier_shadow_review_invalid');
    assertZero(evaluation,'archive_evaluation');assertZero(review,'archive_review');
    const ec=structuredClone(evaluation);delete ec.evaluation_digest;if(digest(ec)!==exactDigest(evaluation.evaluation_digest,'archive_evaluation'))throw new Error('rsi_verifier_shadow_archive_evaluation_digest_mismatch');
    const rc=structuredClone(review);delete rc.review_digest;if(digest(rc)!==exactDigest(review.review_digest,'archive_review'))throw new Error('rsi_verifier_shadow_archive_review_digest_mismatch');
    if(evaluation.source_sha!==this.#sourceSha||review.source_sha!==this.#sourceSha||review.evaluation_digest!==evaluation.evaluation_digest)throw new Error('rsi_verifier_shadow_archive_binding_mismatch');
    const existing=this.#rows.find(r=>r.review.archive_identity_digest===review.archive_identity_digest||r.review.candidate_verifier_root_digest===review.candidate_verifier_root_digest);
    if(existing){
      if(existing.review.review_digest!==review.review_digest||existing.evaluation.evaluation_digest!==evaluation.evaluation_digest)throw new Error('rsi_verifier_shadow_archive_identity_conflict');
      return zero({state:'IDEMPOTENT',review_digest:review.review_digest});
    }
    if(this.#rows.length>=MAX_ROWS)throw new Error('rsi_verifier_shadow_archive_capacity_exceeded');
    this.#rows.push(Object.freeze({source_sha:this.#sourceSha,evaluation:structuredClone(evaluation),review:structuredClone(review)}));
    await this.#persist();
    return zero({state:review.state,review_digest:review.review_digest});
  }
  eligible(){
    if(!this.#initialized)throw new Error('rsi_verifier_shadow_archive_not_initialized');
    return Object.freeze(this.#rows.filter(r=>r.review.eligible_for_verifier_archive===true).map(r=>Object.freeze(structuredClone(r.review))));
  }
  snapshot(){
    const s=archiveState(this.#sourceSha,this.#rows);
    return Object.freeze({schema:s.schema,version:s.version,source_sha:s.source_sha,initialized:this.#initialized,row_count:s.row_count,eligible_count:s.eligible_count,represented_niches:s.represented_niches,append_only:true,archive_preserves_multiple_candidates:true,archive_has_scalar_winner:false,active_verifier_root_digest:null,archive_can_activate_verifier:false,archive_can_gate_canary:false,archive_can_gate_promotion:false,authority_effect:false});
  }
}

export function rsiVerifierShadowLifecycleTrustRootSnapshot(){
  const root={
    schema:'metaengine.rsi.verifier-shadow-lifecycle-root.v1',
    version:1,
    phase21_shadow_qualification_required:true,
    fixed_trusted_runtime_required:true,
    external_anchor_set_required:true,
    heldout_anchor_required:true,
    semantic_construction_audit_required:true,
    freshness_probe_required:true,
    benchmark_contamination_blocks_archive:true,
    candidate_can_read_heldout_anchor:false,
    candidate_can_read_semantic_audit:false,
    candidate_can_modify_trusted_runtime:false,
    no_shadow_metric_regression_required:true,
    at_least_one_shadow_metric_improvement_required:true,
    multiple_candidate_archive_required:true,
    scalar_winner_forbidden:true,
    incumbent_verifier_remains_active:true,
    external_activation_gate_required:true,
    archive_can_activate_verifier:false,
    archive_can_gate_canary:false,
    archive_can_gate_promotion:false,
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
  return Object.freeze({...root,verifier_shadow_lifecycle_root_digest:digest(root)});
}
