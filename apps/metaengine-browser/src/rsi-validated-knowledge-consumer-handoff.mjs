import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  RSI_KNOWLEDGE_CONSOLIDATION_PROPOSAL_SCHEMA,
  RSI_KNOWLEDGE_CONSOLIDATION_ADMISSION_SCHEMA,
  verifyRsiKnowledgeConsolidationProposal,
  verifyRsiKnowledgeTransferValidation,
  verifyRsiKnowledgeConsolidationAdmission,
} from './rsi-slow-knowledge-consolidation.mjs';

export const RSI_VALIDATED_KNOWLEDGE_CONSUMER_HANDOFF_SCHEMA='metaengine.rsi.validated-knowledge-consumer-handoff.v1';
export const RSI_CONSUMER_LOCAL_REVALIDATION_RECEIPT_SCHEMA='metaengine.rsi.consumer-local-revalidation-receipt.v1';
export const RSI_CONSUMER_REVALIDATION_ARCHIVE_SCHEMA='metaengine.rsi.consumer-revalidation-archive.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const SAFE_TOKEN_RE=/^[A-Z0-9][A-Z0-9_.:-]{1,95}$/;
const MAX_ROWS=2048;

const ROUTE_BY_CLASS=Object.freeze({
  REUSABLE_RECIPE_CANDIDATE:'VERIFIED_SKILL_CANDIDATE_REVALIDATION',
  NEGATIVE_CONSTRAINT:'EXPERIENCE_COUNTEREVIDENCE_REVALIDATION',
  LOW_YIELD_CONSTRAINT:'EXPERIENCE_COUNTEREVIDENCE_REVALIDATION',
  ENVIRONMENT_DIAGNOSTIC:'ADAPTIVE_RETRIEVAL_DIAGNOSTIC_REVALIDATION',
  AMBIGUITY_DIAGNOSTIC:'ADAPTIVE_RETRIEVAL_DIAGNOSTIC_REVALIDATION',
});

