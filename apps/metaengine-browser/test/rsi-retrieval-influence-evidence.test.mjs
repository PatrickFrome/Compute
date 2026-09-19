import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import {
  createRsiExperienceCase,
  createRsiExperienceUtilityReceipt,
  createRsiExperienceGraphSnapshot,
  extendRsiExperienceGraphSnapshot,
} from '../src/rsi-experience-graph.mjs';
import { createRsiExperienceContextPlan } from '../src/rsi-experience-context-planner.mjs';
import {
  createRsiRetrievalInfluenceAdmission,
  verifyRsiRetrievalInfluenceAdmission,
  applyRsiRetrievalInfluenceAdmission,
  rsiRetrievalInfluenceTrustRootSnapshot,
} from '../src/rsi-retrieval-influence-evidence.mjs';

const d=(c)=>`sha256:${c.repeat(64)}`;
const cid=(c)=>`candidate_sha256_${c.repeat(64)}`;
const SHA='a'.repeat(40);
const EPISODE='episode:rsi:retrieval-influence-0001';
const REQUIRED=[
  'HARD_INVARIANTS',
  'OBJECTIVES',
  'HOLDOUT',
  'REGRESSION_REPLAY',
  'EVALUATION_INTEGRITY',
  'TOURNAMENT',
];

