import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  verifyRsiCandidateExperimentIntent,
  verifyRsiCandidateExperimentReceipt,
} from './rsi-candidate-experiment-ledger.mjs';
import {
  verifyRsiMaterializedCandidateEvaluationHandoff,
} from './rsi-materialized-candidate-evaluation-handoff.mjs';

export const RSI_GENERATION_SCOPED_OUTCOME_ENTRY_SCHEMA='metaengine.rsi.generation-scoped-outcome-entry.v1';
export const RSI_GENERATION_SCOPED_OUTCOME_ARCHIVE_SCHEMA='metaengine.rsi.generation-scoped-outcome-archive.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const SAFE_TAG_RE=/^[A-Z0-9][A-Z0-9_.:-]{1,63}$/;
const MAX_ROWS=2048;
const MAX_TAGS=16;
const METRICS=Object.freeze([
  'task_utility','safety','security','process_integrity','outcome_integrity','efficiency',
]);
const OUTCOME_KIND=Object.freeze({
  SUPPORTED_FOR_BOUNDED_REVISION:'REUSABLE_RECIPE_CANDIDATE',
  CANDIDATE_EXPERIMENT_REJECTED:'NEGATIVE_CONSTRAINT',
  NO_MATERIAL_IMPROVEMENT:'LOW_YIELD_CONSTRAINT',
  INCONCLUSIVE_ENVIRONMENT:'ENVIRONMENT_DIAGNOSTIC',
  INCONCLUSIVE_AMBIGUOUS:'AMBIGUITY_DIAGNOSTIC',
});

