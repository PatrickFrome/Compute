import crypto from 'node:crypto';

import {
  verifyRsiExperienceGraphSnapshot,
  verifyRsiExperienceGraphQuery,
  verifyRsiExperienceGraphRetrieval,
} from './rsi-experience-graph.mjs';

export const RSI_BOUNDED_MEMORY_UTILITY_STATE_SCHEMA='metaengine.rsi.bounded-memory-utility-state.v1';
export const RSI_BOUNDED_MEMORY_UTILITY_ROOT_SCHEMA='metaengine.rsi.bounded-memory-utility-root.v1';

const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_TOKEN_RE=/^[A-Z0-9][A-Z0-9_.:-]{0,95}$/;
const MAX_RETRIEVAL_ITEMS=12;
const CAPS=Object.freeze({
  EMPTY:0,
  HARMFUL_DOMINANT:4,
  EVIDENCE_SPARSE:6,
  CORRECTION_GUIDED:8,
  BALANCED:8,
});
const COORDINATE_SCHEMA=Object.freeze([
  'EXACT_HELPFUL',
  'EXACT_HARMFUL',
  'EXACT_NEUTRAL',
  'CROSS_CONTEXT_HELPFUL',
  'CROSS_CONTEXT_HARMFUL',
  'CROSS_CONTEXT_NEUTRAL',
  'CORRECTION_TARGET_CASES',
  'SUCCESS_CASES',
  'FAILURE_CASES',
  'UTILITY_SPARSE_CASES',
]);
const MAX_PAYLOAD_BYTES=16*1024;