function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]));}
function digest(v){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`;}
function exactSha(v,l){const x=String(v||'').trim().toLowerCase();if(!SHA40_RE.test(x))throw new Error(`rsi_consumer_${l}_sha_invalid`);return x;}
function exactDigest(v,l){const x=String(v||'').trim().toLowerCase();if(!SHA256_RE.test(x))throw new Error(`rsi_consumer_${l}_digest_invalid`);return x;}
function id(v,l){const x=String(v||'').trim();if(!SAFE_ID_RE.test(x))throw new Error(`rsi_consumer_${l}_invalid`);return x;}
function token(v,l){const x=String(v||'').trim().toUpperCase();if(!SAFE_TOKEN_RE.test(x))throw new Error(`rsi_consumer_${l}_invalid`);return x;}
function assertZero(v,l){
  for(const f of ['execution_authority','browser_authority','task_authority','production_mutation_authority','promotion_authority','self_update_authority','scheduler_authority','authority_effect']){
    if(v?.[f]!==false)throw new Error(`rsi_consumer_${l}_${f}_invalid`);
  }
  if(v?.automatic_retry_allowed!==false)throw new Error(`rsi_consumer_${l}_retry_invalid`);
}
function zero(extra={}){
  return Object.freeze({
    ...extra,
    execution_authority:false,browser_authority:false,task_authority:false,
    production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false,
  });
}

function verifyPhase31({proposal,validations,admission,source_rows}={}){
  if(!proposal||proposal.schema!==RSI_KNOWLEDGE_CONSOLIDATION_PROPOSAL_SCHEMA)throw new Error('rsi_consumer_phase31_proposal_invalid');
  if(!admission||admission.schema!==RSI_KNOWLEDGE_CONSOLIDATION_ADMISSION_SCHEMA)throw new Error('rsi_consumer_phase31_admission_invalid');
  const p=verifyRsiKnowledgeConsolidationProposal(proposal,{source_rows});
  if(!Array.isArray(validations)||validations.length<2)throw new Error('rsi_consumer_phase31_validations_invalid');
  const vs=validations.map(v=>verifyRsiKnowledgeTransferValidation(v,{proposal:p}));
  const a=verifyRsiKnowledgeConsolidationAdmission(admission,{proposal:p,validations:vs});
  if(a.state!=='ELIGIBLE_FOR_LIBRARY_ADMISSION_REVIEW'||a.eligible_for_library_admission_review!==true||a.library_admission_token!==null){
    throw new Error('rsi_consumer_phase31_admission_not_eligible');
  }
  return Object.freeze({proposal:p,validations:Object.freeze(vs),admission:a});
}

export function createRsiValidatedKnowledgeConsumerHandoff({
  handoff_id,
  proposal,
  validations,
  admission,
  source_rows,
  consumer_model_family,
  consumer_environment_family,
  consumer_context_digest,
  consumer_harness_digest,
  consumer_evaluator_root_digest,
  consumer_evaluator_generation_digest,
  consumer_holdout_digest,
  matched_reference_plan_digest,
  local_revalidation_protocol_digest,
  external_consumer_router=false,
  authored_by_candidate=true,
}={}){
  if(external_consumer_router!==true||authored_by_candidate!==false)throw new Error('rsi_consumer_external_router_required');
  const phase31=verifyPhase31({proposal,validations,admission,source_rows});
  const route=ROUTE_BY_CLASS[phase31.proposal.knowledge_class];
  if(!route)throw new Error('rsi_consumer_knowledge_class_unsupported');
  const roots=[
    exactDigest(consumer_context_digest,'context'),
    exactDigest(consumer_harness_digest,'harness'),
    exactDigest(consumer_evaluator_root_digest,'evaluator_root'),
    exactDigest(consumer_evaluator_generation_digest,'evaluator_generation'),
    exactDigest(consumer_holdout_digest,'holdout'),
    exactDigest(matched_reference_plan_digest,'reference_plan'),
    exactDigest(local_revalidation_protocol_digest,'revalidation_protocol'),
    phase31.admission.admission_digest,
    phase31.proposal.proposal_digest,
  ];
  if(new Set(roots).size!==roots.length)throw new Error('rsi_consumer_independent_roots_required');
  const crossGeneration=roots[3]!==phase31.proposal.evaluator_generation_digest;
  const core=zero({
    schema:RSI_VALIDATED_KNOWLEDGE_CONSUMER_HANDOFF_SCHEMA,
    version:1,
    handoff_id:id(handoff_id,'handoff_id'),
    source_sha:exactSha(phase31.proposal.source_sha,'source'),
    phase31_proposal_digest:phase31.proposal.proposal_digest,
    phase31_admission_digest:phase31.admission.admission_digest,
    phase31_validation_digests:Object.freeze(phase31.admission.validation_digests.slice()),
    source_evaluator_generation_digest:phase31.proposal.evaluator_generation_digest,
    source_evaluation_epoch_digest:phase31.proposal.evaluation_epoch_digest,
    knowledge_class:phase31.proposal.knowledge_class,
    consumer_route:route,
    consumer_model_family:token(consumer_model_family,'model_family'),
    consumer_environment_family:token(consumer_environment_family,'environment_family'),
    consumer_context_digest:roots[0],
    consumer_harness_digest:roots[1],
    consumer_evaluator_root_digest:roots[2],
    consumer_evaluator_generation_digest:roots[3],
    consumer_holdout_digest:roots[4],
    matched_reference_plan_digest:roots[5],
    local_revalidation_protocol_digest:roots[6],
    cross_generation_revalidation_required:crossGeneration,
    source_generation_verdict_inherited:false,
    state:'ELIGIBLE_FOR_CONSUMER_LOCAL_REVALIDATION',
    existing_verified_skill_library_only:true,
    existing_experience_graph_only:true,
    existing_adaptive_retrieval_only:true,
    existing_meta_skill_plane_only:true,
    second_skill_library_created:false,
    second_experience_graph_created:false,
    second_scheduler_created:false,
    consumer_local_paired_validation_required:true,
    matched_no_skill_or_reference_required:route==='VERIFIED_SKILL_CANDIDATE_REVALIDATION',
    consumer_can_inherit_source_success:false,
    candidate_can_choose_consumer_context:false,
    candidate_can_choose_consumer_evaluator:false,
    candidate_can_choose_consumer_holdout:false,
    handoff_can_write_skill_library:false,
    handoff_can_write_experience_graph:false,
    handoff_can_modify_meta_skill_profile:false,
    handoff_can_schedule_work:false,
    handoff_can_activate_knowledge:false,
  });
  return Object.freeze({...core,handoff_digest:digest(core)});
}

export function verifyRsiValidatedKnowledgeConsumerHandoff(handoff,{proposal,validations,admission,source_rows}={}){
  if(!handoff||handoff.schema!==RSI_VALIDATED_KNOWLEDGE_CONSUMER_HANDOFF_SCHEMA||handoff.version!==1)throw new Error('rsi_consumer_handoff_invalid');
  assertZero(handoff,'handoff');
  if(handoff.state!=='ELIGIBLE_FOR_CONSUMER_LOCAL_REVALIDATION'
    ||handoff.existing_verified_skill_library_only!==true||handoff.existing_experience_graph_only!==true
    ||handoff.existing_adaptive_retrieval_only!==true||handoff.existing_meta_skill_plane_only!==true
    ||handoff.second_skill_library_created!==false||handoff.second_experience_graph_created!==false
    ||handoff.second_scheduler_created!==false||handoff.consumer_local_paired_validation_required!==true
    ||handoff.source_generation_verdict_inherited!==false||handoff.consumer_can_inherit_source_success!==false
    ||handoff.candidate_can_choose_consumer_context!==false||handoff.candidate_can_choose_consumer_evaluator!==false
    ||handoff.candidate_can_choose_consumer_holdout!==false||handoff.handoff_can_write_skill_library!==false
    ||handoff.handoff_can_write_experience_graph!==false||handoff.handoff_can_modify_meta_skill_profile!==false
    ||handoff.handoff_can_schedule_work!==false||handoff.handoff_can_activate_knowledge!==false){
    throw new Error('rsi_consumer_handoff_policy_invalid');
  }
  const canonical=createRsiValidatedKnowledgeConsumerHandoff({
    handoff_id:handoff.handoff_id,proposal,validations,admission,source_rows,
    consumer_model_family:handoff.consumer_model_family,
    consumer_environment_family:handoff.consumer_environment_family,
    consumer_context_digest:handoff.consumer_context_digest,
    consumer_harness_digest:handoff.consumer_harness_digest,
    consumer_evaluator_root_digest:handoff.consumer_evaluator_root_digest,
    consumer_evaluator_generation_digest:handoff.consumer_evaluator_generation_digest,
    consumer_holdout_digest:handoff.consumer_holdout_digest,
    matched_reference_plan_digest:handoff.matched_reference_plan_digest,
    local_revalidation_protocol_digest:handoff.local_revalidation_protocol_digest,
    external_consumer_router:true,authored_by_candidate:false,
  });
  if(canonical.handoff_digest!==exactDigest(handoff.handoff_digest,'handoff'))throw new Error('rsi_consumer_handoff_digest_mismatch');
  return canonical;
}

function classifyResult(route,{
  hard_invariants_pass,
  task_non_regression,
  safety_non_regression,
  security_non_regression,
  efficiency_non_regression,
  strict_consumer_improvement,
  constraint_prediction_confirmed,
  diagnostic_discrimination_pass,
}){
  if(hard_invariants_pass!==true||task_non_regression!==true||safety_non_regression!==true||security_non_regression!==true||efficiency_non_regression!==true){
    return 'CONSUMER_NEGATIVE_TRANSFER';
  }
  if(route==='VERIFIED_SKILL_CANDIDATE_REVALIDATION'){
    return strict_consumer_improvement===true?'CONSUMER_REVALIDATED_RECIPE':'CONSUMER_NO_CLEAR_BENEFIT';
  }
  if(route==='EXPERIENCE_COUNTEREVIDENCE_REVALIDATION'){
    return constraint_prediction_confirmed===true?'CONSUMER_REVALIDATED_COUNTEREVIDENCE':'CONSUMER_COUNTEREVIDENCE_NOT_CONFIRMED';
  }
  if(route==='ADAPTIVE_RETRIEVAL_DIAGNOSTIC_REVALIDATION'){
    return diagnostic_discrimination_pass===true?'CONSUMER_REVALIDATED_DIAGNOSTIC':'CONSUMER_DIAGNOSTIC_NOT_CONFIRMED';
  }
  throw new Error('rsi_consumer_route_invalid');
}

export function createRsiConsumerLocalRevalidationReceipt({
  receipt_id,
  handoff,
  matched_control_receipt_digest,
  treatment_receipt_digest,
  local_evidence_digest,
  same_instances_pass,
  same_harness_pass,
  same_budget_pass,
  evaluator_integrity_pass,
  hidden_holdout_pass,
  contamination_clear,
  from_scratch_replay_pass,
  hard_invariants_pass,
  task_non_regression,
  safety_non_regression,
  security_non_regression,
  efficiency_non_regression,
  strict_consumer_improvement=false,
  constraint_prediction_confirmed=false,
  diagnostic_discrimination_pass=false,
  external_consumer_evaluator=false,
  authored_by_candidate=true,
}={}){
  if(!handoff||handoff.schema!==RSI_VALIDATED_KNOWLEDGE_CONSUMER_HANDOFF_SCHEMA)throw new Error('rsi_consumer_handoff_invalid');
  assertZero(handoff,'receipt_handoff');
  const hc=structuredClone(handoff);delete hc.handoff_digest;
  if(digest(hc)!==exactDigest(handoff.handoff_digest,'receipt_handoff'))throw new Error('rsi_consumer_handoff_digest_mismatch');
  if(external_consumer_evaluator!==true||authored_by_candidate!==false)throw new Error('rsi_consumer_external_evaluator_required');
  const roots=[
    exactDigest(matched_control_receipt_digest,'control_receipt'),
    exactDigest(treatment_receipt_digest,'treatment_receipt'),
    exactDigest(local_evidence_digest,'local_evidence'),
    handoff.consumer_context_digest,
    handoff.consumer_harness_digest,
    handoff.consumer_holdout_digest,
    handoff.consumer_evaluator_root_digest,
  ];
  if(new Set(roots).size!==roots.length)throw new Error('rsi_consumer_receipt_independent_roots_required');
  const blockers=[];
  if(same_instances_pass!==true)blockers.push('INSTANCE_MISMATCH');
  if(same_harness_pass!==true)blockers.push('HARNESS_MISMATCH');
  if(same_budget_pass!==true)blockers.push('BUDGET_MISMATCH');
  if(evaluator_integrity_pass!==true)blockers.push('EVALUATOR_INTEGRITY_FAILURE');
  if(hidden_holdout_pass!==true)blockers.push('HIDDEN_HOLDOUT_FAILURE');
  if(contamination_clear!==true)blockers.push('CONTAMINATION_DETECTED');
  if(from_scratch_replay_pass!==true)blockers.push('FROM_SCRATCH_REPLAY_FAILURE');
  const classified=classifyResult(handoff.consumer_route,{
    hard_invariants_pass,task_non_regression,safety_non_regression,security_non_regression,efficiency_non_regression,
    strict_consumer_improvement,constraint_prediction_confirmed,diagnostic_discrimination_pass,
  });
  const invalid=blockers.length>0;
  const state=invalid?'CONSUMER_REVALIDATION_INVALID':classified;
  const eligibleTarget=state==='CONSUMER_REVALIDATED_RECIPE'
    ?'EXISTING_VERIFIED_SKILL_EVIDENCE_REVIEW'
    :state==='CONSUMER_REVALIDATED_COUNTEREVIDENCE'
      ?'EXISTING_EXPERIENCE_COUNTEREVIDENCE_REVIEW'
      :state==='CONSUMER_REVALIDATED_DIAGNOSTIC'
        ?'EXISTING_ADAPTIVE_RETRIEVAL_DIAGNOSTIC_REVIEW'
        :null;
  const negativeTransfer=state==='CONSUMER_NEGATIVE_TRANSFER';
  const core=zero({
    schema:RSI_CONSUMER_LOCAL_REVALIDATION_RECEIPT_SCHEMA,
    version:1,
    receipt_id:id(receipt_id,'receipt_id'),
    source_sha:handoff.source_sha,
    handoff_digest:handoff.handoff_digest,
    phase31_admission_digest:handoff.phase31_admission_digest,
    knowledge_class:handoff.knowledge_class,
    consumer_route:handoff.consumer_route,
    consumer_model_family:handoff.consumer_model_family,
    consumer_environment_family:handoff.consumer_environment_family,
    consumer_context_digest:handoff.consumer_context_digest,
    consumer_harness_digest:handoff.consumer_harness_digest,
    consumer_evaluator_root_digest:handoff.consumer_evaluator_root_digest,
    consumer_evaluator_generation_digest:handoff.consumer_evaluator_generation_digest,
    consumer_holdout_digest:handoff.consumer_holdout_digest,
    matched_reference_plan_digest:handoff.matched_reference_plan_digest,
    matched_control_receipt_digest:roots[0],
    treatment_receipt_digest:roots[1],
    local_evidence_digest:roots[2],
    same_instances_pass:same_instances_pass===true,
    same_harness_pass:same_harness_pass===true,
    same_budget_pass:same_budget_pass===true,
    evaluator_integrity_pass:evaluator_integrity_pass===true,
    hidden_holdout_pass:hidden_holdout_pass===true,
    contamination_clear:contamination_clear===true,
    from_scratch_replay_pass:from_scratch_replay_pass===true,
    hard_invariants_pass:hard_invariants_pass===true,
    task_non_regression:task_non_regression===true,
    safety_non_regression:safety_non_regression===true,
    security_non_regression:security_non_regression===true,
    efficiency_non_regression:efficiency_non_regression===true,
    strict_consumer_improvement:strict_consumer_improvement===true,
    constraint_prediction_confirmed:constraint_prediction_confirmed===true,
    diagnostic_discrimination_pass:diagnostic_discrimination_pass===true,
    blockers:Object.freeze(blockers.sort()),
    state,
    eligible_existing_consumer_review:eligibleTarget,
    negative_transfer_memory:negativeTransfer,
    suppress_repeat_same_consumer_context:negativeTransfer,
    cross_generation_revalidation_performed:handoff.cross_generation_revalidation_required===true,
    source_generation_verdict_inherited:false,
    existing_verified_skill_library_only:true,
    existing_experience_graph_only:true,
    existing_adaptive_retrieval_only:true,
    existing_meta_skill_plane_only:true,
    receipt_can_write_skill_library:false,
    receipt_can_write_experience_graph:false,
    receipt_can_modify_meta_skill_profile:false,
    receipt_can_activate_skill:false,
    receipt_can_schedule_work:false,
  });
  return Object.freeze({...core,receipt_digest:digest(core)});
}

export function verifyRsiConsumerLocalRevalidationReceipt(receipt,{handoff}={}){
  if(!receipt||receipt.schema!==RSI_CONSUMER_LOCAL_REVALIDATION_RECEIPT_SCHEMA||receipt.version!==1)throw new Error('rsi_consumer_receipt_invalid');
  assertZero(receipt,'receipt');
  if(receipt.source_generation_verdict_inherited!==false||receipt.existing_verified_skill_library_only!==true
    ||receipt.existing_experience_graph_only!==true||receipt.existing_adaptive_retrieval_only!==true
    ||receipt.existing_meta_skill_plane_only!==true||receipt.receipt_can_write_skill_library!==false
    ||receipt.receipt_can_write_experience_graph!==false||receipt.receipt_can_modify_meta_skill_profile!==false
    ||receipt.receipt_can_activate_skill!==false||receipt.receipt_can_schedule_work!==false){
    throw new Error('rsi_consumer_receipt_policy_invalid');
  }
  if(receipt.handoff_digest!==handoff?.handoff_digest)throw new Error('rsi_consumer_receipt_handoff_mismatch');
  const canonical=createRsiConsumerLocalRevalidationReceipt({
    receipt_id:receipt.receipt_id,handoff,
    matched_control_receipt_digest:receipt.matched_control_receipt_digest,
    treatment_receipt_digest:receipt.treatment_receipt_digest,
    local_evidence_digest:receipt.local_evidence_digest,
    same_instances_pass:receipt.same_instances_pass,
    same_harness_pass:receipt.same_harness_pass,
    same_budget_pass:receipt.same_budget_pass,
    evaluator_integrity_pass:receipt.evaluator_integrity_pass,
    hidden_holdout_pass:receipt.hidden_holdout_pass,
    contamination_clear:receipt.contamination_clear,
    from_scratch_replay_pass:receipt.from_scratch_replay_pass,
    hard_invariants_pass:receipt.hard_invariants_pass,
    task_non_regression:receipt.task_non_regression,
    safety_non_regression:receipt.safety_non_regression,
    security_non_regression:receipt.security_non_regression,
    efficiency_non_regression:receipt.efficiency_non_regression,
    strict_consumer_improvement:receipt.strict_consumer_improvement,
    constraint_prediction_confirmed:receipt.constraint_prediction_confirmed,
    diagnostic_discrimination_pass:receipt.diagnostic_discrimination_pass,
    external_consumer_evaluator:true,authored_by_candidate:false,
  });
  if(canonical.receipt_digest!==exactDigest(receipt.receipt_digest,'receipt'))throw new Error('rsi_consumer_receipt_digest_mismatch');
  return canonical;
}

function archiveState(sourceSha,rows){
  const states={};
  for(const row of rows)states[row.receipt.state]=(states[row.receipt.state]||0)+1;
  const core=zero({
    schema:RSI_CONSUMER_REVALIDATION_ARCHIVE_SCHEMA,
    version:1,
    source_sha:sourceSha,
    rows,
    row_count:rows.length,
    state_counts:Object.freeze(states),
    append_only:true,
    durable_before_visible:true,
    negative_transfer_retained:true,
    active_skill_library_digest:null,
    active_experience_graph_digest:null,
    active_meta_skill_profile_digest:null,
    archive_can_write_consumers:false,
    archive_can_activate_skill:false,
    archive_can_schedule_work:false,
    candidate_can_delete:false,
    candidate_can_rewrite:false,
  });
  return {...core,state_digest:digest(core)};
}

export class RsiConsumerRevalidationArchive{
  #path;#sourceSha;#resolver;#rows=[];#initialized=false;
  constructor({statePath,source_sha,evidenceResolver}={}){
    if(!statePath)throw new Error('rsi_consumer_archive_path_required');
    if(typeof evidenceResolver!=='function')throw new Error('rsi_consumer_archive_evidence_resolver_required');
    this.#path=path.resolve(statePath);this.#sourceSha=exactSha(source_sha,'archive_source');this.#resolver=evidenceResolver;
  }
  async init(){
    if(this.#initialized)return this.snapshot();
    await fs.mkdir(path.dirname(this.#path),{recursive:true});
    try{
      const p=JSON.parse(await fs.readFile(this.#path,'utf8'));assertZero(p,'archive');
      if(p.schema!==RSI_CONSUMER_REVALIDATION_ARCHIVE_SCHEMA||p.version!==1||p.source_sha!==this.#sourceSha
        ||p.append_only!==true||p.durable_before_visible!==true||p.negative_transfer_retained!==true
        ||p.active_skill_library_digest!==null||p.active_experience_graph_digest!==null||p.active_meta_skill_profile_digest!==null
        ||p.archive_can_write_consumers!==false||p.archive_can_activate_skill!==false||p.archive_can_schedule_work!==false
        ||p.candidate_can_delete!==false||p.candidate_can_rewrite!==false){
        throw new Error('rsi_consumer_archive_policy_invalid');
      }
      const clone=structuredClone(p);delete clone.state_digest;
      if(digest(clone)!==exactDigest(p.state_digest,'archive'))throw new Error('rsi_consumer_archive_digest_mismatch');
      if(!Array.isArray(p.rows)||p.rows.length>MAX_ROWS)throw new Error('rsi_consumer_archive_rows_invalid');
      const identities=new Set();
      const checkedRows=[];
      for(const row of p.rows){
        if(row.source_sha!==this.#sourceSha)throw new Error('rsi_consumer_archive_source_mismatch');
        const evidence=await this.#resolver({
          phase31_admission_digest:row.handoff.phase31_admission_digest,
          handoff_digest:row.handoff.handoff_digest,
          receipt_digest:row.receipt.receipt_digest,
        });
        const handoff=verifyRsiValidatedKnowledgeConsumerHandoff(row.handoff,evidence||{});
        const receipt=verifyRsiConsumerLocalRevalidationReceipt(row.receipt,{handoff});
        const key=`${handoff.phase31_admission_digest}|${handoff.consumer_model_family}|${handoff.consumer_environment_family}|${handoff.consumer_context_digest}|${handoff.consumer_harness_digest}|${handoff.consumer_evaluator_generation_digest}`;
        if(identities.has(key))throw new Error('rsi_consumer_archive_identity_duplicate');
        identities.add(key);
        if(row.consumer_identity!==key)throw new Error('rsi_consumer_archive_consumer_identity_mismatch');
        checkedRows.push(Object.freeze({source_sha:this.#sourceSha,consumer_identity:key,handoff,receipt}));
      }
      this.#rows=checkedRows;
    }catch(error){if(error?.code!=='ENOENT')throw error;}
    this.#initialized=true;return this.snapshot();
  }
  async #persist(rows){
    const s=archiveState(this.#sourceSha,rows);const tmp=`${this.#path}.tmp`;const h=await fs.open(tmp,'w',0o600);
    try{await h.writeFile(`${JSON.stringify(s)}\n`,'utf8');await h.sync();}finally{await h.close();}
    await fs.rename(tmp,this.#path);
  }
  async add({handoff,receipt,proposal,validations,admission,source_rows}={}){
    if(!this.#initialized)throw new Error('rsi_consumer_archive_not_initialized');
    const checkedHandoff=verifyRsiValidatedKnowledgeConsumerHandoff(handoff,{proposal,validations,admission,source_rows});
    const checkedReceipt=verifyRsiConsumerLocalRevalidationReceipt(receipt,{handoff:checkedHandoff});
    handoff=checkedHandoff;receipt=checkedReceipt;
    if(handoff.source_sha!==this.#sourceSha||receipt.source_sha!==this.#sourceSha||receipt.handoff_digest!==handoff.handoff_digest){
      throw new Error('rsi_consumer_archive_binding_mismatch');
    }
    const key=`${handoff.phase31_admission_digest}|${handoff.consumer_model_family}|${handoff.consumer_environment_family}|${handoff.consumer_context_digest}|${handoff.consumer_harness_digest}|${handoff.consumer_evaluator_generation_digest}`;
    const existing=this.#rows.find(r=>r.consumer_identity===key);
    if(existing){
      if(existing.handoff.handoff_digest!==handoff.handoff_digest||existing.receipt.receipt_digest!==receipt.receipt_digest)throw new Error('rsi_consumer_archive_identity_conflict');
      return zero({state:'IDEMPOTENT',receipt_digest:receipt.receipt_digest});
    }
    if(this.#rows.length>=MAX_ROWS)throw new Error('rsi_consumer_archive_capacity_exceeded');
    const next=[...this.#rows,Object.freeze({source_sha:this.#sourceSha,consumer_identity:key,handoff:structuredClone(handoff),receipt:structuredClone(receipt)})];
    await this.#persist(next);this.#rows=next;
    return zero({state:receipt.state,receipt_digest:receipt.receipt_digest});
  }
  snapshot(){
    const s=archiveState(this.#sourceSha,this.#rows);
    return Object.freeze({
      schema:s.schema,version:s.version,source_sha:s.source_sha,initialized:this.#initialized,row_count:s.row_count,state_counts:s.state_counts,
      append_only:true,durable_before_visible:true,negative_transfer_retained:true,
      active_skill_library_digest:null,active_experience_graph_digest:null,active_meta_skill_profile_digest:null,
      archive_can_write_consumers:false,archive_can_activate_skill:false,archive_can_schedule_work:false,authority_effect:false,
    });
  }
}

export function rsiValidatedKnowledgeConsumerHandoffTrustRootSnapshot(){
  const root={
    schema:'metaengine.rsi.validated-knowledge-consumer-handoff-root.v1',
    version:1,
    phase31_multi_context_admission_required:true,
    existing_verified_skill_library_only:true,
    existing_experience_graph_only:true,
    existing_adaptive_retrieval_only:true,
    existing_meta_skill_plane_only:true,
    second_skill_library_allowed:false,
    second_experience_graph_allowed:false,
    second_scheduler_allowed:false,
    consumer_local_paired_validation_required:true,
    matched_no_skill_or_reference_required_for_recipes:true,
    consumer_specific_model_harness_context_binding_required:true,
    consumer_evaluator_generation_binding_required:true,
    cross_generation_revalidation_required:true,
    source_generation_verdict_inherited:false,
    negative_transfer_retained:true,
    recipe_route:'VERIFIED_SKILL_CANDIDATE_REVALIDATION',
    constraint_route:'EXPERIENCE_COUNTEREVIDENCE_REVALIDATION',
    diagnostic_route:'ADAPTIVE_RETRIEVAL_DIAGNOSTIC_REVALIDATION',
    direct_skill_library_write:false,
    direct_experience_graph_write:false,
    direct_meta_skill_profile_mutation:false,
    direct_knowledge_activation:false,
    direct_scheduler_action:false,
    execution_authority:false,browser_authority:false,task_authority:false,
    production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...root,validated_knowledge_consumer_handoff_root_digest:digest(root)});
}
