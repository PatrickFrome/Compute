import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  verifyRsiKnowledgeConsolidationAdmission,
  verifyRsiKnowledgeConsolidationProposal,
  verifyRsiKnowledgeTransferValidation,
} from './rsi-slow-knowledge-consolidation.mjs';

export const RSI_CONSUMER_LOCAL_REVALIDATION_REQUEST_SCHEMA='metaengine.rsi.consumer-local-revalidation-request.v1';
export const RSI_CONSUMER_LOCAL_REVALIDATION_RECEIPT_SCHEMA='metaengine.rsi.consumer-local-revalidation-receipt.v1';
export const RSI_CONSUMER_LOCAL_REVALIDATION_LEDGER_SCHEMA='metaengine.rsi.consumer-local-revalidation-ledger.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const MAX_ROWS=2048;
const CONSUMERS=new Set([
  'VERIFIED_SKILL_LIFECYCLE',
  'SHARED_EXPERIENCE_BUS',
  'ADAPTIVE_EXPERIENCE_RETRIEVAL',
  'GROUP_EXPERIENCE_EXCHANGE',
]);
const ALLOWED_CONSUMERS=Object.freeze({
  REUSABLE_RECIPE_CANDIDATE:new Set(['VERIFIED_SKILL_LIFECYCLE','SHARED_EXPERIENCE_BUS','GROUP_EXPERIENCE_EXCHANGE']),
  NEGATIVE_CONSTRAINT:new Set(['SHARED_EXPERIENCE_BUS','ADAPTIVE_EXPERIENCE_RETRIEVAL','GROUP_EXPERIENCE_EXCHANGE']),
  LOW_YIELD_CONSTRAINT:new Set(['SHARED_EXPERIENCE_BUS','ADAPTIVE_EXPERIENCE_RETRIEVAL','GROUP_EXPERIENCE_EXCHANGE']),
  ENVIRONMENT_DIAGNOSTIC:new Set(['ADAPTIVE_EXPERIENCE_RETRIEVAL']),
  AMBIGUITY_DIAGNOSTIC:new Set(['ADAPTIVE_EXPERIENCE_RETRIEVAL']),
});

