import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRsiHarnessComponentRegistry,
  verifyRsiHarnessComponentRegistry,
  createRsiHarnessTraceIr,
  verifyRsiHarnessTraceIr,
  createRsiHarnessFlawRecord,
  verifyRsiHarnessFlawRecord,
  createRsiHarnessRepairSpec,
  verifyRsiHarnessRepairSpec,
  createRsiHarnessRepairOutcome,
  verifyRsiHarnessRepairOutcome,
  rsiTraceGuidedHarnessRepairTrustRootSnapshot,
} from '../src/rsi-trace-guided-harness-repair.mjs';

const sha=(c)=>c.repeat(40);
const d=(c)=>`sha256:${c.repeat(64)}`;

function registry(){
  return createRsiHarnessComponentRegistry({
    registry_id:'registry.browser.harness.1',
    source_sha:sha('1'),
    components:[
      {component_id:'comp.context',path:'apps/metaengine-browser/src/context-manager.mjs',layer:'CONTEXT',component_digest:d('1'),editable:true,revertible:true,authority_root:false},
      {component_id:'comp.tools',path:'apps/metaengine-browser/src/tool-router.mjs',layer:'TOOLS',component_digest:d('2'),editable:true,revertible:true,authority_root:false},
      {component_id:'comp.verify',path:'apps/metaengine-browser/src/verifier.mjs',layer:'VERIFICATION',component_digest:d('3'),editable:true,revertible:true,authority_root:false},
      {component_id:'comp.governance',path:'apps/metaengine-browser/src/governance-root.mjs',layer:'GOVERNANCE',component_digest:d('4'),editable:false,revertible:false,authority_root:true},
    ],
    external_registry_builder:true,
    authored_by_candidate:false,
  });
}

function failedTrace(id='trace.fail.1', task='task.one'){
  const reg=registry();
  return createRsiHarnessTraceIr({
    trace_id:id,
    source_sha:sha('1'),
    task_id:task,
    environment_family:'WINDOWS_BROWSER',
    outcome:'FAIL',
    registry:reg,
    evaluator_root_digest:d('a'),
    steps:[
      {step_id:'step.input',kind:'MODEL',component_id:'comp.context',predecessor_step_ids:[],event_code:'CONTEXT_ASSEMBLED',result_code:'OK',payload_digest:d('5'),provenance_digest:d('6')},
      {step_id:'step.tool',kind:'TOOL_REQUEST',component_id:'comp.tools',predecessor_step_ids:['step.input'],event_code:'TOOL_REQUESTED',result_code:'ROUTING_MISS',payload_digest:d('7'),provenance_digest:d('8')},
      {step_id:'step.verify',kind:'VERIFICATION',component_id:'comp.verify',predecessor_step_ids:['step.tool'],event_code:'RESULT_CHECK',result_code:'FAIL',payload_digest:d('9'),provenance_digest:d('b')},
    ],
    evidence_refs:[`RUN_${id}`],
    external_trace_compiler:true,
    authored_by_candidate:false,
  });
}

test('component registry exposes file-level harness layers but freezes authority roots',()=>{
  const row=registry();
  verifyRsiHarnessComponentRegistry(row);
  assert.equal(row.component_observability,true);
  assert.equal(row.file_level_representation,true);
  assert.equal(row.candidate_can_edit_registry,false);
  assert.equal(row.authority_root_components_mutable,false);
  assert.equal(row.components.length,4);
  assert.equal(row.components.find(x=>x.component_id==='comp.governance').authority_root,true);
  assert.equal(row.authority_effect,false);
});

test('HTIR preserves step provenance/control flow while raw trace/page/user payloads stay untrusted',()=>{
  const reg=registry();
  const trace=failedTrace();
  verifyRsiHarnessTraceIr(trace,reg);
  assert.equal(trace.harness_aware_trace_ir,true);
  assert.equal(trace.step_level_provenance,true);
  assert.equal(trace.control_flow_relations,true);
  assert.equal(trace.experience_observability,true);
  assert.equal(trace.raw_trace_not_trusted,true);
  assert.equal(trace.steps[1].component_layer,'TOOLS');
  for(const step of trace.steps){
    assert.equal(step.raw_payload_present,false);
    assert.equal(step.raw_page_text_present,false);
    assert.equal(step.raw_user_input_present,false);
    assert.equal(step.secret_material_present,false);
    assert.equal(step.model_text_is_authority,false);
  }
});

