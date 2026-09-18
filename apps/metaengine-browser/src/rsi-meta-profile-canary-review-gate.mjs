import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  RSI_RISK_SPENDING_POLICIES,
  createRsiRecursiveRiskBudget,
  verifyRsiRecursiveRiskBudget,
  rsiRiskAllocationForConfirmation,
} from './rsi-recursive-risk-budget.mjs';
import { verifyRsiSelectedShadowContextBinding } from './rsi-selected-shadow-context-binding.mjs';
import { verifyRsiSelectedShadowComparisonObservation } from './rsi-selected-shadow-comparison-evidence.mjs';

export const RSI_META_PROFILE_CANARY_REVIEW_CERT_SCHEMA='metaengine.rsi.meta-profile-canary-review-certificate.v1';
export const RSI_META_PROFILE_CANARY_REVIEW_SCHEMA='metaengine.rsi.meta-profile-canary-review.v1';
export const RSI_META_PROFILE_CANARY_REVIEW_LEDGER_SCHEMA='metaengine.rsi.meta-profile-canary-review-ledger.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const MIN_OBSERVATIONS=8;
const MAX_ROWS=1024;
const EPS=1e-12;
const CERT_METHODS=new Set(['E_VALUE_EXTERNAL_V1','PAIRED_CONFIDENCE_SEQUENCE_EXTERNAL_V1']);
const RISK_BUDGET=createRsiRecursiveRiskBudget({
  budget_id:'rsi.meta-profile.canary-review.risk.v1',
  global_alpha:0.01,
  spending_policy:RSI_RISK_SPENDING_POLICIES.TELESCOPING_ANYTIME,
  evidence_family:'RSI_META_PROFILE_CANARY_REVIEW',
});

