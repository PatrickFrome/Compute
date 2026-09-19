import crypto from 'node:crypto';

import {
  verifyRsiExperienceGraphSnapshot,
  verifyRsiExperienceGraphQuery,
  verifyRsiExperienceGraphRetrieval,
} from './rsi-experience-graph.mjs';

export const RSI_MEMORY_RELIABILITY_PROJECTION_SCHEMA='metaengine.rsi.memory-reliability-projection.v1';
export const RSI_MEMORY_RELIABILITY_ROOT_SCHEMA='metaengine.rsi.memory-reliability-root.v1';

const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const TIERS=Object.freeze(['HOT','WARM','COLD','QUARANTINED']);
const MAX_ITEMS=12;

const POLICY=Object.freeze({
  quarantine_exact_harmful_min:2,
  quarantine_weighted_harmful_min:2,
  quarantine_posterior_max:0.30,
  hot_evidence_min:2,
  hot_posterior_min:0.70,
  warm_posterior_min:0.50,
  cross_context_weight:0.25,
});

function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));
}
function digest(value){
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)),'utf8').digest('hex')}`;
}
function zeroAuthority(extra={}){
  return Object.freeze({
    ...extra,
    execution_authority:false,
    browser_authority:false,
    scheduler_authority:false,
    task_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    release_authority:false,
    self_update_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  });
}
function assertZeroAuthority(value,label){
  for(const key of [
    'execution_authority','browser_authority','scheduler_authority','task_authority',
    'production_mutation_authority','promotion_authority','release_authority',
    'self_update_authority','authority_effect',
  ]){
    if(Object.hasOwn(value||{},key)&&value[key]!==false)throw new Error(`rsi_memory_reliability_${label}_${key}_invalid`);
  }
  if(Object.hasOwn(value||{},'automatic_retry_allowed')&&value.automatic_retry_allowed!==false){
    throw new Error(`rsi_memory_reliability_${label}_retry_invalid`);
  }
}
function sha256(value,label){
  const out=String(value||'').trim().toLowerCase();
  if(!SHA256_RE.test(out))throw new Error(`rsi_memory_reliability_${label}_digest_invalid`);
  return out;
}
function safeId(value,label){
  const out=String(value||'').trim();
  if(!SAFE_ID_RE.test(out))throw new Error(`rsi_memory_reliability_${label}_invalid`);
  return out;
}
function nonNegativeInt(value,label){
  const out=Number(value);
  if(!Number.isSafeInteger(out)||out<0)throw new Error(`rsi_memory_reliability_${label}_invalid`);
  return out;
}
function unit(value,label){
  const out=Number(value);
  if(!Number.isFinite(out)||out<0||out>1)throw new Error(`rsi_memory_reliability_${label}_invalid`);
  return Math.round(out*1_000_000)/1_000_000;
}
function number(value,label){
  const out=Number(value);
  if(!Number.isFinite(out)||out<0)throw new Error(`rsi_memory_reliability_${label}_invalid`);
  return Math.round(out*1_000_000)/1_000_000;
}

function utilitySummary(item){
  const u=item?.contextual_utility||{};
  const exactHelpful=nonNegativeInt(u.helpful||0,'exact_helpful');
  const exactHarmful=nonNegativeInt(u.harmful||0,'exact_harmful');
  const exactNeutral=nonNegativeInt(u.neutral||0,'exact_neutral');
  const crossHelpful=nonNegativeInt(u.cross_context_helpful||0,'cross_helpful');
  const crossHarmful=nonNegativeInt(u.cross_context_harmful||0,'cross_harmful');
  const crossNeutral=nonNegativeInt(u.cross_context_neutral||0,'cross_neutral');
  const exactCount=exactHelpful+exactHarmful+exactNeutral;
  const crossCount=crossHelpful+crossHarmful+crossNeutral;
  const totalCount=exactCount+crossCount;
  const weightedHelpful=exactHelpful+POLICY.cross_context_weight*crossHelpful;
  const weightedHarmful=exactHarmful+POLICY.cross_context_weight*crossHarmful;
  const weightedNeutral=exactNeutral+POLICY.cross_context_weight*crossNeutral;
  const posterior=unit(u.posterior_mean==null?0.5:u.posterior_mean,'posterior');
  return Object.freeze({
    exact_helpful:exactHelpful,
    exact_harmful:exactHarmful,
    exact_neutral:exactNeutral,
    cross_context_helpful:crossHelpful,
    cross_context_harmful:crossHarmful,
    cross_context_neutral:crossNeutral,
    exact_evidence_count:exactCount,
    cross_context_evidence_count:crossCount,
    total_evidence_count:totalCount,
    weighted_helpful:number(weightedHelpful,'weighted_helpful'),
    weighted_harmful:number(weightedHarmful,'weighted_harmful'),
    weighted_neutral:number(weightedNeutral,'weighted_neutral'),
    posterior_helpful:posterior,
  });
}

function deriveTier({item,utility}){
  const hasHelpful=(utility.exact_helpful+utility.cross_context_helpful)>0;
  const hasHarmful=(utility.exact_harmful+utility.cross_context_harmful)>0;
  const conflicted=hasHelpful&&hasHarmful;
  const harmfulDominant=utility.weighted_harmful>utility.weighted_helpful;
  const severeExactHarm=utility.exact_harmful>=POLICY.quarantine_exact_harmful_min;
  const severeWeightedHarm=utility.weighted_harmful>=POLICY.quarantine_weighted_harmful_min
    && utility.posterior_helpful<=POLICY.quarantine_posterior_max;

  if(harmfulDominant&&(severeExactHarm||severeWeightedHarm)){
    return Object.freeze({tier:'QUARANTINED',reason:'HARMFUL_EVIDENCE_DOMINANT',conflicted});
  }
  if(conflicted){
    return Object.freeze({tier:'COLD',reason:'UTILITY_CONFLICT',conflicted:true});
  }
  if(
    item.outcome==='SUCCESS'
    && utility.total_evidence_count>=POLICY.hot_evidence_min
    && utility.posterior_helpful>=POLICY.hot_posterior_min
  ){
    return Object.freeze({tier:'HOT',reason:'REPEATED_HELPFUL_EVIDENCE',conflicted:false});
  }
  if(
    item.outcome==='SUCCESS'
    && (
      utility.posterior_helpful>=POLICY.warm_posterior_min
      || item.corrective_trace_target===true
    )
  ){
    return Object.freeze({
      tier:'WARM',
      reason:item.corrective_trace_target===true?'VERIFIED_CORRECTION_TARGET':'NON_HARMFUL_SUCCESS',
      conflicted:false,
    });
  }
  return Object.freeze({
    tier:'COLD',
    reason:item.outcome==='FAILURE'?'FAILURE_CASE_REQUIRES_CONTEXT':'EVIDENCE_SPARSE_OR_UNCERTAIN',
    conflicted:false,
  });
}

function rowFromItem(item){
  const utility=utilitySummary(item);
  const derived=deriveTier({item,utility});
  return Object.freeze({
    case_id:safeId(item.case_id,'case_id'),
    case_digest:sha256(item.case_digest,'case'),
    outcome:String(item.outcome||'').toUpperCase(),
    corrective_trace_target:item.corrective_trace_target===true,
    exact_task_match:item.exact_task_match===true,
    query_bridge:item.query_bridge===true,
    utility,
    tier:derived.tier,
    tier_reason:derived.reason,
    utility_conflicted:derived.conflicted,
    candidate_guidance_allowed:derived.tier!=='QUARANTINED',
    remains_queryable:true,
    history_deleted:false,
    candidate_can_set_tier:false,
    candidate_can_set_thresholds:false,
    tier_is_execution_authority:false,
    tier_is_promotion_authority:false,
  });
}

function verifyRow(row){
  if(!row||typeof row!=='object'||Array.isArray(row))throw new Error('rsi_memory_reliability_row_invalid');
  safeId(row.case_id,'case_id');
  sha256(row.case_digest,'case');
  if(!['SUCCESS','FAILURE'].includes(row.outcome))throw new Error('rsi_memory_reliability_outcome_invalid');
  if(!TIERS.includes(row.tier))throw new Error('rsi_memory_reliability_tier_invalid');
  if(
    row.remains_queryable!==true
    || row.history_deleted!==false
    || row.candidate_can_set_tier!==false
    || row.candidate_can_set_thresholds!==false
    || row.tier_is_execution_authority!==false
    || row.tier_is_promotion_authority!==false
  )throw new Error('rsi_memory_reliability_row_policy_invalid');
  const utility=row.utility;
  if(!utility||typeof utility!=='object'||Array.isArray(utility))throw new Error('rsi_memory_reliability_utility_invalid');
  for(const key of [
    'exact_helpful','exact_harmful','exact_neutral',
    'cross_context_helpful','cross_context_harmful','cross_context_neutral',
    'exact_evidence_count','cross_context_evidence_count','total_evidence_count',
  ])nonNegativeInt(utility[key],key);
  number(utility.weighted_helpful,'weighted_helpful');
  number(utility.weighted_harmful,'weighted_harmful');
  number(utility.weighted_neutral,'weighted_neutral');
  unit(utility.posterior_helpful,'posterior_helpful');

  const expectedExact=utility.exact_helpful+utility.exact_harmful+utility.exact_neutral;
  const expectedCross=utility.cross_context_helpful+utility.cross_context_harmful+utility.cross_context_neutral;
  if(
    utility.exact_evidence_count!==expectedExact
    || utility.cross_context_evidence_count!==expectedCross
    || utility.total_evidence_count!==expectedExact+expectedCross
  )throw new Error('rsi_memory_reliability_utility_count_mismatch');
  const expectedWeightedHelpful=number(utility.exact_helpful+POLICY.cross_context_weight*utility.cross_context_helpful,'expected_weighted_helpful');
  const expectedWeightedHarmful=number(utility.exact_harmful+POLICY.cross_context_weight*utility.cross_context_harmful,'expected_weighted_harmful');
  const expectedWeightedNeutral=number(utility.exact_neutral+POLICY.cross_context_weight*utility.cross_context_neutral,'expected_weighted_neutral');
  if(
    utility.weighted_helpful!==expectedWeightedHelpful
    || utility.weighted_harmful!==expectedWeightedHarmful
    || utility.weighted_neutral!==expectedWeightedNeutral
  )throw new Error('rsi_memory_reliability_weight_mismatch');
  const expected=deriveTier({item:row,utility});
  if(
    row.tier!==expected.tier
    || row.tier_reason!==expected.reason
    || row.utility_conflicted!==expected.conflicted
    || row.candidate_guidance_allowed!==(expected.tier!=='QUARANTINED')
  )throw new Error('rsi_memory_reliability_tier_derivation_mismatch');
  return row;
}

export function createRsiMemoryReliabilityProjection({
  experience_graph_snapshot,
  query,
  retrieval,
}={}){
  const graph=verifyRsiExperienceGraphSnapshot(experience_graph_snapshot);
  const checkedQuery=verifyRsiExperienceGraphQuery(query);
  const checkedRetrieval=verifyRsiExperienceGraphRetrieval(retrieval,graph,checkedQuery);
  if(checkedRetrieval.item_count>MAX_ITEMS)throw new Error('rsi_memory_reliability_item_budget_exceeded');
  const rows=Object.freeze(checkedRetrieval.items.map(rowFromItem));
  const tierCounts=Object.fromEntries(TIERS.map(tier=>[tier,rows.filter(row=>row.tier===tier).length]));
  const quarantined=rows.filter(row=>row.tier==='QUARANTINED');
  const guidance=rows.filter(row=>row.candidate_guidance_allowed);
  const core=zeroAuthority({
    schema:RSI_MEMORY_RELIABILITY_PROJECTION_SCHEMA,
    version:1,
    graph_snapshot_digest:sha256(graph.snapshot_digest,'graph_snapshot'),
    query_digest:sha256(checkedQuery.query_digest,'query'),
    retrieval_digest:sha256(checkedRetrieval.retrieval_digest,'retrieval'),
    target_context_digest:sha256(checkedQuery.target_context_digest,'target_context'),
    rows,
    row_count:rows.length,
    tier_counts:Object.freeze(tierCounts),
    quarantined_case_ids:Object.freeze(quarantined.map(row=>row.case_id).sort()),
    candidate_guidance_case_ids:Object.freeze(guidance.map(row=>row.case_id).sort()),
    quarantine_count:quarantined.length,
    candidate_guidance_count:guidance.length,
    policy:POLICY,
    reliability_is_contextual_not_global_truth:true,
    quarantined_memory_remains_queryable:true,
    quarantine_deletes_history:false,
    quarantine_is_retrieval_filter_not_authority:true,
    rehabilitation_requires_new_external_utility:true,
    candidate_can_set_tier:false,
    candidate_can_set_thresholds:false,
    candidate_can_delete_memory:false,
    raw_trajectory_stored:false,
    raw_page_text_stored:false,
    raw_user_input_stored:false,
    secret_material_stored:false,
  });
  return Object.freeze({...core,projection_digest:digest(core)});
}

export function verifyRsiMemoryReliabilityProjection(row,{
  experience_graph_snapshot=null,
  query=null,
  retrieval=null,
}={}){
  if(!row||typeof row!=='object'||Array.isArray(row)||row.schema!==RSI_MEMORY_RELIABILITY_PROJECTION_SCHEMA||row.version!==1){
    throw new Error('rsi_memory_reliability_projection_invalid');
  }
  assertZeroAuthority(row,'projection');
  if(
    row.reliability_is_contextual_not_global_truth!==true
    || row.quarantined_memory_remains_queryable!==true
    || row.quarantine_deletes_history!==false
    || row.quarantine_is_retrieval_filter_not_authority!==true
    || row.rehabilitation_requires_new_external_utility!==true
    || row.candidate_can_set_tier!==false
    || row.candidate_can_set_thresholds!==false
    || row.candidate_can_delete_memory!==false
    || row.raw_trajectory_stored!==false
    || row.raw_page_text_stored!==false
    || row.raw_user_input_stored!==false
    || row.secret_material_stored!==false
  )throw new Error('rsi_memory_reliability_policy_invalid');
  for(const [value,label] of [
    [row.graph_snapshot_digest,'graph_snapshot'],
    [row.query_digest,'query'],
    [row.retrieval_digest,'retrieval'],
    [row.target_context_digest,'target_context'],
  ])sha256(value,label);
  if(JSON.stringify(row.policy)!==JSON.stringify(POLICY))throw new Error('rsi_memory_reliability_threshold_policy_invalid');
  if(!Array.isArray(row.rows)||row.rows.length>MAX_ITEMS||row.row_count!==row.rows.length){
    throw new Error('rsi_memory_reliability_rows_invalid');
  }
  const ids=new Set();
  for(const item of row.rows){
    verifyRow(item);
    if(ids.has(item.case_id))throw new Error('rsi_memory_reliability_case_duplicate');
    ids.add(item.case_id);
  }
  const expectedTierCounts=Object.fromEntries(TIERS.map(tier=>[tier,row.rows.filter(item=>item.tier===tier).length]));
  if(JSON.stringify(row.tier_counts)!==JSON.stringify(expectedTierCounts))throw new Error('rsi_memory_reliability_tier_count_mismatch');
  const expectedQuarantined=row.rows.filter(item=>item.tier==='QUARANTINED').map(item=>item.case_id).sort();
  const expectedGuidance=row.rows.filter(item=>item.candidate_guidance_allowed).map(item=>item.case_id).sort();
  if(
    JSON.stringify(row.quarantined_case_ids)!==JSON.stringify(expectedQuarantined)
    || JSON.stringify(row.candidate_guidance_case_ids)!==JSON.stringify(expectedGuidance)
    || row.quarantine_count!==expectedQuarantined.length
    || row.candidate_guidance_count!==expectedGuidance.length
  )throw new Error('rsi_memory_reliability_projection_set_mismatch');
  const core={...structuredClone(row)};
  delete core.projection_digest;
  if(digest(core)!==sha256(row.projection_digest,'projection'))throw new Error('rsi_memory_reliability_projection_digest_mismatch');

  if(experience_graph_snapshot!=null||query!=null||retrieval!=null){
    if(experience_graph_snapshot==null||query==null||retrieval==null)throw new Error('rsi_memory_reliability_full_reverification_required');
    const canonical=createRsiMemoryReliabilityProjection({
      experience_graph_snapshot,
      query,
      retrieval,
    });
    if(canonical.projection_digest!==row.projection_digest)throw new Error('rsi_memory_reliability_recomputed_projection_mismatch');
  }
  return row;
}

export function rsiMemoryReliabilityTrustRootSnapshot(){
  const root=zeroAuthority({
    schema:RSI_MEMORY_RELIABILITY_ROOT_SCHEMA,
    version:1,
    policy_path:'apps/metaengine-browser/src/rsi-memory-reliability-tier.mjs',
    tiers:TIERS,
    policy:POLICY,
    exact_case_local_external_utility_only:true,
    correction_target_is_positive_reliability_signal:true,
    conflicted_utility_never_hot:true,
    repeated_harmful_evidence_can_quarantine:true,
    quarantined_memory_remains_queryable:true,
    quarantine_deletes_history:false,
    quarantine_is_retrieval_filter_not_authority:true,
    rehabilitation_requires_new_external_utility:true,
    candidate_can_set_tier:false,
    candidate_can_set_thresholds:false,
    candidate_can_delete_memory:false,
    retrieval_is_advisory_only:true,
    raw_trajectory_stored:false,
    raw_page_text_stored:false,
    raw_user_input_stored:false,
    secret_material_stored:false,
    no_second_scheduler:true,
  });
  return Object.freeze({...root,memory_reliability_root_digest:digest(root)});
}