test('HTIR rejects cycles and unknown components',()=>{
  const reg=registry();
  assert.throws(()=>createRsiHarnessTraceIr({
    trace_id:'trace.cycle',source_sha:sha('1'),task_id:'task.cycle',environment_family:'WINDOWS_BROWSER',outcome:'FAIL',
    registry:reg,evaluator_root_digest:d('a'),
    steps:[
      {step_id:'step.a',kind:'MODEL',component_id:'comp.context',predecessor_step_ids:['step.b'],event_code:'A',result_code:'FAIL',payload_digest:d('1'),provenance_digest:d('2')},
      {step_id:'step.b',kind:'TOOL_REQUEST',component_id:'comp.tools',predecessor_step_ids:['step.a'],event_code:'B',result_code:'FAIL',payload_digest:d('3'),provenance_digest:d('4')},
    ],
    evidence_refs:['RUN_CYCLE'],external_trace_compiler:true,authored_by_candidate:false,
  }),/cycle_forbidden/);
  assert.throws(()=>createRsiHarnessTraceIr({
    trace_id:'trace.unknown',source_sha:sha('1'),task_id:'task.unknown',environment_family:'WINDOWS_BROWSER',outcome:'FAIL',
    registry:reg,evaluator_root_digest:d('a'),
    steps:[
      {step_id:'step.a',kind:'MODEL',component_id:'comp.missing',predecessor_step_ids:[],event_code:'A',result_code:'FAIL',payload_digest:d('1'),provenance_digest:d('2')},
    ],
    evidence_refs:['RUN_UNKNOWN'],external_trace_compiler:true,authored_by_candidate:false,
  }),/component_unknown/);
});

test('flaw diagnosis localizes failure to exact editable harness component and layer',()=>{
  const reg=registry();
  const flaw=createRsiHarnessFlawRecord({
    flaw_id:'flaw.tool-routing.1',
    registry:reg,
    traces:[failedTrace('trace.fail.1','task.one'),failedTrace('trace.fail.2','task.two')],
    responsible_component_id:'comp.tools',
    failure_code:'TOOL_ROUTING_MISS',
    evidence_step_ids:['STEP.TOOL'],
    repair_operator:'TOOL_CONTRACT_REPAIR',
    external_diagnostician:true,
    authored_by_candidate:false,
  });
  verifyRsiHarnessFlawRecord(flaw);
  assert.equal(flaw.responsible_component_id,'comp.tools');
  assert.equal(flaw.responsible_layer,'TOOLS');
  assert.equal(flaw.independent_trace_count,2);
  assert.equal(flaw.diagnosis_scope,'EXACT_COMPONENT_AND_LAYER');
  assert.equal(flaw.raw_trace_shared_with_candidate,false);
  assert.equal(flaw.model_narrative_is_diagnosis_authority,false);
  assert.equal(flaw.flaw_record_is_patch_authority,false);
  assert.equal(flaw.authority_effect,false);
});

test('authority-root component can never be converted into an RSI repair flaw target',()=>{
  const reg=registry();
  assert.throws(()=>createRsiHarnessFlawRecord({
    flaw_id:'flaw.bad.root',
    registry:reg,
    traces:[failedTrace()],
    responsible_component_id:'comp.governance',
    failure_code:'GOVERNANCE_CHANGED',
    evidence_step_ids:['STEP.INPUT'],
    repair_operator:'GOVERNANCE_FENCE',
    external_diagnostician:true,
    authored_by_candidate:false,
  }),/authority_root_repair_forbidden/);
});

test('repair spec is exact-component, falsifiable and requires heldout + matched-budget controls',()=>{
  const reg=registry();
  const flaw=createRsiHarnessFlawRecord({
    flaw_id:'flaw.tool-routing.2',
    registry:reg,
    traces:[failedTrace()],
    responsible_component_id:'comp.tools',
    failure_code:'TOOL_ROUTING_MISS',
    evidence_step_ids:['STEP.TOOL'],
    repair_operator:'TOOL_CONTRACT_REPAIR',
    external_diagnostician:true,
    authored_by_candidate:false,
  });
  const spec=createRsiHarnessRepairSpec({
    repair_id:'repair.tool-routing.2',
    flaw_record:flaw,
    registry:reg,
    source_sha:sha('1'),
    predicted_failure_code_reduction:'TOOL_ROUTING_MISS',
    predicted_objective_codes:['TASK_SUCCESS_UP','TOOL_RETRY_DOWN'],
    regression_guard_codes:['NO_AUTHORITY_REGRESSION','NO_LATENCY_REGRESSION'],
    heldout_suite_digest:d('c'),
    matched_budget_digest:d('d'),
    external_repair_planner:true,
    authored_by_candidate:false,
  });
  verifyRsiHarnessRepairSpec(spec);
  assert.equal(spec.component_path,'apps/metaengine-browser/src/tool-router.mjs');
  assert.equal(spec.decision_observability,true);
  assert.equal(spec.falsifiable_prediction_required,true);
  assert.equal(spec.exact_component_scope_required,true);
  assert.equal(spec.broad_patch_forbidden,true);
  assert.equal(spec.matched_feedback_budget_baseline_required,true);
  assert.equal(spec.heldout_generalization_required,true);
  assert.equal(spec.test_time_auto_commit,false);
  assert.equal(spec.execution_proxy_is_promotion_authority,false);
  assert.equal(spec.patch_materialization_external,true);
  assert.equal(spec.scheduler_action_authorized,false);
});

