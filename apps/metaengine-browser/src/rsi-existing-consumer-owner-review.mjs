import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  verifyRsiValidatedKnowledgeConsumerHandoff,
  verifyRsiConsumerLocalRevalidationReceipt,
} from './rsi-validated-knowledge-consumer-handoff.mjs';
import {
  createRsiSkillEvidence,
  verifyRsiSkillCapsule,
  verifyRsiSkillEvidence,
  verifyRsiVerifiedSkillLibrary,
} from './rsi-verified-skill-library.mjs';

export const RSI_EXISTING_CONSUMER_OWNER_REVIEW_BUNDLE_SCHEMA='metaengine.rsi.existing-consumer-owner-review-bundle.v1';
export const RSI_EXISTING_SKILL_OWNER_EVIDENCE_REVIEW_SCHEMA='metaengine.rsi.existing-skill-owner-evidence-review.v1';
export const RSI_EXISTING_CONSUMER_OWNER_REVIEW_ARCHIVE_SCHEMA='metaengine.rsi.existing-consumer-owner-review-archive.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const MAX_ROWS=2048;

function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]));}
function digest(v){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`;}
function exactSha(v,l){const x=String(v||'').trim().toLowerCase();if(!SHA40_RE.test(x))throw new Error(`rsi_owner_review_${l}_sha_invalid`);return x;}
function exactDigest(v,l){const x=String(v||'').trim().toLowerCase();if(!SHA256_RE.test(x))throw new Error(`rsi_owner_review_${l}_digest_invalid`);return x;}
function id(v,l){const x=String(v||'').trim();if(!SAFE_ID_RE.test(x))throw new Error(`rsi_owner_review_${l}_invalid`);return x;}
function plain(v){return !!v&&typeof v==='object'&&!Array.isArray(v);}
function zero(extra={}){return Object.freeze({...extra,execution_authority:false,browser_authority:false,task_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false});}
function assertZero(v,l){for(const f of ['execution_authority','browser_authority','task_authority','production_mutation_authority','promotion_authority','self_update_authority','scheduler_authority','authority_effect'])if(v?.[f]!==false)throw new Error(`rsi_owner_review_${l}_${f}_invalid`);if(v?.automatic_retry_allowed!==false)throw new Error(`rsi_owner_review_${l}_retry_invalid`);}

function verifyPhase32({handoff,receipt,proposal,validations,admission,source_rows}={}){
  const h=verifyRsiValidatedKnowledgeConsumerHandoff(handoff,{proposal,validations,admission,source_rows});
  const r=verifyRsiConsumerLocalRevalidationReceipt(receipt,{handoff:h});
  if(r.handoff_digest!==h.handoff_digest)throw new Error('rsi_owner_review_phase32_binding_mismatch');
  return Object.freeze({handoff:h,receipt:r});
}

function reviewRoute(receipt){
  if(receipt.state==='CONSUMER_REVALIDATED_RECIPE'&&receipt.eligible_existing_consumer_review==='EXISTING_VERIFIED_SKILL_EVIDENCE_REVIEW'){
    return 'EXISTING_VERIFIED_SKILL_OWNER_REVIEW';
  }
  if(receipt.state==='CONSUMER_REVALIDATED_COUNTEREVIDENCE'&&receipt.eligible_existing_consumer_review==='EXISTING_EXPERIENCE_COUNTEREVIDENCE_REVIEW'){
    return 'EXISTING_EXPERIENCE_COUNTEREVIDENCE_OWNER_REVIEW';
  }
  if(receipt.state==='CONSUMER_REVALIDATED_DIAGNOSTIC'&&receipt.eligible_existing_consumer_review==='EXISTING_ADAPTIVE_RETRIEVAL_DIAGNOSTIC_REVIEW'){
    return 'EXISTING_ADAPTIVE_RETRIEVAL_OWNER_REVIEW';
  }
  if(receipt.state==='CONSUMER_NEGATIVE_TRANSFER')return 'NEGATIVE_TRANSFER_COUNTEREVIDENCE_ONLY';
  if(receipt.state==='CONSUMER_NO_CLEAR_BENEFIT')return 'NO_CLEAR_BENEFIT_EVIDENCE_ONLY';
  if(receipt.state==='CONSUMER_COUNTEREVIDENCE_NOT_CONFIRMED'||receipt.state==='CONSUMER_DIAGNOSTIC_NOT_CONFIRMED')return 'UNCONFIRMED_EVIDENCE_ONLY';
  if(receipt.state==='CONSUMER_REVALIDATION_INVALID')return 'INVALID_EVIDENCE_ONLY';
  throw new Error('rsi_owner_review_phase32_state_unsupported');
}

export function createRsiExistingConsumerOwnerReviewBundle({
  bundle_id,handoff,receipt,proposal,validations,admission,source_rows,
  current_consumer_snapshot_digest,consumer_owner_policy_digest,consumer_owner_identity_digest,
  external_consumer_owner=false,authored_by_candidate=true,
}={}){
  if(external_consumer_owner!==true||authored_by_candidate!==false)throw new Error('rsi_owner_review_external_owner_required');
  const p32=verifyPhase32({handoff,receipt,proposal,validations,admission,source_rows});
  const route=reviewRoute(p32.receipt);
  const roots=[
    exactDigest(current_consumer_snapshot_digest,'consumer_snapshot'),
    exactDigest(consumer_owner_policy_digest,'consumer_owner_policy'),
    exactDigest(consumer_owner_identity_digest,'consumer_owner_identity'),
    p32.handoff.handoff_digest,p32.receipt.receipt_digest,
  ];
  if(new Set(roots).size!==roots.length)throw new Error('rsi_owner_review_independent_roots_required');
  const eligible=route==='EXISTING_VERIFIED_SKILL_OWNER_REVIEW'
    ||route==='EXISTING_EXPERIENCE_COUNTEREVIDENCE_OWNER_REVIEW'
    ||route==='EXISTING_ADAPTIVE_RETRIEVAL_OWNER_REVIEW';
  const core=zero({
    schema:RSI_EXISTING_CONSUMER_OWNER_REVIEW_BUNDLE_SCHEMA,version:1,
    bundle_id:id(bundle_id,'bundle_id'),source_sha:exactSha(p32.handoff.source_sha,'source'),
    phase32_handoff_digest:p32.handoff.handoff_digest,phase32_receipt_digest:p32.receipt.receipt_digest,
    phase31_admission_digest:p32.handoff.phase31_admission_digest,knowledge_class:p32.handoff.knowledge_class,
    consumer_route:p32.handoff.consumer_route,consumer_model_family:p32.handoff.consumer_model_family,
    consumer_environment_family:p32.handoff.consumer_environment_family,
    consumer_context_digest:p32.handoff.consumer_context_digest,consumer_harness_digest:p32.handoff.consumer_harness_digest,
    consumer_evaluator_root_digest:p32.handoff.consumer_evaluator_root_digest,
    consumer_evaluator_generation_digest:p32.handoff.consumer_evaluator_generation_digest,
    consumer_holdout_digest:p32.handoff.consumer_holdout_digest,
    current_consumer_snapshot_digest:roots[0],consumer_owner_policy_digest:roots[1],consumer_owner_identity_digest:roots[2],
    review_route:route,state:eligible?'ELIGIBLE_FOR_EXISTING_CONSUMER_OWNER_REVIEW':'PRESERVED_NON_ADMISSIBLE_EVIDENCE',
    eligible_for_existing_consumer_owner_review:eligible,
    negative_transfer_veto:p32.receipt.state==='CONSUMER_NEGATIVE_TRANSFER',
    suppress_repeat_same_consumer_context:p32.receipt.suppress_repeat_same_consumer_context===true,
    external_consumer_owner:true,authored_by_candidate:false,
    current_consumer_exact_binding_required:true,consumer_owner_must_revalidate_snapshot_on_effect:true,
    source_evaluator_generation_verdict_not_inherited:true,
    active_skill_library_write_performed:false,experience_graph_write_performed:false,
    adaptive_retrieval_state_write_performed:false,meta_skill_profile_write_performed:false,
    owner_review_token:null,direct_activation_allowed:false,bundle_can_schedule_work:false,
  });
  return Object.freeze({...core,bundle_digest:digest(core)});
}

export function verifyRsiExistingConsumerOwnerReviewBundle(row,evidence={}){
  if(!plain(row)||row.schema!==RSI_EXISTING_CONSUMER_OWNER_REVIEW_BUNDLE_SCHEMA||row.version!==1)throw new Error('rsi_owner_review_bundle_invalid');
  assertZero(row,'bundle');
  if(row.external_consumer_owner!==true||row.authored_by_candidate!==false||row.current_consumer_exact_binding_required!==true
    ||row.consumer_owner_must_revalidate_snapshot_on_effect!==true||row.source_evaluator_generation_verdict_not_inherited!==true
    ||row.active_skill_library_write_performed!==false||row.experience_graph_write_performed!==false
    ||row.adaptive_retrieval_state_write_performed!==false||row.meta_skill_profile_write_performed!==false
    ||row.owner_review_token!==null||row.direct_activation_allowed!==false||row.bundle_can_schedule_work!==false){
    throw new Error('rsi_owner_review_bundle_policy_invalid');
  }
  const canonical=createRsiExistingConsumerOwnerReviewBundle({
    bundle_id:row.bundle_id,...evidence,current_consumer_snapshot_digest:row.current_consumer_snapshot_digest,
    consumer_owner_policy_digest:row.consumer_owner_policy_digest,consumer_owner_identity_digest:row.consumer_owner_identity_digest,
    external_consumer_owner:true,authored_by_candidate:false,
  });
  if(canonical.bundle_digest!==exactDigest(row.bundle_digest,'bundle'))throw new Error('rsi_owner_review_bundle_digest_mismatch');
  return canonical;
}

function findSkillParent(library,skill){
  if(skill.parent_skill_digest==null){
    if(skill.skill_version!==1)throw new Error('rsi_owner_review_new_skill_must_start_at_version_one');
    if(library.entries.some(e=>e.skill_id===skill.skill_id))throw new Error('rsi_owner_review_new_skill_id_conflict');
    return null;
  }
  const parent=library.entries.find(e=>e.skill_digest===skill.parent_skill_digest);
  if(!parent)throw new Error('rsi_owner_review_parent_skill_missing');
  if(parent.skill_id!==skill.skill_id||skill.skill_version!==parent.skill_version+1)throw new Error('rsi_owner_review_skill_lineage_invalid');
  if(parent.role!==skill.role||parent.input_schema_digest!==skill.input_schema_digest||parent.output_schema_digest!==skill.output_schema_digest)throw new Error('rsi_owner_review_skill_interface_drift');
  if(JSON.stringify(parent.capabilities)!==JSON.stringify(skill.capabilities))throw new Error('rsi_owner_review_skill_capability_drift');
  return parent;
}

export function createRsiExistingSkillOwnerEvidenceReview({
  review_id,bundle,handoff,receipt,proposal,validations,admission,source_rows,
  current_library,skill_capsule,knowledge_to_skill_binding_digest,external_materialization_receipt_digest,
  interface_review_digest,capability_review_digest,unit_test_digest,runtime_feedback_digest,
  attempt_count,success_count,hard_invariants_pass=false,matched_reference_pass=false,
  contamination_clear=false,from_scratch_replay_pass=false,negative_transfer_clear=false,
  external_skill_builder=false,external_library_evaluator=false,external_library_owner=false,authored_by_candidate=true,
}={}){
  const b=verifyRsiExistingConsumerOwnerReviewBundle(bundle,{handoff,receipt,proposal,validations,admission,source_rows});
  if(b.review_route!=='EXISTING_VERIFIED_SKILL_OWNER_REVIEW'||b.eligible_for_existing_consumer_owner_review!==true||b.negative_transfer_veto===true){
    throw new Error('rsi_owner_review_recipe_bundle_required');
  }
  if(external_skill_builder!==true||external_library_evaluator!==true||external_library_owner!==true||authored_by_candidate!==false){
    throw new Error('rsi_owner_review_external_skill_owners_required');
  }
  const library=verifyRsiVerifiedSkillLibrary(current_library);
  if(library.library_digest!==b.current_consumer_snapshot_digest)throw new Error('rsi_owner_review_library_snapshot_drift');
  const skill=verifyRsiSkillCapsule(skill_capsule);
  if(skill.source_candidate_sha!==b.source_sha)throw new Error('rsi_owner_review_skill_source_sha_mismatch');
  if(library.entries.some(e=>e.skill_digest===skill.skill_digest||e.skill_id===skill.skill_id&&e.skill_version===skill.skill_version))throw new Error('rsi_owner_review_skill_already_present');
  findSkillParent(library,skill);
  const roots=[
    exactDigest(knowledge_to_skill_binding_digest,'knowledge_binding'),
    exactDigest(external_materialization_receipt_digest,'materialization_receipt'),
    exactDigest(interface_review_digest,'interface_review'),exactDigest(capability_review_digest,'capability_review'),
    exactDigest(unit_test_digest,'unit_test'),exactDigest(runtime_feedback_digest,'runtime_feedback'),
    b.consumer_holdout_digest,b.consumer_evaluator_root_digest,b.phase32_receipt_digest,
  ];
  if(new Set(roots).size!==roots.length)throw new Error('rsi_owner_review_skill_evidence_roots_not_independent');
  if(hard_invariants_pass!==true||matched_reference_pass!==true||contamination_clear!==true||from_scratch_replay_pass!==true||negative_transfer_clear!==true){
    throw new Error('rsi_owner_review_skill_local_validation_failed');
  }
  const evidence=createRsiSkillEvidence({
    capsule:skill,hidden_holdout_digest:b.consumer_holdout_digest,evaluator_root_digest:b.consumer_evaluator_root_digest,
    unit_test_digest:roots[4],runtime_feedback_digest:roots[5],attempt_count,success_count,
    hard_invariants_pass:true,verified_for_library:true,
    evidence_refs:[`phase32:${b.phase32_receipt_digest}`,`owner-review:${b.bundle_digest}`],
    external_evaluator:true,authored_by_candidate:false,
  });
  const core=zero({
    schema:RSI_EXISTING_SKILL_OWNER_EVIDENCE_REVIEW_SCHEMA,version:1,
    review_id:id(review_id,'review_id'),source_sha:b.source_sha,bundle_digest:b.bundle_digest,
    phase32_receipt_digest:b.phase32_receipt_digest,current_library_id:library.library_id,
    current_library_digest:library.library_digest,proposed_skill_digest:skill.skill_digest,
    proposed_skill_id:skill.skill_id,proposed_skill_version:skill.skill_version,
    skill_evidence_digest:evidence.evidence_digest,knowledge_to_skill_binding_digest:roots[0],
    external_materialization_receipt_digest:roots[1],interface_review_digest:roots[2],capability_review_digest:roots[3],
    local_hidden_holdout_digest:b.consumer_holdout_digest,local_evaluator_root_digest:b.consumer_evaluator_root_digest,
    local_evaluator_generation_digest:b.consumer_evaluator_generation_digest,
    matched_reference_pass:true,hard_invariants_pass:true,contamination_clear:true,from_scratch_replay_pass:true,
    negative_transfer_clear:true,external_skill_builder:true,external_library_evaluator:true,external_library_owner:true,
    authored_by_candidate:false,state:'ELIGIBLE_FOR_EXISTING_VERIFIED_SKILL_LIBRARY_OWNER_REVIEW',
    library_append_performed:false,skill_activation_performed:false,skill_lifecycle_mutated:false,
    library_admission_token:null,review_can_schedule_work:false,
  });
  return Object.freeze({...core,skill_evidence:evidence,review_digest:digest({...core,skill_evidence_digest:evidence.evidence_digest})});
}

export function verifyRsiExistingSkillOwnerEvidenceReview(row,args={}){
  if(!plain(row)||row.schema!==RSI_EXISTING_SKILL_OWNER_EVIDENCE_REVIEW_SCHEMA||row.version!==1)throw new Error('rsi_owner_review_skill_review_invalid');
  assertZero(row,'skill_review');
  if(row.external_skill_builder!==true||row.external_library_evaluator!==true||row.external_library_owner!==true
    ||row.authored_by_candidate!==false||row.matched_reference_pass!==true||row.hard_invariants_pass!==true
    ||row.contamination_clear!==true||row.from_scratch_replay_pass!==true||row.negative_transfer_clear!==true
    ||row.state!=='ELIGIBLE_FOR_EXISTING_VERIFIED_SKILL_LIBRARY_OWNER_REVIEW'
    ||row.library_append_performed!==false||row.skill_activation_performed!==false||row.skill_lifecycle_mutated!==false
    ||row.library_admission_token!==null||row.review_can_schedule_work!==false)throw new Error('rsi_owner_review_skill_review_policy_invalid');
  const canonical=createRsiExistingSkillOwnerEvidenceReview({
    review_id:row.review_id,...args,knowledge_to_skill_binding_digest:row.knowledge_to_skill_binding_digest,
    external_materialization_receipt_digest:row.external_materialization_receipt_digest,
    interface_review_digest:row.interface_review_digest,capability_review_digest:row.capability_review_digest,
    unit_test_digest:row.skill_evidence.unit_test_digest,runtime_feedback_digest:row.skill_evidence.runtime_feedback_digest,
    attempt_count:row.skill_evidence.attempt_count,success_count:row.skill_evidence.success_count,
    hard_invariants_pass:true,matched_reference_pass:true,contamination_clear:true,from_scratch_replay_pass:true,
    negative_transfer_clear:true,external_skill_builder:true,external_library_evaluator:true,external_library_owner:true,
    authored_by_candidate:false,
  });
  verifyRsiSkillEvidence(row.skill_evidence,args.skill_capsule);
  if(canonical.review_digest!==exactDigest(row.review_digest,'skill_review')||canonical.skill_evidence_digest!==row.skill_evidence_digest){
    throw new Error('rsi_owner_review_skill_review_digest_mismatch');
  }
  return canonical;
}

function archiveState(sourceSha,rows){
  const counts={};for(const r of rows)counts[r.bundle.review_route]=(counts[r.bundle.review_route]||0)+1;
  const core=zero({
    schema:RSI_EXISTING_CONSUMER_OWNER_REVIEW_ARCHIVE_SCHEMA,version:1,source_sha:sourceSha,rows,row_count:rows.length,
    route_counts:Object.freeze(counts),append_only:true,durable_before_visible:true,external_phase32_evidence_resolver_required:true,
    phase32_evidence_bodies_not_duplicated:true,negative_transfer_vetoes_preserved:true,
    archive_can_write_skill_library:false,archive_can_write_experience_graph:false,archive_can_write_retrieval_state:false,
    archive_can_modify_meta_skill_profile:false,archive_can_activate_skill:false,archive_can_schedule_work:false,
  });return {...core,state_digest:digest(core)};
}

export class RsiExistingConsumerOwnerReviewArchive{
  #path;#sourceSha;#resolver;#rows=[];#initialized=false;
  constructor({statePath,source_sha,evidenceResolver}={}){
    if(!statePath)throw new Error('rsi_owner_review_archive_path_required');
    if(typeof evidenceResolver!=='function')throw new Error('rsi_owner_review_evidence_resolver_required');
    this.#path=path.resolve(statePath);this.#sourceSha=exactSha(source_sha,'archive_source');this.#resolver=evidenceResolver;
  }
  async init(){
    if(this.#initialized)return this.snapshot();
    await fs.mkdir(path.dirname(this.#path),{recursive:true});
    try{
      const p=JSON.parse(await fs.readFile(this.#path,'utf8'));assertZero(p,'archive');
      if(p.schema!==RSI_EXISTING_CONSUMER_OWNER_REVIEW_ARCHIVE_SCHEMA||p.version!==1||p.source_sha!==this.#sourceSha
        ||p.append_only!==true||p.durable_before_visible!==true||p.external_phase32_evidence_resolver_required!==true
        ||p.phase32_evidence_bodies_not_duplicated!==true||p.negative_transfer_vetoes_preserved!==true
        ||p.archive_can_write_skill_library!==false||p.archive_can_write_experience_graph!==false
        ||p.archive_can_write_retrieval_state!==false||p.archive_can_modify_meta_skill_profile!==false
        ||p.archive_can_activate_skill!==false||p.archive_can_schedule_work!==false)throw new Error('rsi_owner_review_archive_policy_invalid');
      const clone=structuredClone(p);delete clone.state_digest;if(digest(clone)!==exactDigest(p.state_digest,'archive'))throw new Error('rsi_owner_review_archive_digest_mismatch');
      if(!Array.isArray(p.rows)||p.rows.length>MAX_ROWS)throw new Error('rsi_owner_review_archive_rows_invalid');
      const checked=[];const ids=new Set();
      for(const stored of p.rows){
        const evidence=await this.#resolver({phase32_receipt_digest:stored.bundle.phase32_receipt_digest});
        const bundle=verifyRsiExistingConsumerOwnerReviewBundle(stored.bundle,evidence||{});
        if(ids.has(bundle.bundle_id))throw new Error('rsi_owner_review_archive_duplicate');ids.add(bundle.bundle_id);
        checked.push(Object.freeze({bundle}));
      }
      const canonical=archiveState(this.#sourceSha,checked);
      if(canonical.row_count!==p.row_count||JSON.stringify(canonical.route_counts)!==JSON.stringify(p.route_counts))throw new Error('rsi_owner_review_archive_summary_mismatch');
      this.#rows=checked;
    }catch(e){if(e?.code!=='ENOENT')throw e;}
    this.#initialized=true;return this.snapshot();
  }
  async #persist(rows){
    const state=archiveState(this.#sourceSha,rows),tmp=`${this.#path}.tmp`,h=await fs.open(tmp,'w',0o600);
    try{await h.writeFile(`${JSON.stringify(state)}\n`,'utf8');await h.sync();}finally{await h.close();}await fs.rename(tmp,this.#path);
  }
  async add({bundle,phase32_evidence}={}){
    if(!this.#initialized)throw new Error('rsi_owner_review_archive_not_initialized');
    const b=verifyRsiExistingConsumerOwnerReviewBundle(bundle,phase32_evidence||{});
    if(b.source_sha!==this.#sourceSha)throw new Error('rsi_owner_review_archive_source_mismatch');
    const existing=this.#rows.find(r=>r.bundle.bundle_id===b.bundle_id||r.bundle.bundle_digest===b.bundle_digest);
    if(existing){if(existing.bundle.bundle_digest!==b.bundle_digest)throw new Error('rsi_owner_review_archive_identity_conflict');return zero({state:'IDEMPOTENT',bundle_digest:b.bundle_digest});}
    if(this.#rows.length>=MAX_ROWS)throw new Error('rsi_owner_review_archive_capacity_exceeded');
    const next=[...this.#rows,Object.freeze({bundle:b})];await this.#persist(next);this.#rows=next;
    return zero({state:b.state,bundle_digest:b.bundle_digest});
  }
  snapshot(){const s=archiveState(this.#sourceSha,this.#rows);return Object.freeze({schema:s.schema,version:s.version,source_sha:s.source_sha,initialized:this.#initialized,row_count:s.row_count,route_counts:s.route_counts,append_only:true,durable_before_visible:true,external_phase32_evidence_resolver_required:true,phase32_evidence_bodies_not_duplicated:true,negative_transfer_vetoes_preserved:true,archive_can_write_skill_library:false,archive_can_write_experience_graph:false,archive_can_write_retrieval_state:false,archive_can_modify_meta_skill_profile:false,archive_can_activate_skill:false,archive_can_schedule_work:false,authority_effect:false});}
}

export function rsiExistingConsumerOwnerReviewTrustRootSnapshot(){
  const root={
    schema:'metaengine.rsi.existing-consumer-owner-review-root.v1',version:1,
    phase32_consumer_local_revalidation_required:true,phase32_negative_transfer_is_veto:true,
    existing_verified_skill_library_schema_reused:true,second_skill_representation_forbidden:true,
    counterevidence_remains_counterevidence:true,diagnostics_remain_diagnostic_only:true,
    current_consumer_snapshot_exact_binding_required:true,consumer_owner_external_effect_required:true,
    skill_holdout_must_equal_phase32_consumer_holdout:true,skill_evaluator_root_must_equal_phase32_consumer_evaluator_root:true,
    source_evaluator_generation_verdict_not_inherited:true,active_skill_library_write_performed_here:false,
    experience_graph_write_performed_here:false,adaptive_retrieval_write_performed_here:false,meta_skill_profile_write_performed_here:false,
    direct_activation_performed_here:false,second_scheduler_created:false,no_blind_retry:true,
    execution_authority:false,browser_authority:false,task_authority:false,production_mutation_authority:false,
    promotion_authority:false,self_update_authority:false,scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };return Object.freeze({...root,existing_consumer_owner_review_root_digest:digest(root)});
}
