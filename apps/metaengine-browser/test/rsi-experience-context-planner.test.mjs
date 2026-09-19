import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRsiExperienceCase,
  createRsiExperienceUtilityReceipt,
  createRsiExperienceGraphSnapshot,
} from '../src/rsi-experience-graph.mjs';
import {
  createRsiExperienceContextPlan,
  verifyRsiExperienceContextPlan,
  rsiExperienceContextTrustRootSnapshot,
} from '../src/rsi-experience-context-planner.mjs';

const d=(c)=>`sha256:${c.repeat(64)}`;
const cid=(c)=>`candidate_sha256_${c.repeat(64)}`;

function frontier(overrides={}) {
  return {
    opportunity_id:'opp:111111111111111111111111',
    signal:'AMBIGUOUS_COMMAND_OUTCOMES',
    priority:'P0',
    mutation_surface:'BROWSER_RUNTIME',
    observation_digest:'2'.repeat(64),
    hypothesis:{
      source_sha:'a'.repeat(40),
      opportunity_id:'opp:111111111111111111111111',
      signal:'AMBIGUOUS_COMMAND_OUTCOMES',
      mutation_surface:'BROWSER_RUNTIME',
      hypothesis_digest:d('3'),
      execution_authority:false,
      production_mutation_authority:false,
      promotion_authority:false,
      self_update_authority:false,
      automatic_retry_allowed:false,
      authority_effect:false,
    },
    plan:{
      source_sha:'a'.repeat(40),
      experiment_id:'rsi_exp_111111111111111111111111',
      plan_digest:'4'.repeat(64),
      target_branch:'work/rsi/ambiguous-command-outcomes-a1b2c3d4-12345678',
      task_spec:{rsi:{
        opportunity_id:'opp:111111111111111111111111',
        mutation_surface:'BROWSER_RUNTIME',
      }},
      execution_authority:false,
      production_mutation_authority:false,
      promotion_authority:false,
      self_update_authority:false,
      automatic_retry_allowed:false,
      authority_effect:false,
    },
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
    ...overrides,
  };
}

function harmfulGraph() {
  const taskAnchor={
    task_id:'task.history.harmful',
    task_signature_digest:d('4'),
    challenge_family:'BROWSER_RUNTIME',
    hidden_manifest_digest:d('6'),
    external_writer:true,
    authored_by_candidate:false,
  };
  const cases=[];
  const utility=[];
  for(let i=1;i<=8;i+=1){
    const ch=String(i);
    cases.push(createRsiExperienceCase({
      case_id:`rsi_case_harmful_${i}`,
      task_id:'task.history.harmful',
      task_signature_digest:d('4'),
      attempt_index:i,
      candidate_id:cid(ch),
      candidate_sha:ch.repeat(40),
      outcome:'SUCCESS',
      environment_fingerprint:'metaengine.browser.runtime',
      model_family:'METAENGINE_RSI',
      execution_signature_digest:d(ch),
      failure_codes:[],
      mechanism_tags:['AMBIGUOUS_COMMAND_OUTCOMES','BROWSER_RUNTIME'],
      lesson_digests:[],
      attribution_digests:[],
      transfer_receipt_digests:[],
      evidence_digest:d(ch),
      evidence_refs:[`evidence:harmful:${i}`],
      external_writer:true,
      authored_by_candidate:false,
    }));
    utility.push(createRsiExperienceUtilityReceipt({
      receipt_id:`utility.harmful.context.${i}`,
      case_id:`rsi_case_harmful_${i}`,
      target_context_digest:d('e'),
      outcome:'HARMFUL',
      evidence_digest:d(ch),
      evidence_refs:[`external:harmful:${i}`],
      external_evaluator:true,
      authored_by_candidate:false,
    }));
  }
  return createRsiExperienceGraphSnapshot({
    graph_id:'rsi.runtime.experience.harmful',
    epoch:1,
    predecessor_snapshot_digest:null,
    task_anchors:[taskAnchor],
    cases,
    similarity_edges:[],
    correction_edges:[],
    utility_receipts:utility,
  });
}

