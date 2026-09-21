import crypto from 'node:crypto';

export const RSI_HARNESS_COMPONENT_REGISTRY_SCHEMA = 'metaengine.rsi.harness-component-registry.v1';
export const RSI_HARNESS_TRACE_IR_SCHEMA = 'metaengine.rsi.harness-trace-ir.v1';
export const RSI_HARNESS_FLAW_RECORD_SCHEMA = 'metaengine.rsi.harness-flaw-record.v1';
export const RSI_HARNESS_REPAIR_SPEC_SCHEMA = 'metaengine.rsi.harness-repair-spec.v1';
export const RSI_HARNESS_REPAIR_OUTCOME_SCHEMA = 'metaengine.rsi.harness-repair-outcome.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const SAFE_TOKEN_RE=/^[A-Z0-9][A-Z0-9_.:-]{0,95}$/;
const MAX_COMPONENTS=256;
const MAX_STEPS=2048;
const MAX_PREDS=16;
const MAX_EVIDENCE_REFS=32;
const MAX_CODES=24;

const LAYERS=Object.freeze(['EXECUTION','TOOLS','CONTEXT','LIFECYCLE','OBSERVABILITY','VERIFICATION','GOVERNANCE']);
const STEP_KINDS=Object.freeze(['MODEL','TOOL_REQUEST','TOOL_RESULT','STATE_TRANSITION','VERIFICATION','RECOVERY','OBSERVABILITY','OUTPUT']);
const REPAIR_OPERATORS=Object.freeze(['SCOPED_GUARD','BOUNDED_RETRY_POLICY','CONTEXT_REPAIR','TOOL_CONTRACT_REPAIR','LIFECYCLE_FENCE','OBSERVABILITY_REPAIR','VERIFICATION_REPAIR','GOVERNANCE_FENCE']);
const OUTCOMES=new Set(['PASS','FAIL','AMBIGUOUS']);