function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]));}
function digest(v){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`;}
function exactSha(v,l){const x=String(v||'').trim().toLowerCase();if(!SHA40_RE.test(x))throw new Error(`rsi_outcome_frontier_${l}_sha_invalid`);return x;}
function exactDigest(v,l){const x=String(v||'').trim().toLowerCase();if(!SHA256_RE.test(x))throw new Error(`rsi_outcome_frontier_${l}_digest_invalid`);return x;}
function optionalDigest(v,l){return v==null?null:exactDigest(v,l);}
function id(v,l){const x=String(v||'').trim();if(!SAFE_ID_RE.test(x))throw new Error(`rsi_outcome_frontier_${l}_invalid`);return x;}
function positiveInt(v,l,max=Number.MAX_SAFE_INTEGER){const n=Number(v);if(!Number.isSafeInteger(n)||n<1||n>max)throw new Error(`rsi_outcome_frontier_${l}_invalid`);return n;}
function tags(v,l){
  if(!Array.isArray(v)||v.length<1||v.length>MAX_TAGS)throw new Error(`rsi_outcome_frontier_${l}_invalid`);
  const out=[...new Set(v.map(x=>String(x||'').trim().toUpperCase()))].sort();
  if(out.length!==v.length||out.some(x=>!SAFE_TAG_RE.test(x)))throw new Error(`rsi_outcome_frontier_${l}_invalid`);
  return Object.freeze(out);
}
function assertZero(v,l){for(const f of ['execution_authority','browser_authority','task_authority','production_mutation_authority','promotion_authority','self_update_authority','scheduler_authority','authority_effect'])if(v?.[f]!==false)throw new Error(`rsi_outcome_frontier_${l}_${f}_invalid`);if(v?.automatic_retry_allowed!==false)throw new Error(`rsi_outcome_frontier_${l}_retry_invalid`);}
function zero(extra={}){return Object.freeze({...extra,execution_authority:false,browser_authority:false,task_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false});}

function verifyHandoffRow(row){
  if(!row||typeof row!=='object'||Array.isArray(row))throw new Error('rsi_outcome_frontier_handoff_row_invalid');
  const seq=positiveInt(row.handoff_seq,'handoff_seq',1_000_000);
  const handoff=verifyRsiMaterializedCandidateEvaluationHandoff(row.handoff,{
    artifact_receipt:row.artifact_receipt,
    artifact_verification:row.artifact_verification,
  });
  if(row.source_sha!==handoff.source_sha)throw new Error('rsi_outcome_frontier_handoff_row_source_mismatch');
  return Object.freeze({handoff_seq:seq,handoff});
}

function verifyOutcomeEvidence({handoff_row,experiment_intent,experiment_receipt}={}){
  const hr=verifyHandoffRow(handoff_row);
  const intent=verifyRsiCandidateExperimentIntent(experiment_intent);
  const receipt=verifyRsiCandidateExperimentReceipt(experiment_receipt,{intent});
  const handoff=hr.handoff;
  if(intent.source_sha!==handoff.source_sha||receipt.source_sha!==handoff.source_sha)throw new Error('rsi_outcome_frontier_source_mismatch');
  if(intent.request_digest!==handoff.fresh_evaluation_request.request_digest)throw new Error('rsi_outcome_frontier_request_mismatch');
  if(intent.phase28_artifact_receipt_digest!==handoff.phase28_artifact_receipt_digest)throw new Error('rsi_outcome_frontier_artifact_receipt_mismatch');
  if(intent.baseline_artifact_digest!==handoff.parent_artifact_digest||receipt.baseline_artifact_digest!==handoff.parent_artifact_digest)throw new Error('rsi_outcome_frontier_parent_artifact_mismatch');
  if(intent.candidate_artifact_digest!==handoff.candidate_artifact_digest||receipt.candidate_artifact_digest!==handoff.candidate_artifact_digest)throw new Error('rsi_outcome_frontier_candidate_artifact_mismatch');
  if(intent.evaluator_root_digest!==handoff.evaluator_root_digest||receipt.evaluator_root_digest!==handoff.evaluator_root_digest)throw new Error('rsi_outcome_frontier_evaluator_root_mismatch');
  if(intent.evaluator_generation_digest!==handoff.evaluator_generation_digest)throw new Error('rsi_outcome_frontier_evaluator_generation_mismatch');
  if(intent.evaluator_generation_seq!==handoff.evaluator_generation_seq)throw new Error('rsi_outcome_frontier_evaluator_generation_seq_mismatch');
  if(intent.evaluator_generation_history_anchor_digest!==handoff.evaluator_generation_history_anchor_digest)throw new Error('rsi_outcome_frontier_generation_history_anchor_mismatch');
  if(intent.evaluation_epoch_digest!==handoff.evaluation_epoch_digest)throw new Error('rsi_outcome_frontier_evaluation_epoch_mismatch');
  if(intent.evaluation_epoch_seq!==handoff.evaluation_epoch_seq)throw new Error('rsi_outcome_frontier_evaluation_epoch_seq_mismatch');
  if(intent.sealed_task_set_digest!==handoff.sealed_task_set_digest)throw new Error('rsi_outcome_frontier_sealed_tasks_mismatch');
  if(intent.harness_digest!==handoff.evaluation_harness_digest)throw new Error('rsi_outcome_frontier_harness_mismatch');
  if(intent.trial_worker_image_digest!==handoff.trial_worker_image_digest)throw new Error('rsi_outcome_frontier_trial_worker_mismatch');
  if(intent.resource_budget_digest!==handoff.resource_budget_digest)throw new Error('rsi_outcome_frontier_resource_budget_mismatch');
  if(intent.task_order_digest!==handoff.task_order_digest)throw new Error('rsi_outcome_frontier_task_order_mismatch');
  if(intent.threshold_policy_digest!==handoff.acceptance_policy_digest)throw new Error('rsi_outcome_frontier_acceptance_policy_mismatch');
  if(intent.stopping_policy_digest!==handoff.stopping_policy_digest)throw new Error('rsi_outcome_frontier_stopping_policy_mismatch');
  if(intent.hidden_holdout_root_digest!==handoff.hidden_holdout_root_digest)throw new Error('rsi_outcome_frontier_hidden_holdout_mismatch');
  if(intent.safety_suite_root_digest!==handoff.safety_suite_root_digest)throw new Error('rsi_outcome_frontier_safety_suite_mismatch');
  if(intent.security_suite_root_digest!==handoff.security_suite_root_digest)throw new Error('rsi_outcome_frontier_security_suite_mismatch');
  if(!OUTCOME_KIND[receipt.state])throw new Error('rsi_outcome_frontier_outcome_state_invalid');
  return Object.freeze({handoff_seq:hr.handoff_seq,handoff,intent,receipt});
}

function metricGains(receipt){
  return Object.freeze(Object.fromEntries(METRICS.map(k=>[k,receipt.treatment_metrics[k]-receipt.control_metrics[k]])));
}

function acceptanceAttribution(evidence){
  const acceptance=Object.freeze({
    sealed_task_set_digest:exactDigest(evidence.handoff.sealed_task_set_digest,'sealed_task_set'),
    evaluation_harness_digest:exactDigest(evidence.handoff.evaluation_harness_digest,'evaluation_harness'),
    trial_worker_image_digest:exactDigest(evidence.handoff.trial_worker_image_digest,'trial_worker_image'),
    resource_budget_digest:exactDigest(evidence.handoff.resource_budget_digest,'resource_budget'),
    task_order_digest:exactDigest(evidence.handoff.task_order_digest,'task_order'),
    acceptance_policy_digest:exactDigest(evidence.handoff.acceptance_policy_digest,'acceptance_policy'),
    stopping_policy_digest:exactDigest(evidence.handoff.stopping_policy_digest,'stopping_policy'),
    hidden_holdout_root_digest:exactDigest(evidence.handoff.hidden_holdout_root_digest,'hidden_holdout'),
    safety_suite_root_digest:exactDigest(evidence.handoff.safety_suite_root_digest,'safety_suite'),
    security_suite_root_digest:exactDigest(evidence.handoff.security_suite_root_digest,'security_suite'),
  });
  const metric_differential=metricGains(evidence.receipt);
  const acceptance_bundle_digest=digest(acceptance);
  const metric_differential_digest=digest(metric_differential);
  const differential_attribution_digest=digest({
    parent_artifact_digest:evidence.handoff.parent_artifact_digest,
    candidate_artifact_digest:evidence.handoff.candidate_artifact_digest,
    evaluator_root_digest:evidence.handoff.evaluator_root_digest,
    evaluator_generation_digest:evidence.handoff.evaluator_generation_digest,
    evaluator_generation_seq:evidence.handoff.evaluator_generation_seq,
    evaluator_generation_history_anchor_digest:evidence.handoff.evaluator_generation_history_anchor_digest,
    evaluation_epoch_digest:evidence.handoff.evaluation_epoch_digest,
    evaluation_epoch_seq:evidence.handoff.evaluation_epoch_seq,
    acceptance_bundle_digest,
    metric_differential_digest,
    outcome_class:evidence.receipt.state,
  });
  return Object.freeze({acceptance,acceptance_bundle_digest,metric_differential,metric_differential_digest,differential_attribution_digest});
}

function learningFieldsForOutcome(state,input){
  const fields={
    recipe_digest:null,watch_out_digest:null,negative_constraint_digest:null,
    low_yield_constraint_digest:null,environment_diagnostic_digest:null,ambiguity_diagnostic_digest:null,
  };
  if(state==='SUPPORTED_FOR_BOUNDED_REVISION'){
    fields.recipe_digest=exactDigest(input.recipe_digest,'recipe');
    fields.watch_out_digest=exactDigest(input.watch_out_digest,'watch_out');
  }else if(state==='CANDIDATE_EXPERIMENT_REJECTED'){
    fields.negative_constraint_digest=exactDigest(input.negative_constraint_digest,'negative_constraint');
    fields.watch_out_digest=exactDigest(input.watch_out_digest,'watch_out');
  }else if(state==='NO_MATERIAL_IMPROVEMENT'){
    fields.low_yield_constraint_digest=exactDigest(input.low_yield_constraint_digest,'low_yield_constraint');
  }else if(state==='INCONCLUSIVE_ENVIRONMENT'){
    fields.environment_diagnostic_digest=exactDigest(input.environment_diagnostic_digest,'environment_diagnostic');
  }else if(state==='INCONCLUSIVE_AMBIGUOUS'){
    fields.ambiguity_diagnostic_digest=exactDigest(input.ambiguity_diagnostic_digest,'ambiguity_diagnostic');
  }
  return Object.freeze(fields);
}

export function createRsiGenerationScopedOutcomeEntry({
  entry_id,handoff_row,experiment_intent,experiment_receipt,niche_tags,
  summary_digest,applicability_digest,counterevidence_digest,
  recipe_digest=null,watch_out_digest=null,negative_constraint_digest=null,
  low_yield_constraint_digest=null,environment_diagnostic_digest=null,ambiguity_diagnostic_digest=null,
  external_learning_reviewer=false,external_niche_owner=false,authored_by_candidate=true,
}={}){
  if(external_learning_reviewer!==true||external_niche_owner!==true||authored_by_candidate!==false)throw new Error('rsi_outcome_frontier_external_learning_ownership_required');
  const evidence=verifyOutcomeEvidence({handoff_row,experiment_intent,experiment_receipt});
  const outcome=evidence.receipt.state;
  const learning=learningFieldsForOutcome(outcome,{
    recipe_digest,watch_out_digest,negative_constraint_digest,low_yield_constraint_digest,
    environment_diagnostic_digest,ambiguity_diagnostic_digest,
  });
  const niches=tags(niche_tags,'niche_tags');
  const attribution=acceptanceAttribution(evidence);
  const core=zero({
    schema:RSI_GENERATION_SCOPED_OUTCOME_ENTRY_SCHEMA,version:1,
    entry_id:id(entry_id,'entry_id'),source_sha:exactSha(evidence.receipt.source_sha,'source'),
    handoff_seq:evidence.handoff_seq,handoff_digest:evidence.handoff.evaluation_handoff_digest,
    experiment_intent_digest:evidence.intent.intent_digest,experiment_receipt_digest:evidence.receipt.receipt_digest,
    phase28_artifact_receipt_digest:evidence.handoff.phase28_artifact_receipt_digest,
    parent_artifact_digest:evidence.handoff.parent_artifact_digest,candidate_artifact_digest:evidence.handoff.candidate_artifact_digest,
    evaluator_root_digest:evidence.handoff.evaluator_root_digest,
    evaluator_generation_digest:evidence.handoff.evaluator_generation_digest,
    evaluator_generation_seq:evidence.handoff.evaluator_generation_seq,
    evaluator_generation_history_anchor_digest:evidence.handoff.evaluator_generation_history_anchor_digest,
    evaluation_epoch_digest:evidence.handoff.evaluation_epoch_digest,
    evaluation_epoch_seq:evidence.handoff.evaluation_epoch_seq,
    provenance_root_digest:evidence.handoff.provenance_root_digest,
    outcome_class:outcome,learning_kind:OUTCOME_KIND[outcome],
    niche_tags:niches,metric_gains:attribution.metric_differential,
    metric_differential_digest:attribution.metric_differential_digest,
    sealed_acceptance_bundle:attribution.acceptance,
    sealed_acceptance_bundle_digest:attribution.acceptance_bundle_digest,
    differential_attribution_digest:attribution.differential_attribution_digest,
    summary_digest:exactDigest(summary_digest,'summary'),
    applicability_digest:exactDigest(applicability_digest,'applicability'),
    counterevidence_digest:exactDigest(counterevidence_digest,'counterevidence'),
    ...learning,
    external_learning_reviewer:true,external_niche_owner:true,authored_by_candidate:false,
    raw_trajectory_stored:false,raw_hidden_holdout_stored:false,raw_evaluator_assets_stored:false,
    raw_prompt_or_secret_stored:false,source_outcome_receipt_stored:false,
    existing_candidate_experiment_ledger_is_source_of_truth:true,
    exact_external_sequence_binding_required:true,
    sealed_acceptance_differential_attribution_required:true,
    generation_scoped_comparison_only:true,cross_generation_comparison_requires_external_revalidation:true,
    fast_learning_timescale:'GENERATION_SCOPED_EVIDENCE',
    slow_consolidation_requires_external_validation:true,
    slow_consolidation_authorized:false,
    entry_can_mutate_candidate:false,entry_can_change_budget:false,entry_can_schedule_work:false,
    entry_can_promote:false,entry_can_trigger_rollback:false,
  });
  return Object.freeze({...core,entry_digest:digest(core)});
}

export function verifyRsiGenerationScopedOutcomeEntry(row,{handoff_row,experiment_intent,experiment_receipt}={}){
  if(!row||row.schema!==RSI_GENERATION_SCOPED_OUTCOME_ENTRY_SCHEMA||row.version!==1)throw new Error('rsi_outcome_frontier_entry_invalid');
  assertZero(row,'entry');
  if(row.external_learning_reviewer!==true||row.external_niche_owner!==true||row.authored_by_candidate!==false
    ||row.raw_trajectory_stored!==false||row.raw_hidden_holdout_stored!==false||row.raw_evaluator_assets_stored!==false
    ||row.raw_prompt_or_secret_stored!==false||row.source_outcome_receipt_stored!==false
    ||row.existing_candidate_experiment_ledger_is_source_of_truth!==true
    ||row.exact_external_sequence_binding_required!==true||row.sealed_acceptance_differential_attribution_required!==true
    ||row.generation_scoped_comparison_only!==true||row.cross_generation_comparison_requires_external_revalidation!==true
    ||row.fast_learning_timescale!=='GENERATION_SCOPED_EVIDENCE'||row.slow_consolidation_requires_external_validation!==true
    ||row.slow_consolidation_authorized!==false
    ||row.entry_can_mutate_candidate!==false||row.entry_can_change_budget!==false||row.entry_can_schedule_work!==false
    ||row.entry_can_promote!==false||row.entry_can_trigger_rollback!==false)throw new Error('rsi_outcome_frontier_entry_policy_invalid');
  const canonical=createRsiGenerationScopedOutcomeEntry({
    entry_id:row.entry_id,handoff_row,experiment_intent,experiment_receipt,niche_tags:row.niche_tags,
    summary_digest:row.summary_digest,applicability_digest:row.applicability_digest,counterevidence_digest:row.counterevidence_digest,
    recipe_digest:row.recipe_digest,watch_out_digest:row.watch_out_digest,negative_constraint_digest:row.negative_constraint_digest,
    low_yield_constraint_digest:row.low_yield_constraint_digest,environment_diagnostic_digest:row.environment_diagnostic_digest,
    ambiguity_diagnostic_digest:row.ambiguity_diagnostic_digest,
    external_learning_reviewer:true,external_niche_owner:true,authored_by_candidate:false,
  });
  if(canonical.entry_digest!==exactDigest(row.entry_digest,'entry'))throw new Error('rsi_outcome_frontier_entry_digest_mismatch');
  return canonical;
}

function archiveState(sourceSha,rows){
  const counts=Object.freeze(Object.fromEntries(Object.keys(OUTCOME_KIND).map(k=>[k,rows.filter(r=>r.outcome_class===k).length])));
  const generations=[...new Set(rows.map(r=>r.evaluator_generation_digest))].sort();
  const niches=[...new Set(rows.flatMap(r=>r.niche_tags))].sort();
  const core=zero({
    schema:RSI_GENERATION_SCOPED_OUTCOME_ARCHIVE_SCHEMA,version:1,source_sha:sourceSha,
    rows,row_count:rows.length,outcome_counts:counts,generation_count:generations.length,niche_count:niches.length,
    append_only:true,durable_before_visible:true,source_outcome_receipts_stored_here:false,
    external_evidence_resolver_required:true,quality_diverse_frontier:true,scalar_global_winner_forbidden:true,
    exact_external_generation_and_epoch_sequence_required:true,
    sealed_acceptance_differential_attribution_required:true,
    two_timescale_learning_separation_required:true,
    cross_generation_dominance_forbidden:true,old_evidence_remains_addressable:true,
    archive_can_mutate_candidate:false,archive_can_change_budget:false,archive_can_schedule_work:false,
    archive_can_promote:false,archive_can_rollback:false,candidate_can_delete:false,candidate_can_rewrite:false,
  });
  return {...core,state_digest:digest(core)};
}

function dominates(a,b){
  let strict=false;
  for(const k of METRICS){
    if(a.metric_gains[k]<b.metric_gains[k])return false;
    if(a.metric_gains[k]>b.metric_gains[k])strict=true;
  }
  return strict;
}

function frontierRows(rows){
  const supported=rows.filter(r=>r.outcome_class==='SUPPORTED_FOR_BOUNDED_REVISION');
  const groups=new Map();
  for(const row of supported){
    for(const niche of row.niche_tags){
      const key=`${row.evaluator_generation_seq}|${row.evaluation_epoch_seq}|${row.evaluator_generation_digest}|${row.evaluation_epoch_digest}|${niche}`;
      const list=groups.get(key)||[];list.push(row);groups.set(key,list);
    }
  }
  const out=[];
  for(const [key,list] of groups){
    const [generationSeqRaw,epochSeqRaw,generation,epoch,niche]=key.split('|');
    const generationSeq=Number(generationSeqRaw),epochSeq=Number(epochSeqRaw);
    const nondominated=list.filter(candidate=>!list.some(other=>other.entry_digest!==candidate.entry_digest&&dominates(other,candidate)));
    out.push(Object.freeze({
      evaluator_generation_seq:generationSeq,evaluation_epoch_seq:epochSeq,
      evaluator_generation_digest:generation,evaluation_epoch_digest:epoch,niche,
      entry_digests:Object.freeze(nondominated.map(r=>r.entry_digest).sort()),
      scalar_winner:null,
    }));
  }
  return Object.freeze(out.sort((a,b)=>
    a.evaluator_generation_seq-b.evaluator_generation_seq
    ||a.evaluation_epoch_seq-b.evaluation_epoch_seq
    ||a.evaluator_generation_digest.localeCompare(b.evaluator_generation_digest)
    ||a.evaluation_epoch_digest.localeCompare(b.evaluation_epoch_digest)
    ||a.niche.localeCompare(b.niche)));
}

export class RsiGenerationScopedOutcomeArchive{
  #path;#sourceSha;#resolver;#rows=[];#initialized=false;
  constructor({statePath,source_sha,evidenceResolver}={}){
    if(!statePath)throw new Error('rsi_outcome_frontier_archive_path_required');
    if(typeof evidenceResolver!=='function')throw new Error('rsi_outcome_frontier_evidence_resolver_required');
    this.#path=path.resolve(statePath);this.#sourceSha=exactSha(source_sha,'archive_source');this.#resolver=evidenceResolver;
  }
  async init(){
    if(this.#initialized)return this.snapshot();
    await fs.mkdir(path.dirname(this.#path),{recursive:true});
    try{
      const p=JSON.parse(await fs.readFile(this.#path,'utf8'));assertZero(p,'archive');
      if(p.schema!==RSI_GENERATION_SCOPED_OUTCOME_ARCHIVE_SCHEMA||p.version!==1||p.source_sha!==this.#sourceSha
        ||p.append_only!==true||p.durable_before_visible!==true||p.source_outcome_receipts_stored_here!==false
        ||p.external_evidence_resolver_required!==true||p.quality_diverse_frontier!==true||p.scalar_global_winner_forbidden!==true
        ||p.exact_external_generation_and_epoch_sequence_required!==true
        ||p.sealed_acceptance_differential_attribution_required!==true
        ||p.two_timescale_learning_separation_required!==true
        ||p.cross_generation_dominance_forbidden!==true||p.old_evidence_remains_addressable!==true
        ||p.archive_can_mutate_candidate!==false||p.archive_can_change_budget!==false||p.archive_can_schedule_work!==false
        ||p.archive_can_promote!==false||p.archive_can_rollback!==false||p.candidate_can_delete!==false||p.candidate_can_rewrite!==false){
        throw new Error('rsi_outcome_frontier_archive_policy_invalid');
      }
      const clone=structuredClone(p);delete clone.state_digest;
      if(digest(clone)!==exactDigest(p.state_digest,'archive'))throw new Error('rsi_outcome_frontier_archive_digest_mismatch');
      if(!Array.isArray(p.rows)||p.rows.length>MAX_ROWS)throw new Error('rsi_outcome_frontier_archive_rows_invalid');
      const checked=[];const ids=new Set();const receipts=new Set();
      for(const row of p.rows){
        const evidence=await this.#resolver({
          handoff_digest:row.handoff_digest,experiment_intent_digest:row.experiment_intent_digest,
          experiment_receipt_digest:row.experiment_receipt_digest,
        });
        const canonical=verifyRsiGenerationScopedOutcomeEntry(row,evidence||{});
        if(canonical.source_sha!==this.#sourceSha)throw new Error('rsi_outcome_frontier_archive_source_mismatch');
        if(ids.has(canonical.entry_id)||receipts.has(canonical.experiment_receipt_digest))throw new Error('rsi_outcome_frontier_archive_duplicate');
        ids.add(canonical.entry_id);receipts.add(canonical.experiment_receipt_digest);checked.push(canonical);
      }
      const canonical=archiveState(this.#sourceSha,checked);
      if(canonical.row_count!==p.row_count||JSON.stringify(canonical.outcome_counts)!==JSON.stringify(p.outcome_counts)
        ||canonical.generation_count!==p.generation_count||canonical.niche_count!==p.niche_count)throw new Error('rsi_outcome_frontier_archive_summary_mismatch');
      this.#rows=checked;
    }catch(error){if(error?.code!=='ENOENT')throw error;}
    this.#initialized=true;return this.snapshot();
  }
  async #persist(rows){
    const state=archiveState(this.#sourceSha,rows);const tmp=`${this.#path}.tmp`;const h=await fs.open(tmp,'w',0o600);
    try{await h.writeFile(`${JSON.stringify(state)}\n`,'utf8');await h.sync();}finally{await h.close();}
    await fs.rename(tmp,this.#path);
  }
  async add({entry,handoff_row,experiment_intent,experiment_receipt}={}){
    if(!this.#initialized)throw new Error('rsi_outcome_frontier_archive_not_initialized');
    const checked=verifyRsiGenerationScopedOutcomeEntry(entry,{handoff_row,experiment_intent,experiment_receipt});
    if(checked.source_sha!==this.#sourceSha)throw new Error('rsi_outcome_frontier_archive_source_mismatch');
    const existing=this.#rows.find(r=>r.entry_id===checked.entry_id||r.experiment_receipt_digest===checked.experiment_receipt_digest);
    if(existing){
      if(existing.entry_digest!==checked.entry_digest)throw new Error('rsi_outcome_frontier_archive_identity_conflict');
      return zero({state:'IDEMPOTENT',entry_digest:checked.entry_digest});
    }
    if(this.#rows.length>=MAX_ROWS)throw new Error('rsi_outcome_frontier_archive_capacity_exceeded');
    const next=[...this.#rows,checked];await this.#persist(next);this.#rows=next;
    return zero({state:'DERIVED_LEARNING_EVIDENCE_ARCHIVED',entry_digest:checked.entry_digest});
  }
  frontier(){if(!this.#initialized)throw new Error('rsi_outcome_frontier_archive_not_initialized');return frontierRows(this.#rows);}
  entries(){if(!this.#initialized)throw new Error('rsi_outcome_frontier_archive_not_initialized');return Object.freeze(this.#rows.map(r=>Object.freeze(structuredClone(r))));}
  nicheStats(){
    if(!this.#initialized)throw new Error('rsi_outcome_frontier_archive_not_initialized');
    const map=new Map();
    for(const row of this.#rows)for(const niche of row.niche_tags){
      const x=map.get(niche)||{niche,total:0,supported:0,rejected:0,no_material_improvement:0,inconclusive_environment:0,inconclusive_ambiguous:0};
      x.total+=1;
      if(row.outcome_class==='SUPPORTED_FOR_BOUNDED_REVISION')x.supported+=1;
      if(row.outcome_class==='CANDIDATE_EXPERIMENT_REJECTED')x.rejected+=1;
      if(row.outcome_class==='NO_MATERIAL_IMPROVEMENT')x.no_material_improvement+=1;
      if(row.outcome_class==='INCONCLUSIVE_ENVIRONMENT')x.inconclusive_environment+=1;
      if(row.outcome_class==='INCONCLUSIVE_AMBIGUOUS')x.inconclusive_ambiguous+=1;
      map.set(niche,x);
    }
    return Object.freeze([...map.values()].sort((a,b)=>a.niche.localeCompare(b.niche)).map(x=>Object.freeze({...x,budget_recommendation:null,automatic_plasticity_change_authorized:false})));
  }
  snapshot(){
    const s=archiveState(this.#sourceSha,this.#rows);
    return Object.freeze({schema:s.schema,version:s.version,source_sha:s.source_sha,initialized:this.#initialized,row_count:s.row_count,
      outcome_counts:s.outcome_counts,generation_count:s.generation_count,niche_count:s.niche_count,append_only:true,durable_before_visible:true,
      source_outcome_receipts_stored_here:false,external_evidence_resolver_required:true,quality_diverse_frontier:true,
      scalar_global_winner_forbidden:true,exact_external_generation_and_epoch_sequence_required:true,
      sealed_acceptance_differential_attribution_required:true,two_timescale_learning_separation_required:true,
      cross_generation_dominance_forbidden:true,old_evidence_remains_addressable:true,
      archive_can_mutate_candidate:false,archive_can_change_budget:false,archive_can_schedule_work:false,archive_can_promote:false,
      archive_can_rollback:false,authority_effect:false});
  }
}

export function rsiGenerationScopedOutcomeFrontierTrustRootSnapshot(){
  const root={
    schema:'metaengine.rsi.generation-scoped-outcome-frontier-root.v1',version:1,
    existing_candidate_experiment_ledger_is_only_outcome_truth:true,
    source_outcome_receipts_not_duplicated:true,external_evidence_resolver_required:true,
    phase29_handoff_binding_required:true,evaluator_generation_binding_required:true,evaluation_epoch_binding_required:true,
    exact_evaluator_generation_sequence_binding_required:true,exact_evaluation_epoch_sequence_binding_required:true,
    evaluator_generation_history_anchor_binding_required:true,
    sealed_acceptance_differential_attribution_required:true,
    supported_recipe_candidate_only:true,rejected_negative_constraint_only:true,no_improvement_low_yield_constraint_only:true,
    environment_inconclusive_diagnostic_only:true,ambiguity_diagnostic_only:true,
    raw_trajectory_storage_forbidden:true,hidden_holdout_copy_forbidden:true,evaluator_asset_copy_forbidden:true,
    external_learning_reviewer_required:true,external_niche_owner_required:true,
    quality_diverse_frontier_required:true,scalar_global_winner_forbidden:true,cross_generation_dominance_forbidden:true,
    fast_generation_evidence_and_slow_consolidation_separation_required:true,
    slow_consolidation_requires_external_validation:true,
    external_revalidation_required_for_cross_generation_comparison:true,old_evidence_remains_addressable:true,
    maturity_stats_advisory_only:true,automatic_plasticity_change_authorized:false,
    archive_can_mutate_candidate:false,archive_can_change_budget:false,archive_can_schedule_work:false,
    archive_can_promote:false,archive_can_rollback:false,execution_authority:false,browser_authority:false,
    task_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...root,outcome_frontier_root_digest:digest(root)});
}
