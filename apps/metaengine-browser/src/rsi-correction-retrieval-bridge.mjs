import crypto from 'node:crypto';

import { verifyRsiExperienceGraphSnapshot } from './rsi-experience-graph.mjs';
import { verifyRsiExperienceContextPlan } from './rsi-experience-context-planner.mjs';

export const RSI_CORRECTION_RETRIEVAL_BRIDGE_SCHEMA='metaengine.rsi.correction-retrieval-bridge.v1';
export const RSI_CORRECTION_RETRIEVAL_BRIDGE_ROOT_SCHEMA='metaengine.rsi.correction-retrieval-bridge-root.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const MAX_BRIDGES=4;
const MAX_EVIDENCE_REFS=16;
const MAX_PAYLOAD_BYTES=24*1024;

function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));
}
function digest(value){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)),'utf8').digest('hex')}`}
function bytes(value){return Buffer.byteLength(JSON.stringify(stable(value)),'utf8')}
function zeroAuthority(extra={}){return Object.freeze({...extra,execution_authority:false,browser_authority:false,scheduler_authority:false,task_authority:false,production_mutation_authority:false,promotion_authority:false,release_authority:false,self_update_authority:false,automatic_retry_allowed:false,authority_effect:false})}
function assertZeroAuthority(value,label){
  for(const key of ['execution_authority','browser_authority','scheduler_authority','task_authority','production_mutation_authority','promotion_authority','release_authority','self_update_authority','authority_effect']){
    if(Object.hasOwn(value||{},key)&&value[key]!==false)throw new Error(`rsi_correction_bridge_${label}_${key}_invalid`);
  }
  if(Object.hasOwn(value||{},'automatic_retry_allowed')&&value.automatic_retry_allowed!==false)throw new Error(`rsi_correction_bridge_${label}_retry_invalid`);
}
function sha(value,label){const out=String(value||'').trim().toLowerCase();if(!SHA40_RE.test(out))throw new Error(`rsi_correction_bridge_${label}_sha_invalid`);return out}
function sha256(value,label){const out=String(value||'').trim().toLowerCase();if(!SHA256_RE.test(out))throw new Error(`rsi_correction_bridge_${label}_digest_invalid`);return out}
function safeId(value,label){const out=String(value||'').trim();if(!SAFE_ID_RE.test(out))throw new Error(`rsi_correction_bridge_${label}_invalid`);return out}
function refs(value){
  if(!Array.isArray(value)||value.length<1||value.length>MAX_EVIDENCE_REFS)throw new Error('rsi_correction_bridge_evidence_refs_invalid');
  const out=value.map(v=>safeId(v,'evidence_ref')).sort();
  if(new Set(out).size!==out.length)throw new Error('rsi_correction_bridge_evidence_ref_duplicate');
  return Object.freeze(out);
}

function verifyBridgeCases(snapshot,ids){
  const caseById=new Map(snapshot.cases.map(row=>[row.case_id,row]));
  const correctionByFailure=new Map(snapshot.correction_edges.map(row=>[row.from_case_id,row]));
  return Object.freeze(ids.map(id=>{
    const row=caseById.get(id);
    const correction=correctionByFailure.get(id);
    if(!row||row.outcome!=='FAILURE'||!correction)throw new Error('rsi_correction_bridge_case_not_verified_failure_trace');
    const fixed=caseById.get(correction.to_case_id);
    if(!fixed||fixed.outcome!=='SUCCESS')throw new Error('rsi_correction_bridge_successor_trace_missing');
    return Object.freeze({
      case_id:id,
      case_digest:row.case_digest,
      task_signature_digest:row.task_signature_digest,
      correction_target_case_id:fixed.case_id,
      correction_target_case_digest:fixed.case_digest,
      correction_evidence_digest:correction.evidence_digest,
    });
  }));
}

export function createRsiCorrectionRetrievalBridge({
  source_sha,
  base_context_plan,
  experience_graph_snapshot,
  selection,
}={}){
  const source=sha(source_sha,'source');
  const plan=verifyRsiExperienceContextPlan(base_context_plan);
  const graph=verifyRsiExperienceGraphSnapshot(experience_graph_snapshot);
  if(plan.source_sha!==source)throw new Error('rsi_correction_bridge_plan_source_mismatch');
  if(plan.graph_snapshot_digest!==graph.snapshot_digest)throw new Error('rsi_correction_bridge_graph_snapshot_mismatch');
  if(!selection||typeof selection!=='object'||Array.isArray(selection))throw new Error('rsi_correction_bridge_selection_invalid');
  if(
    selection.external_selector!==true
    || selection.authored_by_candidate!==false
    || selection.candidate_can_select_bridges!==false
  )throw new Error('rsi_correction_bridge_external_selector_required');
  if(!Array.isArray(selection.bridge_case_ids)||selection.bridge_case_ids.length<1||selection.bridge_case_ids.length>MAX_BRIDGES){
    throw new Error('rsi_correction_bridge_case_ids_invalid');
  }
  const bridgeIds=selection.bridge_case_ids.map(v=>safeId(v,'bridge_case_id')).sort();
  if(new Set(bridgeIds).size!==bridgeIds.length)throw new Error('rsi_correction_bridge_case_id_duplicate');
  const selectedCases=verifyBridgeCases(graph,bridgeIds);
  const core=zeroAuthority({
    schema:RSI_CORRECTION_RETRIEVAL_BRIDGE_SCHEMA,
    version:1,
    source_sha:source,
    selector_id:safeId(selection.selector_id,'selector_id'),
    selection_id:safeId(selection.selection_id,'selection_id'),
    base_context_plan_digest:sha256(plan.context_plan_digest,'base_context_plan'),
    base_query_digest:sha256(plan.query_digest,'base_query'),
    opportunity_id:safeId(plan.opportunity_id,'opportunity_id'),
    target_context_digest:sha256(plan.target_context_digest,'target_context'),
    graph_snapshot_digest:sha256(graph.snapshot_digest,'graph_snapshot'),
    bridge_case_ids:Object.freeze(bridgeIds),
    selected_cases:selectedCases,
    evidence_digest:sha256(selection.evidence_digest,'evidence'),
    evidence_refs:refs(selection.evidence_refs),
    external_selector:true,
    authored_by_candidate:false,
    candidate_can_select_bridges:false,
    correction_failures_only:true,
    verified_success_targets_required:true,
    bridge_selection_is_retrieval_signal_only:true,
    bridge_selection_is_execution_authority:false,
    bridge_selection_is_promotion_authority:false,
    source_context_truth_is_portable:false,
    cross_context_use_requires_current_plan_binding:true,
    raw_trajectory_exposed:false,
    raw_page_text_exposed:false,
    raw_user_input_exposed:false,
    secret_material_exposed:false,
  });
  const payloadBytes=bytes(core);
  if(payloadBytes>MAX_PAYLOAD_BYTES)throw new Error('rsi_correction_bridge_payload_budget_exceeded');
  return Object.freeze({...core,payload_bytes:payloadBytes,max_payload_bytes:MAX_PAYLOAD_BYTES,bridge_digest:digest(core)});
}

export function verifyRsiCorrectionRetrievalBridge(row,baseContextPlan,experienceGraphSnapshot){
  if(!row||typeof row!=='object'||Array.isArray(row)||row.schema!==RSI_CORRECTION_RETRIEVAL_BRIDGE_SCHEMA||row.version!==1)throw new Error('rsi_correction_bridge_invalid');
  assertZeroAuthority(row,'bridge');
  if(
    row.external_selector!==true
    || row.authored_by_candidate!==false
    || row.candidate_can_select_bridges!==false
    || row.correction_failures_only!==true
    || row.verified_success_targets_required!==true
    || row.bridge_selection_is_retrieval_signal_only!==true
    || row.bridge_selection_is_execution_authority!==false
    || row.bridge_selection_is_promotion_authority!==false
    || row.source_context_truth_is_portable!==false
    || row.cross_context_use_requires_current_plan_binding!==true
    || row.raw_trajectory_exposed!==false
    || row.raw_page_text_exposed!==false
    || row.raw_user_input_exposed!==false
    || row.secret_material_exposed!==false
  )throw new Error('rsi_correction_bridge_policy_invalid');
  const plan=verifyRsiExperienceContextPlan(baseContextPlan);
  const graph=verifyRsiExperienceGraphSnapshot(experienceGraphSnapshot);
  if(
    row.source_sha!==plan.source_sha
    || row.base_context_plan_digest!==plan.context_plan_digest
    || row.base_query_digest!==plan.query_digest
    || row.opportunity_id!==plan.opportunity_id
    || row.target_context_digest!==plan.target_context_digest
    || row.graph_snapshot_digest!==graph.snapshot_digest
    || plan.graph_snapshot_digest!==graph.snapshot_digest
  )throw new Error('rsi_correction_bridge_context_binding_mismatch');
  safeId(row.selector_id,'selector_id');safeId(row.selection_id,'selection_id');
  const bridgeIds=row.bridge_case_ids.map(v=>safeId(v,'bridge_case_id')).sort();
  if(bridgeIds.length<1||bridgeIds.length>MAX_BRIDGES||new Set(bridgeIds).size!==bridgeIds.length)throw new Error('rsi_correction_bridge_case_ids_invalid');
  const selectedCases=verifyBridgeCases(graph,bridgeIds);
  if(JSON.stringify(selectedCases)!==JSON.stringify(row.selected_cases))throw new Error('rsi_correction_bridge_selected_cases_mismatch');
  sha256(row.evidence_digest,'evidence');refs(row.evidence_refs);
  const core={...structuredClone(row)};delete core.payload_bytes;delete core.max_payload_bytes;delete core.bridge_digest;
  const payloadBytes=bytes(core);
  if(payloadBytes!==Number(row.payload_bytes)||payloadBytes>Number(row.max_payload_bytes)||Number(row.max_payload_bytes)!==MAX_PAYLOAD_BYTES)throw new Error('rsi_correction_bridge_size_mismatch');
  if(digest(core)!==sha256(row.bridge_digest,'bridge'))throw new Error('rsi_correction_bridge_digest_mismatch');
  return row;
}

export function rsiCorrectionRetrievalBridgeTrustRootSnapshot(){
  const root=zeroAuthority({
    schema:RSI_CORRECTION_RETRIEVAL_BRIDGE_ROOT_SCHEMA,
    version:1,
    policy_path:'apps/metaengine-browser/src/rsi-correction-retrieval-bridge.mjs',
    current_base_context_plan_required:true,
    exact_graph_snapshot_required:true,
    correction_failure_cases_only:true,
    verified_success_correction_targets_required:true,
    external_selector_required:true,
    candidate_can_select_bridges:false,
    max_bridge_cases:MAX_BRIDGES,
    bridge_selection_is_retrieval_signal_only:true,
    source_context_truth_is_portable:false,
    cross_context_use_requires_current_plan_binding:true,
    raw_trajectory_exposed:false,
    raw_page_text_exposed:false,
    raw_user_input_exposed:false,
    secret_material_exposed:false,
    execution_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    no_second_scheduler:true,
    max_payload_bytes:MAX_PAYLOAD_BYTES,
  });
  return Object.freeze({...root,correction_bridge_root_digest:digest(root)});
}