function plainObject(v){if(!v||typeof v!=='object'||Array.isArray(v))return false;const p=Object.getPrototypeOf(v);return p===Object.prototype||p===null;}
function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]))}
function digest(v){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`}
function exactDigest(v,l){const o=String(v||'').toLowerCase();if(!SHA256_RE.test(o))throw new Error(`rsi_harness_${l}_digest_invalid`);return o}
function exactSha(v,l){const o=String(v||'').toLowerCase();if(!SHA40_RE.test(o))throw new Error(`rsi_harness_${l}_sha_invalid`);return o}
function boundedId(v,l){const o=String(v||'').trim();if(!SAFE_ID_RE.test(o))throw new Error(`rsi_harness_${l}_invalid`);return o}
function boundedToken(v,l){const o=String(v||'').trim().toUpperCase();if(!SAFE_TOKEN_RE.test(o))throw new Error(`rsi_harness_${l}_invalid`);return o}
function positiveInt(v,l,max=Number.MAX_SAFE_INTEGER){const o=Number(v);if(!Number.isSafeInteger(o)||o<1||o>max)throw new Error(`rsi_harness_${l}_invalid`);return o}
function finite(v,l){const o=Number(v);if(!Number.isFinite(o))throw new Error(`rsi_harness_${l}_invalid`);return o}
function zeroAuthority(extra={}){return Object.freeze({...extra,execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,automatic_retry_allowed:false,authority_effect:false})}
function assertZeroAuthority(v,l){for(const f of ['execution_authority','production_mutation_authority','promotion_authority','self_update_authority','authority_effect'])if(v?.[f]!==false)throw new Error(`rsi_harness_${l}_${f}_invalid`);if(v?.automatic_retry_allowed!==false)throw new Error(`rsi_harness_${l}_automatic_retry_invalid`)}
function normalizeCodes(v,l,{min=0}={}){if(!Array.isArray(v)||v.length<min||v.length>MAX_CODES)throw new Error(`rsi_harness_${l}_invalid`);const s=new Set();for(const raw of v){const t=boundedToken(raw,l);if(s.has(t))throw new Error(`rsi_harness_${l}_duplicate`);s.add(t)}return [...s].sort()}
function refs(v){if(!Array.isArray(v)||v.length<1||v.length>MAX_EVIDENCE_REFS)throw new Error('rsi_harness_evidence_refs_invalid');const s=new Set();return v.map(raw=>{const x=boundedId(raw,'evidence_ref');if(s.has(x))throw new Error('rsi_harness_evidence_ref_duplicate');s.add(x);return x}).sort()}
function relPath(v,l){const p=String(v||'').trim();if(!p||p.length>240||p.startsWith('/')||p.includes('\\')||p.includes('\0')||p.split('/').some(x=>!x||x==='.'||x==='..'))throw new Error(`rsi_harness_${l}_path_invalid`);return p}

export function createRsiHarnessComponentRegistry({registry_id,source_sha,components,external_registry_builder=false,authored_by_candidate=true}={}){
  if(external_registry_builder!==true||authored_by_candidate!==false)throw new Error('rsi_harness_registry_external_origin_required');
  if(!Array.isArray(components)||components.length<1||components.length>MAX_COMPONENTS)throw new Error('rsi_harness_components_invalid');
  const ids=new Set(),paths=new Set();
  const normalized=components.map(row=>{
    if(!plainObject(row))throw new Error('rsi_harness_component_invalid');
    const component_id=boundedId(row.component_id,'component_id');
    if(ids.has(component_id))throw new Error('rsi_harness_component_id_duplicate');ids.add(component_id);
    const path=relPath(row.path,'component');
    if(paths.has(path))throw new Error('rsi_harness_component_path_duplicate');paths.add(path);
    const layer=boundedToken(row.layer,'component_layer');if(!LAYERS.includes(layer))throw new Error('rsi_harness_component_layer_invalid');
    return Object.freeze({component_id,path,layer,component_digest:exactDigest(row.component_digest,'component'),editable:row.editable===true,revertible:row.revertible===true,authority_root:row.authority_root===true});
  }).sort((a,b)=>a.component_id.localeCompare(b.component_id));
  const core={schema:RSI_HARNESS_COMPONENT_REGISTRY_SCHEMA,version:1,registry_id:boundedId(registry_id,'registry_id'),source_sha:exactSha(source_sha,'registry_source'),components:normalized,component_count:normalized.length,component_observability:true,file_level_representation:true,candidate_can_edit_registry:false,authority_root_components_mutable:false,external_registry_builder:true,authored_by_candidate:false,execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,automatic_retry_allowed:false,authority_effect:false};
  return Object.freeze({...core,registry_digest:digest(core)});
}
export function verifyRsiHarnessComponentRegistry(row){
  if(!plainObject(row)||row.schema!==RSI_HARNESS_COMPONENT_REGISTRY_SCHEMA||row.version!==1)throw new Error('rsi_harness_registry_invalid');
  assertZeroAuthority(row,'registry');
  if(row.component_observability!==true||row.file_level_representation!==true||row.candidate_can_edit_registry!==false||row.authority_root_components_mutable!==false||row.external_registry_builder!==true||row.authored_by_candidate!==false)throw new Error('rsi_harness_registry_policy_invalid');
  const canonical=createRsiHarnessComponentRegistry({registry_id:row.registry_id,source_sha:row.source_sha,components:row.components,external_registry_builder:true,authored_by_candidate:false});
  if(canonical.registry_digest!==exactDigest(row.registry_digest,'registry'))throw new Error('rsi_harness_registry_digest_mismatch');
  return canonical;
}

function validateTraceDag(steps){
  const byId=new Map(steps.map(s=>[s.step_id,s]));
  for(const s of steps)for(const p of s.predecessor_step_ids)if(!byId.has(p))throw new Error('rsi_harness_trace_predecessor_missing');
  const visiting=new Set(),done=new Set();
  function dfs(id){if(done.has(id))return;if(visiting.has(id))throw new Error('rsi_harness_trace_cycle_forbidden');visiting.add(id);for(const p of byId.get(id).predecessor_step_ids)dfs(p);visiting.delete(id);done.add(id)}
  for(const id of byId.keys())dfs(id);
}

export function createRsiHarnessTraceIr({
  trace_id,source_sha,task_id,environment_family,outcome,registry,steps,evaluator_root_digest,evidence_refs,
  external_trace_compiler=false,authored_by_candidate=true,
}={}){
  const checkedRegistry=verifyRsiHarnessComponentRegistry(registry);
  if(external_trace_compiler!==true||authored_by_candidate!==false)throw new Error('rsi_harness_trace_external_origin_required');
  const normalizedOutcome=boundedToken(outcome,'trace_outcome');if(!OUTCOMES.has(normalizedOutcome))throw new Error('rsi_harness_trace_outcome_invalid');
  if(!Array.isArray(steps)||steps.length<1||steps.length>MAX_STEPS)throw new Error('rsi_harness_trace_steps_invalid');
  const componentById=new Map(checkedRegistry.components.map(c=>[c.component_id,c]));
  const seen=new Set();
  const normalized=steps.map((s,index)=>{
    if(!plainObject(s))throw new Error('rsi_harness_trace_step_invalid');
    const step_id=boundedId(s.step_id,'step_id');if(seen.has(step_id))throw new Error('rsi_harness_trace_step_duplicate');seen.add(step_id);
    const kind=boundedToken(s.kind,'step_kind');if(!STEP_KINDS.includes(kind))throw new Error('rsi_harness_trace_step_kind_invalid');
    const component_id=boundedId(s.component_id,'step_component');const component=componentById.get(component_id);if(!component)throw new Error('rsi_harness_trace_component_unknown');
    const preds=Array.isArray(s.predecessor_step_ids)?s.predecessor_step_ids.map(x=>boundedId(x,'predecessor_step_id')):[];
    if(preds.length>MAX_PREDS||new Set(preds).size!==preds.length)throw new Error('rsi_harness_trace_predecessors_invalid');
    return Object.freeze({
      step_id,ordinal:index+1,kind,component_id,component_path:component.path,component_layer:component.layer,
      predecessor_step_ids:[...preds].sort(),
      event_code:boundedToken(s.event_code,'event_code'),
      result_code:boundedToken(s.result_code,'result_code'),
      payload_digest:exactDigest(s.payload_digest,'step_payload'),
      provenance_digest:exactDigest(s.provenance_digest,'step_provenance'),
      raw_payload_present:false,raw_page_text_present:false,raw_user_input_present:false,secret_material_present:false,model_text_is_authority:false,
    });
  });
  validateTraceDag(normalized);
  const core={schema:RSI_HARNESS_TRACE_IR_SCHEMA,version:1,trace_id:boundedId(trace_id,'trace_id'),source_sha:exactSha(source_sha,'trace_source'),task_id:boundedId(task_id,'task_id'),environment_family:boundedToken(environment_family,'environment_family'),outcome:normalizedOutcome,registry_digest:checkedRegistry.registry_digest,evaluator_root_digest:exactDigest(evaluator_root_digest,'evaluator_root'),steps:normalized,step_count:normalized.length,evidence_refs:refs(evidence_refs),harness_aware_trace_ir:true,step_level_provenance:true,control_flow_relations:true,experience_observability:true,raw_trace_not_trusted:true,external_trace_compiler:true,authored_by_candidate:false,execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,automatic_retry_allowed:false,authority_effect:false};
  return Object.freeze({...core,trace_digest:digest(core)});
}
export function verifyRsiHarnessTraceIr(trace,registry){
  if(!plainObject(trace)||trace.schema!==RSI_HARNESS_TRACE_IR_SCHEMA||trace.version!==1)throw new Error('rsi_harness_trace_invalid');
  assertZeroAuthority(trace,'trace');
  if(trace.harness_aware_trace_ir!==true||trace.step_level_provenance!==true||trace.control_flow_relations!==true||trace.experience_observability!==true||trace.raw_trace_not_trusted!==true||trace.external_trace_compiler!==true||trace.authored_by_candidate!==false)throw new Error('rsi_harness_trace_policy_invalid');
  const canonical=createRsiHarnessTraceIr({trace_id:trace.trace_id,source_sha:trace.source_sha,task_id:trace.task_id,environment_family:trace.environment_family,outcome:trace.outcome,registry,steps:trace.steps,evaluator_root_digest:trace.evaluator_root_digest,evidence_refs:trace.evidence_refs,external_trace_compiler:true,authored_by_candidate:false});
  if(canonical.trace_digest!==exactDigest(trace.trace_digest,'trace'))throw new Error('rsi_harness_trace_digest_mismatch');
  return canonical;
}

export function createRsiHarnessFlawRecord({
  flaw_id,registry,traces,responsible_component_id,failure_code,evidence_step_ids,repair_operator,
  external_diagnostician=false,authored_by_candidate=true,
}={}){
  const checkedRegistry=verifyRsiHarnessComponentRegistry(registry);
  if(external_diagnostician!==true||authored_by_candidate!==false)throw new Error('rsi_harness_flaw_external_origin_required');
  if(!Array.isArray(traces)||traces.length<1||traces.length>64)throw new Error('rsi_harness_flaw_traces_invalid');
  const checkedTraces=traces.map(t=>verifyRsiHarnessTraceIr(t,checkedRegistry));
  if(checkedTraces.some(t=>t.outcome==='PASS'))throw new Error('rsi_harness_flaw_failed_trace_required');
  const componentId=boundedId(responsible_component_id,'responsible_component');const component=checkedRegistry.components.find(c=>c.component_id===componentId);if(!component)throw new Error('rsi_harness_flaw_component_unknown');
  if(component.authority_root===true)throw new Error('rsi_harness_flaw_authority_root_repair_forbidden');
  const stepIds=normalizeCodes(evidence_step_ids,'evidence_step_id',{min:1});
  for(const sid of stepIds){
    const found=checkedTraces.some(t=>t.steps.some(s=>s.step_id.toUpperCase()===sid));
    if(!found)throw new Error('rsi_harness_flaw_evidence_step_missing');
  }
  const op=boundedToken(repair_operator,'repair_operator');if(!REPAIR_OPERATORS.includes(op))throw new Error('rsi_harness_flaw_repair_operator_invalid');
  const core={schema:RSI_HARNESS_FLAW_RECORD_SCHEMA,version:1,flaw_id:boundedId(flaw_id,'flaw_id'),registry_digest:checkedRegistry.registry_digest,responsible_component_id:component.component_id,responsible_component_path:component.path,responsible_layer:component.layer,failure_code:boundedToken(failure_code,'failure_code'),repair_operator:op,trace_digests:checkedTraces.map(t=>t.trace_digest).sort(),independent_trace_count:new Set(checkedTraces.map(t=>t.trace_id)).size,evidence_step_ids:stepIds,external_diagnostician:true,authored_by_candidate:false,diagnosis_scope:'EXACT_COMPONENT_AND_LAYER',raw_trace_shared_with_candidate:false,model_narrative_is_diagnosis_authority:false,flaw_record_is_patch_authority:false,execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,automatic_retry_allowed:false,authority_effect:false};
  return Object.freeze({...core,flaw_digest:digest(core)});
}
export function verifyRsiHarnessFlawRecord(row){
  if(!plainObject(row)||row.schema!==RSI_HARNESS_FLAW_RECORD_SCHEMA||row.version!==1)throw new Error('rsi_harness_flaw_invalid');
  assertZeroAuthority(row,'flaw');
  if(row.external_diagnostician!==true||row.authored_by_candidate!==false||row.diagnosis_scope!=='EXACT_COMPONENT_AND_LAYER'||row.raw_trace_shared_with_candidate!==false||row.model_narrative_is_diagnosis_authority!==false||row.flaw_record_is_patch_authority!==false)throw new Error('rsi_harness_flaw_policy_invalid');
  const clone=structuredClone(row);delete clone.flaw_digest;if(exactDigest(row.flaw_digest,'flaw')!==digest(clone))throw new Error('rsi_harness_flaw_digest_mismatch');return row;
}

export function createRsiHarnessRepairSpec({
  repair_id,flaw_record,registry,source_sha,predicted_failure_code_reduction,predicted_objective_codes,regression_guard_codes,
  heldout_suite_digest,matched_budget_digest,external_repair_planner=false,authored_by_candidate=true,
}={}){
  const flaw=verifyRsiHarnessFlawRecord(flaw_record);const checkedRegistry=verifyRsiHarnessComponentRegistry(registry);
  if(external_repair_planner!==true||authored_by_candidate!==false)throw new Error('rsi_harness_repair_external_origin_required');
  if(flaw.registry_digest!==checkedRegistry.registry_digest)throw new Error('rsi_harness_repair_registry_mismatch');
  const component=checkedRegistry.components.find(c=>c.component_id===flaw.responsible_component_id);if(!component||component.path!==flaw.responsible_component_path)throw new Error('rsi_harness_repair_component_binding_mismatch');
  if(component.editable!==true||component.revertible!==true||component.authority_root===true)throw new Error('rsi_harness_repair_component_not_eligible');
  const core={schema:RSI_HARNESS_REPAIR_SPEC_SCHEMA,version:1,repair_id:boundedId(repair_id,'repair_id'),source_sha:exactSha(source_sha,'repair_source'),flaw_id:flaw.flaw_id,flaw_digest:flaw.flaw_digest,component_id:component.component_id,component_path:component.path,component_layer:component.layer,repair_operator:flaw.repair_operator,predicted_failure_code_reduction:boundedToken(predicted_failure_code_reduction,'predicted_failure_reduction'),predicted_objective_codes:normalizeCodes(predicted_objective_codes,'predicted_objective_code',{min:1}),regression_guard_codes:normalizeCodes(regression_guard_codes,'regression_guard_code',{min:1}),heldout_suite_digest:exactDigest(heldout_suite_digest,'heldout_suite'),matched_budget_digest:exactDigest(matched_budget_digest,'matched_budget'),decision_observability:true,falsifiable_prediction_required:true,exact_component_scope_required:true,broad_patch_forbidden:true,matched_feedback_budget_baseline_required:true,heldout_generalization_required:true,test_time_auto_commit:false,execution_proxy_is_promotion_authority:false,external_repair_planner:true,authored_by_candidate:false,patch_materialization_external:true,scheduler_action_authorized:false,execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,automatic_retry_allowed:false,authority_effect:false};
  return Object.freeze({...core,repair_digest:digest(core)});
}
export function verifyRsiHarnessRepairSpec(row){
  if(!plainObject(row)||row.schema!==RSI_HARNESS_REPAIR_SPEC_SCHEMA||row.version!==1)throw new Error('rsi_harness_repair_invalid');
  assertZeroAuthority(row,'repair');
  if(row.decision_observability!==true||row.falsifiable_prediction_required!==true||row.exact_component_scope_required!==true||row.broad_patch_forbidden!==true||row.matched_feedback_budget_baseline_required!==true||row.heldout_generalization_required!==true||row.test_time_auto_commit!==false||row.execution_proxy_is_promotion_authority!==false||row.external_repair_planner!==true||row.authored_by_candidate!==false||row.patch_materialization_external!==true||row.scheduler_action_authorized!==false)throw new Error('rsi_harness_repair_policy_invalid');
  const clone=structuredClone(row);delete clone.repair_digest;if(exactDigest(row.repair_digest,'repair')!==digest(clone))throw new Error('rsi_harness_repair_digest_mismatch');return row;
}

export function createRsiHarnessRepairOutcome({
  repair_spec,target_failure_count_before,target_failure_count_after,matched_budget_baseline_delta,heldout_delta,
  unacceptable_regression_count,objective_deltas,evidence_refs,external_evaluator=false,authored_by_candidate=true,
}={}){
  const spec=verifyRsiHarnessRepairSpec(repair_spec);
  if(external_evaluator!==true||authored_by_candidate!==false)throw new Error('rsi_harness_outcome_external_origin_required');
  const before=positiveInt(target_failure_count_before,'failure_before',1_000_000);
  const after=Number(target_failure_count_after);if(!Number.isSafeInteger(after)||after<0||after>1_000_000)throw new Error('rsi_harness_failure_after_invalid');
  const regressions=Number(unacceptable_regression_count);if(!Number.isSafeInteger(regressions)||regressions<0||regressions>1_000_000)throw new Error('rsi_harness_regression_count_invalid');
  if(!Array.isArray(objective_deltas)||objective_deltas.length<1||objective_deltas.length>16)throw new Error('rsi_harness_objective_deltas_invalid');
  const deltas=objective_deltas.map(r=>Object.freeze({code:boundedToken(r.code,'objective_delta_code'),delta:finite(r.delta,'objective_delta')})).sort((a,b)=>a.code.localeCompare(b.code));
  const reduced=after<before;
  const matched=finite(matched_budget_baseline_delta,'matched_budget_delta');
  const heldout=finite(heldout_delta,'heldout_delta');
  const pass=reduced&&matched>0&&heldout>=0&&regressions===0;
  const core={schema:RSI_HARNESS_REPAIR_OUTCOME_SCHEMA,version:1,repair_id:spec.repair_id,repair_digest:spec.repair_digest,component_id:spec.component_id,component_path:spec.component_path,target_failure_count_before:before,target_failure_count_after:after,target_flaw_reduced:reduced,matched_budget_baseline_delta:matched,heldout_delta:heldout,unacceptable_regression_count:regressions,objective_deltas:deltas,evidence_refs:refs(evidence_refs),state:pass?'REPAIR_VERIFIED_FOR_EXTERNAL_REVIEW':'REPAIR_REJECTED',prediction_verified:pass,matched_feedback_budget_baseline_checked:true,heldout_generalization_checked:true,no_unacceptable_regressions:regressions===0,external_evaluator:true,authored_by_candidate:false,repair_outcome_is_promotion_authority:false,test_time_auto_commit:false,direct_install_authorized:false,scheduler_action_authorized:false,execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,automatic_retry_allowed:false,authority_effect:false};
  return Object.freeze({...core,outcome_digest:digest(core)});
}
export function verifyRsiHarnessRepairOutcome(row){
  if(!plainObject(row)||row.schema!==RSI_HARNESS_REPAIR_OUTCOME_SCHEMA||row.version!==1)throw new Error('rsi_harness_outcome_invalid');
  assertZeroAuthority(row,'outcome');
  if(row.matched_feedback_budget_baseline_checked!==true||row.heldout_generalization_checked!==true||row.external_evaluator!==true||row.authored_by_candidate!==false||row.repair_outcome_is_promotion_authority!==false||row.test_time_auto_commit!==false||row.direct_install_authorized!==false||row.scheduler_action_authorized!==false)throw new Error('rsi_harness_outcome_policy_invalid');
  const clone=structuredClone(row);delete clone.outcome_digest;if(exactDigest(row.outcome_digest,'outcome')!==digest(clone))throw new Error('rsi_harness_outcome_digest_mismatch');return row;
}

export function rsiTraceGuidedHarnessRepairTrustRootSnapshot(){
  const root={schema:'metaengine.rsi.trace-guided-harness-repair-root.v1',version:1,policy_path:'apps/metaengine-browser/src/rsi-trace-guided-harness-repair.mjs',layers:[...LAYERS],repair_operators:[...REPAIR_OPERATORS],harness_aware_trace_ir:true,component_observability:true,experience_observability:true,decision_observability:true,raw_trace_not_trusted:true,exact_component_scope_required:true,matched_feedback_budget_baseline_required:true,heldout_generalization_required:true,test_time_auto_commit:false,execution_proxy_is_promotion_authority:false,candidate_can_edit_policy:false,scheduler_action_authorized:false,execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,automatic_retry_allowed:false,authority_effect:false};
  return Object.freeze({...root,harness_repair_root_digest:digest(root)});
}