function graph() {
  const taskAnchor={
    task_id:'task.history.1',
    task_signature_digest:d('5'),
    challenge_family:'BROWSER_RUNTIME',
    hidden_manifest_digest:d('6'),
    external_writer:true,
    authored_by_candidate:false,
  };
  const useful=createRsiExperienceCase({
    case_id:'rsi_case_historical_success',
    task_id:'task.history.1',
    task_signature_digest:d('5'),
    attempt_index:1,
    candidate_id:cid('a'),
    candidate_sha:'a'.repeat(40),
    outcome:'SUCCESS',
    environment_fingerprint:'metaengine.browser.runtime',
    model_family:'METAENGINE_RSI',
    execution_signature_digest:d('7'),
    failure_codes:[],
    mechanism_tags:['AMBIGUOUS_COMMAND_OUTCOMES','BROWSER_RUNTIME'],
    lesson_digests:[d('8')],
    attribution_digests:[d('9')],
    transfer_receipt_digests:[],
    evidence_digest:d('a'),
    evidence_refs:['evidence:historical-success'],
    external_writer:true,
    authored_by_candidate:false,
  });
  return createRsiExperienceGraphSnapshot({
    graph_id:'rsi.runtime.experience.aaaaaaaaaaaaaaaa',
    epoch:1,
    predecessor_snapshot_digest:null,
    task_anchors:[taskAnchor],
    cases:[useful],
    similarity_edges:[],
    correction_edges:[],
    utility_receipts:[],
  });
}

test('planner explicitly records absence of verified experience without inventing memory',()=>{
  const plan=createRsiExperienceContextPlan({frontier_entry:frontier()});
  verifyRsiExperienceContextPlan(plan);
  assert.equal(plan.mode,'NO_VERIFIED_EXPERIENCE');
  assert.equal(plan.source_sha,'a'.repeat(40));
  assert.equal(plan.selected_case_count,0);
  assert.equal(plan.graph_snapshot_digest,null);
  assert.equal(plan.retrieval_digest,null);
  assert.equal(plan.bounded_memory_utility_state,null);
  assert.equal(plan.bounded_memory_utility_state_digest,null);
  assert.equal(plan.bounded_memory_utility_mode,'NO_GRAPH');
  assert.equal(plan.utility_bounded_case_cap,0);
  assert.equal(plan.memory_reliability_projection,null);
  assert.equal(plan.memory_reliability_projection_digest,null);
  assert.equal(plan.quarantined_case_count,0);
  assert.deepEqual(plan.quarantined_cases,[]);
  assert.equal(plan.no_verified_experience_is_explicit,true);
  assert.equal(plan.retrieval_is_advisory_only,true);
  assert.match(plan.search_context_digest,/^[0-9a-f]{64}$/);
  assert.equal(plan.execution_authority,false);
  assert.equal(plan.promotion_authority,false);
});

