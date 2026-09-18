import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  verifyRsiValidatedKnowledgeConsumerHandoff,
  verifyRsiConsumerLocalRevalidationReceipt,
} from './rsi-validated-knowledge-consumer-handoff.mjs';
import {
  verifyRsiConsolidatedKnowledgeSkillEvidenceReview,
} from './rsi-consolidated-knowledge-skill-review.mjs';

export const RSI_EXACT_CONSUMER_OWNER_REVIEW_BUNDLE_SCHEMA='metaengine.rsi.exact-consumer-owner-review-bundle.v1';
export const RSI_EXACT_SKILL_PRECOMMIT_CERTIFICATE_SCHEMA='metaengine.rsi.exact-skill-precommit-certificate.v1';
export const RSI_EXACT_OWNER_REVIEW_ARCHIVE_SCHEMA='metaengine.rsi.exact-owner-review-archive.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const MAX_ROWS=2048;

function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]));}
function digest(v){return 'sha256:'+crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex');}
function exactDigest(v,l){const x=String(v||'').trim().toLowerCase();if(!SHA256_RE.test(x))throw new Error('rsi_phase33_'+l+'_digest_invalid');return x;}
function exactSha(v,l){const x=String(v||'').trim().toLowerCase();if(!SHA40_RE.test(x))throw new Error('rsi_phase33_'+l+'_sha_invalid');return x;}
function id(v,l){const x=String(v||'').trim();if(!SAFE_ID_RE.test(x))throw new Error('rsi_phase33_'+l+'_invalid');return x;}
function nonNegativeInt(v,l){if(!Number.isInteger(v)||v<0)throw new Error('rsi_phase33_'+l+'_invalid');return v;}
function positiveInt(v,l){if(!Number.isInteger(v)||v<1)throw new Error('rsi_phase33_'+l+'_invalid');return v;}
function zero(extra={}){return Object.freeze({...extra,execution_authority:false,browser_authority:false,task_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false});}
function assertZero(v,l){for(const f of ['execution_authority','browser_authority','task_authority','production_mutation_authority','promotion_authority','self_update_authority','scheduler_authority','authority_effect'])if(v?.[f]!==false)throw new Error('rsi_phase33_'+l+'_'+f+'_invalid');if(v?.automatic_retry_allowed!==false)throw new Error('rsi_phase33_'+l+'_retry_invalid');}

function verifyPhase32({handoff,receipt,proposal,validations,admission,source_rows}={}){
  const h=verifyRsiValidatedKnowledgeConsumerHandoff(handoff,{proposal,validations,admission,source_rows});
  const r=verifyRsiConsumerLocalRevalidationReceipt(receipt,{handoff:h});
  if(r.handoff_digest!==h.handoff_digest)throw new Error('rsi_phase33_phase32_binding_mismatch');
  return Object.freeze({handoff:h,receipt:r});
}

function routeFor(receipt){
  if(receipt.state==='CONSUMER_REVALIDATED_RECIPE'&&receipt.eligible_existing_consumer_review==='EXISTING_VERIFIED_SKILL_EVIDENCE_REVIEW')return 'EXISTING_VERIFIED_SKILL_OWNER_PRECOMMIT';
  if(receipt.state==='CONSUMER_REVALIDATED_COUNTEREVIDENCE'&&receipt.eligible_existing_consumer_review==='EXISTING_EXPERIENCE_COUNTEREVIDENCE_REVIEW')return 'EXISTING_EXPERIENCE_COUNTEREVIDENCE_OWNER_REVIEW';
  if(receipt.state==='CONSUMER_REVALIDATED_DIAGNOSTIC'&&receipt.eligible_existing_consumer_review==='EXISTING_ADAPTIVE_RETRIEVAL_DIAGNOSTIC_REVIEW')return 'EXISTING_ADAPTIVE_RETRIEVAL_OWNER_REVIEW';
  if(receipt.state==='CONSUMER_NEGATIVE_TRANSFER')return 'NEGATIVE_TRANSFER_VETO_EVIDENCE_ONLY';
  if(receipt.state==='CONSUMER_NO_CLEAR_BENEFIT')return 'NO_CLEAR_BENEFIT_EVIDENCE_ONLY';
  if(receipt.state==='CONSUMER_REVALIDATION_INVALID')return 'INVALID_EVIDENCE_ONLY';
  return 'UNCONFIRMED_EVIDENCE_ONLY';
}

export function createRsiExactConsumerOwnerReviewBundle({
  bundle_id,handoff,receipt,proposal,validations,admission,source_rows,
  current_consumer_snapshot_digest,consumer_owner_policy_digest,consumer_owner_identity_digest,
  external_consumer_owner=false,authored_by_candidate=true,
}={}){
  if(external_consumer_owner!==true||authored_by_candidate!==false)throw new Error('rsi_phase33_external_consumer_owner_required');
  const p32=verifyPhase32({handoff,receipt,proposal,validations,admission,source_rows});
  const roots=[exactDigest(current_consumer_snapshot_digest,'consumer_snapshot'),exactDigest(consumer_owner_policy_digest,'owner_policy'),exactDigest(consumer_owner_identity_digest,'owner_identity'),p32.handoff.handoff_digest,p32.receipt.receipt_digest,p32.handoff.consumer_evaluation_contract_digest];
  if(new Set(roots).size!==roots.length)throw new Error('rsi_phase33_bundle_independent_roots_required');
  const route=routeFor(p32.receipt);
  const eligible=!route.endsWith('EVIDENCE_ONLY');
  const core=zero({
    schema:RSI_EXACT_CONSUMER_OWNER_REVIEW_BUNDLE_SCHEMA,version:1,bundle_id:id(bundle_id,'bundle_id'),
    source_sha:exactSha(p32.handoff.source_sha,'source'),phase31_admission_digest:p32.handoff.phase31_admission_digest,
    phase32_handoff_digest:p32.handoff.handoff_digest,phase32_receipt_digest:p32.receipt.receipt_digest,
    knowledge_class:p32.handoff.knowledge_class,consumer_route:p32.handoff.consumer_route,review_route:route,
    consumer_model_family:p32.handoff.consumer_model_family,consumer_environment_family:p32.handoff.consumer_environment_family,
    consumer_context_digest:p32.handoff.consumer_context_digest,consumer_harness_digest:p32.handoff.consumer_harness_digest,
    consumer_evaluator_root_digest:p32.handoff.consumer_evaluator_root_digest,
    consumer_evaluator_generation_digest:p32.handoff.consumer_evaluator_generation_digest,
    consumer_evaluator_generation_seq:p32.handoff.consumer_evaluator_generation_seq,
    consumer_evaluator_generation_history_anchor_digest:p32.handoff.consumer_evaluator_generation_history_anchor_digest,
    consumer_evaluation_epoch_seq:p32.handoff.consumer_evaluation_epoch_seq,consumer_evaluation_epoch_digest:p32.handoff.consumer_evaluation_epoch_digest,
    consumer_evaluation_contract_digest:p32.handoff.consumer_evaluation_contract_digest,
    consumer_holdout_digest:p32.handoff.consumer_holdout_digest,matched_reference_plan_digest:p32.handoff.matched_reference_plan_digest,
    local_revalidation_protocol_digest:p32.handoff.local_revalidation_protocol_digest,current_consumer_snapshot_digest:roots[0],
    consumer_owner_policy_digest:roots[1],consumer_owner_identity_digest:roots[2],
    state:eligible?'ELIGIBLE_FOR_EXISTING_CONSUMER_OWNER_PRECOMMIT_REVIEW':'PRESERVED_NON_ADMISSIBLE_EVIDENCE',
    eligible_for_existing_consumer_owner_review:eligible,negative_transfer_veto:p32.receipt.state==='CONSUMER_NEGATIVE_TRANSFER',
    suppress_repeat_same_consumer_context:p32.receipt.suppress_repeat_same_consumer_context===true,
    exact_phase32_consumer_identity_required:true,current_consumer_snapshot_exact_binding_required:true,
    source_generation_verdict_inherited:false,library_append_performed:false,retrieval_exposure_changed:false,
    skill_activation_performed:false,experience_graph_write_performed:false,meta_skill_profile_mutated:false,
    owner_review_token:null,bundle_can_schedule_work:false,direct_activation_allowed:false,
  });
  return Object.freeze({...core,bundle_digest:digest(core)});
}

export function verifyRsiExactConsumerOwnerReviewBundle(bundle,evidence={}){
  if(!bundle||bundle.schema!==RSI_EXACT_CONSUMER_OWNER_REVIEW_BUNDLE_SCHEMA||bundle.version!==1)throw new Error('rsi_phase33_bundle_invalid');
  assertZero(bundle,'bundle');
  if(bundle.exact_phase32_consumer_identity_required!==true||bundle.current_consumer_snapshot_exact_binding_required!==true||bundle.source_generation_verdict_inherited!==false||bundle.library_append_performed!==false||bundle.retrieval_exposure_changed!==false||bundle.skill_activation_performed!==false||bundle.experience_graph_write_performed!==false||bundle.meta_skill_profile_mutated!==false||bundle.owner_review_token!==null||bundle.bundle_can_schedule_work!==false||bundle.direct_activation_allowed!==false)throw new Error('rsi_phase33_bundle_policy_invalid');
  const canonical=createRsiExactConsumerOwnerReviewBundle({bundle_id:bundle.bundle_id,...evidence,current_consumer_snapshot_digest:bundle.current_consumer_snapshot_digest,consumer_owner_policy_digest:bundle.consumer_owner_policy_digest,consumer_owner_identity_digest:bundle.consumer_owner_identity_digest,external_consumer_owner:true,authored_by_candidate:false});
  if(canonical.bundle_digest!==exactDigest(bundle.bundle_digest,'bundle'))throw new Error('rsi_phase33_bundle_digest_mismatch');
  return canonical;
}

export function createRsiExactSkillPrecommitCertificate({
  certificate_id,bundle,phase32_evidence,skill_evidence_review,skill_evidence_review_args,current_library_snapshot_digest,
  structural_critic_identity_digest,structural_critic_receipt_digest,behavioral_critic_identity_digest,behavioral_critic_receipt_digest,
  semantic_critic_identity_digest,semantic_critic_receipt_digest,coalition_ablation_receipt_digest,no_skill_ablation_receipt_digest,
  mechanical_artifact_audit_digest,artifact_noop_ablation_receipt_digest,benchmark_provenance_attestation_digest,evaluator_provenance_attestation_digest,
  contamination_attestation_digest,active_cap_policy_digest,marginal_subset_selection_policy_digest,
  anytime_valid_certificate_digest,false_admission_error_budget_policy_digest,paired_instance_manifest_digest,stopping_policy_digest,
  active_retrieval_cap,current_active_retrieval_count,projected_active_retrieval_count,
  structural_validity_pass=false,behavioral_harmlessness_pass=false,semantic_consistency_pass=false,coalition_ablation_pass=false,
  no_skill_ablation_pass=false,mechanical_artifact_audit_pass=false,artifact_noop_ablation_pass=false,benchmark_provenance_pass=false,
  evaluator_provenance_pass=false,contamination_clear=false,marginal_gain_subset_pass=false,anytime_valid_acceptance_pass=false,
  active_cap_pass=false,external_owner_reviewer=false,external_critics=false,external_artifact_auditor=false,
  external_provenance_attestor=false,external_statistical_acceptor=false,authored_by_candidate=true,
}={}){
  const b=verifyRsiExactConsumerOwnerReviewBundle(bundle,phase32_evidence||{});
  if(b.review_route!=='EXISTING_VERIFIED_SKILL_OWNER_PRECOMMIT'||b.eligible_for_existing_consumer_owner_review!==true||b.negative_transfer_veto===true)throw new Error('rsi_phase33_recipe_bundle_required');
  if(external_owner_reviewer!==true||external_critics!==true||external_artifact_auditor!==true||external_provenance_attestor!==true||external_statistical_acceptor!==true||authored_by_candidate!==false)throw new Error('rsi_phase33_external_review_owners_required');
  const skillReview=verifyRsiConsolidatedKnowledgeSkillEvidenceReview(skill_evidence_review,skill_evidence_review_args||{});
  if(skillReview.state!=='READY_FOR_EXTERNAL_EXISTING_LIBRARY_APPEND_REVIEW'||skillReview.standard_skill_evidence_verified_for_library!==true)throw new Error('rsi_phase33_phase32_skill_review_not_ready');
  const libraryDigest=exactDigest(current_library_snapshot_digest,'library_snapshot');
  if(skillReview.current_library_digest!==libraryDigest||b.current_consumer_snapshot_digest!==libraryDigest)throw new Error('rsi_phase33_library_snapshot_drift');
  if(skillReview.source_sha!==b.source_sha)throw new Error('rsi_phase33_skill_source_mismatch');
  if(skillReview.local_hidden_holdout_digest!==b.consumer_holdout_digest||skillReview.local_evaluator_root_digest!==b.consumer_evaluator_root_digest)throw new Error('rsi_phase33_consumer_skill_evidence_binding_mismatch');

  const criticIds=[exactDigest(structural_critic_identity_digest,'structural_critic_identity'),exactDigest(behavioral_critic_identity_digest,'behavioral_critic_identity'),exactDigest(semantic_critic_identity_digest,'semantic_critic_identity')];
  if(new Set(criticIds).size!==3)throw new Error('rsi_phase33_three_independent_critics_required');
  const criticReceipts=[exactDigest(structural_critic_receipt_digest,'structural_critic_receipt'),exactDigest(behavioral_critic_receipt_digest,'behavioral_critic_receipt'),exactDigest(semantic_critic_receipt_digest,'semantic_critic_receipt')];
  if(new Set(criticReceipts).size!==3)throw new Error('rsi_phase33_three_independent_critic_receipts_required');
  const evidenceRoots=[...criticIds,...criticReceipts,exactDigest(coalition_ablation_receipt_digest,'coalition_ablation'),exactDigest(no_skill_ablation_receipt_digest,'no_skill_ablation'),exactDigest(mechanical_artifact_audit_digest,'mechanical_artifact_audit'),exactDigest(artifact_noop_ablation_receipt_digest,'artifact_noop_ablation'),exactDigest(benchmark_provenance_attestation_digest,'benchmark_provenance'),exactDigest(evaluator_provenance_attestation_digest,'evaluator_provenance'),exactDigest(contamination_attestation_digest,'contamination_attestation'),exactDigest(active_cap_policy_digest,'active_cap_policy'),exactDigest(marginal_subset_selection_policy_digest,'marginal_subset_selection'),exactDigest(anytime_valid_certificate_digest,'anytime_valid_certificate'),exactDigest(false_admission_error_budget_policy_digest,'false_admission_error_budget'),exactDigest(paired_instance_manifest_digest,'paired_instance_manifest'),exactDigest(stopping_policy_digest,'stopping_policy')];
  const forbidden=new Set([b.phase32_handoff_digest,b.phase32_receipt_digest,b.consumer_holdout_digest,b.consumer_evaluator_root_digest,b.consumer_evaluation_contract_digest,skillReview.evidence_review_digest,skillReview.standard_skill_evidence_digest,libraryDigest]);
  if(new Set(evidenceRoots).size!==evidenceRoots.length||evidenceRoots.some(x=>forbidden.has(x)))throw new Error('rsi_phase33_independent_precommit_evidence_required');

  const cap=positiveInt(active_retrieval_cap,'active_retrieval_cap'),current=nonNegativeInt(current_active_retrieval_count,'current_active_retrieval_count'),projected=nonNegativeInt(projected_active_retrieval_count,'projected_active_retrieval_count');
  const blockers=[];
  if(structural_validity_pass!==true)blockers.push('STRUCTURAL_VALIDITY_FAILED');
  if(behavioral_harmlessness_pass!==true)blockers.push('BEHAVIORAL_HARMLESSNESS_FAILED');
  if(semantic_consistency_pass!==true)blockers.push('SEMANTIC_CONSISTENCY_FAILED');
  if(coalition_ablation_pass!==true)blockers.push('COALITION_ABLATION_FAILED');
  if(no_skill_ablation_pass!==true)blockers.push('NO_SKILL_ABLATION_FAILED');
  if(mechanical_artifact_audit_pass!==true)blockers.push('MECHANICAL_ARTIFACT_AUDIT_FAILED');
  if(artifact_noop_ablation_pass!==true)blockers.push('ARTIFACT_NOOP_ABLATION_FAILED');
  if(benchmark_provenance_pass!==true)blockers.push('BENCHMARK_PROVENANCE_FAILED');
  if(evaluator_provenance_pass!==true)blockers.push('EVALUATOR_PROVENANCE_FAILED');
  if(contamination_clear!==true)blockers.push('CONTAMINATION_DETECTED');
  if(marginal_gain_subset_pass!==true)blockers.push('MARGINAL_SUBSET_SELECTION_FAILED');
  if(anytime_valid_acceptance_pass!==true)blockers.push('ANYTIME_VALID_ACCEPTANCE_FAILED');
  if(active_cap_pass!==true||projected>cap||current>cap)blockers.push('ACTIVE_CAP_POLICY_FAILED');
  const passed=blockers.length===0;
  const core=zero({
    schema:RSI_EXACT_SKILL_PRECOMMIT_CERTIFICATE_SCHEMA,version:1,certificate_id:id(certificate_id,'certificate_id'),source_sha:b.source_sha,
    bundle_digest:b.bundle_digest,phase32_handoff_digest:b.phase32_handoff_digest,phase32_receipt_digest:b.phase32_receipt_digest,
    consumer_evaluation_contract_digest:b.consumer_evaluation_contract_digest,consumer_evaluator_generation_digest:b.consumer_evaluator_generation_digest,
    consumer_evaluator_generation_seq:b.consumer_evaluator_generation_seq,consumer_evaluator_generation_history_anchor_digest:b.consumer_evaluator_generation_history_anchor_digest,
    consumer_evaluation_epoch_seq:b.consumer_evaluation_epoch_seq,consumer_evaluation_epoch_digest:b.consumer_evaluation_epoch_digest,
    current_library_digest:libraryDigest,phase32_skill_evidence_review_digest:skillReview.evidence_review_digest,
    proposed_skill_digest:skillReview.proposed_skill_digest,standard_skill_evidence_digest:skillReview.standard_skill_evidence_digest,
    structural_critic_identity_digest:criticIds[0],behavioral_critic_identity_digest:criticIds[1],semantic_critic_identity_digest:criticIds[2],
    structural_critic_receipt_digest:criticReceipts[0],behavioral_critic_receipt_digest:criticReceipts[1],semantic_critic_receipt_digest:criticReceipts[2],
    coalition_ablation_receipt_digest:evidenceRoots[6],no_skill_ablation_receipt_digest:evidenceRoots[7],mechanical_artifact_audit_digest:evidenceRoots[8],
    artifact_noop_ablation_receipt_digest:evidenceRoots[9],benchmark_provenance_attestation_digest:evidenceRoots[10],evaluator_provenance_attestation_digest:evidenceRoots[11],
    contamination_attestation_digest:evidenceRoots[12],active_cap_policy_digest:evidenceRoots[13],marginal_subset_selection_policy_digest:evidenceRoots[14],
    anytime_valid_certificate_digest:evidenceRoots[15],false_admission_error_budget_policy_digest:evidenceRoots[16],paired_instance_manifest_digest:evidenceRoots[17],stopping_policy_digest:evidenceRoots[18],
    active_retrieval_cap:cap,current_active_retrieval_count:current,projected_active_retrieval_count:projected,
    structural_validity_pass:structural_validity_pass===true,behavioral_harmlessness_pass:behavioral_harmlessness_pass===true,semantic_consistency_pass:semantic_consistency_pass===true,
    coalition_ablation_pass:coalition_ablation_pass===true,no_skill_ablation_pass:no_skill_ablation_pass===true,mechanical_artifact_audit_pass:mechanical_artifact_audit_pass===true,
    artifact_noop_ablation_pass:artifact_noop_ablation_pass===true,benchmark_provenance_pass:benchmark_provenance_pass===true,evaluator_provenance_pass:evaluator_provenance_pass===true,
    contamination_clear:contamination_clear===true,marginal_gain_subset_pass:marginal_gain_subset_pass===true,anytime_valid_acceptance_pass:anytime_valid_acceptance_pass===true,active_cap_pass:active_cap_pass===true,
    blockers:Object.freeze(blockers.sort()),state:passed?'ELIGIBLE_FOR_EXISTING_LIBRARY_OWNER_ADMISSION_REVIEW':'REJECTED_PRECOMMIT_OWNER_REVIEW',
    three_independent_critics_required:true,coalition_aware_ablation_required:true,mechanical_artifact_audit_required:true,artifact_noop_ablation_required:true,
    contamination_resistant_provenance_required:true,paired_anytime_valid_acceptance_required:true,active_cap_and_marginal_subset_policy_required:true,
    append_does_not_imply_retrieval_exposure:true,library_append_performed:false,retrieval_exposure_changed:false,skill_activation_performed:false,
    skill_lifecycle_mutated:false,meta_skill_profile_mutated:false,certificate_can_schedule_work:false,library_admission_token:null,
  });
  return Object.freeze({...core,certificate_digest:digest(core)});
}

export function verifyRsiExactSkillPrecommitCertificate(row,args={}){
  if(!row||row.schema!==RSI_EXACT_SKILL_PRECOMMIT_CERTIFICATE_SCHEMA||row.version!==1)throw new Error('rsi_phase33_certificate_invalid');
  assertZero(row,'certificate');
  if(row.three_independent_critics_required!==true||row.coalition_aware_ablation_required!==true||row.mechanical_artifact_audit_required!==true||row.artifact_noop_ablation_required!==true||row.contamination_resistant_provenance_required!==true||row.paired_anytime_valid_acceptance_required!==true||row.active_cap_and_marginal_subset_policy_required!==true||row.append_does_not_imply_retrieval_exposure!==true||row.library_append_performed!==false||row.retrieval_exposure_changed!==false||row.skill_activation_performed!==false||row.skill_lifecycle_mutated!==false||row.meta_skill_profile_mutated!==false||row.certificate_can_schedule_work!==false||row.library_admission_token!==null)throw new Error('rsi_phase33_certificate_policy_invalid');
  const canonical=createRsiExactSkillPrecommitCertificate({...args,certificate_id:row.certificate_id,current_library_snapshot_digest:row.current_library_digest,structural_critic_identity_digest:row.structural_critic_identity_digest,structural_critic_receipt_digest:row.structural_critic_receipt_digest,behavioral_critic_identity_digest:row.behavioral_critic_identity_digest,behavioral_critic_receipt_digest:row.behavioral_critic_receipt_digest,semantic_critic_identity_digest:row.semantic_critic_identity_digest,semantic_critic_receipt_digest:row.semantic_critic_receipt_digest,coalition_ablation_receipt_digest:row.coalition_ablation_receipt_digest,no_skill_ablation_receipt_digest:row.no_skill_ablation_receipt_digest,mechanical_artifact_audit_digest:row.mechanical_artifact_audit_digest,artifact_noop_ablation_receipt_digest:row.artifact_noop_ablation_receipt_digest,benchmark_provenance_attestation_digest:row.benchmark_provenance_attestation_digest,evaluator_provenance_attestation_digest:row.evaluator_provenance_attestation_digest,contamination_attestation_digest:row.contamination_attestation_digest,active_cap_policy_digest:row.active_cap_policy_digest,marginal_subset_selection_policy_digest:row.marginal_subset_selection_policy_digest,anytime_valid_certificate_digest:row.anytime_valid_certificate_digest,false_admission_error_budget_policy_digest:row.false_admission_error_budget_policy_digest,paired_instance_manifest_digest:row.paired_instance_manifest_digest,stopping_policy_digest:row.stopping_policy_digest,active_retrieval_cap:row.active_retrieval_cap,current_active_retrieval_count:row.current_active_retrieval_count,projected_active_retrieval_count:row.projected_active_retrieval_count,structural_validity_pass:row.structural_validity_pass,behavioral_harmlessness_pass:row.behavioral_harmlessness_pass,semantic_consistency_pass:row.semantic_consistency_pass,coalition_ablation_pass:row.coalition_ablation_pass,no_skill_ablation_pass:row.no_skill_ablation_pass,mechanical_artifact_audit_pass:row.mechanical_artifact_audit_pass,artifact_noop_ablation_pass:row.artifact_noop_ablation_pass,benchmark_provenance_pass:row.benchmark_provenance_pass,evaluator_provenance_pass:row.evaluator_provenance_pass,contamination_clear:row.contamination_clear,marginal_gain_subset_pass:row.marginal_gain_subset_pass,anytime_valid_acceptance_pass:row.anytime_valid_acceptance_pass,active_cap_pass:row.active_cap_pass,external_owner_reviewer:true,external_critics:true,external_artifact_auditor:true,external_provenance_attestor:true,external_statistical_acceptor:true,authored_by_candidate:false});
  if(canonical.certificate_digest!==exactDigest(row.certificate_digest,'certificate'))throw new Error('rsi_phase33_certificate_digest_mismatch');
  return canonical;
}

function archiveState(sourceSha,rows){
  const counts={};for(const row of rows)counts[row.bundle.review_route]=(counts[row.bundle.review_route]||0)+1;
  const core=zero({schema:RSI_EXACT_OWNER_REVIEW_ARCHIVE_SCHEMA,version:1,source_sha:sourceSha,rows,row_count:rows.length,route_counts:Object.freeze(counts),append_only:true,durable_before_visible:true,rejected_evidence_retained:true,negative_transfer_vetoes_retained:true,archive_can_write_skill_library:false,archive_can_change_retrieval_exposure:false,archive_can_activate_skill:false,archive_can_write_experience_graph:false,archive_can_modify_meta_skill_profile:false,archive_can_schedule_work:false});
  return {...core,state_digest:digest(core)};
}

export class RsiExactOwnerReviewArchive{
  #path;#sourceSha;#resolver;#rows=[];#initialized=false;
  constructor({statePath,source_sha,evidenceResolver}={}){if(!statePath)throw new Error('rsi_phase33_archive_path_required');if(typeof evidenceResolver!=='function')throw new Error('rsi_phase33_archive_resolver_required');this.#path=path.resolve(statePath);this.#sourceSha=exactSha(source_sha,'archive_source');this.#resolver=evidenceResolver;}
  async init(){if(this.#initialized)return this.snapshot();await fs.mkdir(path.dirname(this.#path),{recursive:true});try{const p=JSON.parse(await fs.readFile(this.#path,'utf8'));assertZero(p,'archive');if(p.schema!==RSI_EXACT_OWNER_REVIEW_ARCHIVE_SCHEMA||p.version!==1||p.source_sha!==this.#sourceSha||p.append_only!==true||p.durable_before_visible!==true||p.rejected_evidence_retained!==true||p.negative_transfer_vetoes_retained!==true||p.archive_can_write_skill_library!==false||p.archive_can_change_retrieval_exposure!==false||p.archive_can_activate_skill!==false||p.archive_can_write_experience_graph!==false||p.archive_can_modify_meta_skill_profile!==false||p.archive_can_schedule_work!==false)throw new Error('rsi_phase33_archive_policy_invalid');const clone=structuredClone(p);delete clone.state_digest;if(digest(clone)!==exactDigest(p.state_digest,'archive'))throw new Error('rsi_phase33_archive_digest_mismatch');if(!Array.isArray(p.rows)||p.rows.length>MAX_ROWS)throw new Error('rsi_phase33_archive_rows_invalid');const checked=[];const ids=new Set();for(const row of p.rows){const ev=await this.#resolver({bundle_digest:row.bundle.bundle_digest,certificate_digest:row.certificate?.certificate_digest??null});const bundle=verifyRsiExactConsumerOwnerReviewBundle(row.bundle,ev?.phase32_evidence||{});let certificate=null;if(row.certificate){certificate=verifyRsiExactSkillPrecommitCertificate(row.certificate,ev?.certificate_args||{});}if(ids.has(bundle.bundle_id))throw new Error('rsi_phase33_archive_duplicate');ids.add(bundle.bundle_id);checked.push(Object.freeze({bundle,certificate}));}this.#rows=checked;}catch(e){if(e?.code!=='ENOENT')throw e;}this.#initialized=true;return this.snapshot();}
  async #persist(rows){const state=archiveState(this.#sourceSha,rows),tmp=this.#path+'.tmp',h=await fs.open(tmp,'w',0o600);try{await h.writeFile(JSON.stringify(state)+'\n','utf8');await h.sync();}finally{await h.close();}await fs.rename(tmp,this.#path);}
  async add({bundle,certificate=null,phase32_evidence={},certificate_args={}}={}){if(!this.#initialized)throw new Error('rsi_phase33_archive_not_initialized');const b=verifyRsiExactConsumerOwnerReviewBundle(bundle,phase32_evidence);const cert=certificate?verifyRsiExactSkillPrecommitCertificate(certificate,certificate_args):null;if(b.source_sha!==this.#sourceSha)throw new Error('rsi_phase33_archive_source_mismatch');if(cert&&cert.bundle_digest!==b.bundle_digest)throw new Error('rsi_phase33_archive_certificate_bundle_mismatch');const existing=this.#rows.find(r=>r.bundle.bundle_id===b.bundle_id);if(existing){if(existing.bundle.bundle_digest!==b.bundle_digest||existing.certificate?.certificate_digest!==(cert?.certificate_digest??null))throw new Error('rsi_phase33_archive_identity_conflict');return zero({state:'IDEMPOTENT',bundle_digest:b.bundle_digest});}if(this.#rows.length>=MAX_ROWS)throw new Error('rsi_phase33_archive_capacity_exceeded');const next=[...this.#rows,Object.freeze({bundle:b,certificate:cert})];await this.#persist(next);this.#rows=next;return zero({state:cert?.state??b.state,bundle_digest:b.bundle_digest,certificate_digest:cert?.certificate_digest??null});}
  snapshot(){const s=archiveState(this.#sourceSha,this.#rows);return Object.freeze({schema:s.schema,version:s.version,source_sha:s.source_sha,initialized:this.#initialized,row_count:s.row_count,route_counts:s.route_counts,append_only:true,durable_before_visible:true,rejected_evidence_retained:true,negative_transfer_vetoes_retained:true,archive_can_write_skill_library:false,archive_can_change_retrieval_exposure:false,archive_can_activate_skill:false,archive_can_write_experience_graph:false,archive_can_modify_meta_skill_profile:false,archive_can_schedule_work:false,authority_effect:false});}
}

export function rsiExactExistingConsumerOwnerReviewTrustRootSnapshot(){
  const root={schema:'metaengine.rsi.exact-existing-consumer-owner-review-root.v1',version:1,exact_phase32_consumer_identity_required:true,existing_verified_skill_library_reused:true,second_skill_library_allowed:false,three_independent_critics_required:true,coalition_aware_ablation_required:true,no_skill_paired_intervention_required:true,mechanical_artifact_audit_required:true,artifact_noop_ablation_required:true,benchmark_and_evaluator_provenance_required:true,contamination_clear_required:true,anytime_valid_acceptance_required:true,fixed_false_admission_error_budget_required:true,active_retrieval_cap_required:true,marginal_subset_selection_policy_required:true,append_does_not_imply_active_retrieval:true,negative_transfer_veto_retained:true,rejected_evidence_append_only:true,direct_library_append:false,direct_retrieval_exposure_change:false,direct_skill_activation:false,direct_experience_graph_write:false,direct_meta_skill_profile_mutation:false,direct_scheduler_action:false,execution_authority:false,browser_authority:false,task_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false};
  return Object.freeze({...root,exact_owner_review_root_digest:digest(root)});
}
