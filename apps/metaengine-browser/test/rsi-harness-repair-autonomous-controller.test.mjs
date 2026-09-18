
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RSI_COMMAND_PLANE_LIVENESS_INPUT_SCHEMA,
  RsiCommandPlaneLivenessObserver,
} from '../src/rsi-command-plane-liveness-observer.mjs';
import { createRsiSearchContext } from '../src/rsi-search-mode-router.mjs';
import {
  createRsiHarnessComponentRegistry,
  createRsiHarnessTraceIr,
  createRsiHarnessFlawRecord,
  createRsiHarnessRepairSpec,
} from '../src/rsi-trace-guided-harness-repair.mjs';
import {
  createRsiAutonomousEpisodePlan,
  verifyRsiAutonomousEpisodePlan,
  rsiAutonomousEpisodeControllerTrustRootSnapshot,
} from '../src/rsi-autonomous-episode-controller.mjs';

const SOURCE_SHA='a0af13c0640fffb4b6d5da1645220e32786b5ec0';
const OTHER_SHA='b0af13c0640fffb4b6d5da1645220e32786b5ec1';
const MATCHING_COMPONENT='apps/metaengine-browser/src/native-supervisor-client-core-base.mjs';
const OTHER_COMPONENT='apps/metaengine-browser/src/unrelated-runtime-helper.mjs';
const d=(c)=>`sha256:${c.repeat(64)}`;

function livenessObservation(){
  const observer=new RsiCommandPlaneLivenessObserver({
    source_sha:SOURCE_SHA,
    clock:()=>Date.parse('2026-09-18T12:00:00.000Z'),
    heartbeat_fresh_ms:15_000,
    perception_fresh_ms:15_000,
    command_stall_ms:120_000,
  });
  return observer.observe({
    schema:RSI_COMMAND_PLANE_LIVENESS_INPUT_SCHEMA,
    observed_at:'2026-09-18T12:00:00.000Z',
    heartbeat_at:'2026-09-18T11:59:55.000Z',
    perception_at:'2026-09-18T11:59:56.000Z',
    command_progress_at:'2026-09-18T05:00:00.000Z',
    pending_command_count:3,
    active_command:{
      command_id:'11111111-1111-4111-8111-111111111111',
      action:'SCROLL',
      command_lane:'TAB_MUTATION',
      status:'LEASED',
      leased_at:'2026-09-18T04:59:59.000Z',
      effect_bound_at:'2026-09-18T05:00:00.000Z',
      receipt_recorded_at:null,
    },
    command_payload_exposed:false,
    page_text_exposed:false,
    input_values_exposed:false,
    raw_network_exposed:false,
    execution_authority:false,
    production_mutation_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  });
}

function context(){
  return createRsiSearchContext({
    context_id:'rsi-context-harness-result-delivery',
    mutation_surface:'BROWSER_RUNTIME',
    problem_class:'RESULT_DELIVERY_STALL',
    budget_class:'NORMAL',
    skeleton_available:false,
    trace_history_available:true,
    lineage_candidate_count:3,
    failure_class:'RESULT_DELIVERY_STALL',
    novelty_pressure:0.4,
    external_context_owner:true,
    authored_by_candidate:false,
  });
}

function repairSpec({
  sourceSha=SOURCE_SHA,
  componentPath=MATCHING_COMPONENT,
  componentLayer='LIFECYCLE',
}={}){
  const registry=createRsiHarnessComponentRegistry({
    registry_id:'registry.harness.autonomous.1',
    source_sha:sourceSha,
    components:[
      {
        component_id:'comp.result-delivery',
        path:componentPath,
        layer:componentLayer,
        component_digest:d('1'),
        editable:true,
        revertible:true,
        authority_root:false,
      },
    ],
    external_registry_builder:true,
    authored_by_candidate:false,
  });
  const trace=createRsiHarnessTraceIr({
    trace_id:'trace.harness.autonomous.1',
    source_sha:sourceSha,
    task_id:'task.harness.autonomous.1',
    environment_family:'WINDOWS_BROWSER',
    outcome:'FAIL',
    registry,
    evaluator_root_digest:d('2'),
    steps:[
      {
        step_id:'step.result-delivery',
        kind:'STATE_TRANSITION',
        component_id:'comp.result-delivery',
        predecessor_step_ids:[],
        event_code:'RESULT_DELIVERY_ATTEMPT',
        result_code:'TIMEOUT',
        payload_digest:d('3'),
        provenance_digest:d('4'),
      },
    ],
    evidence_refs:['RUN_HARNESS_AUTONOMOUS_1'],
    external_trace_compiler:true,
    authored_by_candidate:false,
  });
  const flaw=createRsiHarnessFlawRecord({
    flaw_id:'flaw.result-delivery.autonomous.1',
    registry,
    traces:[trace],
    responsible_component_id:'comp.result-delivery',
    failure_code:'RESULT_DELIVERY_TIMEOUT',
    evidence_step_ids:['STEP.RESULT-DELIVERY'],
    repair_operator:'LIFECYCLE_FENCE',
    external_diagnostician:true,
    authored_by_candidate:false,
  });
  return createRsiHarnessRepairSpec({
    repair_id:'repair.result-delivery.autonomous.1',
    flaw_record:flaw,
    registry,
    source_sha:sourceSha,
    predicted_failure_code_reduction:'RESULT_DELIVERY_TIMEOUT',
    predicted_objective_codes:['COMMAND_PROGRESS_RECOVERY_UP','RESULT_DELIVERY_TERMINAL_MS_DOWN'],
    regression_guard_codes:['NO_DUPLICATE_EFFECT','NO_AUTHORITY_REGRESSION'],
    heldout_suite_digest:d('5'),
    matched_budget_digest:d('6'),
    external_repair_planner:true,
    authored_by_candidate:false,
  });
}