test('planner retrieves only verified graph summaries and never exposes raw trajectory or authority',()=>{
  const plan=createRsiExperienceContextPlan({
    frontier_entry:frontier(),
    experience_graph_snapshot:graph(),
  });
  verifyRsiExperienceContextPlan(plan);
  assert.equal(plan.mode,'VERIFIED_EXPERIENCE_RETRIEVAL');
  assert.equal(plan.selected_case_count,1);
  assert.equal(plan.bounded_memory_utility_mode,'EVIDENCE_SPARSE');
  assert.equal(plan.utility_bounded_case_cap,6);
  assert.equal(plan.bounded_memory_utility_state.fixed_dimensional_state,true);
  assert.equal(plan.bounded_memory_utility_state.trajectory_joint_reward_assignment,false);
  assert.equal(plan.selected_cases[0].case_id,'rsi_case_historical_success');
  assert.equal(plan.selected_cases[0].memory_reliability_tier,'WARM');
  assert.equal(plan.selected_cases[0].memory_candidate_guidance_allowed,true);
  assert.equal(plan.selected_cases[0].memory_remains_queryable,true);
  assert.equal(plan.quarantined_case_count,0);
  assert.ok(plan.selected_cases[0].mechanism_tags.includes('AMBIGUOUS_COMMAND_OUTCOMES'));
  assert.equal(plan.selected_cases[0].source_context_truth_is_portable,false);
  assert.equal(plan.selected_cases[0].external_transfer_validation_required,true);
  assert.equal(plan.raw_trajectory_exposed,false);
  assert.equal(plan.raw_page_text_exposed,false);
  assert.equal(plan.raw_user_input_exposed,false);
  assert.equal(plan.secret_material_exposed,false);
  assert.equal(plan.candidate_can_write_graph,false);
  assert.equal(plan.candidate_can_select_retrieval_thresholds,false);
  assert.equal(plan.candidate_can_mark_memory_portable,false);
  assert.equal(plan.second_scheduler,false);
});

test('bridge cases are rejected when no verified graph exists',()=>{
  assert.throws(()=>createRsiExperienceContextPlan({
    frontier_entry:frontier(),
    bridge_case_ids:['rsi_case_historical_success'],
  }),/bridge_cases_require_experience_graph/);
});

test('context digest is tamper evident and independent from execution authority',()=>{
  const plan=createRsiExperienceContextPlan({frontier_entry:frontier(),experience_graph_snapshot:graph()});
  assert.throws(()=>verifyRsiExperienceContextPlan({...plan,mode:'NO_VERIFIED_EXPERIENCE'}),/digest_mismatch/);
  assert.throws(()=>verifyRsiExperienceContextPlan({...plan,execution_authority:true}),/execution_authority_invalid/);
});

test('experience context trust root is retrieval-only and cannot become scheduler or promotion authority',()=>{
  const root=rsiExperienceContextTrustRootSnapshot();
  assert.equal(root.verified_experience_graph_only,true);
  assert.equal(root.no_verified_experience_is_explicit,true);
  assert.equal(root.source_context_truth_is_portable,false);
  assert.equal(root.retrieval_is_advisory_only,true);
  assert.equal(root.candidate_can_write_graph,false);
  assert.equal(root.utility_state_controls_case_cap,true);
  assert.equal(root.harmful_dominant_case_cap,4);
  assert.equal(root.evidence_sparse_case_cap,6);
  assert.equal(root.bounded_memory_utility_root.fixed_dimensional_state,true);
  assert.equal(root.bounded_memory_utility_root.trajectory_joint_reward_assignment,false);
  assert.equal(root.memory_reliability_root.quarantined_memory_remains_queryable,true);
  assert.equal(root.memory_reliability_root.candidate_can_set_tier,false);
  assert.equal(root.quarantined_memory_remains_queryable,true);
  assert.equal(root.quarantined_memory_is_candidate_guidance,false);
  assert.equal(root.candidate_can_set_memory_tier,false);
  assert.equal(root.candidate_can_set_memory_reliability_thresholds,false);
  assert.equal(root.second_scheduler,false);
  assert.equal(root.execution_authority,false);
  assert.equal(root.promotion_authority,false);
  assert.equal(root.self_update_authority,false);
});


test('harmful-dominant bounded utility state contracts context breadth before candidate synthesis',()=>{
  const plan=createRsiExperienceContextPlan({
    frontier_entry:frontier(),
    experience_graph_snapshot:harmfulGraph(),
  });
  verifyRsiExperienceContextPlan(plan);
  assert.equal(plan.mode,'VERIFIED_EXPERIENCE_RETRIEVAL');
  assert.equal(plan.bounded_memory_utility_mode,'HARMFUL_DOMINANT');
  assert.equal(plan.utility_bounded_case_cap,4);
  assert.equal(plan.selected_case_count,4);
  assert.equal(plan.bounded_memory_utility_state.candidate_can_set_case_cap,false);
  assert.equal(plan.bounded_memory_utility_state.co_retrieved_memory_credit_update,false);
  assert.equal(plan.retrieval_is_advisory_only,true);
  assert.equal(plan.execution_authority,false);
});