test('repair is verified only if target flaw falls, matched-budget baseline improves, heldout does not regress and regressions are zero',()=>{
  const reg=registry();
  const flaw=createRsiHarnessFlawRecord({
    flaw_id:'flaw.tool-routing.3',registry:reg,traces:[failedTrace()],responsible_component_id:'comp.tools',
    failure_code:'TOOL_ROUTING_MISS',evidence_step_ids:['STEP.TOOL'],repair_operator:'TOOL_CONTRACT_REPAIR',
    external_diagnostician:true,authored_by_candidate:false,
  });
  const spec=createRsiHarnessRepairSpec({
    repair_id:'repair.tool-routing.3',flaw_record:flaw,registry:reg,source_sha:sha('1'),
    predicted_failure_code_reduction:'TOOL_ROUTING_MISS',predicted_objective_codes:['TASK_SUCCESS_UP'],
    regression_guard_codes:['NO_AUTHORITY_REGRESSION'],heldout_suite_digest:d('c'),matched_budget_digest:d('d'),
    external_repair_planner:true,authored_by_candidate:false,
  });
  const good=createRsiHarnessRepairOutcome({
    repair_spec:spec,target_failure_count_before:10,target_failure_count_after:4,matched_budget_baseline_delta:0.08,heldout_delta:0.02,
    unacceptable_regression_count:0,objective_deltas:[{code:'TASK_SUCCESS',delta:0.08}],evidence_refs:['HELDOUT_RUN_1','MATCHED_BUDGET_1'],
    external_evaluator:true,authored_by_candidate:false,
  });
  verifyRsiHarnessRepairOutcome(good);
  assert.equal(good.state,'REPAIR_VERIFIED_FOR_EXTERNAL_REVIEW');
  assert.equal(good.prediction_verified,true);
  assert.equal(good.repair_outcome_is_promotion_authority,false);
  assert.equal(good.test_time_auto_commit,false);
  assert.equal(good.direct_install_authorized,false);

  const overfit=createRsiHarnessRepairOutcome({
    repair_spec:spec,target_failure_count_before:10,target_failure_count_after:4,matched_budget_baseline_delta:0.08,heldout_delta:-0.01,
    unacceptable_regression_count:0,objective_deltas:[{code:'TASK_SUCCESS',delta:0.08}],evidence_refs:['HELDOUT_RUN_2'],
    external_evaluator:true,authored_by_candidate:false,
  });
  assert.equal(overfit.state,'REPAIR_REJECTED');
  assert.equal(overfit.prediction_verified,false);

  const budgetIllusion=createRsiHarnessRepairOutcome({
    repair_spec:spec,target_failure_count_before:10,target_failure_count_after:4,matched_budget_baseline_delta:0,heldout_delta:0.02,
    unacceptable_regression_count:0,objective_deltas:[{code:'TASK_SUCCESS',delta:0.08}],evidence_refs:['MATCHED_BUDGET_2'],
    external_evaluator:true,authored_by_candidate:false,
  });
  assert.equal(budgetIllusion.state,'REPAIR_REJECTED');
});

test('test-time proxy signals never auto-commit a harness or become promotion authority',()=>{
  const root=rsiTraceGuidedHarnessRepairTrustRootSnapshot();
  assert.equal(root.harness_aware_trace_ir,true);
  assert.equal(root.component_observability,true);
  assert.equal(root.experience_observability,true);
  assert.equal(root.decision_observability,true);
  assert.equal(root.raw_trace_not_trusted,true);
  assert.equal(root.exact_component_scope_required,true);
  assert.equal(root.matched_feedback_budget_baseline_required,true);
  assert.equal(root.heldout_generalization_required,true);
  assert.equal(root.test_time_auto_commit,false);
  assert.equal(root.execution_proxy_is_promotion_authority,false);
  assert.equal(root.candidate_can_edit_policy,false);
  assert.equal(root.scheduler_action_authorized,false);
  assert.equal(root.authority_effect,false);
  assert.match(root.harness_repair_root_digest,/^sha256:[0-9a-f]{64}$/);
});
