import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { verifyRsiRuntimeMetaSkillRecord } from './rsi-runtime-meta-skill-archive.mjs';
import {
  RSI_RISK_SPENDING_POLICIES,
  createRsiRecursiveRiskBudget,
  verifyRsiRecursiveRiskBudget,
  rsiRiskAllocationForConfirmation,
} from './rsi-recursive-risk-budget.mjs';

export const RSI_META_PROFILE_SHADOW_PLAN_SCHEMA='metaengine.rsi.meta-profile-shadow-plan.v1';
export const RSI_META_PROFILE_PAIR_RECEIPT_SCHEMA='metaengine.rsi.meta-profile-pair-receipt.v1';
export const RSI_META_PROFILE_SHADOW_RESULT_SCHEMA='metaengine.rsi.meta-profile-shadow-result.v1';
export const RSI_META_PROFILE_STAT_CERT_SCHEMA='metaengine.rsi.meta-profile-statistical-certificate.v1';
export const RSI_META_PROFILE_QUALIFICATION_SCHEMA='metaengine.rsi.meta-profile-qualification.v1';
export const RSI_META_PROFILE_QUALIFICATION_LEDGER_SCHEMA='metaengine.rsi.meta-profile-qualification-ledger.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const PAIR_COUNT=7;
const MAX_ROWS=1024;
const EPS=1e-12;
const META_PROFILE_RISK_BUDGET=createRsiRecursiveRiskBudget({
  budget_id:'rsi.meta-profile.activation.risk.v1',
  global_alpha:0.05,
  spending_policy:RSI_RISK_SPENDING_POLICIES.TELESCOPING_ANYTIME,
  evidence_family:'RSI_META_PROFILE_ACTIVATION',
});