function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]));}
function digest(v){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`;}
function exactSha(v,l){const x=String(v||'').trim().toLowerCase();if(!SHA40_RE.test(x))throw new Error(`rsi_consumer_revalidation_${l}_sha_invalid`);return x;}
function exactDigest(v,l){const x=String(v||'').trim().toLowerCase();if(!SHA256_RE.test(x))throw new Error(`rsi_consumer_revalidation_${l}_digest_invalid`);return x;}
function id(v,l){const x=String(v||'').trim();if(!SAFE_ID_RE.test(x))throw new Error(`rsi_consumer_revalidation_${l}_invalid`);return x;}
function consumer(v){const x=String(v||'').trim().toUpperCase();if(!CONSUMERS.has(x))throw new Error('rsi_consumer_revalidation_consumer_invalid');return x;}
function zero(extra={}){return Object.freeze({...extra,execution_authority:false,browser_authority:false,task_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false});}
function assertZero(v,l){for(const f of ['execution_authority','browser_authority','task_authority','production_mutation_authority','promotion_authority','self_update_authority','scheduler_authority','authority_effect'])if(v?.[f]!==false)throw new Error(`rsi_consumer_revalidation_${l}_${f}_invalid`);if(v?.automatic_retry_allowed!==false)throw new Error(`rsi_consumer_revalidation_${l}_retry_invalid`);}
function plain(v){return !!v&&typeof v==='object'&&!Array.isArray(v);}

function verifyPhase31Evidence({proposal,validations,admission,source_rows}={}){
  const p=verifyRsiKnowledgeConsolidationProposal(proposal,{source_rows});
  if(!Array.isArray(validations))throw new Error('rsi_consumer_revalidation_validations_invalid');
  const vs=validations.map(v=>verifyRsiKnowledgeTransferValidation(v,{proposal:p}));
  const a=verifyRsiKnowledgeConsolidationAdmission(admission,{proposal:p,validations:vs});
  if(a.proposal_digest!==p.proposal_digest||a.state!=='ELIGIBLE_FOR_LIBRARY_ADMISSION_REVIEW'||a.eligible_for_library_admission_review!==true||a.library_admission_token!==null){
    throw new Error('rsi_consumer_revalidation_phase31_admission_invalid');
  }
  return Object.freeze({proposal:p,validations:Object.freeze(vs),admission:a});
}

function classGoal(kind,input){
  if(kind==='REUSABLE_RECIPE_CANDIDATE')return input.consumer_utility_improvement===true;
  if(kind==='NEGATIVE_CONSTRAINT'||kind==='LOW_YIELD_CONSTRAINT')return input.constraint_prediction_confirmed===true;
  if(kind==='ENVIRONMENT_DIAGNOSTIC'||kind==='AMBIGUITY_DIAGNOSTIC')return input.diagnostic_discrimination_pass===true;
  return false;
}

export function createRsiConsumerLocalRevalidationRequest({
  request_id,proposal,validations,admission,source_rows,
  consumer_kind,target_consumer_digest,target_model_family_digest,target_environment_family_digest,
  target_context_digest,consumer_harness_digest,evaluator_root_digest,evaluator_generation_digest,
  local_holdout_root_digest,admission_policy_digest,risk_policy_digest,negative_transfer_probe_digest,
  counterfactual_reference_policy_digest,
  external_consumer_owner=false,external_validation_owner=false,authored_by_candidate=true,
}={}){
  if(external_consumer_owner!==true||external_validation_owner!==true||authored_by_candidate!==false)throw new Error('rsi_consumer_revalidation_external_ownership_required');
  const evidence=verifyPhase31Evidence({proposal,validations,admission,source_rows});
  const target=consumer(consumer_kind);
  const allowed=ALLOWED_CONSUMERS[evidence.proposal.knowledge_class];
  if(!allowed?.has(target))throw new Error('rsi_consumer_revalidation_consumer_knowledge_class_mismatch');
  const roots=[
    exactDigest(target_consumer_digest,'target_consumer'),
    exactDigest(target_model_family_digest,'target_model_family'),
    exactDigest(target_environment_family_digest,'target_environment_family'),
    exactDigest(target_context_digest,'target_context'),
    exactDigest(consumer_harness_digest,'consumer_harness'),
    exactDigest(evaluator_root_digest,'evaluator_root'),
    exactDigest(evaluator_generation_digest,'evaluator_generation'),
    exactDigest(local_holdout_root_digest,'local_holdout_root'),
    exactDigest(admission_policy_digest,'admission_policy'),
    exactDigest(risk_policy_digest,'risk_policy'),
    exactDigest(negative_transfer_probe_digest,'negative_transfer_probe'),
    exactDigest(counterfactual_reference_policy_digest,'counterfactual_reference_policy'),
  ];
  if(new Set(roots).size!==roots.length)throw new Error('rsi_consumer_revalidation_independent_roots_required');
  const core=zero({
    schema:RSI_CONSUMER_LOCAL_REVALIDATION_REQUEST_SCHEMA,version:1,
    request_id:id(request_id,'request_id'),source_sha:exactSha(evidence.proposal.source_sha,'source'),
    phase31_proposal_digest:evidence.proposal.proposal_digest,
    phase31_admission_digest:evidence.admission.admission_digest,
    phase31_validation_digests:Object.freeze(evidence.admission.validation_digests),
    phase31_evaluator_generation_digest:evidence.proposal.evaluator_generation_digest,
    phase31_evaluation_epoch_digest:evidence.proposal.evaluation_epoch_digest,
    phase30_source_entry_digests:Object.freeze(evidence.proposal.source_entry_digests),
    knowledge_class:evidence.proposal.knowledge_class,
    consolidated_knowledge_digest:evidence.proposal.consolidated_knowledge_digest,
    applicability_contract_digest:evidence.proposal.applicability_contract_digest,
    watch_out_digest:evidence.proposal.watch_out_digest,
    falsification_protocol_digest:evidence.proposal.falsification_protocol_digest,
    consumer_kind:target,target_consumer_digest:roots[0],target_model_family_digest:roots[1],
    target_environment_family_digest:roots[2],target_context_digest:roots[3],consumer_harness_digest:roots[4],
    evaluator_root_digest:roots[5],evaluator_generation_digest:roots[6],local_holdout_root_digest:roots[7],
    admission_policy_digest:roots[8],risk_policy_digest:roots[9],negative_transfer_probe_digest:roots[10],
    counterfactual_reference_policy_digest:roots[11],
    external_consumer_owner:true,external_validation_owner:true,authored_by_candidate:false,
    matched_or_no_knowledge_reference_required:true,consumer_local_revalidation_required:true,
    source_transfer_success_not_assumed_portable:true,cross_evaluator_generation_inheritance_allowed:false,
    abstain_no_injection_is_first_class:true,false_positive_injection_is_high_risk:true,
    memory_injection_allowed:false,direct_consumer_write_allowed:false,direct_skill_activation_allowed:false,
    direct_experience_activation_allowed:false,request_can_schedule_work:false,
    candidate_can_choose_consumer:false,candidate_can_choose_context:false,candidate_can_choose_evaluator:false,
    candidate_can_choose_holdout:false,candidate_can_choose_reference_policy:false,candidate_can_choose_risk_policy:false,
  });
  return Object.freeze({...core,request_digest:digest(core)});
}

export function verifyRsiConsumerLocalRevalidationRequest(row,evidence={}){
  if(!plain(row)||row.schema!==RSI_CONSUMER_LOCAL_REVALIDATION_REQUEST_SCHEMA||row.version!==1)throw new Error('rsi_consumer_revalidation_request_invalid');
  assertZero(row,'request');
  if(row.external_consumer_owner!==true||row.external_validation_owner!==true||row.authored_by_candidate!==false
    ||row.matched_or_no_knowledge_reference_required!==true||row.consumer_local_revalidation_required!==true
    ||row.source_transfer_success_not_assumed_portable!==true||row.cross_evaluator_generation_inheritance_allowed!==false
    ||row.abstain_no_injection_is_first_class!==true||row.false_positive_injection_is_high_risk!==true
    ||row.memory_injection_allowed!==false||row.direct_consumer_write_allowed!==false
    ||row.direct_skill_activation_allowed!==false||row.direct_experience_activation_allowed!==false
    ||row.request_can_schedule_work!==false||row.candidate_can_choose_consumer!==false||row.candidate_can_choose_context!==false
    ||row.candidate_can_choose_evaluator!==false||row.candidate_can_choose_holdout!==false
    ||row.candidate_can_choose_reference_policy!==false||row.candidate_can_choose_risk_policy!==false)throw new Error('rsi_consumer_revalidation_request_policy_invalid');
  const canonical=createRsiConsumerLocalRevalidationRequest({
    request_id:row.request_id,...evidence,consumer_kind:row.consumer_kind,target_consumer_digest:row.target_consumer_digest,
    target_model_family_digest:row.target_model_family_digest,target_environment_family_digest:row.target_environment_family_digest,
    target_context_digest:row.target_context_digest,consumer_harness_digest:row.consumer_harness_digest,
    evaluator_root_digest:row.evaluator_root_digest,evaluator_generation_digest:row.evaluator_generation_digest,
    local_holdout_root_digest:row.local_holdout_root_digest,admission_policy_digest:row.admission_policy_digest,
    risk_policy_digest:row.risk_policy_digest,negative_transfer_probe_digest:row.negative_transfer_probe_digest,
    counterfactual_reference_policy_digest:row.counterfactual_reference_policy_digest,
    external_consumer_owner:true,external_validation_owner:true,authored_by_candidate:false,
  });
  if(canonical.request_digest!==exactDigest(row.request_digest,'request'))throw new Error('rsi_consumer_revalidation_request_digest_mismatch');
  return canonical;
}

export function createRsiConsumerLocalRevalidationReceipt({
  receipt_id,request,phase31_evidence,
  matched_reference_receipt_digest,knowledge_enabled_receipt_digest,local_validation_evidence_digest,
  same_instances_pass=false,target_context_compatibility_pass=false,evaluator_integrity_pass=false,
  contamination_clear=false,from_scratch_replay_pass=false,negative_transfer_probe_pass=false,
  task_non_regression=false,safety_non_regression=false,security_non_regression=false,
  process_non_regression=false,outcome_non_regression=false,efficiency_non_regression=false,
  consumer_utility_improvement=false,constraint_prediction_confirmed=false,diagnostic_discrimination_pass=false,
  false_positive_risk_acceptable=false,environment_blocker_detected=false,ambiguous_effect=false,
  attempt_count=1,retry_count=0,external_evaluator=false,authored_by_candidate=true,
}={}){
  const r=verifyRsiConsumerLocalRevalidationRequest(request,phase31_evidence);
  if(external_evaluator!==true||authored_by_candidate!==false)throw new Error('rsi_consumer_revalidation_external_evaluator_required');
  if(attempt_count!==1||retry_count!==0)throw new Error('rsi_consumer_revalidation_attempt_semantics_invalid');
  const refs=[
    exactDigest(matched_reference_receipt_digest,'matched_reference_receipt'),
    exactDigest(knowledge_enabled_receipt_digest,'knowledge_enabled_receipt'),
    exactDigest(local_validation_evidence_digest,'local_validation_evidence'),
  ];
  if(new Set(refs).size!==refs.length)throw new Error('rsi_consumer_revalidation_receipt_roots_not_independent');
  const env=environment_blocker_detected===true,amb=ambiguous_effect===true;
  if(env&&amb)throw new Error('rsi_consumer_revalidation_multiple_inconclusive_causes');
  const compatibility=target_context_compatibility_pass===true;
  const riskOk=false_positive_risk_acceptable===true;
  const common=same_instances_pass===true&&evaluator_integrity_pass===true&&contamination_clear===true
    &&from_scratch_replay_pass===true&&negative_transfer_probe_pass===true
    &&task_non_regression===true&&safety_non_regression===true&&security_non_regression===true
    &&process_non_regression===true&&outcome_non_regression===true&&efficiency_non_regression===true;
  const goal=classGoal(r.knowledge_class,{consumer_utility_improvement,constraint_prediction_confirmed,diagnostic_discrimination_pass});
  let state;
  if(amb)state='INCONCLUSIVE_AMBIGUOUS';
  else if(env)state='INCONCLUSIVE_ENVIRONMENT';
  else if(!compatibility||!riskOk)state='ABSTAIN_NO_INJECTION';
  else if(common&&goal)state='ELIGIBLE_FOR_EXISTING_CONSUMER_ADMISSION_REVIEW';
  else state='CONSUMER_LOCAL_REVALIDATION_REJECTED';
  const core=zero({
    schema:RSI_CONSUMER_LOCAL_REVALIDATION_RECEIPT_SCHEMA,version:1,
    receipt_id:id(receipt_id,'receipt_id'),source_sha:r.source_sha,request_digest:r.request_digest,
    phase31_admission_digest:r.phase31_admission_digest,knowledge_class:r.knowledge_class,
    consumer_kind:r.consumer_kind,target_consumer_digest:r.target_consumer_digest,
    target_model_family_digest:r.target_model_family_digest,target_environment_family_digest:r.target_environment_family_digest,
    target_context_digest:r.target_context_digest,evaluator_generation_digest:r.evaluator_generation_digest,
    matched_reference_receipt_digest:refs[0],knowledge_enabled_receipt_digest:refs[1],local_validation_evidence_digest:refs[2],
    same_instances_pass:same_instances_pass===true,target_context_compatibility_pass:compatibility,
    evaluator_integrity_pass:evaluator_integrity_pass===true,contamination_clear:contamination_clear===true,
    from_scratch_replay_pass:from_scratch_replay_pass===true,negative_transfer_probe_pass:negative_transfer_probe_pass===true,
    task_non_regression:task_non_regression===true,safety_non_regression:safety_non_regression===true,
    security_non_regression:security_non_regression===true,process_non_regression:process_non_regression===true,
    outcome_non_regression:outcome_non_regression===true,efficiency_non_regression:efficiency_non_regression===true,
    consumer_utility_improvement:consumer_utility_improvement===true,
    constraint_prediction_confirmed:constraint_prediction_confirmed===true,
    diagnostic_discrimination_pass:diagnostic_discrimination_pass===true,
    false_positive_risk_acceptable:riskOk,environment_blocker_detected:env,ambiguous_effect:amb,
    attempt_count:1,retry_count:0,state,
    eligible_for_existing_consumer_admission_review:state==='ELIGIBLE_FOR_EXISTING_CONSUMER_ADMISSION_REVIEW',
    memory_injection_allowed:false,direct_consumer_write_allowed:false,direct_skill_activation_allowed:false,
    direct_experience_activation_allowed:false,consumer_admission_token:null,
    external_evaluator:true,authored_by_candidate:false,
  });
  return Object.freeze({...core,receipt_digest:digest(core)});
}

export function verifyRsiConsumerLocalRevalidationReceipt(row,{request,phase31_evidence}={}){
  if(!plain(row)||row.schema!==RSI_CONSUMER_LOCAL_REVALIDATION_RECEIPT_SCHEMA||row.version!==1)throw new Error('rsi_consumer_revalidation_receipt_invalid');
  assertZero(row,'receipt');
  if(row.external_evaluator!==true||row.authored_by_candidate!==false||row.attempt_count!==1||row.retry_count!==0
    ||row.memory_injection_allowed!==false||row.direct_consumer_write_allowed!==false
    ||row.direct_skill_activation_allowed!==false||row.direct_experience_activation_allowed!==false
    ||row.consumer_admission_token!==null)throw new Error('rsi_consumer_revalidation_receipt_policy_invalid');
  const canonical=createRsiConsumerLocalRevalidationReceipt({
    receipt_id:row.receipt_id,request,phase31_evidence,
    matched_reference_receipt_digest:row.matched_reference_receipt_digest,
    knowledge_enabled_receipt_digest:row.knowledge_enabled_receipt_digest,
    local_validation_evidence_digest:row.local_validation_evidence_digest,
    same_instances_pass:row.same_instances_pass,target_context_compatibility_pass:row.target_context_compatibility_pass,
    evaluator_integrity_pass:row.evaluator_integrity_pass,contamination_clear:row.contamination_clear,
    from_scratch_replay_pass:row.from_scratch_replay_pass,negative_transfer_probe_pass:row.negative_transfer_probe_pass,
    task_non_regression:row.task_non_regression,safety_non_regression:row.safety_non_regression,
    security_non_regression:row.security_non_regression,process_non_regression:row.process_non_regression,
    outcome_non_regression:row.outcome_non_regression,efficiency_non_regression:row.efficiency_non_regression,
    consumer_utility_improvement:row.consumer_utility_improvement,constraint_prediction_confirmed:row.constraint_prediction_confirmed,
    diagnostic_discrimination_pass:row.diagnostic_discrimination_pass,false_positive_risk_acceptable:row.false_positive_risk_acceptable,
    environment_blocker_detected:row.environment_blocker_detected,ambiguous_effect:row.ambiguous_effect,
    attempt_count:1,retry_count:0,external_evaluator:true,authored_by_candidate:false,
  });
  if(canonical.receipt_digest!==exactDigest(row.receipt_digest,'receipt'))throw new Error('rsi_consumer_revalidation_receipt_digest_mismatch');
  return canonical;
}

function ledgerState(sourceSha,rows){
  const counts={};
  for(const row of rows)counts[row.receipt.state]=(counts[row.receipt.state]||0)+1;
  const core=zero({
    schema:RSI_CONSUMER_LOCAL_REVALIDATION_LEDGER_SCHEMA,version:1,source_sha:sourceSha,rows,row_count:rows.length,
    state_counts:Object.freeze(counts),append_only:true,durable_before_visible:true,external_phase31_evidence_resolver_required:true,
    source_phase31_bodies_stored_here:false,consumer_specific_evidence_preserved:true,rejected_and_abstained_preserved:true,
    ledger_can_write_consumer:false,ledger_can_activate_skill:false,ledger_can_activate_experience:false,
    ledger_can_change_governance:false,ledger_can_schedule_work:false,
  });
  return {...core,state_digest:digest(core)};
}

export class RsiConsumerLocalRevalidationLedger{
  #path;#sourceSha;#resolver;#rows=[];#initialized=false;
  constructor({statePath,source_sha,evidenceResolver}={}){
    if(!statePath)throw new Error('rsi_consumer_revalidation_ledger_path_required');
    if(typeof evidenceResolver!=='function')throw new Error('rsi_consumer_revalidation_evidence_resolver_required');
    this.#path=path.resolve(statePath);this.#sourceSha=exactSha(source_sha,'ledger_source');this.#resolver=evidenceResolver;
  }
  async init(){
    if(this.#initialized)return this.snapshot();
    await fs.mkdir(path.dirname(this.#path),{recursive:true});
    try{
      const p=JSON.parse(await fs.readFile(this.#path,'utf8'));assertZero(p,'ledger');
      if(p.schema!==RSI_CONSUMER_LOCAL_REVALIDATION_LEDGER_SCHEMA||p.version!==1||p.source_sha!==this.#sourceSha
        ||p.append_only!==true||p.durable_before_visible!==true||p.external_phase31_evidence_resolver_required!==true
        ||p.source_phase31_bodies_stored_here!==false||p.consumer_specific_evidence_preserved!==true
        ||p.rejected_and_abstained_preserved!==true||p.ledger_can_write_consumer!==false
        ||p.ledger_can_activate_skill!==false||p.ledger_can_activate_experience!==false
        ||p.ledger_can_change_governance!==false||p.ledger_can_schedule_work!==false)throw new Error('rsi_consumer_revalidation_ledger_policy_invalid');
      const clone=structuredClone(p);delete clone.state_digest;
      if(digest(clone)!==exactDigest(p.state_digest,'ledger'))throw new Error('rsi_consumer_revalidation_ledger_digest_mismatch');
      if(!Array.isArray(p.rows)||p.rows.length>MAX_ROWS)throw new Error('rsi_consumer_revalidation_ledger_rows_invalid');
      const checked=[];const ids=new Set(),keys=new Set();
      for(const stored of p.rows){
        const evidence=await this.#resolver({phase31_admission_digest:stored.request.phase31_admission_digest});
        const request=verifyRsiConsumerLocalRevalidationRequest(stored.request,evidence||{});
        const receipt=verifyRsiConsumerLocalRevalidationReceipt(stored.receipt,{request,phase31_evidence:evidence||{}});
        const key=[request.phase31_admission_digest,request.consumer_kind,request.target_consumer_digest,request.target_model_family_digest,request.target_environment_family_digest,request.target_context_digest,request.evaluator_generation_digest].join('|');
        if(ids.has(request.request_id)||keys.has(key))throw new Error('rsi_consumer_revalidation_ledger_duplicate');
        ids.add(request.request_id);keys.add(key);checked.push(Object.freeze({request,receipt}));
      }
      const canonical=ledgerState(this.#sourceSha,checked);
      if(canonical.row_count!==p.row_count||JSON.stringify(canonical.state_counts)!==JSON.stringify(p.state_counts))throw new Error('rsi_consumer_revalidation_ledger_summary_mismatch');
      this.#rows=checked;
    }catch(error){if(error?.code!=='ENOENT')throw error;}
    this.#initialized=true;return this.snapshot();
  }
  async #persist(rows){
    const state=ledgerState(this.#sourceSha,rows),tmp=`${this.#path}.tmp`,h=await fs.open(tmp,'w',0o600);
    try{await h.writeFile(`${JSON.stringify(state)}\n`,'utf8');await h.sync();}finally{await h.close();}
    await fs.rename(tmp,this.#path);
  }
  async add({request,receipt,phase31_evidence}={}){
    if(!this.#initialized)throw new Error('rsi_consumer_revalidation_ledger_not_initialized');
    const req=verifyRsiConsumerLocalRevalidationRequest(request,phase31_evidence||{});
    const rec=verifyRsiConsumerLocalRevalidationReceipt(receipt,{request:req,phase31_evidence:phase31_evidence||{}});
    if(req.source_sha!==this.#sourceSha||rec.source_sha!==this.#sourceSha)throw new Error('rsi_consumer_revalidation_ledger_source_mismatch');
    const key=[req.phase31_admission_digest,req.consumer_kind,req.target_consumer_digest,req.target_model_family_digest,req.target_environment_family_digest,req.target_context_digest,req.evaluator_generation_digest].join('|');
    const existing=this.#rows.find(r=>r.request.request_id===req.request_id||[r.request.phase31_admission_digest,r.request.consumer_kind,r.request.target_consumer_digest,r.request.target_model_family_digest,r.request.target_environment_family_digest,r.request.target_context_digest,r.request.evaluator_generation_digest].join('|')===key);
    if(existing){
      if(existing.request.request_digest!==req.request_digest||existing.receipt.receipt_digest!==rec.receipt_digest)throw new Error('rsi_consumer_revalidation_ledger_identity_conflict');
      return zero({state:'IDEMPOTENT',request_digest:req.request_digest,receipt_digest:rec.receipt_digest});
    }
    if(this.#rows.length>=MAX_ROWS)throw new Error('rsi_consumer_revalidation_ledger_capacity_exceeded');
    const next=[...this.#rows,Object.freeze({request:req,receipt:rec})];await this.#persist(next);this.#rows=next;
    return zero({state:rec.state,request_digest:req.request_digest,receipt_digest:rec.receipt_digest});
  }
  entries(){if(!this.#initialized)throw new Error('rsi_consumer_revalidation_ledger_not_initialized');return Object.freeze(this.#rows.map(r=>Object.freeze(structuredClone(r))));}
  snapshot(){
    const s=ledgerState(this.#sourceSha,this.#rows);
    return Object.freeze({schema:s.schema,version:s.version,source_sha:s.source_sha,initialized:this.#initialized,row_count:s.row_count,
      state_counts:s.state_counts,append_only:true,durable_before_visible:true,external_phase31_evidence_resolver_required:true,
      source_phase31_bodies_stored_here:false,consumer_specific_evidence_preserved:true,rejected_and_abstained_preserved:true,
      ledger_can_write_consumer:false,ledger_can_activate_skill:false,ledger_can_activate_experience:false,
      ledger_can_change_governance:false,ledger_can_schedule_work:false,authority_effect:false});
  }
}

export function rsiConsumerLocalRevalidationTrustRootSnapshot(){
  const root={
    schema:'metaengine.rsi.consumer-local-revalidation-root.v1',version:1,
    phase31_library_admission_review_evidence_required:true,consumer_local_revalidation_required:true,
    existing_consumer_planes_reused:true,second_skill_library_forbidden:true,second_experience_graph_forbidden:true,
    matched_or_no_knowledge_reference_required:true,same_instance_differential_validation_required:true,
    negative_transfer_probe_required:true,abstain_no_injection_is_first_class:true,false_positive_injection_is_high_risk:true,
    source_transfer_success_not_assumed_portable:true,cross_evaluator_generation_inheritance_allowed:false,
    candidate_consumer_selection_forbidden:true,candidate_context_selection_forbidden:true,candidate_evaluator_selection_forbidden:true,
    one_attempt_semantics:true,no_blind_retry:true,rejected_and_abstained_evidence_preserved:true,
    direct_consumer_write_performed_here:false,direct_skill_activation_performed_here:false,
    direct_experience_activation_performed_here:false,consumer_admission_token_issued_here:false,
    execution_authority:false,browser_authority:false,task_authority:false,production_mutation_authority:false,
    promotion_authority:false,self_update_authority:false,scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...root,consumer_local_revalidation_root_digest:digest(root)});
}
