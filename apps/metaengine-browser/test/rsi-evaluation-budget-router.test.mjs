import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  createRsiSharedExperienceAdmission,
  createRsiSharedExperienceHypothesis,
} from '../src/rsi-shared-experience-bus.mjs';
import {
  RsiEvaluationBudgetLedger,
  createRsiEvaluationBudgetPlan,
  createRsiEvaluationRoutingRequest,
  rsiEvaluationBudgetRouterTrustRootSnapshot,
  verifyRsiEvaluationBudgetPlan,
  verifyRsiEvaluationRoutingRequest,
} from '../src/rsi-evaluation-budget-router.mjs';

const SOURCE='a'.repeat(40);
function dg(label){return `sha256:${crypto.createHash('sha256').update(String(label),'utf8').digest('hex')}`;}
function stable(value){if(Array.isArray(value))return value.map(stable);if(!value||typeof value!=='object')return value;return Object.fromEntries(Object.keys(value).sort().map((key)=>[key,stable(value[key])]));}
function structuralDigest(value){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)),'utf8').digest('hex')}`;}

function experience(label,{cost=8,info=0.8,scopeTags=['VERIFIER']}={}){
  const hypothesis=createRsiSharedExperienceHypothesis({
    hypothesis_id:`experience.hypothesis.${label}`,
    source_sha:SOURCE,
    origin_candidate_digest:dg(`candidate-${label}`),
    origin_lineage_digest:dg(`lineage-${label}`),
    sanitized_summary_digest:dg(`summary-${label}`),
    distilled_recipe_digest:dg(`recipe-${label}`),
    supporting_evidence_digest:dg(`support-${label}`),
    counterevidence_digest:dg(`counter-${label}`),
    falsification_test_digest:dg(`falsify-${label}`),
    source_context_digest:dg(`source-context-${label}`),
    local_revalidation_protocol_digest:dg(`revalidate-${label}`),
    negative_transfer_probe_digest:dg(`negative-transfer-${label}`),
    scope_tags:scopeTags,
    recipient_group_tags:['CODING'],
    evaluator_cost_units:cost,
    expected_information_gain:info,
    hidden_data_disclosed:false,
    raw_benchmark_content_included:false,
    raw_verifier_assets_included:false,
    external_synthesizer:true,
    authored_by_candidate:false,
  });
  const admission=createRsiSharedExperienceAdmission({
    admission_id:`experience.admission.${label}`,
    hypothesis,
    supporting_evidence_verified:true,
    counterevidence_reviewed:true,
    falsification_test_precommitted:true,
    hidden_data_non_disclosure_pass:true,
    recipe_distillation_verified:true,
    context_compatibility_pass:true,
    negative_transfer_probe_pass:true,
    scope_precision_pass:true,
    evaluator_budget_available:true,
    marginal_information_gain_certified:true,
    external_reviewer:true,
    authored_by_candidate:false,
  });
  return {hypothesis,admission};
}
function request(label,opts={}){
  const exp=experience(label,{cost:opts.cost??8,info:opts.info??0.8,scopeTags:opts.scopeTags??['VERIFIER']});
  const row=createRsiEvaluationRoutingRequest({
    request_id:`eval.request.${label}`,
    hypothesis:exp.hypothesis,
    admission:exp.admission,
    external_measurement_digest:dg(`measurement-${label}`),
    proxy_score_digest:dg(`proxy-${label}`),
    uncertainty:opts.uncertainty??0.8,
    decision_closeness:opts.closeness??0.8,
    proxy_reliability_gap:opts.gap??0.2,
    external_measurement_owner:true,
    authored_by_candidate:false,
  });
  return {...exp,row};
}

test('routing request binds admitted hypothesis provenance and remains zero-authority',()=>{
  const fx=request('one');
  const checked=verifyRsiEvaluationRoutingRequest(fx.row,{hypothesis:fx.hypothesis,admission:fx.admission});
  assert.equal(checked.request_digest,fx.row.request_digest);
  assert.equal(fx.row.distilled_recipe_digest,fx.hypothesis.distilled_recipe_digest);
  assert.equal(fx.row.source_context_digest,fx.hypothesis.source_context_digest);
  assert.equal(fx.row.local_revalidation_protocol_digest,fx.hypothesis.local_revalidation_protocol_digest);
  assert.equal(fx.row.negative_transfer_probe_digest,fx.hypothesis.negative_transfer_probe_digest);
  assert.equal(fx.row.recipe_distillation_verified,true);
  assert.equal(fx.row.context_compatibility_pass,true);
  assert.equal(fx.row.negative_transfer_probe_pass,true);
  assert.equal(fx.row.cheap_proxy_is_final_truth,false);
  assert.equal(fx.row.independent_audit_required,true);
  assert.equal(fx.row.candidate_can_set_priority,false);
  assert.equal(fx.row.request_can_schedule_evaluation,false);
  assert.equal(fx.row.request_can_execute_evaluation,false);
  assert.equal(fx.row.authority_effect,false);
});

test('candidate cannot own routing measurements or inject priority directly',()=>{
  const exp=experience('candidate');
  assert.throws(()=>createRsiEvaluationRoutingRequest({
    request_id:'eval.request.candidate',
    hypothesis:exp.hypothesis,
    admission:exp.admission,
    external_measurement_digest:dg('measurement-candidate'),
    proxy_score_digest:dg('proxy-candidate'),
    uncertainty:0.8,
    decision_closeness:0.8,
    proxy_reliability_gap:0.2,
    external_measurement_owner:false,
    authored_by_candidate:true,
  }),/external_measurement_owner_required/);
});

test('priority increases with information gain uncertainty closeness and proxy unreliability and decreases with cost',()=>{
  const high=request('high',{cost:4,info:0.9,uncertainty:0.9,closeness:0.9,gap:0.6}).row;
  const low=request('low',{cost:16,info:0.4,uncertainty:0.3,closeness:0.1,gap:0.1}).row;
  assert.ok(high.routing_priority_score>low.routing_priority_score);
});

test('budget plan deterministically selects highest-value requests without exceeding budget',()=>{
  const high=request('plan-high',{cost:8,info:0.9,uncertainty:0.9,closeness:0.9,gap:0.5}).row;
  const medium=request('plan-medium',{cost:8,info:0.7,uncertainty:0.7,closeness:0.7,gap:0.3}).row;
  const low=request('plan-low',{cost:8,info:0.3,uncertainty:0.2,closeness:0.1,gap:0.1}).row;
  const plan=createRsiEvaluationBudgetPlan({
    plan_id:'eval.plan.one',
    source_sha:SOURCE,
    requests:[low,medium,high],
    epoch_budget_units:16,
    external_budget_owner:true,
    authored_by_candidate:false,
  });
  assert.equal(verifyRsiEvaluationBudgetPlan(plan,{requests:[low,medium,high]}).plan_digest,plan.plan_digest);
  assert.equal(plan.used_budget_units,16);
  assert.equal(plan.remaining_budget_units,0);
  assert.deepEqual(plan.selected_request_digests,[high.request_digest,medium.request_digest]);
  assert.deepEqual(plan.deferred_request_digests,[low.request_digest]);
  assert.equal(plan.plan_can_schedule_evaluation,false);
  assert.equal(plan.plan_can_execute_evaluation,false);
  assert.equal(plan.selected_requests_are_execution_authority,false);
  assert.equal(plan.selected_requests_are_scheduler_authority,false);
});

test('budget failure is fail-closed and candidate cannot override external budget',()=>{
  const expensive=request('expensive',{cost:32,info:1,uncertainty:1,closeness:1,gap:1}).row;
  const plan=createRsiEvaluationBudgetPlan({
    plan_id:'eval.plan.small-budget',
    source_sha:SOURCE,
    requests:[expensive],
    epoch_budget_units:8,
    external_budget_owner:true,
    authored_by_candidate:false,
  });
  assert.equal(plan.used_budget_units,0);
  assert.deepEqual(plan.selected_request_digests,[]);
  assert.deepEqual(plan.deferred_request_digests,[expensive.request_digest]);
  assert.equal(plan.budget_fail_closed,true);

  assert.throws(()=>createRsiEvaluationBudgetPlan({
    plan_id:'eval.plan.candidate-budget',
    source_sha:SOURCE,
    requests:[expensive],
    epoch_budget_units:64,
    external_budget_owner:false,
    authored_by_candidate:true,
  }),/external_budget_owner_required/);
});

test('routing request roots must remain independent from supporting evidence',()=>{
  const exp=experience('root-alias');
  assert.throws(()=>createRsiEvaluationRoutingRequest({
    request_id:'eval.request.root-alias',
    hypothesis:exp.hypothesis,
    admission:exp.admission,
    external_measurement_digest:exp.hypothesis.supporting_evidence_digest,
    proxy_score_digest:dg('proxy-root-alias'),
    uncertainty:0.5,
    decision_closeness:0.5,
    proxy_reliability_gap:0.5,
    external_measurement_owner:true,
    authored_by_candidate:false,
  }),/independent_measurement_roots_required/);
});

test('append-only budget ledger persists exact cost accounting and cannot execute evaluations',async(t)=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rsi-eval-router-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const statePath=path.join(dir,'ledger.json');
  const ledger=new RsiEvaluationBudgetLedger({statePath,source_sha:SOURCE});
  await ledger.init();

  const a=request('ledger-a',{cost:8,info:0.8,uncertainty:0.8,closeness:0.8,gap:0.2}).row;
  const b=request('ledger-b',{cost:8,info:0.6,uncertainty:0.7,closeness:0.6,gap:0.3}).row;
  const plan=createRsiEvaluationBudgetPlan({
    plan_id:'eval.plan.ledger',
    source_sha:SOURCE,
    requests:[a,b],
    epoch_budget_units:8,
    external_budget_owner:true,
    authored_by_candidate:false,
  });
  assert.equal((await ledger.add(plan)).state,'RECORDED');
  const snap=ledger.snapshot();
  assert.equal(snap.row_count,1);
  assert.equal(snap.total_budget_units,8);
  assert.equal(snap.total_used_budget_units,8);
  assert.equal(snap.total_remaining_budget_units,0);
  assert.equal(snap.ledger_can_schedule_evaluation,false);
  assert.equal(snap.ledger_can_execute_evaluation,false);
  assert.equal(snap.ledger_can_increase_budget,false);

  const restored=new RsiEvaluationBudgetLedger({statePath,source_sha:SOURCE});
  await restored.init();
  assert.equal(restored.snapshot().row_count,1);
  assert.equal((await restored.add(plan)).state,'IDEMPOTENT');
});

test('evaluation budget router trust root keeps routing advisory and bounded',()=>{
  const root=rsiEvaluationBudgetRouterTrustRootSnapshot();
  assert.equal(root.admitted_experience_required,true);
  assert.equal(root.recipe_distillation_verified_required,true);
  assert.equal(root.context_compatible_experience_required,true);
  assert.equal(root.negative_transfer_clearance_required,true);
  assert.equal(root.local_revalidation_protocol_binding_required,true);
  assert.equal(root.external_measurement_owner_required,true);
  assert.equal(root.external_budget_owner_required,true);
  assert.equal(root.uncertainty_aware_routing,true);
  assert.equal(root.information_gain_aware_routing,true);
  assert.equal(root.proxy_bias_aware_routing,true);
  assert.equal(root.close_decision_priority,true);
  assert.equal(root.deterministic_tie_break_required,true);
  assert.equal(root.bounded_epoch_budget_units,256);
  assert.equal(root.cheap_proxy_is_final_truth,false);
  assert.equal(root.independent_audit_required,true);
  assert.equal(root.budget_fail_closed,true);
  assert.equal(root.candidate_can_set_priority,false);
  assert.equal(root.candidate_can_override_budget,false);
  assert.equal(root.router_can_schedule_evaluation,false);
  assert.equal(root.router_can_execute_evaluation,false);
  assert.equal(root.selected_request_is_execution_authority,false);
  assert.equal(root.authority_effect,false);
  assert.match(root.evaluation_budget_router_root_digest,/^sha256:[0-9a-f]{64}$/);
});


test('plan rejects a self-rehashed routing-priority manipulation',()=>{
  const fx=request('priority-tamper',{cost:8,info:0.8,uncertainty:0.8,closeness:0.8,gap:0.2});
  const badCore={...fx.row,routing_priority_score:999};
  delete badCore.request_digest;
  const bad={...badCore,request_digest:structuralDigest(badCore)};
  assert.throws(()=>createRsiEvaluationBudgetPlan({
    plan_id:'eval.plan.priority-tamper',
    source_sha:SOURCE,
    requests:[bad],
    epoch_budget_units:16,
    external_budget_owner:true,
    authored_by_candidate:false,
  }),/request_digest_mismatch/);
});

test('protected safety and security scopes receive a fail-closed evaluation floor',()=>{
  const regular=request('floor-regular',{cost:4,info:1,uncertainty:1,closeness:1,gap:1}).row;
  const safety=request('floor-safety',{cost:8,info:0.2,uncertainty:0.2,closeness:0,gap:0,scopeTags:['SAFETY']}).row;

  const insufficient=createRsiEvaluationBudgetPlan({
    plan_id:'eval.plan.floor-insufficient',
    source_sha:SOURCE,
    requests:[regular,safety],
    epoch_budget_units:4,
    external_budget_owner:true,
    authored_by_candidate:false,
  });
  assert.equal(insufficient.safety_floor_satisfied,false);
  assert.equal(insufficient.state,'EVALUATION_BUDGET_FLOOR_UNSATISFIED');
  assert.deepEqual(insufficient.selected_request_digests,[]);

  const enough=createRsiEvaluationBudgetPlan({
    plan_id:'eval.plan.floor-enough',
    source_sha:SOURCE,
    requests:[regular,safety],
    epoch_budget_units:8,
    external_budget_owner:true,
    authored_by_candidate:false,
  });
  assert.equal(enough.safety_floor_satisfied,true);
  assert.ok(enough.selected_request_digests.includes(safety.request_digest));
  assert.ok(enough.protected_scopes_covered.includes('SAFETY'));
});

test('failed durable budget-ledger write creates no phantom spend',async(t)=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rsi-eval-router-persist-fail-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const statePath=path.join(dir,'ledger.json');
  const ledger=new RsiEvaluationBudgetLedger({statePath,source_sha:SOURCE});
  await ledger.init();
  const row=request('persist-fail',{cost:8}).row;
  const plan=createRsiEvaluationBudgetPlan({
    plan_id:'eval.plan.persist-fail',
    source_sha:SOURCE,
    requests:[row],
    epoch_budget_units:8,
    external_budget_owner:true,
    authored_by_candidate:false,
  });
  await fs.mkdir(statePath);
  await assert.rejects(()=>ledger.add(plan));
  assert.equal(ledger.snapshot().row_count,0);
  assert.equal(ledger.snapshot().total_used_budget_units,0);
});

test('restart rejects self-rehashed plan policy or accounting downgrade',async(t)=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rsi-eval-router-restart-policy-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const statePath=path.join(dir,'ledger.json');
  const ledger=new RsiEvaluationBudgetLedger({statePath,source_sha:SOURCE});
  await ledger.init();
  const row=request('restart-policy',{cost:8}).row;
  const plan=createRsiEvaluationBudgetPlan({
    plan_id:'eval.plan.restart-policy',
    source_sha:SOURCE,
    requests:[row],
    epoch_budget_units:8,
    external_budget_owner:true,
    authored_by_candidate:false,
  });
  await ledger.add(plan);

  const persisted=JSON.parse(await fs.readFile(statePath,'utf8'));
  const badPlanCore={...persisted.rows[0].plan,candidate_can_override_budget:true};
  delete badPlanCore.plan_digest;
  persisted.rows[0].plan={...badPlanCore,plan_digest:structuralDigest(badPlanCore)};
  const stateCore={...persisted};
  delete stateCore.state_digest;
  persisted.state_digest=structuralDigest(stateCore);
  await fs.writeFile(statePath,`${JSON.stringify(persisted)}\n`,'utf8');

  const restored=new RsiEvaluationBudgetLedger({statePath,source_sha:SOURCE});
  await assert.rejects(()=>restored.init(),/plan_policy_invalid/);
});


test('restart rejects duplicate budget plan identities even with distinct digests',async(t)=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rsi-eval-router-duplicate-plan-id-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const statePath=path.join(dir,'ledger.json');
  const rowA=request('duplicate-plan-a',{cost:8}).row;
  const rowB=request('duplicate-plan-b',{cost:8}).row;
  const planA=createRsiEvaluationBudgetPlan({
    plan_id:'eval.plan.duplicate-id',
    source_sha:SOURCE,
    requests:[rowA],
    epoch_budget_units:8,
    external_budget_owner:true,
    authored_by_candidate:false,
  });
  const planB=createRsiEvaluationBudgetPlan({
    plan_id:'eval.plan.duplicate-id',
    source_sha:SOURCE,
    requests:[rowB],
    epoch_budget_units:8,
    external_budget_owner:true,
    authored_by_candidate:false,
  });

  const ledger=new RsiEvaluationBudgetLedger({statePath,source_sha:SOURCE});
  await ledger.init();
  await ledger.add(planA);
  const persisted=JSON.parse(await fs.readFile(statePath,'utf8'));
  persisted.rows.push({source_sha:SOURCE,plan:planB});
  persisted.row_count=2;
  persisted.total_budget_units=16;
  persisted.total_used_budget_units=16;
  persisted.total_remaining_budget_units=0;
  const stateCore={...persisted};
  delete stateCore.state_digest;
  persisted.state_digest=structuralDigest(stateCore);
  await fs.writeFile(statePath,`${JSON.stringify(persisted)}\n`,'utf8');

  const restored=new RsiEvaluationBudgetLedger({statePath,source_sha:SOURCE});
  await assert.rejects(()=>restored.init(),/plan_id_duplicate/);
});