function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]))}
function digest(v){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`}
function exactSha(v,l){const x=String(v||'').trim().toLowerCase();if(!SHA40_RE.test(x))throw new Error(`rsi_meta_profile_${l}_sha_invalid`);return x}
function exactDigest(v,l){const x=String(v||'').trim().toLowerCase();if(!SHA256_RE.test(x))throw new Error(`rsi_meta_profile_${l}_digest_invalid`);return x}
function boundedId(v,l){const x=String(v||'').trim();if(!SAFE_ID_RE.test(x))throw new Error(`rsi_meta_profile_${l}_invalid`);return x}
function finite(v,l){const n=Number(v);if(!Number.isFinite(n))throw new Error(`rsi_meta_profile_${l}_invalid`);return n}
function assertZero(v,l){for(const f of ['execution_authority','production_mutation_authority','promotion_authority','self_update_authority','scheduler_authority','authority_effect'])if(v?.[f]!==false)throw new Error(`rsi_meta_profile_${l}_${f}_invalid`);if(v?.automatic_retry_allowed!==false)throw new Error(`rsi_meta_profile_${l}_retry_invalid`)}
function zero(extra={}){return Object.freeze({...extra,execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false})}

function objectiveSpec(record){
  const spec=record?.evaluation?.objective_spec;
  if(!Array.isArray(spec)||spec.length<1)throw new Error('rsi_meta_profile_objective_spec_invalid');
  return Object.freeze(spec.map(row=>Object.freeze({
    metric:boundedId(row.metric,'objective_metric'),
    direction:String(row.direction||'').toUpperCase(),
    materiality_threshold:finite(row.materiality_threshold,'materiality_threshold'),
  })).sort((a,b)=>a.metric.localeCompare(b.metric)));
}
function metricMap(value,spec,label){
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(`rsi_meta_profile_${label}_metrics_invalid`);
  const keys=Object.keys(value).sort(), expected=spec.map(x=>x.metric).sort();
  if(keys.length!==expected.length||keys.some((k,i)=>k!==expected[i]))throw new Error(`rsi_meta_profile_${label}_metrics_shape_invalid`);
  return Object.freeze(Object.fromEntries(expected.map(k=>[k,finite(value[k],`${label}_metric`)])));
}
function median(values){
  const xs=[...values].sort((a,b)=>a-b);const mid=Math.floor(xs.length/2);
  return xs.length%2?xs[mid]:(xs[mid-1]+xs[mid])/2;
}
function schedule(recordDigest,holdout){
  const seeds=[];const order=[];
  for(let i=0;i<PAIR_COUNT;i++){
    const h=crypto.createHash('sha256').update(`${recordDigest}|${holdout}|${i+1}`,'utf8').digest();
    seeds.push(h.readUInt32BE(0));
    order.push((h[4]&1)===0?'PARENT_FIRST':'SUCCESSOR_FIRST');
  }
  return Object.freeze({seeds:Object.freeze(seeds),order:Object.freeze(order)});
}

export function createRsiMetaProfileShadowPlan({
  plan_id,meta_record,activation_holdout_digest,evaluator_root_digest,
  external_plan_owner=false,authored_by_candidate=true,
}={}){
  const record=verifyRsiRuntimeMetaSkillRecord(meta_record);
  if(record.eligible_for_meta_archive!==true)throw new Error('rsi_meta_profile_meta_archive_eligibility_required');
  if(external_plan_owner!==true||authored_by_candidate!==false)throw new Error('rsi_meta_profile_external_plan_owner_required');
  const holdout=exactDigest(activation_holdout_digest,'activation_holdout');
  const fast=exactDigest(record.fast_loop_summary.fast_holdout_digest,'fast_holdout');
  const slow=exactDigest(record.plan.meta_holdout_digest,'meta_holdout');
  if(holdout===fast||holdout===slow)throw new Error('rsi_meta_profile_activation_holdout_alias');
  const evaluator=exactDigest(evaluator_root_digest,'evaluator_root');
  const sched=schedule(record.record_digest,holdout);
  const core={
    schema:RSI_META_PROFILE_SHADOW_PLAN_SCHEMA,version:1,
    source_sha:exactSha(record.source_sha,'source'),
    plan_id:boundedId(plan_id,'plan_id'),
    meta_record_digest:record.record_digest,
    parent_profile_digest:record.parent_profile_digest,
    successor_profile_digest:record.successor_profile_digest,
    library_digest:record.library_digest,
    activation_holdout_digest:holdout,
    evaluator_root_digest:evaluator,
    objective_spec:objectiveSpec(record),
    pair_count:PAIR_COUNT,
    precommitted_seed_schedule:sched.seeds,
    precommitted_order_schedule:sched.order,
    exact_pair_count_required:true,
    early_stop_allowed:false,
    paired_shadow_required:true,
    independent_activation_holdout_required:true,
    activation_holdout_distinct_from_fast_and_meta:true,
    scalar_winner_authoritative:false,
    candidate_can_choose_pair_count:false,
    candidate_can_choose_holdout:false,
    candidate_can_choose_seed_schedule:false,
    direct_profile_activation_allowed:false,
    plan_is_execution_authority:false,
    external_plan_owner:true,authored_by_candidate:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...core,plan_digest:digest(core)});
}

export function verifyRsiMetaProfileShadowPlan(plan,metaRecord){
  if(!plan||plan.schema!==RSI_META_PROFILE_SHADOW_PLAN_SCHEMA||plan.version!==1)throw new Error('rsi_meta_profile_shadow_plan_invalid');
  assertZero(plan,'plan');
  if(plan.exact_pair_count_required!==true||plan.early_stop_allowed!==false||plan.paired_shadow_required!==true
    ||plan.independent_activation_holdout_required!==true||plan.activation_holdout_distinct_from_fast_and_meta!==true
    ||plan.scalar_winner_authoritative!==false||plan.candidate_can_choose_pair_count!==false
    ||plan.candidate_can_choose_holdout!==false||plan.candidate_can_choose_seed_schedule!==false
    ||plan.direct_profile_activation_allowed!==false||plan.plan_is_execution_authority!==false
    ||plan.external_plan_owner!==true||plan.authored_by_candidate!==false)throw new Error('rsi_meta_profile_shadow_plan_policy_invalid');
  const canonical=createRsiMetaProfileShadowPlan({
    plan_id:plan.plan_id,meta_record:metaRecord,activation_holdout_digest:plan.activation_holdout_digest,
    evaluator_root_digest:plan.evaluator_root_digest,external_plan_owner:true,authored_by_candidate:false,
  });
  if(canonical.plan_digest!==exactDigest(plan.plan_digest,'plan'))throw new Error('rsi_meta_profile_shadow_plan_digest_mismatch');
  return canonical;
}

export function createRsiMetaProfilePairReceipt({
  plan,meta_record,pair_index,order,seed,parent_metrics,successor_metrics,
  hard_invariants_pass,evidence_digest,evidence_refs,external_evaluator=false,authored_by_candidate=true,
}={}){
  const record=verifyRsiRuntimeMetaSkillRecord(meta_record);
  const checked=verifyRsiMetaProfileShadowPlan(plan,record);
  if(external_evaluator!==true||authored_by_candidate!==false)throw new Error('rsi_meta_profile_external_evaluator_required');
  const index=Number(pair_index);if(!Number.isSafeInteger(index)||index<1||index>PAIR_COUNT)throw new Error('rsi_meta_profile_pair_index_invalid');
  if(order!==checked.precommitted_order_schedule[index-1])throw new Error('rsi_meta_profile_pair_order_mismatch');
  if(Number(seed)!==checked.precommitted_seed_schedule[index-1])throw new Error('rsi_meta_profile_pair_seed_mismatch');
  const refs=Array.isArray(evidence_refs)?[...new Set(evidence_refs.map(x=>boundedId(x,'evidence_ref')))].sort():[];
  if(refs.length<1||refs.length!==evidence_refs.length)throw new Error('rsi_meta_profile_evidence_refs_invalid');
  const core={
    schema:RSI_META_PROFILE_PAIR_RECEIPT_SCHEMA,version:1,
    plan_id:checked.plan_id,plan_digest:checked.plan_digest,meta_record_digest:record.record_digest,
    pair_index:index,order,seed:Number(seed),
    parent_metrics:metricMap(parent_metrics,checked.objective_spec,'parent'),
    successor_metrics:metricMap(successor_metrics,checked.objective_spec,'successor'),
    hard_invariants_pass:hard_invariants_pass===true,
    evidence_digest:exactDigest(evidence_digest,'pair_evidence'),
    evidence_refs:Object.freeze(refs),
    external_evaluator:true,authored_by_candidate:false,
    receipt_is_profile_activation_authority:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...core,receipt_digest:digest(core)});
}
export function verifyRsiMetaProfilePairReceipt(row,plan,record){
  if(!row||row.schema!==RSI_META_PROFILE_PAIR_RECEIPT_SCHEMA||row.version!==1)throw new Error('rsi_meta_profile_pair_receipt_invalid');
  assertZero(row,'pair');
  if(row.external_evaluator!==true||row.authored_by_candidate!==false||row.receipt_is_profile_activation_authority!==false)throw new Error('rsi_meta_profile_pair_policy_invalid');
  const c=createRsiMetaProfilePairReceipt({
    plan,meta_record:record,pair_index:row.pair_index,order:row.order,seed:row.seed,parent_metrics:row.parent_metrics,
    successor_metrics:row.successor_metrics,hard_invariants_pass:row.hard_invariants_pass,evidence_digest:row.evidence_digest,
    evidence_refs:row.evidence_refs,external_evaluator:true,authored_by_candidate:false,
  });
  if(c.receipt_digest!==exactDigest(row.receipt_digest,'pair'))throw new Error('rsi_meta_profile_pair_digest_mismatch');
  return c;
}

export function evaluateRsiMetaProfileShadow({plan,meta_record,receipts}={}){
  const record=verifyRsiRuntimeMetaSkillRecord(meta_record);
  const checked=verifyRsiMetaProfileShadowPlan(plan,record);
  if(!Array.isArray(receipts)||receipts.length!==PAIR_COUNT)throw new Error('rsi_meta_profile_exact_pair_count_required');
  const rows=receipts.map(r=>verifyRsiMetaProfilePairReceipt(r,checked,record)).sort((a,b)=>a.pair_index-b.pair_index);
  rows.forEach((r,i)=>{if(r.pair_index!==i+1)throw new Error('rsi_meta_profile_pair_sequence_invalid')});
  const spec=checked.objective_spec;
  const objectives=spec.map(obj=>{
    const parentMedian=median(rows.map(r=>r.parent_metrics[obj.metric]));
    const successorMedian=median(rows.map(r=>r.successor_metrics[obj.metric]));
    const signed=obj.direction==='MAXIMIZE'?successorMedian-parentMedian:parentMedian-successorMedian;
    const status=signed>obj.materiality_threshold?'IMPROVED':signed<-obj.materiality_threshold?'REGRESSED':'EQUIVALENT';
    return Object.freeze({metric:obj.metric,direction:obj.direction,materiality_threshold:obj.materiality_threshold,parent_median:parentMedian,successor_median:successorMedian,signed_successor_gain:signed,status});
  });
  const hardPass=rows.every(r=>r.hard_invariants_pass===true);
  const improved=objectives.filter(x=>x.status==='IMPROVED').length;
  const regressed=objectives.filter(x=>x.status==='REGRESSED').length;
  const relation=!hardPass?'REJECTED_HARD_INVARIANT':improved>0&&regressed===0?'PARETO_ADVANCE':improved>0&&regressed>0?'TRADEOFF_STEPPING_STONE':regressed>0?'DOMINATED_REGRESSION':'NO_MEASURED_ADVANCE';
  const eligible=relation==='PARETO_ADVANCE';
  const core={
    schema:RSI_META_PROFILE_SHADOW_RESULT_SCHEMA,version:1,
    plan_digest:checked.plan_digest,meta_record_digest:record.record_digest,
    parent_profile_digest:record.parent_profile_digest,successor_profile_digest:record.successor_profile_digest,
    activation_holdout_digest:checked.activation_holdout_digest,evaluator_root_digest:checked.evaluator_root_digest,
    pair_count:rows.length,receipt_digests:Object.freeze(rows.map(r=>r.receipt_digest)),
    objectives:Object.freeze(objectives),hard_invariants_pass:hardPass,relation,
    eligible_for_statistical_confirmation:eligible,
    tradeoff_is_not_activation_eligible:true,
    scalar_winner_authoritative:false,
    direct_profile_activation_allowed:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...core,result_digest:digest(core)});
}

export function verifyRsiMetaProfileShadowResult(result,{plan,meta_record,receipts}={}){
  if(!result||result.schema!==RSI_META_PROFILE_SHADOW_RESULT_SCHEMA||result.version!==1)throw new Error('rsi_meta_profile_shadow_result_invalid');
  assertZero(result,'shadow_result');
  const canonical=evaluateRsiMetaProfileShadow({plan,meta_record,receipts});
  if(canonical.result_digest!==exactDigest(result.result_digest,'shadow_result'))throw new Error('rsi_meta_profile_shadow_result_digest_mismatch');
  return canonical;
}

export function createRsiMetaProfileStatisticalCertificate({
  certificate_id,budget,confirmation_index,meta_record,shadow_plan,shadow_result,receipts,
  alpha_used,superiority_certified,method='EXTERNAL_PAIRED_ANYTIME_VALID_TEST',
  sample_count,evidence_refs,external_verifier=false,authored_by_candidate=true,
}={}){
  const record=verifyRsiRuntimeMetaSkillRecord(meta_record);
  const plan=verifyRsiMetaProfileShadowPlan(shadow_plan,record);
  const verifiedShadow=verifyRsiMetaProfileShadowResult(shadow_result,{plan,meta_record:record,receipts});
  if(verifiedShadow.eligible_for_statistical_confirmation!==true)throw new Error('rsi_meta_profile_shadow_pass_required');
  if(external_verifier!==true||authored_by_candidate!==false)throw new Error('rsi_meta_profile_external_stat_verifier_required');
  const checkedBudget=verifyRsiRecursiveRiskBudget(budget);
  if(checkedBudget.budget_digest!==META_PROFILE_RISK_BUDGET.budget_digest)throw new Error('rsi_meta_profile_fixed_risk_budget_required');
  const index=Number(confirmation_index);if(!Number.isSafeInteger(index)||index<1)throw new Error('rsi_meta_profile_confirmation_index_invalid');
  const allocated=rsiRiskAllocationForConfirmation(checkedBudget,index);
  const used=Number(alpha_used);if(!Number.isFinite(used)||used<=0||used-allocated>EPS)throw new Error('rsi_meta_profile_alpha_over_budget');
  const refs=Array.isArray(evidence_refs)?[...new Set(evidence_refs.map(x=>boundedId(x,'evidence_ref')))].sort():[];
  if(refs.length<1||refs.length!==evidence_refs.length)throw new Error('rsi_meta_profile_stat_evidence_refs_invalid');
  const core={
    schema:RSI_META_PROFILE_STAT_CERT_SCHEMA,version:1,
    certificate_id:boundedId(certificate_id,'certificate_id'),
    budget_id:checkedBudget.budget_id,budget_digest:checkedBudget.budget_digest,
    confirmation_index:index,allocated_alpha:allocated,alpha_used:used,
    source_sha:exactSha(record.source_sha,'source'),
    meta_record_digest:record.record_digest,shadow_plan_digest:plan.plan_digest,shadow_result_digest:verifiedShadow.result_digest,
    successor_profile_digest:record.successor_profile_digest,activation_holdout_digest:plan.activation_holdout_digest,
    evaluator_root_digest:plan.evaluator_root_digest,method:boundedId(method,'method'),
    superiority_certified:superiority_certified===true,sample_count:Number(sample_count),
    evidence_refs:Object.freeze(refs),external_verifier:true,authored_by_candidate:false,
    paired_evaluation:true,independent_holdout:true,stopping_rule_precommitted:true,optional_stopping_used:false,
    screening_spent_alpha:false,certificate_is_profile_activation_authority:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  if(!Number.isSafeInteger(core.sample_count)||core.sample_count<PAIR_COUNT)throw new Error('rsi_meta_profile_sample_count_invalid');
  return Object.freeze({...core,certificate_digest:digest(core)});
}

export function verifyRsiMetaProfileStatisticalCertificate(certificate,{
  budget,confirmation_index,meta_record,shadow_plan,shadow_result,receipts,
}={}){
  if(!certificate||certificate.schema!==RSI_META_PROFILE_STAT_CERT_SCHEMA||certificate.version!==1)throw new Error('rsi_meta_profile_certificate_invalid');
  assertZero(certificate,'certificate');
  if(certificate.external_verifier!==true||certificate.authored_by_candidate!==false
    ||certificate.paired_evaluation!==true||certificate.independent_holdout!==true
    ||certificate.stopping_rule_precommitted!==true||certificate.optional_stopping_used!==false
    ||certificate.screening_spent_alpha!==false||certificate.certificate_is_profile_activation_authority!==false){
    throw new Error('rsi_meta_profile_certificate_policy_invalid');
  }
  const canonical=createRsiMetaProfileStatisticalCertificate({
    certificate_id:certificate.certificate_id,budget,confirmation_index,
    meta_record,shadow_plan,shadow_result,receipts,
    alpha_used:certificate.alpha_used,superiority_certified:certificate.superiority_certified,
    method:certificate.method,sample_count:certificate.sample_count,evidence_refs:certificate.evidence_refs,
    external_verifier:true,authored_by_candidate:false,
  });
  if(canonical.certificate_digest!==exactDigest(certificate.certificate_digest,'certificate'))throw new Error('rsi_meta_profile_certificate_digest_mismatch');
  return canonical;
}

export function createRsiMetaProfileQualification({
  qualification_id,meta_record,shadow_plan,shadow_result,receipts,budget,certificate,confirmation_index,
}={}){
  const record=verifyRsiRuntimeMetaSkillRecord(meta_record);
  const plan=verifyRsiMetaProfileShadowPlan(shadow_plan,record);
  const verifiedShadow=verifyRsiMetaProfileShadowResult(shadow_result,{plan,meta_record:record,receipts});
  if(verifiedShadow.eligible_for_statistical_confirmation!==true)throw new Error('rsi_meta_profile_shadow_result_not_eligible');
  const checkedCertificate=verifyRsiMetaProfileStatisticalCertificate(certificate,{
    budget,confirmation_index,meta_record:record,shadow_plan:plan,shadow_result:verifiedShadow,receipts,
  });
  if(checkedCertificate.meta_record_digest!==record.record_digest||checkedCertificate.shadow_plan_digest!==plan.plan_digest
    ||checkedCertificate.shadow_result_digest!==verifiedShadow.result_digest)throw new Error('rsi_meta_profile_certificate_binding_invalid');
  const pass=checkedCertificate.superiority_certified===true;
  const core={
    schema:RSI_META_PROFILE_QUALIFICATION_SCHEMA,version:1,
    source_sha:exactSha(record.source_sha,'source'),
    qualification_id:boundedId(qualification_id,'qualification_id'),
    meta_record_digest:record.record_digest,parent_profile_digest:record.parent_profile_digest,
    successor_profile_digest:record.successor_profile_digest,shadow_plan_digest:plan.plan_digest,
    shadow_result_digest:verifiedShadow.result_digest,certificate_digest:checkedCertificate.certificate_digest,
    risk_budget_digest:checkedCertificate.budget_digest,
    confirmation_index:checkedCertificate.confirmation_index,
    allocated_alpha:checkedCertificate.allocated_alpha,
    alpha_used:checkedCertificate.alpha_used,
    global_alpha:META_PROFILE_RISK_BUDGET.global_alpha,
    state:pass?'QUALIFIED_FOR_SHADOW_PROFILE_SELECTION':'STATISTICAL_CONFIRMATION_REJECTED',
    qualified_for_shadow_profile_selection:pass,
    live_profile_activation_authorized:false,profile_replacement_authorized:false,
    canary_activation_authorized:false,external_activation_gate_still_required:true,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...core,qualification_digest:digest(core)});
}

function ledgerState(sourceSha,rows){
  const cumulative=rows.reduce((sum,row)=>sum+Number(row.alpha_used||0),0);
  const nextIndex=rows.length+1;
  const core={schema:RSI_META_PROFILE_QUALIFICATION_LEDGER_SCHEMA,version:1,source_sha:sourceSha,
    fixed_risk_budget:META_PROFILE_RISK_BUDGET,fixed_risk_budget_digest:META_PROFILE_RISK_BUDGET.budget_digest,
    rows,row_count:rows.length,qualified_count:rows.filter(x=>x.qualified_for_shadow_profile_selection===true).length,
    cumulative_alpha_spent:cumulative,global_alpha:META_PROFILE_RISK_BUDGET.global_alpha,
    next_confirmation_index:nextIndex,next_confirmation_alpha_allocation:rsiRiskAllocationForConfirmation(META_PROFILE_RISK_BUDGET,nextIndex),
    append_only:true,active_profile_digest:null,shadow_profile_digest:null,ledger_can_activate_profile:false,
    candidate_can_delete_rows:false,candidate_can_rewrite_rows:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false};
  return {...core,state_digest:digest(core)};
}
export class RsiMetaProfileQualificationLedger{
  #path;#sourceSha;#rows=[];#initialized=false;
  constructor({statePath,source_sha}={}){if(!statePath)throw new Error('rsi_meta_profile_ledger_path_required');this.#path=path.resolve(statePath);this.#sourceSha=exactSha(source_sha,'source')}
  async init(){if(this.#initialized)return this.snapshot();await fs.mkdir(path.dirname(this.#path),{recursive:true});try{const p=JSON.parse(await fs.readFile(this.#path,'utf8'));assertZero(p,'ledger');if(p.schema!==RSI_META_PROFILE_QUALIFICATION_LEDGER_SCHEMA||p.version!==1||p.source_sha!==this.#sourceSha
        ||p.fixed_risk_budget_digest!==META_PROFILE_RISK_BUDGET.budget_digest||p.append_only!==true||p.ledger_can_activate_profile!==false)throw new Error('rsi_meta_profile_ledger_state_invalid');const clone=structuredClone(p);delete clone.state_digest;if(digest(clone)!==exactDigest(p.state_digest,'ledger'))throw new Error('rsi_meta_profile_ledger_digest_mismatch');if(!Array.isArray(p.rows)||p.rows.length>MAX_ROWS)throw new Error('rsi_meta_profile_ledger_rows_invalid');let cumulative=0;
      for(let i=0;i<p.rows.length;i++){
        const row=p.rows[i];
        if(row.source_sha!==this.#sourceSha)throw new Error('rsi_meta_profile_ledger_row_source_mismatch');
        const rc=structuredClone(row);delete rc.qualification_digest;
        if(digest(rc)!==exactDigest(row.qualification_digest,'qualification'))throw new Error('rsi_meta_profile_ledger_row_digest_mismatch');
        if(row.risk_budget_digest!==META_PROFILE_RISK_BUDGET.budget_digest||row.confirmation_index!==i+1)throw new Error('rsi_meta_profile_ledger_risk_sequence_invalid');
        const allocated=rsiRiskAllocationForConfirmation(META_PROFILE_RISK_BUDGET,i+1);
        if(Number(row.alpha_used)<=0||Number(row.alpha_used)-allocated>EPS)throw new Error('rsi_meta_profile_ledger_alpha_invalid');
        cumulative+=Number(row.alpha_used);
        if(cumulative-META_PROFILE_RISK_BUDGET.global_alpha>EPS)throw new Error('rsi_meta_profile_ledger_global_alpha_exhausted');
      }
      this.#rows=p.rows}catch(e){if(e?.code!=='ENOENT')throw e}this.#initialized=true;return this.snapshot()}
  async #persist(){const s=ledgerState(this.#sourceSha,this.#rows);const t=`${this.#path}.tmp`;const h=await fs.open(t,'w',0o600);try{await h.writeFile(`${JSON.stringify(s)}\n`,'utf8');await h.sync()}finally{await h.close()}await fs.rename(t,this.#path)}
  async add(q){if(!this.#initialized)throw new Error('rsi_meta_profile_ledger_not_initialized');if(!q||q.schema!==RSI_META_PROFILE_QUALIFICATION_SCHEMA)throw new Error('rsi_meta_profile_qualification_invalid');assertZero(q,'qualification');if(q.source_sha!==this.#sourceSha)throw new Error('rsi_meta_profile_qualification_source_mismatch');const clone=structuredClone(q);delete clone.qualification_digest;if(digest(clone)!==exactDigest(q.qualification_digest,'qualification'))throw new Error('rsi_meta_profile_qualification_digest_mismatch');if(q.risk_budget_digest!==META_PROFILE_RISK_BUDGET.budget_digest)throw new Error('rsi_meta_profile_fixed_risk_budget_required');const existing=this.#rows.find(x=>x.qualification_id===q.qualification_id||x.meta_record_digest===q.meta_record_digest);if(existing){if(existing.qualification_digest!==q.qualification_digest)throw new Error('rsi_meta_profile_qualification_conflict');return zero({state:'IDEMPOTENT',qualification_digest:q.qualification_digest})}const expectedIndex=this.#rows.length+1;if(q.confirmation_index!==expectedIndex)throw new Error('rsi_meta_profile_confirmation_index_out_of_sequence');const allocated=rsiRiskAllocationForConfirmation(META_PROFILE_RISK_BUDGET,expectedIndex);if(Number(q.alpha_used)<=0||Number(q.alpha_used)-allocated>EPS)throw new Error('rsi_meta_profile_alpha_over_budget');const cumulative=this.#rows.reduce((sum,row)=>sum+Number(row.alpha_used),0)+Number(q.alpha_used);if(cumulative-META_PROFILE_RISK_BUDGET.global_alpha>EPS)throw new Error('rsi_meta_profile_global_alpha_exhausted');if(this.#rows.length>=MAX_ROWS)throw new Error('rsi_meta_profile_ledger_capacity_exceeded');this.#rows.push(structuredClone(q));await this.#persist();return zero({state:q.state,qualification_digest:q.qualification_digest})}
  qualified(){if(!this.#initialized)throw new Error('rsi_meta_profile_ledger_not_initialized');return Object.freeze(this.#rows.filter(x=>x.qualified_for_shadow_profile_selection===true).map(x=>Object.freeze(structuredClone(x))))}
  snapshot(){const s=ledgerState(this.#sourceSha,this.#rows);return Object.freeze({schema:s.schema,version:s.version,source_sha:s.source_sha,initialized:this.#initialized,row_count:s.row_count,qualified_count:s.qualified_count,fixed_risk_budget_digest:s.fixed_risk_budget_digest,cumulative_alpha_spent:s.cumulative_alpha_spent,global_alpha:s.global_alpha,next_confirmation_index:s.next_confirmation_index,next_confirmation_alpha_allocation:s.next_confirmation_alpha_allocation,append_only:true,active_profile_digest:null,shadow_profile_digest:null,ledger_can_activate_profile:false,authority_effect:false})}
}

export function rsiMetaProfileRiskBudgetSnapshot(){
  return META_PROFILE_RISK_BUDGET;
}

export function rsiMetaProfileQualificationTrustRootSnapshot(){
  const root={schema:'metaengine.rsi.meta-profile-qualification-root.v1',version:1,
    exact_meta_archive_record_required:true,source_sha_fencing_required:true,independent_activation_holdout_required:true,pair_count:PAIR_COUNT,
    paired_shadow_required:true,early_stop_allowed:false,recursive_risk_budget_reused:true,
    fixed_risk_budget_digest:META_PROFILE_RISK_BUDGET.budget_digest,global_alpha:META_PROFILE_RISK_BUDGET.global_alpha,
    confirmation_index_ledger_owned:true,cumulative_alpha_enforced:true,
    external_statistical_verifier_required:true,tradeoff_is_not_activation_eligible:true,
    candidate_can_choose_pair_count:false,candidate_can_choose_holdout:false,candidate_can_choose_seed_schedule:false,
    qualification_only_for_shadow_profile_selection:true,live_profile_activation_authorized:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false};
  return Object.freeze({...root,qualification_root_digest:digest(root)});
}