function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));
}
function digest(value){
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)),'utf8').digest('hex')}`;
}
function bytes(value){return Buffer.byteLength(JSON.stringify(stable(value)),'utf8')}
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
    if(Object.hasOwn(value||{},key)&&value[key]!==false)throw new Error(`rsi_bounded_utility_${label}_${key}_invalid`);
  }
  if(Object.hasOwn(value||{},'automatic_retry_allowed')&&value.automatic_retry_allowed!==false){
    throw new Error(`rsi_bounded_utility_${label}_retry_invalid`);
  }
}
function sha256(value,label){
  const out=String(value||'').trim().toLowerCase();
  if(!SHA256_RE.test(out))throw new Error(`rsi_bounded_utility_${label}_digest_invalid`);
  return out;
}
function token(value,label){
  const out=String(value||'').trim().toUpperCase();
  if(!SAFE_TOKEN_RE.test(out))throw new Error(`rsi_bounded_utility_${label}_invalid`);
  return out;
}
function nonNegativeInt(value,label,max=Number.MAX_SAFE_INTEGER){
  const out=Number(value);
  if(!Number.isSafeInteger(out)||out<0||out>max)throw new Error(`rsi_bounded_utility_${label}_invalid`);
  return out;
}
function unit(value,label){
  const out=Number(value);
  if(!Number.isFinite(out)||out<0||out>1)throw new Error(`rsi_bounded_utility_${label}_invalid`);
  return Math.round(out*1_000_000)/1_000_000;
}

function aggregate(retrieval){
  const counts={
    EXACT_HELPFUL:0,
    EXACT_HARMFUL:0,
    EXACT_NEUTRAL:0,
    CROSS_CONTEXT_HELPFUL:0,
    CROSS_CONTEXT_HARMFUL:0,
    CROSS_CONTEXT_NEUTRAL:0,
    CORRECTION_TARGET_CASES:0,
    SUCCESS_CASES:0,
    FAILURE_CASES:0,
    UTILITY_SPARSE_CASES:0,
  };
  for(const item of retrieval.items){
    const u=item.contextual_utility||{};
    counts.EXACT_HELPFUL+=nonNegativeInt(u.helpful||0,'exact_helpful');
    counts.EXACT_HARMFUL+=nonNegativeInt(u.harmful||0,'exact_harmful');
    counts.EXACT_NEUTRAL+=nonNegativeInt(u.neutral||0,'exact_neutral');
    counts.CROSS_CONTEXT_HELPFUL+=nonNegativeInt(u.cross_context_helpful||0,'cross_helpful');
    counts.CROSS_CONTEXT_HARMFUL+=nonNegativeInt(u.cross_context_harmful||0,'cross_harmful');
    counts.CROSS_CONTEXT_NEUTRAL+=nonNegativeInt(u.cross_context_neutral||0,'cross_neutral');
    if(item.corrective_trace_target===true)counts.CORRECTION_TARGET_CASES+=1;
    if(item.outcome==='SUCCESS')counts.SUCCESS_CASES+=1;
    else if(item.outcome==='FAILURE')counts.FAILURE_CASES+=1;
    const exactCount=nonNegativeInt(u.evidence_count||0,'exact_evidence');
    const crossCount=nonNegativeInt(u.cross_context_evidence_count||0,'cross_evidence');
    if(exactCount+crossCount===0)counts.UTILITY_SPARSE_CASES+=1;
  }
  return counts;
}

function decideMode({itemCount,weightedHelpful,weightedHarmful,utilityEvidenceCount,correctionTargetCount}){
  if(itemCount===0)return 'EMPTY';
  if(weightedHarmful>weightedHelpful)return 'HARMFUL_DOMINANT';
  if(utilityEvidenceCount===0)return 'EVIDENCE_SPARSE';
  if(correctionTargetCount>0)return 'CORRECTION_GUIDED';
  return 'BALANCED';
}

export function createRsiBoundedMemoryUtilityState({
  experience_graph_snapshot,
  query,
  retrieval,
}={}){
  const graph=verifyRsiExperienceGraphSnapshot(experience_graph_snapshot);
  const checkedQuery=verifyRsiExperienceGraphQuery(query);
  const checkedRetrieval=verifyRsiExperienceGraphRetrieval(retrieval,graph,checkedQuery);
  if(checkedRetrieval.item_count>MAX_RETRIEVAL_ITEMS)throw new Error('rsi_bounded_utility_retrieval_item_budget_exceeded');

  const counts=aggregate(checkedRetrieval);
  const exactEvidence=counts.EXACT_HELPFUL+counts.EXACT_HARMFUL+counts.EXACT_NEUTRAL;
  const crossEvidence=counts.CROSS_CONTEXT_HELPFUL+counts.CROSS_CONTEXT_HARMFUL+counts.CROSS_CONTEXT_NEUTRAL;
  const utilityEvidenceCount=exactEvidence+crossEvidence;
  const weightedHelpful=counts.EXACT_HELPFUL+0.25*counts.CROSS_CONTEXT_HELPFUL;
  const weightedHarmful=counts.EXACT_HARMFUL+0.25*counts.CROSS_CONTEXT_HARMFUL;
  const weightedNeutral=counts.EXACT_NEUTRAL+0.25*counts.CROSS_CONTEXT_NEUTRAL;
  const posteriorHelpful=(1+weightedHelpful)/(2+weightedHelpful+weightedHarmful+0.25*weightedNeutral);
  const mode=decideMode({
    itemCount:checkedRetrieval.item_count,
    weightedHelpful,
    weightedHarmful,
    utilityEvidenceCount,
    correctionTargetCount:counts.CORRECTION_TARGET_CASES,
  });
  const recommendedCaseCap=CAPS[mode];
  const core=zeroAuthority({
    schema:RSI_BOUNDED_MEMORY_UTILITY_STATE_SCHEMA,
    version:1,
    graph_snapshot_digest:sha256(graph.snapshot_digest,'graph_snapshot'),
    query_digest:sha256(checkedQuery.query_digest,'query'),
    retrieval_digest:sha256(checkedRetrieval.retrieval_digest,'retrieval'),
    task_signature_digest:sha256(checkedQuery.task_signature_digest,'task_signature'),
    challenge_family:token(checkedQuery.challenge_family,'challenge_family'),
    target_context_digest:sha256(checkedQuery.target_context_digest,'target_context'),
    mode,
    coordinate_schema:COORDINATE_SCHEMA,
    coordinates:Object.freeze({...counts}),
    coordinate_count:COORDINATE_SCHEMA.length,
    retrieval_item_count:checkedRetrieval.item_count,
    exact_utility_evidence_count:exactEvidence,
    cross_context_utility_evidence_count:crossEvidence,
    total_utility_evidence_count:utilityEvidenceCount,
    weighted_helpful:weightedHelpful,
    weighted_harmful:weightedHarmful,
    weighted_neutral:weightedNeutral,
    posterior_helpful:unit(posteriorHelpful,'posterior_helpful'),
    recommended_case_cap:recommendedCaseCap,
    max_recommended_case_cap:Math.max(...Object.values(CAPS)),
    fixed_dimensional_state:true,
    per_trajectory_utility_state:false,
    trajectory_joint_reward_assignment:false,
    co_retrieved_memory_credit_update:false,
    utility_receipts_are_case_local:true,
    cross_context_utility_discount_weight:0.25,
    exact_context_utility_dominates:true,
    candidate_can_set_utility:false,
    candidate_can_set_case_cap:false,
    candidate_can_mutate_state:false,
    state_is_retrieval_advisory_only:true,
    scalar_reward:null,
    global_candidate_score_delta:null,
    raw_trajectory_stored:false,
    raw_page_text_stored:false,
    raw_user_input_stored:false,
    secret_material_stored:false,
  });
  const payloadBytes=bytes(core);
  if(payloadBytes>MAX_PAYLOAD_BYTES)throw new Error('rsi_bounded_utility_payload_budget_exceeded');
  return Object.freeze({
    ...core,
    payload_bytes:payloadBytes,
    max_payload_bytes:MAX_PAYLOAD_BYTES,
    state_digest:digest(core),
  });
}

export function verifyRsiBoundedMemoryUtilityState(row,{
  experience_graph_snapshot=null,
  query=null,
  retrieval=null,
}={}){
  if(!row||typeof row!=='object'||Array.isArray(row)||row.schema!==RSI_BOUNDED_MEMORY_UTILITY_STATE_SCHEMA||row.version!==1){
    throw new Error('rsi_bounded_utility_state_invalid');
  }
  assertZeroAuthority(row,'state');
  if(
    row.fixed_dimensional_state!==true
    || row.per_trajectory_utility_state!==false
    || row.trajectory_joint_reward_assignment!==false
    || row.co_retrieved_memory_credit_update!==false
    || row.utility_receipts_are_case_local!==true
    || row.cross_context_utility_discount_weight!==0.25
    || row.exact_context_utility_dominates!==true
    || row.candidate_can_set_utility!==false
    || row.candidate_can_set_case_cap!==false
    || row.candidate_can_mutate_state!==false
    || row.state_is_retrieval_advisory_only!==true
    || row.scalar_reward!==null
    || row.global_candidate_score_delta!==null
    || row.raw_trajectory_stored!==false
    || row.raw_page_text_stored!==false
    || row.raw_user_input_stored!==false
    || row.secret_material_stored!==false
  )throw new Error('rsi_bounded_utility_policy_invalid');
  for(const [value,label] of [
    [row.graph_snapshot_digest,'graph_snapshot'],
    [row.query_digest,'query'],
    [row.retrieval_digest,'retrieval'],
    [row.task_signature_digest,'task_signature'],
    [row.target_context_digest,'target_context'],
  ])sha256(value,label);
  token(row.challenge_family,'challenge_family');
  if(!Object.hasOwn(CAPS,row.mode))throw new Error('rsi_bounded_utility_mode_invalid');
  if(!Array.isArray(row.coordinate_schema)||JSON.stringify(row.coordinate_schema)!==JSON.stringify(COORDINATE_SCHEMA)){
    throw new Error('rsi_bounded_utility_coordinate_schema_invalid');
  }
  if(row.coordinate_count!==COORDINATE_SCHEMA.length)throw new Error('rsi_bounded_utility_coordinate_count_invalid');
  if(
    !row.coordinates
    || typeof row.coordinates!=='object'
    || Array.isArray(row.coordinates)
    || JSON.stringify(Object.keys(row.coordinates).sort())!==JSON.stringify([...COORDINATE_SCHEMA].sort())
  )throw new Error('rsi_bounded_utility_coordinates_invalid');
  for(const key of COORDINATE_SCHEMA)nonNegativeInt(row.coordinates[key],`coordinate_${key.toLowerCase()}`);
  const retrievalItemCount=nonNegativeInt(row.retrieval_item_count,'retrieval_item_count',MAX_RETRIEVAL_ITEMS);
  const exactEvidence=nonNegativeInt(row.exact_utility_evidence_count,'exact_utility_evidence_count');
  const crossEvidence=nonNegativeInt(row.cross_context_utility_evidence_count,'cross_context_utility_evidence_count');
  const totalEvidence=nonNegativeInt(row.total_utility_evidence_count,'total_utility_evidence_count');
  const expectedExact=row.coordinates.EXACT_HELPFUL+row.coordinates.EXACT_HARMFUL+row.coordinates.EXACT_NEUTRAL;
  const expectedCross=row.coordinates.CROSS_CONTEXT_HELPFUL+row.coordinates.CROSS_CONTEXT_HARMFUL+row.coordinates.CROSS_CONTEXT_NEUTRAL;
  if(exactEvidence!==expectedExact||crossEvidence!==expectedCross||totalEvidence!==expectedExact+expectedCross){
    throw new Error('rsi_bounded_utility_evidence_count_mismatch');
  }
  if(
    row.coordinates.SUCCESS_CASES+row.coordinates.FAILURE_CASES!==retrievalItemCount
    || row.coordinates.UTILITY_SPARSE_CASES>retrievalItemCount
    || row.coordinates.CORRECTION_TARGET_CASES>retrievalItemCount
  )throw new Error('rsi_bounded_utility_case_coordinate_mismatch');
  const expectedWeightedHelpful=row.coordinates.EXACT_HELPFUL+0.25*row.coordinates.CROSS_CONTEXT_HELPFUL;
  const expectedWeightedHarmful=row.coordinates.EXACT_HARMFUL+0.25*row.coordinates.CROSS_CONTEXT_HARMFUL;
  const expectedWeightedNeutral=row.coordinates.EXACT_NEUTRAL+0.25*row.coordinates.CROSS_CONTEXT_NEUTRAL;
  if(
    Number(row.weighted_helpful)!==expectedWeightedHelpful
    || Number(row.weighted_harmful)!==expectedWeightedHarmful
    || Number(row.weighted_neutral)!==expectedWeightedNeutral
  )throw new Error('rsi_bounded_utility_weighted_coordinate_mismatch');
  const expectedPosterior=unit(
    (1+expectedWeightedHelpful)/(2+expectedWeightedHelpful+expectedWeightedHarmful+0.25*expectedWeightedNeutral),
    'expected_posterior_helpful',
  );
  if(unit(row.posterior_helpful,'posterior_helpful')!==expectedPosterior){
    throw new Error('rsi_bounded_utility_posterior_mismatch');
  }
  const expectedMode=decideMode({
    itemCount:retrievalItemCount,
    weightedHelpful:expectedWeightedHelpful,
    weightedHarmful:expectedWeightedHarmful,
    utilityEvidenceCount:totalEvidence,
    correctionTargetCount:row.coordinates.CORRECTION_TARGET_CASES,
  });
  if(row.mode!==expectedMode)throw new Error('rsi_bounded_utility_mode_mismatch');
  if(row.recommended_case_cap!==CAPS[row.mode]||row.max_recommended_case_cap!==Math.max(...Object.values(CAPS))){
    throw new Error('rsi_bounded_utility_case_cap_invalid');
  }
  const core={...structuredClone(row)};
  delete core.payload_bytes;
  delete core.max_payload_bytes;
  delete core.state_digest;
  const payloadBytes=bytes(core);
  if(payloadBytes!==Number(row.payload_bytes)||payloadBytes>Number(row.max_payload_bytes)||Number(row.max_payload_bytes)!==MAX_PAYLOAD_BYTES){
    throw new Error('rsi_bounded_utility_size_mismatch');
  }
  if(digest(core)!==sha256(row.state_digest,'state'))throw new Error('rsi_bounded_utility_digest_mismatch');

  if(experience_graph_snapshot!=null||query!=null||retrieval!=null){
    if(experience_graph_snapshot==null||query==null||retrieval==null)throw new Error('rsi_bounded_utility_full_reverification_required');
    const canonical=createRsiBoundedMemoryUtilityState({
      experience_graph_snapshot,
      query,
      retrieval,
    });
    if(canonical.state_digest!==row.state_digest)throw new Error('rsi_bounded_utility_recomputed_state_mismatch');
  }
  return row;
}

export function rsiBoundedMemoryUtilityTrustRootSnapshot(){
  const root=zeroAuthority({
    schema:RSI_BOUNDED_MEMORY_UTILITY_ROOT_SCHEMA,
    version:1,
    policy_path:'apps/metaengine-browser/src/rsi-bounded-memory-utility-state.mjs',
    fixed_dimensional_state:true,
    coordinate_schema:COORDINATE_SCHEMA,
    per_trajectory_utility_state:false,
    trajectory_joint_reward_assignment:false,
    co_retrieved_memory_credit_update:false,
    utility_receipts_are_case_local:true,
    cross_context_utility_discount_weight:0.25,
    exact_context_utility_dominates:true,
    harmful_dominant_case_cap:CAPS.HARMFUL_DOMINANT,
    evidence_sparse_case_cap:CAPS.EVIDENCE_SPARSE,
    correction_guided_case_cap:CAPS.CORRECTION_GUIDED,
    balanced_case_cap:CAPS.BALANCED,
    candidate_can_set_utility:false,
    candidate_can_set_case_cap:false,
    state_is_retrieval_advisory_only:true,
    scalar_reward_allowed:false,
    global_candidate_score_delta_allowed:false,
    raw_trajectory_stored:false,
    raw_page_text_stored:false,
    raw_user_input_stored:false,
    secret_material_stored:false,
    no_second_scheduler:true,
    max_payload_bytes:MAX_PAYLOAD_BYTES,
  });
  return Object.freeze({...root,bounded_memory_utility_root_digest:digest(root)});
}
