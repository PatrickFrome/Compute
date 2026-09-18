import crypto from 'node:crypto';
import { verifyRsiPostAdoptionCausalMeasurement } from './rsi-post-adoption-causal-measurement.mjs';
import { verifyRsiEpisodePromotionReview } from './rsi-episode-promotion-review.mjs';
import {
  createRsiExperienceCase, verifyRsiExperienceCase,
  createRsiExperienceGraphSnapshot, verifyRsiExperienceGraphSnapshot,
  extendRsiExperienceGraphSnapshot,
} from './rsi-experience-graph.mjs';

export const RSI_POST_ADOPTION_EXPERIENCE_ADMISSION_SCHEMA='metaengine.rsi.post-adoption-experience-admission.v1';

const D=/^sha256:[0-9a-f]{64}$/;
const S=/^[0-9a-f]{40}$/;
const C=/^candidate_sha256_[0-9a-f]{64}$/;
const I=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const T=/^[A-Z0-9][A-Z0-9_.:-]{0,95}$/;
function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]))}
function digest(v){return 'sha256:'+crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}
function exact(v,re,label){const x=String(v||'').trim();if(!re.test(x))throw new Error('rsi_postexp_'+label+'_invalid');return x}
function zero(extra={}){return Object.freeze({...extra,execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,automatic_retry_allowed:false,authority_effect:false})}
function refs(v){
  if(!Array.isArray(v)||v.length<1||v.length>24)throw new Error('rsi_postexp_evidence_refs_invalid');
  const out=v.map(x=>exact(x,I,'evidence_ref')).sort();
  if(new Set(out).size!==out.length)throw new Error('rsi_postexp_evidence_ref_duplicate');
  return out;
}
function anchor(m,r){
  const suffix=m.measurement_digest.slice(7,31);
  return Object.freeze({
    task_id:'post_adoption_'+suffix,
    task_signature_digest:digest({
      measurement:m.measurement_digest,policy:m.policy_digest,workload:m.workload_manifest_digest,
      environment:m.environment_fingerprint,execution:m.execution_signature_digest,epoch:m.observation_epoch,
      candidate_id:r.candidate_id,candidate_sha:m.candidate_sha,
    }),
    challenge_family:'POST_ADOPTION_DEPLOYMENT',
    hidden_manifest_digest:m.workload_manifest_digest,
    external_writer:true,authored_by_candidate:false,
  });
}
function cls(m){
  if(m.state==='PARETO_IMPROVEMENT')return {
    outcome:'SUCCESS',failure_codes:[],
    mechanism_tags:['POST_ADOPTION_DEPLOYMENT','PARETO_IMPROVEMENT','QUALIFIED_SUCCESSOR'],
  };
  if(m.state==='REGRESSION'){
    const failures=['POST_ADOPTION_REGRESSION'];
    if(m.hard_invariant_regression===true)failures.push('HARD_INVARIANT_REGRESSION');
    if(m.primary_regression===true)failures.push('PRIMARY_METRIC_REGRESSION');
    return {outcome:'FAILURE',failure_codes:failures.sort(),
      mechanism_tags:['POST_ADOPTION_DEPLOYMENT','VERIFIED_REGRESSION','QUALIFIED_SUCCESSOR']};
  }
  throw new Error('rsi_postexp_measurement_not_learning_eligible');
}

export function createRsiPostAdoptionExperienceAdmission({
  post_adoption_measurement,episode_promotion_review,model_family,evidence_refs,
  external_graph_writer=false,authored_by_candidate=true,
}={}){
  const m=verifyRsiPostAdoptionCausalMeasurement(post_adoption_measurement);
  if(m.eligible_for_experience_graph!==true)throw new Error('rsi_postexp_measurement_not_learning_eligible');
  const r=verifyRsiEpisodePromotionReview(episode_promotion_review);
  if(r.candidate_sha!==m.candidate_sha)throw new Error('rsi_postexp_promotion_candidate_mismatch');
  if(external_graph_writer!==true||authored_by_candidate!==false)throw new Error('rsi_postexp_external_writer_required');
  const model=exact(String(model_family||'').toUpperCase(),T,'model_family');
  const er=refs(evidence_refs),a=anchor(m,r),k=cls(m),suffix=m.measurement_digest.slice(7,31);
  const exp=createRsiExperienceCase({
    case_id:'rsi_post_adopt_'+suffix,task_id:a.task_id,task_signature_digest:a.task_signature_digest,
    attempt_index:Number(m.observation_epoch),candidate_id:exact(r.candidate_id,C,'candidate_id'),
    candidate_sha:exact(m.candidate_sha,S,'candidate_sha'),outcome:k.outcome,
    environment_fingerprint:exact(m.environment_fingerprint,I,'environment'),
    model_family:model,execution_signature_digest:exact(m.execution_signature_digest,D,'execution'),
    failure_codes:k.failure_codes,mechanism_tags:k.mechanism_tags,lesson_digests:[],
    attribution_digests:[m.measurement_digest,m.successor_verification_digest,r.review_digest].sort(),
    transfer_receipt_digests:[],evidence_digest:m.measurement_digest,evidence_refs:er,
    external_writer:true,authored_by_candidate:false,
  });
  const core=zero({
    schema:RSI_POST_ADOPTION_EXPERIENCE_ADMISSION_SCHEMA,version:1,
    graph_id:'rsi.runtime.experience.'+m.candidate_sha.slice(0,16),
    measurement_digest:m.measurement_digest,measurement_state:m.state,
    successor_verification_digest:m.successor_verification_digest,promotion_review_digest:r.review_digest,
    candidate_id:r.candidate_id,candidate_sha:m.candidate_sha,previous_authority_sha:m.previous_authority_sha,
    workload_manifest_digest:m.workload_manifest_digest,task_anchor:a,experience_case:exp,
    outcome:k.outcome,model_family:model,evidence_refs:er,
    append_only_graph_admission:true,external_graph_writer:true,authored_by_candidate:false,
    candidate_can_write_graph:false,candidate_can_edit_case:false,
    measurement_is_contextual_not_global_truth:true,graph_write_authorizes_execution:false,
    skill_library_write_performed:false,next_episode_created:false,
  });
  return Object.freeze({...core,admission_digest:digest(core)});
}

