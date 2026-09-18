import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  RSI_META_PROFILE_DUAL_PLAN_COMPARISON_SCHEMA,
  RSI_META_PROFILE_SHADOW_BINDING_SCHEMA,
} from './rsi-meta-profile-shadow-comparison.mjs';

export const RSI_QD_BOUNDED_CANARY_REVIEW_SCHEMA = 'metaengine.rsi.qd-bounded-canary-review.v1';
export const RSI_QD_BOUNDED_CANARY_REVIEW_LEDGER_SCHEMA = 'metaengine.rsi.qd-bounded-canary-review-ledger.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const MIN_COMPARISONS=32;
const MIN_CONTEXTS=4;
const MAX_CANARY_DECISIONS=16;
const MAX_ROWS=256;

function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]))}
function digest(v){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`}
function sha(v,l){const x=String(v||'').trim().toLowerCase();if(!SHA40_RE.test(x))throw new Error(`rsi_qd_canary_${l}_sha_invalid`);return x}
function dg(v,l){const x=String(v||'').trim().toLowerCase();if(!SHA256_RE.test(x))throw new Error(`rsi_qd_canary_${l}_digest_invalid`);return x}
function id(v,l){const x=String(v||'').trim();if(!SAFE_ID_RE.test(x))throw new Error(`rsi_qd_canary_${l}_invalid`);return x}
function plain(v){return !!v&&typeof v==='object'&&!Array.isArray(v)}
function zero(v,l){for(const f of ['execution_authority','production_mutation_authority','promotion_authority','self_update_authority','scheduler_authority','authority_effect'])if(v?.[f]!==false)throw new Error(`rsi_qd_canary_${l}_${f}_invalid`);if(v?.automatic_retry_allowed!==false)throw new Error(`rsi_qd_canary_${l}_retry_invalid`)}

function verifyBinding(row){
  if(!plain(row)||row.schema!==RSI_META_PROFILE_SHADOW_BINDING_SCHEMA||row.version!==1)throw new Error('rsi_qd_canary_binding_invalid');
  zero(row,'binding');
  if(row.selection_policy!=='QUALIFIED_PARETO_DIVERSITY_ROUND_ROBIN_V1'
    ||row.comparison_mode!=='READ_ONLY_DUAL_PLAN'||row.qd_selection_required!==true
    ||row.same_verified_context_required!==true||row.champion_challenger_roles_fixed!==true
    ||row.raw_context_exposed_to_candidate!==false||row.plan_execution_allowed!==false
    ||row.browser_effects_allowed!==false||row.active_profile_replacement_authorized!==false
    ||row.canary_activation_authorized!==false||row.future_canary_gate_still_required!==true
    ||row.external_comparator_owner!==true||row.authored_by_candidate!==false)throw new Error('rsi_qd_canary_binding_policy_invalid');
  sha(row.source_sha,'binding_source');
  for(const [v,l] of [[row.binding_digest,'binding'],[row.selection_digest,'selection'],[row.qualification_digest,'qualification'],[row.verified_context_digest,'context'],[row.comparator_root_digest,'comparator'],[row.champion_profile_digest,'champion'],[row.challenger_profile_digest,'challenger']])dg(v,l);
  const clone=structuredClone(row);delete clone.binding_digest;
  if(digest(clone)!==row.binding_digest)throw new Error('rsi_qd_canary_binding_digest_mismatch');
  return Object.freeze(structuredClone(row));
}

function verifyComparison(row,binding){
  if(!plain(row)||row.schema!==RSI_META_PROFILE_DUAL_PLAN_COMPARISON_SCHEMA||row.version!==1)throw new Error('rsi_qd_canary_comparison_invalid');
  zero(row,'comparison');
  if(row.binding_digest!==binding.binding_digest||row.source_sha!==binding.source_sha
    ||row.selection_digest!==binding.selection_digest||row.qualification_digest!==binding.qualification_digest
    ||row.verified_context_digest!==binding.verified_context_digest||row.comparator_root_digest!==binding.comparator_root_digest
    ||row.champion_profile_digest!==binding.champion_profile_digest||row.challenger_profile_digest!==binding.challenger_profile_digest)throw new Error('rsi_qd_canary_comparison_binding_mismatch');
  if(row.shadow_only!==true||row.plan_execution_observed!==false||row.plan_execution_authorized!==false
    ||row.raw_context_stored!==false||row.candidate_can_author_comparison!==false
    ||row.candidate_can_choose_comparator!==false||row.canary_activation_authorized!==false
    ||row.live_profile_activation_authorized!==false||row.profile_replacement_authorized!==false
    ||row.external_comparator!==true||row.authored_by_candidate!==false)throw new Error('rsi_qd_canary_comparison_policy_invalid');
  if(row.hard_invariants_pass!==true||row.incident_observed!==false||row.eligible_for_future_canary_review_evidence!==true)throw new Error('rsi_qd_canary_clean_comparison_required');
  if(!['MATCHES_CHAMPION','SHADOW_DIVERGENCE'].includes(row.relation))throw new Error('rsi_qd_canary_comparison_relation_invalid');
  dg(row.comparison_digest,'comparison');
  const clone=structuredClone(row);delete clone.comparison_digest;
  if(digest(clone)!==row.comparison_digest)throw new Error('rsi_qd_canary_comparison_digest_mismatch');
  return Object.freeze(structuredClone(row));
}

function normalizePairs(pairs,sourceSha){
  if(!Array.isArray(pairs)||pairs.length<MIN_COMPARISONS)throw new Error('rsi_qd_canary_minimum_comparisons_required');
  const ids=new Set(), digests=new Set(), contexts=new Set();
  let qualification=null, champion=null, challenger=null, comparator=null, divergence=0;
  const rows=pairs.map((pair)=>{
    if(!plain(pair))throw new Error('rsi_qd_canary_pair_invalid');
    const binding=verifyBinding(pair.binding);
    const comparison=verifyComparison(pair.comparison,binding);
    if(binding.source_sha!==sourceSha)throw new Error('rsi_qd_canary_source_mismatch');
    if(ids.has(comparison.comparison_id)||digests.has(comparison.comparison_digest))throw new Error('rsi_qd_canary_duplicate_comparison');
    ids.add(comparison.comparison_id);digests.add(comparison.comparison_digest);contexts.add(binding.verified_context_digest);
    qualification??=binding.qualification_digest;champion??=binding.champion_profile_digest;challenger??=binding.challenger_profile_digest;comparator??=binding.comparator_root_digest;
    if(binding.qualification_digest!==qualification||binding.champion_profile_digest!==champion||binding.challenger_profile_digest!==challenger)throw new Error('rsi_qd_canary_profile_identity_drift');
    if(binding.comparator_root_digest!==comparator)throw new Error('rsi_qd_canary_comparator_root_drift');
    if(comparison.relation==='SHADOW_DIVERGENCE')divergence+=1;
    return Object.freeze({binding,comparison});
  });
  if(contexts.size<MIN_CONTEXTS)throw new Error('rsi_qd_canary_context_coverage_insufficient');
  if(divergence<1)throw new Error('rsi_qd_canary_meaningful_divergence_required');
  rows.sort((a,b)=>a.comparison.comparison_digest.localeCompare(b.comparison.comparison_digest));
  return Object.freeze({rows,qualification,champion,challenger,comparator,context_count:contexts.size,divergence_count:divergence});
}

export function createRsiQdBoundedCanaryReview({
  review_id,source_sha,comparison_pairs,cohort_digest,
  external_review_owner=false,authored_by_candidate=true,
}={}){
  const sourceSha=sha(source_sha,'source');
  if(external_review_owner!==true||authored_by_candidate!==false)throw new Error('rsi_qd_canary_external_review_owner_required');
  const normalized=normalizePairs(comparison_pairs,sourceSha);
  const comparisonDigests=Object.freeze(normalized.rows.map(x=>x.comparison.comparison_digest));
  const contextDigests=Object.freeze([...new Set(normalized.rows.map(x=>x.binding.verified_context_digest))].sort());
  const core={
    schema:RSI_QD_BOUNDED_CANARY_REVIEW_SCHEMA,version:1,source_sha:sourceSha,
    review_id:id(review_id,'review_id'),
    qualification_digest:normalized.qualification,
    champion_profile_digest:normalized.champion,
    challenger_profile_digest:normalized.challenger,
    comparator_root_digest:normalized.comparator,
    cohort_digest:dg(cohort_digest,'cohort'),
    comparison_digests:comparisonDigests,
    comparison_count:comparisonDigests.length,
    context_digests:contextDigests,
    context_count:contextDigests.length,
    divergence_count:normalized.divergence_count,
    minimum_comparisons:MIN_COMPARISONS,minimum_contexts:MIN_CONTEXTS,
    canary_surface:'READ_ONLY_DECISION_SUPPORT',
    max_canary_decisions:MAX_CANARY_DECISIONS,
    incumbent_remains_default:true,incumbent_is_mandatory_fallback:true,
    challenger_is_advisory_only:true,cohort_is_externally_fixed:true,
    candidate_can_choose_cohort:false,candidate_can_choose_budget:false,
    candidate_can_activate_canary:false,candidate_can_clear_rollback:false,
    identity_stable:true,clean_shadow_evidence_required:true,
    ready_for_external_bounded_canary_review:true,
    external_canary_controller_required:true,canary_token:null,
    canary_activation_authorized:false,live_profile_activation_authorized:false,profile_replacement_authorized:false,
    external_review_owner:true,authored_by_candidate:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...core,review_digest:digest(core)});
}

export function verifyRsiQdBoundedCanaryReview(row,{comparison_pairs}={}){
  if(!plain(row)||row.schema!==RSI_QD_BOUNDED_CANARY_REVIEW_SCHEMA||row.version!==1)throw new Error('rsi_qd_canary_review_invalid');
  zero(row,'review');
  if(row.canary_surface!=='READ_ONLY_DECISION_SUPPORT'||row.minimum_comparisons!==MIN_COMPARISONS||row.minimum_contexts!==MIN_CONTEXTS
    ||row.max_canary_decisions!==MAX_CANARY_DECISIONS||row.incumbent_remains_default!==true||row.incumbent_is_mandatory_fallback!==true
    ||row.challenger_is_advisory_only!==true||row.cohort_is_externally_fixed!==true
    ||row.candidate_can_choose_cohort!==false||row.candidate_can_choose_budget!==false
    ||row.candidate_can_activate_canary!==false||row.candidate_can_clear_rollback!==false
    ||row.identity_stable!==true||row.clean_shadow_evidence_required!==true
    ||row.ready_for_external_bounded_canary_review!==true||row.external_canary_controller_required!==true
    ||row.canary_token!==null||row.canary_activation_authorized!==false||row.live_profile_activation_authorized!==false
    ||row.profile_replacement_authorized!==false||row.external_review_owner!==true||row.authored_by_candidate!==false)throw new Error('rsi_qd_canary_review_policy_invalid');
  const canonical=createRsiQdBoundedCanaryReview({
    review_id:row.review_id,source_sha:row.source_sha,comparison_pairs,
    cohort_digest:row.cohort_digest,external_review_owner:true,authored_by_candidate:false,
  });
  if(canonical.review_digest!==dg(row.review_digest,'review'))throw new Error('rsi_qd_canary_review_digest_mismatch');
  return canonical;
}

function verifyStoredReview(row){
  if(!plain(row)||row.schema!==RSI_QD_BOUNDED_CANARY_REVIEW_SCHEMA||row.version!==1)throw new Error('rsi_qd_canary_review_invalid');
  zero(row,'review');sha(row.source_sha,'review_source');id(row.review_id,'review_id');
  if(row.minimum_comparisons!==MIN_COMPARISONS||row.minimum_contexts!==MIN_CONTEXTS||row.max_canary_decisions!==MAX_CANARY_DECISIONS
    ||row.canary_surface!=='READ_ONLY_DECISION_SUPPORT'||row.incumbent_remains_default!==true||row.incumbent_is_mandatory_fallback!==true
    ||row.challenger_is_advisory_only!==true||row.cohort_is_externally_fixed!==true
    ||row.candidate_can_choose_cohort!==false||row.candidate_can_choose_budget!==false||row.candidate_can_activate_canary!==false
    ||row.candidate_can_clear_rollback!==false||row.identity_stable!==true||row.clean_shadow_evidence_required!==true
    ||row.ready_for_external_bounded_canary_review!==true||row.external_canary_controller_required!==true
    ||row.canary_token!==null||row.canary_activation_authorized!==false||row.live_profile_activation_authorized!==false
    ||row.profile_replacement_authorized!==false||row.external_review_owner!==true||row.authored_by_candidate!==false
    ||!Array.isArray(row.comparison_digests)||row.comparison_digests.length<MIN_COMPARISONS
    ||!Array.isArray(row.context_digests)||row.context_digests.length<MIN_CONTEXTS
    ||row.comparison_count!==row.comparison_digests.length||row.context_count!==row.context_digests.length
    ||!Number.isSafeInteger(row.divergence_count)||row.divergence_count<1)throw new Error('rsi_qd_canary_review_policy_invalid');
  for(const [v,l] of [[row.qualification_digest,'qualification'],[row.champion_profile_digest,'champion'],[row.challenger_profile_digest,'challenger'],[row.comparator_root_digest,'comparator'],[row.cohort_digest,'cohort']])dg(v,l);
  for(const value of row.comparison_digests)dg(value,'comparison');
  for(const value of row.context_digests)dg(value,'context');
  if(new Set(row.comparison_digests).size!==row.comparison_digests.length||new Set(row.context_digests).size!==row.context_digests.length)throw new Error('rsi_qd_canary_review_duplicate_evidence');
  const rc=structuredClone(row);delete rc.review_digest;if(digest(rc)!==dg(row.review_digest,'review'))throw new Error('rsi_qd_canary_review_digest_mismatch');
  return Object.freeze(structuredClone(row));
}

function state(sourceSha,rows){
  const core={schema:RSI_QD_BOUNDED_CANARY_REVIEW_LEDGER_SCHEMA,version:1,source_sha:sourceSha,rows,row_count:rows.length,
    append_only:true,active_canary_digest:null,ledger_can_activate_canary:false,ledger_can_clear_rollback:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false};
  return {...core,state_digest:digest(core)};
}

export class RsiQdBoundedCanaryReviewLedger{
  #path;#sourceSha;#rows=[];#initialized=false;
  constructor({statePath,source_sha}={}){if(!statePath)throw new Error('rsi_qd_canary_ledger_path_required');this.#path=path.resolve(statePath);this.#sourceSha=sha(source_sha,'source')}
  async init(){
    if(this.#initialized)return this.snapshot();
    await fs.mkdir(path.dirname(this.#path),{recursive:true});
    try{
      const p=JSON.parse(await fs.readFile(this.#path,'utf8'));zero(p,'ledger');
      if(p.schema!==RSI_QD_BOUNDED_CANARY_REVIEW_LEDGER_SCHEMA||p.version!==1||p.source_sha!==this.#sourceSha||p.append_only!==true
        ||p.active_canary_digest!==null||p.ledger_can_activate_canary!==false||p.ledger_can_clear_rollback!==false
        ||!Array.isArray(p.rows)||p.rows.length>MAX_ROWS)throw new Error('rsi_qd_canary_ledger_state_invalid');
      const clone=structuredClone(p);delete clone.state_digest;if(digest(clone)!==dg(p.state_digest,'ledger'))throw new Error('rsi_qd_canary_ledger_digest_mismatch');
      const ids=new Set();
      const checkedRows=p.rows.map((row)=>{const checked=verifyStoredReview(row);if(checked.source_sha!==this.#sourceSha)throw new Error('rsi_qd_canary_ledger_row_invalid');if(ids.has(checked.review_id))throw new Error('rsi_qd_canary_ledger_duplicate');ids.add(checked.review_id);return checked});
      this.#rows=checkedRows;
    }catch(e){if(e?.code!=='ENOENT')throw e}
    this.#initialized=true;return this.snapshot();
  }
  async #persist(){const s=state(this.#sourceSha,this.#rows);const t=`${this.#path}.tmp`;const h=await fs.open(t,'w',0o600);try{await h.writeFile(`${JSON.stringify(s)}\n`,'utf8');await h.sync()}finally{await h.close()}await fs.rename(t,this.#path)}
  async add(review){
    if(!this.#initialized)throw new Error('rsi_qd_canary_ledger_not_initialized');
    const checked=verifyStoredReview(review);if(checked.source_sha!==this.#sourceSha)throw new Error('rsi_qd_canary_review_source_mismatch');
    const existing=this.#rows.find(x=>x.review_id===checked.review_id);
    if(existing){if(existing.review_digest!==checked.review_digest)throw new Error('rsi_qd_canary_review_identity_conflict');return Object.freeze({state:'IDEMPOTENT',review_digest:checked.review_digest,authority_effect:false})}
    if(this.#rows.length>=MAX_ROWS)throw new Error('rsi_qd_canary_ledger_capacity_exceeded');
    this.#rows.push(structuredClone(checked));await this.#persist();return Object.freeze({state:'REVIEW_RECORDED',review_digest:checked.review_digest,authority_effect:false});
  }
  snapshot(){const s=state(this.#sourceSha,this.#rows);return Object.freeze({schema:s.schema,version:s.version,source_sha:s.source_sha,initialized:this.#initialized,row_count:s.row_count,append_only:true,active_canary_digest:null,ledger_can_activate_canary:false,authority_effect:false})}
}

export function rsiQdBoundedCanaryReviewTrustRootSnapshot(){
  const root={schema:'metaengine.rsi.qd-bounded-canary-review-root.v1',version:1,
    phase19_clean_dual_plan_comparison_required:true,minimum_comparisons:MIN_COMPARISONS,minimum_contexts:MIN_CONTEXTS,
    meaningful_divergence_required:true,exact_profile_identity_required:true,exact_comparator_root_required:true,
    canary_surface:'READ_ONLY_DECISION_SUPPORT',max_canary_decisions:MAX_CANARY_DECISIONS,
    incumbent_remains_default:true,incumbent_is_mandatory_fallback:true,external_cohort_required:true,
    candidate_can_choose_cohort:false,candidate_can_choose_budget:false,candidate_can_activate_canary:false,candidate_can_clear_rollback:false,
    external_canary_controller_required:true,canary_token_minted:false,canary_activation_authorized:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false};
  return Object.freeze({...root,canary_review_root_digest:digest(root)});
}