function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]))}
function digest(v){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`}
function exactSha(v,l){const x=String(v||'').trim().toLowerCase();if(!SHA40_RE.test(x))throw new Error(`rsi_canary_review_${l}_sha_invalid`);return x}
function exactDigest(v,l){const x=String(v||'').trim().toLowerCase();if(!SHA256_RE.test(x))throw new Error(`rsi_canary_review_${l}_digest_invalid`);return x}
function boundedId(v,l){const x=String(v||'').trim();if(!SAFE_ID_RE.test(x))throw new Error(`rsi_canary_review_${l}_invalid`);return x}
function positiveInt(v,l){const n=Number(v);if(!Number.isSafeInteger(n)||n<1)throw new Error(`rsi_canary_review_${l}_invalid`);return n}
function probability(v,l){const n=Number(v);if(!Number.isFinite(n)||n<=0||n>=1)throw new Error(`rsi_canary_review_${l}_invalid`);return n}
function refs(v){if(!Array.isArray(v)||v.length<1||v.length>32)throw new Error('rsi_canary_review_evidence_refs_invalid');const out=[...new Set(v.map(x=>boundedId(x,'evidence_ref')))].sort();if(out.length!==v.length)throw new Error('rsi_canary_review_evidence_ref_duplicate');return Object.freeze(out)}
function assertZero(v,l){for(const f of ['execution_authority','production_mutation_authority','promotion_authority','self_update_authority','scheduler_authority','authority_effect'])if(v?.[f]!==false)throw new Error(`rsi_canary_review_${l}_${f}_invalid`);if(v?.automatic_retry_allowed!==false)throw new Error(`rsi_canary_review_${l}_retry_invalid`)}
function zero(extra={}){return Object.freeze({...extra,execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false})}

function verifyEvidence({binding,selection,observations}={}){
  const checkedBinding=verifyRsiSelectedShadowContextBinding(binding,selection);
  if(!Array.isArray(observations)||observations.length<MIN_OBSERVATIONS)throw new Error('rsi_canary_review_evidence_floor_not_met');
  const rows=observations.map(row=>verifyRsiSelectedShadowComparisonObservation(row,{binding:checkedBinding,selection}))
    .sort((a,b)=>a.observation_index-b.observation_index);
  const digests=new Set();
  for(let i=0;i<rows.length;i++){
    if(rows[i].observation_index!==i+1)throw new Error('rsi_canary_review_evidence_sequence_invalid');
    if(rows[i].binding_digest!==checkedBinding.binding_digest)throw new Error('rsi_canary_review_binding_mismatch');
    if(digests.has(rows[i].observation_digest))throw new Error('rsi_canary_review_evidence_duplicate');
    digests.add(rows[i].observation_digest);
  }
  const incident=rows.find(row=>row.incident===true)||null;
  const baselineInvalid=rows.some(row=>row.baseline_invalid===true);
  if(incident)throw new Error('rsi_canary_review_incident_latched');
  if(baselineInvalid)throw new Error('rsi_canary_review_baseline_invalid');
  return Object.freeze({binding:checkedBinding,rows:Object.freeze(rows)});
}

export function createRsiMetaProfileCanaryReviewCertificate({
  certificate_id,budget,confirmation_index,binding,selection,observations,
  independent_holdout_digest,evaluator_root_digest,method='E_VALUE_EXTERNAL_V1',
  alpha_used,safety_noninferiority_certified,security_noninferiority_certified,
  utility_noninferiority_certified,material_improvement_certified,
  familywise_valid,independent_holdout,stopping_rule_precommitted,optional_stopping_used,
  sample_count,evidence_refs,external_verifier=false,authored_by_candidate=true,
}={}){
  const evidence=verifyEvidence({binding,selection,observations});
  const checkedBudget=verifyRsiRecursiveRiskBudget(budget);
  if(checkedBudget.budget_digest!==RISK_BUDGET.budget_digest)throw new Error('rsi_canary_review_fixed_risk_budget_required');
  if(external_verifier!==true||authored_by_candidate!==false)throw new Error('rsi_canary_review_external_verifier_required');
  const index=positiveInt(confirmation_index,'confirmation_index');
  const allocated=rsiRiskAllocationForConfirmation(checkedBudget,index);
  const used=probability(alpha_used,'alpha_used');
  if(used-allocated>EPS)throw new Error('rsi_canary_review_alpha_over_budget');
  const normalizedMethod=String(method||'').toUpperCase();
  if(!CERT_METHODS.has(normalizedMethod))throw new Error('rsi_canary_review_method_invalid');
  if(familywise_valid!==true||independent_holdout!==true||stopping_rule_precommitted!==true||optional_stopping_used!==false)throw new Error('rsi_canary_review_statistical_policy_invalid');
  const core={
    schema:RSI_META_PROFILE_CANARY_REVIEW_CERT_SCHEMA,version:1,
    certificate_id:boundedId(certificate_id,'certificate_id'),
    source_sha:evidence.binding.source_sha,binding_digest:evidence.binding.binding_digest,
    selection_digest:evidence.binding.selection_digest,
    champion_profile_digest:evidence.binding.champion_profile_digest,
    challenger_profile_digest:evidence.binding.challenger_profile_digest,
    verified_context_digest:evidence.binding.verified_context_digest,
    comparator_root_digest:evidence.binding.comparator_root_digest,
    observation_count:evidence.rows.length,observation_digests:Object.freeze(evidence.rows.map(x=>x.observation_digest)),
    independent_holdout_digest:exactDigest(independent_holdout_digest,'holdout'),
    evaluator_root_digest:exactDigest(evaluator_root_digest,'evaluator_root'),
    budget_id:checkedBudget.budget_id,budget_digest:checkedBudget.budget_digest,
    confirmation_index:index,allocated_alpha:allocated,alpha_used:used,
    global_alpha:checkedBudget.global_alpha,method:normalizedMethod,
    safety_noninferiority_certified:safety_noninferiority_certified===true,
    security_noninferiority_certified:security_noninferiority_certified===true,
    utility_noninferiority_certified:utility_noninferiority_certified===true,
    material_improvement_certified:material_improvement_certified===true,
    familywise_valid:true,independent_holdout:true,stopping_rule_precommitted:true,optional_stopping_used:false,
    sample_count:positiveInt(sample_count,'sample_count'),evidence_refs:refs(evidence_refs),
    external_verifier:true,authored_by_candidate:false,
    candidate_can_choose_alpha:false,candidate_can_choose_confirmation_index:false,
    candidate_can_choose_holdout:false,candidate_can_author_certificate:false,
    certificate_is_canary_authority:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  if(core.sample_count<evidence.rows.length)throw new Error('rsi_canary_review_sample_count_below_evidence');
  return Object.freeze({...core,certificate_digest:digest(core)});
}

export function verifyRsiMetaProfileCanaryReviewCertificate(certificate,args={}){
  if(!certificate||certificate.schema!==RSI_META_PROFILE_CANARY_REVIEW_CERT_SCHEMA||certificate.version!==1)throw new Error('rsi_canary_review_certificate_invalid');
  assertZero(certificate,'certificate');
  if(certificate.external_verifier!==true||certificate.authored_by_candidate!==false||certificate.candidate_can_choose_alpha!==false
    ||certificate.candidate_can_choose_confirmation_index!==false||certificate.candidate_can_choose_holdout!==false
    ||certificate.candidate_can_author_certificate!==false||certificate.certificate_is_canary_authority!==false)throw new Error('rsi_canary_review_certificate_policy_invalid');
  const canonical=createRsiMetaProfileCanaryReviewCertificate({
    certificate_id:certificate.certificate_id,budget:args.budget,confirmation_index:args.confirmation_index,
    binding:args.binding,selection:args.selection,observations:args.observations,
    independent_holdout_digest:certificate.independent_holdout_digest,evaluator_root_digest:certificate.evaluator_root_digest,
    method:certificate.method,alpha_used:certificate.alpha_used,
    safety_noninferiority_certified:certificate.safety_noninferiority_certified,
    security_noninferiority_certified:certificate.security_noninferiority_certified,
    utility_noninferiority_certified:certificate.utility_noninferiority_certified,
    material_improvement_certified:certificate.material_improvement_certified,
    familywise_valid:certificate.familywise_valid,independent_holdout:certificate.independent_holdout,
    stopping_rule_precommitted:certificate.stopping_rule_precommitted,optional_stopping_used:certificate.optional_stopping_used,
    sample_count:certificate.sample_count,evidence_refs:certificate.evidence_refs,
    external_verifier:true,authored_by_candidate:false,
  });
  if(canonical.certificate_digest!==exactDigest(certificate.certificate_digest,'certificate'))throw new Error('rsi_canary_review_certificate_digest_mismatch');
  return canonical;
}

export function createRsiMetaProfileCanaryReview({
  review_id,binding,selection,observations,budget,certificate,confirmation_index,
}={}){
  const evidence=verifyEvidence({binding,selection,observations});
  const cert=verifyRsiMetaProfileCanaryReviewCertificate(certificate,{budget,confirmation_index,binding:evidence.binding,selection,observations:evidence.rows});
  const pass=cert.safety_noninferiority_certified&&cert.security_noninferiority_certified&&cert.utility_noninferiority_certified&&cert.material_improvement_certified;
  const core={
    schema:RSI_META_PROFILE_CANARY_REVIEW_SCHEMA,version:1,
    source_sha:evidence.binding.source_sha,review_id:boundedId(review_id,'review_id'),
    binding_digest:evidence.binding.binding_digest,selection_digest:evidence.binding.selection_digest,
    champion_profile_digest:evidence.binding.champion_profile_digest,challenger_profile_digest:evidence.binding.challenger_profile_digest,
    certificate_digest:cert.certificate_digest,budget_digest:cert.budget_digest,
    confirmation_index:cert.confirmation_index,alpha_used:cert.alpha_used,allocated_alpha:cert.allocated_alpha,
    observation_count:evidence.rows.length,observation_root_digest:digest(evidence.rows.map(x=>x.observation_digest)),
    state:pass?'ELIGIBLE_FOR_EXTERNAL_BOUNDED_CANARY_REVIEW':'STATISTICAL_CANARY_REVIEW_REJECTED',
    eligible_for_external_bounded_canary_review:pass,
    canary_token:null,canary_activation_authorized:false,profile_replacement_authorized:false,
    champion_remains_default:true,external_canary_controller_required:true,
    statistical_gate_is_canary_authority:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...core,review_digest:digest(core)});
}

export function verifyRsiMetaProfileCanaryReview(review){
  if(!review||review.schema!==RSI_META_PROFILE_CANARY_REVIEW_SCHEMA||review.version!==1)throw new Error('rsi_canary_review_invalid');
  assertZero(review,'review');
  const eligible=review.state==='ELIGIBLE_FOR_EXTERNAL_BOUNDED_CANARY_REVIEW';
  if(!eligible&&review.state!=='STATISTICAL_CANARY_REVIEW_REJECTED')throw new Error('rsi_canary_review_state_invalid');
  if(review.eligible_for_external_bounded_canary_review!==eligible||review.canary_token!==null
    ||review.canary_activation_authorized!==false||review.profile_replacement_authorized!==false
    ||review.champion_remains_default!==true||review.external_canary_controller_required!==true
    ||review.statistical_gate_is_canary_authority!==false)throw new Error('rsi_canary_review_policy_invalid');
  exactDigest(review.binding_digest,'binding');exactDigest(review.selection_digest,'selection');
  exactDigest(review.champion_profile_digest,'champion');exactDigest(review.challenger_profile_digest,'challenger');
  exactDigest(review.certificate_digest,'certificate');exactDigest(review.budget_digest,'budget');
  exactDigest(review.observation_root_digest,'observation_root');
  positiveInt(review.confirmation_index,'confirmation_index');positiveInt(review.observation_count,'observation_count');
  const clone=structuredClone(review);delete clone.review_digest;
  if(digest(clone)!==exactDigest(review.review_digest,'review'))throw new Error('rsi_canary_review_digest_mismatch');
  return Object.freeze(structuredClone(review));
}

function ledgerState(sourceSha,rows){
  const cumulative=rows.reduce((s,row)=>s+Number(row.alpha_used),0);
  const next=rows.length+1;
  const core={schema:RSI_META_PROFILE_CANARY_REVIEW_LEDGER_SCHEMA,version:1,source_sha:sourceSha,
    fixed_risk_budget:RISK_BUDGET,fixed_risk_budget_digest:RISK_BUDGET.budget_digest,
    rows,row_count:rows.length,cumulative_alpha_spent:cumulative,global_alpha:RISK_BUDGET.global_alpha,
    next_confirmation_index:next,next_confirmation_alpha_allocation:rsiRiskAllocationForConfirmation(RISK_BUDGET,next),
    append_only:true,active_profile_digest:null,canary_profile_digest:null,canary_token:null,
    ledger_can_activate_canary:false,ledger_can_replace_profile:false,candidate_can_rewrite_rows:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false};
  return {...core,state_digest:digest(core)};
}

export class RsiMetaProfileCanaryReviewLedger{
  #path;#sourceSha;#rows=[];#initialized=false;
  constructor({statePath,source_sha}={}){if(!statePath)throw new Error('rsi_canary_review_ledger_path_required');this.#path=path.resolve(statePath);this.#sourceSha=exactSha(source_sha,'source')}
  async init(){if(this.#initialized)return this.snapshot();await fs.mkdir(path.dirname(this.#path),{recursive:true});try{const p=JSON.parse(await fs.readFile(this.#path,'utf8'));assertZero(p,'ledger');if(p.schema!==RSI_META_PROFILE_CANARY_REVIEW_LEDGER_SCHEMA||p.version!==1||p.source_sha!==this.#sourceSha||p.fixed_risk_budget_digest!==RISK_BUDGET.budget_digest||p.append_only!==true||p.ledger_can_activate_canary!==false||p.ledger_can_replace_profile!==false)throw new Error('rsi_canary_review_ledger_state_invalid');const c=structuredClone(p);delete c.state_digest;if(digest(c)!==exactDigest(p.state_digest,'ledger'))throw new Error('rsi_canary_review_ledger_digest_mismatch');if(!Array.isArray(p.rows)||p.rows.length>MAX_ROWS)throw new Error('rsi_canary_review_ledger_rows_invalid');let cumulative=0;for(let i=0;i<p.rows.length;i++){const row=p.rows[i];const rc=structuredClone(row);delete rc.review_digest;if(digest(rc)!==exactDigest(row.review_digest,'review'))throw new Error('rsi_canary_review_ledger_row_digest_mismatch');if(row.source_sha!==this.#sourceSha||row.confirmation_index!==i+1||row.budget_digest!==RISK_BUDGET.budget_digest)throw new Error('rsi_canary_review_ledger_sequence_invalid');const allocation=rsiRiskAllocationForConfirmation(RISK_BUDGET,i+1);if(Number(row.alpha_used)<=0||Number(row.alpha_used)-allocation>EPS)throw new Error('rsi_canary_review_ledger_alpha_invalid');cumulative+=Number(row.alpha_used);if(cumulative-RISK_BUDGET.global_alpha>EPS)throw new Error('rsi_canary_review_global_alpha_exhausted')}this.#rows=p.rows}catch(e){if(e?.code!=='ENOENT')throw e}this.#initialized=true;return this.snapshot()}
  async #persist(){const state=ledgerState(this.#sourceSha,this.#rows);const tmp=`${this.#path}.tmp`;const h=await fs.open(tmp,'w',0o600);try{await h.writeFile(`${JSON.stringify(state)}\n`,'utf8');await h.sync()}finally{await h.close()}await fs.rename(tmp,this.#path)}
  async add(review){if(!this.#initialized)throw new Error('rsi_canary_review_ledger_not_initialized');const checked=verifyRsiMetaProfileCanaryReview(review);if(checked.source_sha!==this.#sourceSha)throw new Error('rsi_canary_review_source_mismatch');const existing=this.#rows.find(x=>x.review_id===checked.review_id||x.binding_digest===checked.binding_digest);if(existing){if(existing.review_digest!==checked.review_digest)throw new Error('rsi_canary_review_conflict');return zero({state:'IDEMPOTENT',review_digest:checked.review_digest})}const expected=this.#rows.length+1;if(checked.confirmation_index!==expected)throw new Error('rsi_canary_review_confirmation_index_out_of_sequence');const allocation=rsiRiskAllocationForConfirmation(RISK_BUDGET,expected);if(Number(checked.alpha_used)<=0||Number(checked.alpha_used)-allocation>EPS)throw new Error('rsi_canary_review_alpha_over_budget');const cumulative=this.#rows.reduce((s,x)=>s+Number(x.alpha_used),0)+Number(checked.alpha_used);if(cumulative-RISK_BUDGET.global_alpha>EPS)throw new Error('rsi_canary_review_global_alpha_exhausted');if(this.#rows.length>=MAX_ROWS)throw new Error('rsi_canary_review_ledger_capacity_exceeded');this.#rows.push(structuredClone(checked));await this.#persist();return zero({state:checked.state,review_digest:checked.review_digest})}
  eligible(){if(!this.#initialized)throw new Error('rsi_canary_review_ledger_not_initialized');return Object.freeze(this.#rows.filter(x=>x.eligible_for_external_bounded_canary_review===true).map(x=>Object.freeze(structuredClone(x))))}
  snapshot(){const s=ledgerState(this.#sourceSha,this.#rows);return Object.freeze({schema:s.schema,version:s.version,source_sha:s.source_sha,initialized:this.#initialized,row_count:s.row_count,fixed_risk_budget_digest:s.fixed_risk_budget_digest,cumulative_alpha_spent:s.cumulative_alpha_spent,global_alpha:s.global_alpha,next_confirmation_index:s.next_confirmation_index,next_confirmation_alpha_allocation:s.next_confirmation_alpha_allocation,append_only:true,active_profile_digest:null,canary_profile_digest:null,canary_token:null,ledger_can_activate_canary:false,authority_effect:false})}
}

export function rsiMetaProfileCanaryReviewRiskBudgetSnapshot(){return RISK_BUDGET}

export function rsiMetaProfileCanaryReviewTrustRootSnapshot(){
  const root={schema:'metaengine.rsi.meta-profile-canary-review-root.v1',version:1,
    phase19b_repeated_evidence_required:true,minimum_observations:MIN_OBSERVATIONS,
    zero_incident_required:true,valid_baseline_required:true,external_statistical_verifier_required:true,
    allowed_certificate_methods:Object.freeze([...CERT_METHODS].sort()),fixed_risk_budget_digest:RISK_BUDGET.budget_digest,
    global_alpha:RISK_BUDGET.global_alpha,anytime_risk_spending:true,
    safety_noninferiority_required:true,security_noninferiority_required:true,utility_noninferiority_required:true,
    material_improvement_required:true,familywise_validity_required:true,independent_holdout_required:true,
    candidate_can_choose_alpha:false,candidate_can_choose_holdout:false,candidate_can_author_certificate:false,
    external_canary_controller_required:true,champion_remains_default:true,
    review_is_canary_authority:false,canary_activation_authorized:false,profile_replacement_authorized:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false};
  return Object.freeze({...root,canary_review_root_digest:digest(root)});
}