function baseInput(){
  const observation=livenessObservation();
  const opportunity=observation.opportunities.find((row)=>row.signal==='RESULT_DELIVERY_STALL_AFTER_EFFECT_BINDING');
  assert.ok(opportunity);
  return {
    observation,
    opportunity_id:opportunity.opportunity_id,
    search_context:context(),
    search_outcomes:[],
    cycle_generation:1,
    max_candidates:4,
    proposal_budget_units:100,
    exploration_fraction:0.2,
  };
}

test('verified harness repair scopes both autonomous variants without widening authority',()=>{
  const repair=repairSpec();
  const plan=createRsiAutonomousEpisodePlan({...baseInput(),harness_repair_spec:repair});
  verifyRsiAutonomousEpisodePlan(plan);

  assert.equal(plan.harness_repair_digest,repair.repair_digest.slice(7));
  assert.equal(plan.harness_repair_spec.repair_digest,repair.repair_digest);
  assert.equal(plan.variant_count,2);
  for(const variant of plan.variant_plans){
    const scoped=variant.task_spec.rsi.harness_repair;
    assert.equal(scoped.repair_digest,repair.repair_digest);
    assert.equal(scoped.component_path,MATCHING_COMPONENT);
    assert.equal(scoped.exact_component_scope_required,true);
    assert.equal(scoped.broad_patch_forbidden,true);
    assert.equal(scoped.candidate_can_modify_repair_spec,false);
    assert.equal(scoped.patch_materialization_external,true);
    assert.equal(scoped.scheduler_action_authorized,false);
    assert.equal(variant.execution_authority,false);
    assert.equal(variant.promotion_authority,false);
    assert.equal(variant.self_update_authority,false);
    assert.ok(variant.task_spec.constraints.includes('rsi_harness_exact_component_scope_required'));
    assert.ok(variant.task_spec.constraints.includes('rsi_harness_broad_patch_forbidden'));
  }
});

test('repair-scoped cycle has distinct deterministic episode identity from unscoped cycle',()=>{
  const input=baseInput();
  const plain=createRsiAutonomousEpisodePlan(input);
  const scoped=createRsiAutonomousEpisodePlan({...input,harness_repair_spec:repairSpec()});
  assert.notEqual(scoped.episode_id,plain.episode_id);
  assert.notEqual(scoped.routing_digest,plain.routing_digest);
  assert.equal(scoped.harness_repair_digest,repairSpec().repair_digest.slice(7));
});

test('harness repair exact source and mapped mutation surface are fail-closed',()=>{
  const input=baseInput();
  assert.throws(
    ()=>createRsiAutonomousEpisodePlan({...input,harness_repair_spec:repairSpec({sourceSha:OTHER_SHA})}),
    /harness_repair_source_mismatch/,
  );
  assert.throws(
    ()=>createRsiAutonomousEpisodePlan({...input,harness_repair_spec:repairSpec({componentLayer:'TOOLS'})}),
    /harness_repair_surface_mismatch/,
  );
});

test('hypothesis suspected-component boundary rejects unrelated harness repair target',()=>{
  const input=baseInput();
  assert.throws(
    ()=>createRsiAutonomousEpisodePlan({...input,harness_repair_spec:repairSpec({componentPath:OTHER_COMPONENT})}),
    /harness_repair_component_not_suspected/,
  );
});

test('repair scope tampering invalidates autonomous plan verification',()=>{
  const plan=createRsiAutonomousEpisodePlan({...baseInput(),harness_repair_spec:repairSpec()});
  const tampered=structuredClone(plan);
  tampered.variant_plans[0].task_spec.rsi.harness_repair.component_path=OTHER_COMPONENT;
  assert.throws(
    ()=>verifyRsiAutonomousEpisodePlan(tampered),
    /(variant_harness_repair_policy_invalid|variant_plan_digest_mismatch)/,
  );
});

test('autonomous controller trust root freezes harness repair policy and forbids broad patches',()=>{
  const root=rsiAutonomousEpisodeControllerTrustRootSnapshot();
  assert.ok(root.immutable_component_paths.includes('apps/metaengine-browser/src/rsi-trace-guided-harness-repair.mjs'));
  assert.equal(root.harness_repair_exact_component_scope,true);
  assert.equal(root.broad_harness_patch_allowed,false);
  assert.equal(root.candidate_can_modify_harness_repair_spec,false);
  assert.equal(root.harness_repair_requires_matched_budget_baseline,true);
  assert.equal(root.harness_repair_requires_heldout_generalization,true);
  assert.equal(root.second_scheduler_allowed,false);
  assert.equal(root.direct_dispatch_enabled,false);
  assert.equal(root.direct_promotion_enabled,false);
});
