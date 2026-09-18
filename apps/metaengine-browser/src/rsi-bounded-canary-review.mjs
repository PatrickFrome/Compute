import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { RSI_SHADOW_DIVERGENCE_REVIEW_EVIDENCE_SCHEMA } from './rsi-shadow-divergence-monitor.mjs';

export const RSI_BOUNDED_CANARY_REVIEW_SCHEMA='metaengine.rsi.bounded-canary-review.v1';
export const RSI_BOUNDED_CANARY_REVIEW_LEDGER_SCHEMA='metaengine.rsi.bounded-canary-review-ledger.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const FIXED_DECISION_BUDGET=128;
const FIXED_WINDOW_BUDGET=32;
const ALLOWED_SURFACE='READ_ONLY_DECISION_SUPPORT_CANARY';
const MAX_REVIEWS=256;

function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.keys(value).sort().map((key)=>[key,stable(value[key])]));
}
function digest(value){
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)),'utf8').digest('hex')}`;
}
function exactSha(value,label){
  const out=String(value||'').trim().toLowerCase();
  if(!SHA40_RE.test(out))throw new Error(`rsi_canary_review_${label}_sha_invalid`);
  return out;
}
function exactDigest(value,label){
  const out=String(value||'').trim().toLowerCase();
  if(!SHA256_RE.test(out))throw new Error(`rsi_canary_review_${label}_digest_invalid`);
  return out;
}
function id(value,label){
  const out=String(value||'').trim();
  if(!SAFE_ID_RE.test(out))throw new Error(`rsi_canary_review_${label}_invalid`);
  return out;
}
function assertZero(value,label){
  for(const field of [
    'execution_authority','production_mutation_authority','promotion_authority',
    'self_update_authority','scheduler_authority','signing_authority','authority_effect',
  ]){
    if(value?.[field]!==false)throw new Error(`rsi_canary_review_${label}_${field}_invalid`);
  }
  if(value?.automatic_retry_allowed!==false)throw new Error(`rsi_canary_review_${label}_retry_invalid`);
}
function zero(extra={}){
  return Object.freeze({
    ...extra,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    signing_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  });
}

export function verifyRsiShadowReviewEvidence(evidence){
  if(!evidence||evidence.schema!==RSI_SHADOW_DIVERGENCE_REVIEW_EVIDENCE_SCHEMA||evidence.version!==1){
    throw new Error('rsi_canary_review_shadow_evidence_invalid');
  }
  assertZero(evidence,'shadow_evidence');
  if(
    evidence.champion_remains_default!==true
    ||evidence.active_profile_replacement_authorized!==false
    ||evidence.canary_activation_authorized!==false
    ||evidence.external_review_still_required!==true
    ||evidence.incident_latched!==false
    ||evidence.enough_evidence!==true
    ||evidence.no_negative_comparative_evidence!==true
    ||evidence.challenger_has_positive_evidence!==true
    ||evidence.ready_for_external_bounded_canary_review!==true
  ){
    throw new Error('rsi_canary_review_shadow_evidence_not_ready');
  }
  if(!Number.isSafeInteger(evidence.observation_count)||evidence.observation_count<8){
    throw new Error('rsi_canary_review_shadow_observation_floor_invalid');
  }
  const clone=structuredClone(evidence);
  delete clone.review_evidence_digest;
  if(digest(clone)!==exactDigest(evidence.review_evidence_digest,'shadow_evidence')){
    throw new Error('rsi_canary_review_shadow_evidence_digest_mismatch');
  }
  return Object.freeze(structuredClone(evidence));
}

export function createRsiBoundedCanaryReview({
  review_id,
  shadow_review_evidence,
  external_cohort_digest,
  decision_budget=FIXED_DECISION_BUDGET,
  window_budget=FIXED_WINDOW_BUDGET,
  action_surface=ALLOWED_SURFACE,
  external_reviewer=false,
  authored_by_candidate=true,
}={}){
  const evidence=verifyRsiShadowReviewEvidence(shadow_review_evidence);
  if(external_reviewer!==true||authored_by_candidate!==false){
    throw new Error('rsi_canary_review_external_reviewer_required');
  }
  if(Number(decision_budget)!==FIXED_DECISION_BUDGET){
    throw new Error('rsi_canary_review_fixed_decision_budget_required');
  }
  if(Number(window_budget)!==FIXED_WINDOW_BUDGET){
    throw new Error('rsi_canary_review_fixed_window_budget_required');
  }
  if(String(action_surface||'').trim().toUpperCase()!==ALLOWED_SURFACE){
    throw new Error('rsi_canary_review_surface_invalid');
  }
  const core={
    schema:RSI_BOUNDED_CANARY_REVIEW_SCHEMA,
    version:1,
    source_sha:exactSha(evidence.source_sha,'source'),
    review_id:id(review_id,'review_id'),
    shadow_review_evidence_digest:evidence.review_evidence_digest,
    monitor_id:evidence.monitor_id,
    monitor_policy_digest:exactDigest(evidence.policy_digest,'monitor_policy'),
    binding_digest:exactDigest(evidence.binding_digest,'binding'),
    qualification_digest:exactDigest(evidence.qualification_digest,'qualification'),
    champion_profile_digest:exactDigest(evidence.champion_profile_digest,'champion_profile'),
    challenger_profile_digest:exactDigest(evidence.challenger_profile_digest,'challenger_profile'),
    verified_context_digest:exactDigest(evidence.verified_context_digest,'verified_context'),
    monitor_root_digest:exactDigest(evidence.monitor_root_digest,'monitor_root'),
    external_cohort_digest:exactDigest(external_cohort_digest,'external_cohort'),
    action_surface:ALLOWED_SURFACE,
    decision_budget:FIXED_DECISION_BUDGET,
    window_budget:FIXED_WINDOW_BUDGET,
    state:'READY_FOR_EXTERNAL_CANARY_CONTROLLER_REVIEW',
    monitor_evidence_floor_satisfied:true,
    incident_free_monitor_required:true,
    champion_remains_default:true,
    champion_is_mandatory_fallback:true,
    challenger_is_advisory_only:true,
    identity_must_remain_exact:true,
    cohort_is_externally_fixed:true,
    budgets_are_externally_fixed:true,
    candidate_can_choose_cohort:false,
    candidate_can_choose_budget:false,
    candidate_can_choose_surface:false,
    candidate_can_clear_monitor_incident:false,
    review_can_activate_canary:false,
    review_can_replace_profile:false,
    review_can_execute_browser_effect:false,
    review_can_issue_tool_effect:false,
    external_canary_controller_still_required:true,
    canary_activation_authorized:false,
    production_activation_authorized:false,
    external_reviewer:true,
    authored_by_candidate:false,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    signing_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...core,review_digest:digest(core)});
}

export function verifyRsiBoundedCanaryReview(review,{shadow_review_evidence}={}){
  if(!review||review.schema!==RSI_BOUNDED_CANARY_REVIEW_SCHEMA||review.version!==1){
    throw new Error('rsi_canary_review_invalid');
  }
  assertZero(review,'review');
  if(
    review.state!=='READY_FOR_EXTERNAL_CANARY_CONTROLLER_REVIEW'
    ||review.action_surface!==ALLOWED_SURFACE
    ||review.decision_budget!==FIXED_DECISION_BUDGET
    ||review.window_budget!==FIXED_WINDOW_BUDGET
    ||review.monitor_evidence_floor_satisfied!==true
    ||review.incident_free_monitor_required!==true
    ||review.champion_remains_default!==true
    ||review.champion_is_mandatory_fallback!==true
    ||review.challenger_is_advisory_only!==true
    ||review.identity_must_remain_exact!==true
    ||review.cohort_is_externally_fixed!==true
    ||review.budgets_are_externally_fixed!==true
    ||review.candidate_can_choose_cohort!==false
    ||review.candidate_can_choose_budget!==false
    ||review.candidate_can_choose_surface!==false
    ||review.candidate_can_clear_monitor_incident!==false
    ||review.review_can_activate_canary!==false
    ||review.review_can_replace_profile!==false
    ||review.review_can_execute_browser_effect!==false
    ||review.review_can_issue_tool_effect!==false
    ||review.external_canary_controller_still_required!==true
    ||review.canary_activation_authorized!==false
    ||review.production_activation_authorized!==false
    ||review.external_reviewer!==true
    ||review.authored_by_candidate!==false
  ){
    throw new Error('rsi_canary_review_policy_invalid');
  }
  const canonical=createRsiBoundedCanaryReview({
    review_id:review.review_id,
    shadow_review_evidence,
    external_cohort_digest:review.external_cohort_digest,
    decision_budget:review.decision_budget,
    window_budget:review.window_budget,
    action_surface:review.action_surface,
    external_reviewer:true,
    authored_by_candidate:false,
  });
  if(canonical.review_digest!==exactDigest(review.review_digest,'review')){
    throw new Error('rsi_canary_review_digest_mismatch');
  }
  return canonical;
}

function ledgerState(sourceSha,rows){
  const core={
    schema:RSI_BOUNDED_CANARY_REVIEW_LEDGER_SCHEMA,
    version:1,
    source_sha:sourceSha,
    rows,
    row_count:rows.length,
    append_only:true,
    active_profile_digest:null,
    active_canary_review_digest:null,
    ledger_can_activate_canary:false,
    ledger_can_replace_profile:false,
    ledger_can_clear_monitor_incident:false,
    external_controller_still_required:true,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    signing_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return {...core,state_digest:digest(core)};
}

export class RsiBoundedCanaryReviewLedger{
  #path;
  #sourceSha;
  #rows=[];
  #initialized=false;

  constructor({statePath,source_sha}={}){
    if(!statePath)throw new Error('rsi_canary_review_ledger_path_required');
    this.#path=path.resolve(statePath);
    this.#sourceSha=exactSha(source_sha,'ledger_source');
  }

  async init(){
    if(this.#initialized)return this.snapshot();
    await fs.mkdir(path.dirname(this.#path),{recursive:true});
    try{
      const persisted=JSON.parse(await fs.readFile(this.#path,'utf8'));
      assertZero(persisted,'ledger');
      if(
        persisted.schema!==RSI_BOUNDED_CANARY_REVIEW_LEDGER_SCHEMA
        ||persisted.version!==1
        ||persisted.source_sha!==this.#sourceSha
        ||persisted.append_only!==true
        ||persisted.active_profile_digest!==null
        ||persisted.active_canary_review_digest!==null
        ||persisted.ledger_can_activate_canary!==false
        ||persisted.ledger_can_replace_profile!==false
        ||persisted.ledger_can_clear_monitor_incident!==false
        ||persisted.external_controller_still_required!==true
        ||!Array.isArray(persisted.rows)
        ||persisted.rows.length>MAX_REVIEWS
      ){
        throw new Error('rsi_canary_review_ledger_state_invalid');
      }
      const clone=structuredClone(persisted);delete clone.state_digest;
      if(digest(clone)!==exactDigest(persisted.state_digest,'ledger')){
        throw new Error('rsi_canary_review_ledger_digest_mismatch');
      }
      this.#rows=persisted.rows.map((row)=>{
        if(!row||typeof row!=='object'||!row.review||!row.shadow_review_evidence){
          throw new Error('rsi_canary_review_ledger_row_invalid');
        }
        const evidence=verifyRsiShadowReviewEvidence(row.shadow_review_evidence);
        const review=verifyRsiBoundedCanaryReview(row.review,{shadow_review_evidence:evidence});
        if(review.source_sha!==this.#sourceSha){
          throw new Error('rsi_canary_review_ledger_source_mismatch');
        }
        if(review.shadow_review_evidence_digest!==evidence.review_evidence_digest){
          throw new Error('rsi_canary_review_ledger_evidence_binding_mismatch');
        }
        return Object.freeze({
          review:structuredClone(review),
          shadow_review_evidence:structuredClone(evidence),
        });
      });
    }catch(error){
      if(error?.code!=='ENOENT')throw error;
    }
    this.#initialized=true;
    return this.snapshot();
  }

  async #persist(){
    const state=ledgerState(this.#sourceSha,this.#rows);
    const temp=`${this.#path}.tmp`;
    const handle=await fs.open(temp,'w',0o600);
    try{
      await handle.writeFile(`${JSON.stringify(state)}\n`,'utf8');
      await handle.sync();
    }finally{
      await handle.close();
    }
    await fs.rename(temp,this.#path);
  }

  async append({review,shadow_review_evidence}={}){
    if(!this.#initialized)throw new Error('rsi_canary_review_ledger_not_initialized');
    const evidence=verifyRsiShadowReviewEvidence(shadow_review_evidence);
    const checked=verifyRsiBoundedCanaryReview(review,{shadow_review_evidence:evidence});
    if(checked.source_sha!==this.#sourceSha)throw new Error('rsi_canary_review_source_mismatch');
    if(checked.shadow_review_evidence_digest!==evidence.review_evidence_digest){
      throw new Error('rsi_canary_review_ledger_evidence_binding_mismatch');
    }
    const existing=this.#rows.find((row)=>row.review.review_id===checked.review_id||row.review.review_digest===checked.review_digest);
    if(existing){
      if(existing.review.review_digest!==checked.review_digest){
        throw new Error('rsi_canary_review_identity_conflict');
      }
      if(existing.shadow_review_evidence.review_evidence_digest!==evidence.review_evidence_digest){
        throw new Error('rsi_canary_review_evidence_identity_conflict');
      }
      return zero({state:'IDEMPOTENT',review_digest:checked.review_digest});
    }
    if(this.#rows.length>=MAX_REVIEWS)throw new Error('rsi_canary_review_ledger_capacity_exceeded');
    this.#rows.push(Object.freeze({
      review:structuredClone(checked),
      shadow_review_evidence:structuredClone(evidence),
    }));
    await this.#persist();
    return zero({state:'READY_FOR_EXTERNAL_CANARY_CONTROLLER_REVIEW',review_digest:checked.review_digest});
  }

  reviews(){
    if(!this.#initialized)throw new Error('rsi_canary_review_ledger_not_initialized');
    return Object.freeze(this.#rows.map((row)=>Object.freeze(structuredClone(row.review))));
  }

  evidenceForReview(reviewDigest){
    if(!this.#initialized)throw new Error('rsi_canary_review_ledger_not_initialized');
    const wanted=exactDigest(reviewDigest,'review_lookup');
    const row=this.#rows.find((entry)=>entry.review.review_digest===wanted);
    return row?Object.freeze(structuredClone(row.shadow_review_evidence)):null;
  }

  snapshot(){
    const state=ledgerState(this.#sourceSha,this.#rows);
    return Object.freeze({
      schema:state.schema,
      version:state.version,
      source_sha:state.source_sha,
      initialized:this.#initialized,
      row_count:state.row_count,
      active_profile_digest:null,
      active_canary_review_digest:null,
      ledger_can_activate_canary:false,
      ledger_can_replace_profile:false,
      ledger_can_clear_monitor_incident:false,
      external_controller_still_required:true,
      authority_effect:false,
    });
  }
}

export function rsiBoundedCanaryReviewTrustRootSnapshot(){
  const root={
    schema:'metaengine.rsi.bounded-canary-review-root.v1',
    version:1,
    sealed_shadow_monitor_evidence_required:true,
    incident_free_monitor_required:true,
    challenger_positive_evidence_required:true,
    negative_comparative_evidence_forbidden:true,
    fixed_decision_budget:FIXED_DECISION_BUDGET,
    fixed_window_budget:FIXED_WINDOW_BUDGET,
    allowed_surface:ALLOWED_SURFACE,
    external_cohort_required:true,
    champion_remains_default:true,
    champion_is_mandatory_fallback:true,
    challenger_is_advisory_only:true,
    exact_identity_required:true,
    candidate_can_choose_cohort:false,
    candidate_can_choose_budget:false,
    candidate_can_choose_surface:false,
    candidate_can_clear_monitor_incident:false,
    review_can_activate_canary:false,
    review_can_replace_profile:false,
    external_canary_controller_required:true,
    canary_activation_authorized:false,
    production_activation_authorized:false,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    signing_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...root,review_root_digest:digest(root)});
}