test('tampering with bounded utility state or its cap invalidates the context plan',()=>{
  const plan=createRsiExperienceContextPlan({
    frontier_entry:frontier(),
    experience_graph_snapshot:graph(),
  });
  const badState=structuredClone(plan);
  badState.bounded_memory_utility_state.recommended_case_cap=12;
  assert.throws(()=>verifyRsiExperienceContextPlan(badState),/case_cap_invalid|digest_mismatch|state_mismatch/);

  const badCap={...plan,utility_bounded_case_cap:12};
  assert.throws(()=>verifyRsiExperienceContextPlan(badCap),/state_mismatch|digest_mismatch/);
});


test('quarantined harmful memory remains in the projection but is excluded from candidate guidance',()=>{
  const noGraph=createRsiExperienceContextPlan({frontier_entry:frontier()});
  const base=harmfulGraph();
  const exactHarm1=createRsiExperienceUtilityReceipt({
    receipt_id:'utility.quarantine.exact.1',
    case_id:'rsi_case_harmful_1',
    target_context_digest:noGraph.target_context_digest,
    outcome:'HARMFUL',
    evidence_digest:d('a'),
    evidence_refs:['external:quarantine:exact:1'],
    external_evaluator:true,
    authored_by_candidate:false,
  });
  const exactHarm2=createRsiExperienceUtilityReceipt({
    receipt_id:'utility.quarantine.exact.2',
    case_id:'rsi_case_harmful_1',
    target_context_digest:noGraph.target_context_digest,
    outcome:'HARMFUL',
    evidence_digest:d('b'),
    evidence_refs:['external:quarantine:exact:2'],
    external_evaluator:true,
    authored_by_candidate:false,
  });
  const snapshot=createRsiExperienceGraphSnapshot({
    graph_id:'rsi.runtime.experience.quarantine',
    epoch:1,
    predecessor_snapshot_digest:null,
    task_anchors:base.task_anchors,
    cases:base.cases,
    similarity_edges:base.similarity_edges,
    correction_edges:base.correction_edges,
    utility_receipts:[...base.utility_receipts,exactHarm1,exactHarm2],
  });
  const plan=createRsiExperienceContextPlan({
    frontier_entry:frontier(),
    experience_graph_snapshot:snapshot,
  });
  verifyRsiExperienceContextPlan(plan);
  assert.equal(plan.quarantined_case_count,1);
  assert.equal(plan.quarantined_cases[0].case_id,'rsi_case_harmful_1');
  assert.equal(plan.quarantined_cases[0].remains_queryable,true);
  assert.equal(plan.quarantined_cases[0].candidate_guidance_allowed,false);
  assert.ok(plan.memory_reliability_projection.quarantined_case_ids.includes('rsi_case_harmful_1'));
  assert.ok(!plan.selected_cases.some(row=>row.case_id==='rsi_case_harmful_1'));
  assert.ok(plan.selected_cases.every(row=>row.memory_reliability_tier!=='QUARANTINED'));
});

test('tampering a selected memory into QUARANTINED guidance is rejected',()=>{
  const plan=createRsiExperienceContextPlan({
    frontier_entry:frontier(),
    experience_graph_snapshot:graph(),
  });
  const bad=structuredClone(plan);
  bad.selected_cases[0].memory_reliability_tier='QUARANTINED';
  assert.throws(()=>verifyRsiExperienceContextPlan(bad),/selected_case_reliability_mismatch|digest_mismatch/);
});