export function verifyRsiPostAdoptionExperienceAdmission(row){
  if(!row||row.schema!==RSI_POST_ADOPTION_EXPERIENCE_ADMISSION_SCHEMA||row.version!==1)throw new Error('rsi_postexp_schema_invalid');
  for(const f of ['execution_authority','production_mutation_authority','promotion_authority','self_update_authority','authority_effect']){
    if(row[f]!==false)throw new Error('rsi_postexp_'+f+'_invalid');
  }
  if(row.automatic_retry_allowed!==false||row.append_only_graph_admission!==true
    ||row.external_graph_writer!==true||row.authored_by_candidate!==false||row.candidate_can_write_graph!==false
    ||row.candidate_can_edit_case!==false||row.measurement_is_contextual_not_global_truth!==true
    ||row.graph_write_authorizes_execution!==false||row.skill_library_write_performed!==false||row.next_episode_created!==false)
    throw new Error('rsi_postexp_policy_invalid');
  const expected=row.measurement_state==='PARETO_IMPROVEMENT'?'SUCCESS':row.measurement_state==='REGRESSION'?'FAILURE':null;
  if(expected==null||row.outcome!==expected)throw new Error('rsi_postexp_outcome_invalid');
  exact(row.candidate_id,C,'candidate_id');exact(row.candidate_sha,S,'candidate_sha');exact(row.previous_authority_sha,S,'previous_sha');
  for(const x of ['measurement_digest','successor_verification_digest','promotion_review_digest','workload_manifest_digest'])exact(row[x],D,x);
  exact(String(row.model_family||'').toUpperCase(),T,'model_family');refs(row.evidence_refs);
  if(row.graph_id!=='rsi.runtime.experience.'+row.candidate_sha.slice(0,16))throw new Error('rsi_postexp_graph_id_invalid');
  const exp=verifyRsiExperienceCase(row.experience_case);
  if(exp.outcome!==expected||exp.candidate_id!==row.candidate_id||exp.candidate_sha!==row.candidate_sha
    ||exp.evidence_digest!==row.measurement_digest||exp.task_id!==row.task_anchor?.task_id
    ||exp.task_signature_digest!==row.task_anchor?.task_signature_digest
    ||row.task_anchor?.challenge_family!=='POST_ADOPTION_DEPLOYMENT'
    ||row.task_anchor?.hidden_manifest_digest!==row.workload_manifest_digest
    ||row.task_anchor?.external_writer!==true||row.task_anchor?.authored_by_candidate!==false)
    throw new Error('rsi_postexp_case_binding_invalid');
  const clone=structuredClone(row),claimed=exact(clone.admission_digest,D,'admission');delete clone.admission_digest;
  if(digest(clone)!==claimed)throw new Error('rsi_postexp_admission_digest_mismatch');
  return row;
}

export function applyRsiPostAdoptionExperienceAdmission({previous_snapshot=null,admission}={}){
  const a=verifyRsiPostAdoptionExperienceAdmission(admission);
  if(previous_snapshot==null)return createRsiExperienceGraphSnapshot({
    graph_id:a.graph_id,epoch:1,task_anchors:[a.task_anchor],cases:[a.experience_case]});
  const prev=verifyRsiExperienceGraphSnapshot(previous_snapshot);
  if(prev.graph_id!==a.graph_id)throw new Error('rsi_postexp_graph_source_mismatch');
  return extendRsiExperienceGraphSnapshot({previous_snapshot:prev,task_anchors:[a.task_anchor],cases:[a.experience_case]});
}

export function rsiPostAdoptionExperienceAdmissionTrustRootSnapshot(){
  const root={schema:'metaengine.rsi.post-adoption-experience-admission-root.v1',version:1,
    adapter_path:'apps/metaengine-browser/src/rsi-post-adoption-experience-admission.mjs',
    experience_graph_path:'apps/metaengine-browser/src/rsi-experience-graph.mjs',
    existing_experience_graph_only:true,append_only_graph_admission:true,
    exact_candidate_id_from_promotion_review_required:true,only_pareto_or_verified_regression_measurements:true,
    pareto_maps_to_success_case:true,regression_maps_to_failure_case:true,contextual_measurement_not_global_truth:true,
    candidate_can_write_graph:false,candidate_can_edit_case:false,skill_library_write_performed_here:false,
    next_episode_created_here:false,graph_write_authorizes_execution:false,candidate_can_modify_admission_root:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,
    self_update_authority:false,automatic_retry_allowed:false,authority_effect:false};
  return Object.freeze({...root,post_adoption_experience_root_digest:digest(root)});
}