function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));
}
function digest(value){
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)),'utf8').digest('hex')}`;
}
function zero(extra={}){
  return {
    ...extra,
    execution_authority:false,
    browser_authority:false,
    scheduler_authority:false,
    task_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
}

function experienceCase(i,outcome='SUCCESS'){
  const c=String(i);
  return createRsiExperienceCase({
    case_id:`case.influence.${i}`,
    task_id:'task.influence',
    task_signature_digest:d('4'),
    attempt_index:i,
    candidate_id:cid(c),
    candidate_sha:c.repeat(40),
    outcome,
    environment_fingerprint:'metaengine.browser.runtime',
    model_family:'METAENGINE_RSI',
    execution_signature_digest:d(c),
    failure_codes:outcome==='FAILURE'?['AMBIGUOUS_COMMAND_OUTCOMES']:[],
    mechanism_tags:['BROWSER_RUNTIME','AMBIGUOUS_COMMAND_OUTCOMES'],
    lesson_digests:[],
    attribution_digests:[],
    transfer_receipt_digests:[],
    evidence_digest:d(c),
    evidence_refs:[`evidence:influence:${i}`],
    external_writer:true,
    authored_by_candidate:false,
  });
}

function graph(extraUtility=[]){
  const rows=[experienceCase(1,'FAILURE'),experienceCase(2),experienceCase(3)];
  return createRsiExperienceGraphSnapshot({
    graph_id:'rsi.influence.graph',
    epoch:1,
    predecessor_snapshot_digest:null,
    task_anchors:[{
      task_id:'task.influence',
      task_signature_digest:d('4'),
      challenge_family:'BROWSER_RUNTIME',
      hidden_manifest_digest:d('8'),
      external_writer:true,
      authored_by_candidate:false,
    }],
    cases:rows,
    similarity_edges:[],
    correction_edges:[{
      from_case_id:'case.influence.1',
      to_case_id:'case.influence.2',
      evidence_digest:d('9'),
      external_verifier:true,
      authored_by_candidate:false,
    }],
    utility_receipts:extraUtility,
  });
}

function frontier(){
  return zero({
    opportunity_id:'opportunity:influence:0001',
    signal:'AMBIGUOUS_COMMAND_OUTCOMES',
    priority:'P0',
    mutation_surface:'BROWSER_RUNTIME',
    observation_digest:'2'.repeat(64),
    hypothesis:zero({
      source_sha:SHA,
      opportunity_id:'opportunity:influence:0001',
      signal:'AMBIGUOUS_COMMAND_OUTCOMES',
      mutation_surface:'BROWSER_RUNTIME',
      hypothesis_digest:d('3'),
    }),
    plan:zero({
      source_sha:SHA,
      experiment_id:'rsi_exp_influence_00000001',
      plan_digest:'4'.repeat(64),
      target_branch:'work/rsi/influence-00000001',
      task_spec:{rsi:{
        opportunity_id:'opportunity:influence:0001',
        mutation_surface:'BROWSER_RUNTIME',
      }},
    }),
  });
}

function plan(snapshot=graph()){
  return createRsiExperienceContextPlan({
    frontier_entry:frontier(),
    experience_graph_snapshot:snapshot,
  });
}

function externalBundle({ambiguous=false}={}){
  const classes=REQUIRED.map((kind,index)=>zero({
    evidence_id:`external:${kind.toLowerCase().replaceAll('_','-')}`,
    evidence_kind:kind,
    result:ambiguous&&index===2?'AMBIGUOUS':'PASS',
    evidence_digest:d(String((index+1)%10)),
    support_schema:'metaengine.test.support.v1',
    support_digest:d(String((index+2)%10)),
    external_evaluator_required:true,
    authored_by_candidate:false,
    candidate_can_override_result:false,
    physical_effect_replay_allowed:false,
  }));
  const core=zero({
    schema:'metaengine.rsi.external-evaluation-bundle.v1',
    version:1,
    episode_id:EPISODE,
    candidate_id:cid('b'),
    candidate_sha:'b'.repeat(40),
    parent_sha:SHA,
    isolated_candidate_handoff_digest:d('1'),
    evaluator_plan_digest:d('2'),
    evaluator_result_digest:d('3'),
    benchmark_admission_digest:null,
    holdout_result_digest:null,
    regression_gate_digest:null,
    evaluation_integrity_assessment_digest:null,
    tournament_plan_digest:null,
    tournament_result_digest:null,
    evidence_classes:classes,
    required_evidence_kinds:[...REQUIRED],
    all_classes_pass:classes.every(row=>row.result==='PASS'),
    any_class_ambiguous:classes.some(row=>row.result==='AMBIGUOUS'),
    candidate_can_self_certify:false,
    candidate_can_modify_evidence:false,
    evidence_ingest_is_promotion_authority:false,
    direct_promotion_enabled:false,
    physical_effect_replay_allowed:false,
  });
  const payloadBytes=Buffer.byteLength(JSON.stringify(stable(core)),'utf8');
  return {
    ...core,
    payload_bytes:payloadBytes,
    max_payload_bytes:48*1024,
    bundle_digest:digest(core),
  };
}

function assessmentFor(contextPlan,overrides={}){
  const first=contextPlan.selected_cases[0];
  return {
    assessment_id:'retrieval-influence-assessment-0001',
    evaluator_id:'external-memory-ablation-v1',
    external_evaluator:true,
    authored_by_candidate:false,
    candidate_can_rate_memory:false,
    trajectory_level_reward_assigned:false,
    co_retrieved_memories_share_reward:false,
    rows:[{
      case_id:first.case_id,
      attribution_method:'LEAVE_ONE_OUT',
      outcome:'HELPFUL',
      baseline_without_case_digest:d('5'),
      treatment_with_case_digest:d('6'),
      evidence_digest:d('7'),
      evidence_refs:['external:ablation:case-1'],
      external_evaluator:true,
      authored_by_candidate:false,
      candidate_can_rate_memory:false,
      counterfactual_baseline_verified:true,
      treatment_verified:true,
    }],
    ...overrides,
  };
}

test('per-case counterfactual evidence appends utility only to the assessed selected memory',()=>{
  const snapshot=graph();
  const context=plan(snapshot);
  assert.ok(context.selected_case_count>=2);
  const bundle=externalBundle();
  const admission=createRsiRetrievalInfluenceAdmission({
    episode_id:EPISODE,
    context_plan:context,
    external_evaluation_bundle:bundle,
    experience_graph_snapshot:snapshot,
    assessment:assessmentFor(context),
  });
  verifyRsiRetrievalInfluenceAdmission(admission,{
    context_plan:context,
    external_evaluation_bundle:bundle,
    experience_graph_snapshot:snapshot,
  });
  assert.equal(admission.assessed_case_count,1);
  assert.equal(admission.utility_receipts.length,1);
  assert.equal(admission.utility_receipts[0].case_id,context.selected_cases[0].case_id);
  assert.equal(admission.utility_receipts[0].target_context_digest,context.target_context_digest);
  assert.equal(admission.per_case_utility_only,true);
  assert.equal(admission.trajectory_level_reward_assigned,false);
  assert.equal(admission.co_retrieved_memories_share_reward,false);
  assert.equal(admission.unassessed_cases_receive_no_utility,true);
  assert.equal(admission.candidate_can_rate_memory,false);
  assert.equal(admission.scalar_reward,null);

  const next=applyRsiRetrievalInfluenceAdmission({previous_snapshot:snapshot,admission});
  assert.equal(next.utility_receipt_count,snapshot.utility_receipt_count+1);
  const affected=new Set(next.utility_receipts.slice(snapshot.utility_receipt_count).map(row=>row.case_id));
  assert.deepEqual([...affected],[context.selected_cases[0].case_id]);
});

test('unselected memory cannot receive influence utility and candidate self-rating is rejected',()=>{
  const snapshot=graph();
  const context=plan(snapshot);
  const bundle=externalBundle();
  const unselected=snapshot.cases.find(row=>!context.selected_cases.some(selected=>selected.case_id===row.case_id));
  if(unselected){
    const bad=assessmentFor(context);
    bad.rows[0]={...bad.rows[0],case_id:unselected.case_id};
    assert.throws(()=>createRsiRetrievalInfluenceAdmission({
      episode_id:EPISODE,
      context_plan:context,
      external_evaluation_bundle:bundle,
      experience_graph_snapshot:snapshot,
      assessment:bad,
    }),/case_not_selected/);
  }
  assert.throws(()=>createRsiRetrievalInfluenceAdmission({
    episode_id:EPISODE,
    context_plan:context,
    external_evaluation_bundle:bundle,
    experience_graph_snapshot:snapshot,
    assessment:assessmentFor(context,{candidate_can_rate_memory:true}),
  }),/external_assessment_required/);
});

test('ambiguous evaluation and non-counterfactual identical runs cannot update memory utility',()=>{
  const snapshot=graph();
  const context=plan(snapshot);
  assert.throws(()=>createRsiRetrievalInfluenceAdmission({
    episode_id:EPISODE,
    context_plan:context,
    external_evaluation_bundle:externalBundle({ambiguous:true}),
    experience_graph_snapshot:snapshot,
    assessment:assessmentFor(context),
  }),/ambiguous_evaluation_forbidden/);

  const same=assessmentFor(context);
  same.rows[0]={
    ...same.rows[0],
    treatment_with_case_digest:same.rows[0].baseline_without_case_digest,
  };
  assert.throws(()=>createRsiRetrievalInfluenceAdmission({
    episode_id:EPISODE,
    context_plan:context,
    external_evaluation_bundle:externalBundle(),
    experience_graph_snapshot:snapshot,
    assessment:same,
  }),/counterfactual_distinct_runs_required/);
});

test('graph advance after influence assessment requires reassessment instead of replaying stale utility',()=>{
  const snapshot=graph();
  const context=plan(snapshot);
  const bundle=externalBundle();
  const admission=createRsiRetrievalInfluenceAdmission({
    episode_id:EPISODE,
    context_plan:context,
    external_evaluation_bundle:bundle,
    experience_graph_snapshot:snapshot,
    assessment:assessmentFor(context),
  });
  const extra=createRsiExperienceUtilityReceipt({
    receipt_id:'utility.intervening.external',
    case_id:snapshot.cases[0].case_id,
    target_context_digest:d('e'),
    outcome:'NEUTRAL',
    evidence_digest:d('8'),
    evidence_refs:['external:intervening:utility'],
    external_evaluator:true,
    authored_by_candidate:false,
  });
  const advanced=extendRsiExperienceGraphSnapshot({
    previous_snapshot:snapshot,
    utility_receipts:[extra],
  });
  assert.throws(()=>applyRsiRetrievalInfluenceAdmission({
    previous_snapshot:advanced,
    admission,
  }),/graph_advanced_requires_reassessment/);
});

test('intrinsic verifier rejects receipt-set tampering and shared trajectory reward',()=>{
  const snapshot=graph();
  const context=plan(snapshot);
  const bundle=externalBundle();
  const admission=createRsiRetrievalInfluenceAdmission({
    episode_id:EPISODE,
    context_plan:context,
    external_evaluation_bundle:bundle,
    experience_graph_snapshot:snapshot,
    assessment:assessmentFor(context),
  });
  assert.throws(()=>verifyRsiRetrievalInfluenceAdmission({
    ...admission,
    co_retrieved_memories_share_reward:true,
  }),/policy_invalid/);
  assert.throws(()=>verifyRsiRetrievalInfluenceAdmission({
    ...admission,
    utility_receipts:[],
  }),/receipt_set_mismatch|digest_mismatch/);
});

test('retrieval influence trust root fixes causal per-case anti-self-reward boundaries',()=>{
  const root=rsiRetrievalInfluenceTrustRootSnapshot();
  assert.equal(root.persisted_context_plan_required,true);
  assert.equal(root.exact_selected_case_binding_required,true);
  assert.equal(root.external_evaluation_bundle_required,true);
  assert.equal(root.ambiguous_evaluation_allowed,false);
  assert.deepEqual(root.allowed_attribution_methods,['LEAVE_ONE_OUT','PAIRED_ABLATION']);
  assert.equal(root.counterfactual_or_ablation_required,true);
  assert.equal(root.per_case_utility_only,true);
  assert.equal(root.trajectory_level_reward_assignment,false);
  assert.equal(root.co_retrieved_memories_share_reward,false);
  assert.equal(root.unassessed_cases_receive_no_utility,true);
  assert.equal(root.candidate_can_rate_memory,false);
  assert.equal(root.graph_advance_requires_reassessment,true);
  assert.equal(root.execution_authority,false);
  assert.equal(root.promotion_authority,false);
});
