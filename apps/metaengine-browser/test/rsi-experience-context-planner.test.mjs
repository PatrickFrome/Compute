import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRsiExperienceCase,
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
  assert.equal(plan.selected_case_count,0);
  assert.equal(plan.graph_snapshot_digest,null);
  assert.equal(plan.retrieval_digest,null);
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
  assert.equal(plan.selected_cases[0].case_id,'rsi_case_historical_success');
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
  assert.equal(root.second_scheduler,false);
  assert.equal(root.execution_authority,false);
  assert.equal(root.promotion_authority,false);
  assert.equal(root.self_update_authority,false);
});
