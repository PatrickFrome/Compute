import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRsiExperienceCase,
  createRsiExperienceUtilityReceipt,
  createRsiExperienceGraphSnapshot,
  createRsiExperienceGraphQuery,
  retrieveRsiExperienceGraph,
} from '../src/rsi-experience-graph.mjs';
import {
  createRsiBoundedMemoryUtilityState,
  verifyRsiBoundedMemoryUtilityState,
  rsiBoundedMemoryUtilityTrustRootSnapshot,
} from '../src/rsi-bounded-memory-utility-state.mjs';

const d=(c)=>`sha256:${c.repeat(64)}`;
const cid=(c)=>`candidate_sha256_${c.repeat(64)}`;
const sha=(c)=>c.repeat(40);

function caseRow(index,{outcome='SUCCESS'}={}){
  const c=String(index);
  return createRsiExperienceCase({
    case_id:`case.utility.${index}`,
    task_id:'task.utility.bounded',
    task_signature_digest:d('1'),
    attempt_index:index,
    candidate_id:cid(c),
    candidate_sha:sha(c),
    outcome,
    environment_fingerprint:'WINDOWS_BROWSER',
    model_family:'METAENGINE_RSI',
    execution_signature_digest:d(c),
    failure_codes:outcome==='FAILURE'?['POST_DEPLOYMENT_REGRESSION']:[],
    mechanism_tags:['BROWSER_RUNTIME'],
    lesson_digests:[],
    attribution_digests:[],
    transfer_receipt_digests:[],
    evidence_digest:d(c),
    evidence_refs:[`evidence:utility:${index}`],
    external_writer:true,
    authored_by_candidate:false,
  });
}

function graph({utility=[]}={}){
  const cases=Array.from({length:6},(_,i)=>caseRow(i+1,{outcome:i===0?'FAILURE':'SUCCESS'}));
  return createRsiExperienceGraphSnapshot({
    graph_id:'rsi.utility.bounded.graph',
    epoch:1,
    predecessor_snapshot_digest:null,
    task_anchors:[{
      task_id:'task.utility.bounded',
      task_signature_digest:d('1'),
      challenge_family:'BROWSER_RUNTIME',
      hidden_manifest_digest:d('a'),
      external_writer:true,
      authored_by_candidate:false,
    }],
    cases,
    similarity_edges:[],
    correction_edges:[{
      from_case_id:'case.utility.1',
      to_case_id:'case.utility.2',
      evidence_digest:d('b'),
      external_verifier:true,
      authored_by_candidate:false,
    }],
    utility_receipts:utility,
  });
}

function query(target=d('f')){
  return createRsiExperienceGraphQuery({
    query_id:'query.utility.bounded',
    target_context_digest:target,
    task_signature_digest:d('1'),
    challenge_family:'BROWSER_RUNTIME',
    environment_fingerprint:'WINDOWS_BROWSER',
    model_family:'METAENGINE_RSI',
    failure_codes:['POST_DEPLOYMENT_REGRESSION'],
    mechanism_tags:['BROWSER_RUNTIME'],
    bridge_case_ids:['case.utility.1'],
    external_query_context:true,
    authored_by_candidate:false,
  });
}

test('bounded utility state stays fixed-dimensional and avoids trajectory joint reward',()=>{
  const utility=[
    createRsiExperienceUtilityReceipt({
      receipt_id:'utility.harmful.1',
      case_id:'case.utility.1',
      target_context_digest:d('e'),
      outcome:'HARMFUL',
      evidence_digest:d('2'),
      evidence_refs:['external:utility:harmful:1'],
      external_evaluator:true,
      authored_by_candidate:false,
    }),
    createRsiExperienceUtilityReceipt({
      receipt_id:'utility.harmful.2',
      case_id:'case.utility.2',
      target_context_digest:d('e'),
      outcome:'HARMFUL',
      evidence_digest:d('3'),
      evidence_refs:['external:utility:harmful:2'],
      external_evaluator:true,
      authored_by_candidate:false,
    }),
    createRsiExperienceUtilityReceipt({
      receipt_id:'utility.helpful.3',
      case_id:'case.utility.3',
      target_context_digest:d('f'),
      outcome:'HELPFUL',
      evidence_digest:d('4'),
      evidence_refs:['external:utility:helpful:3'],
      external_evaluator:true,
      authored_by_candidate:false,
    }),
  ];
  const snapshot=graph({utility});
  const q=query();
  const retrieval=retrieveRsiExperienceGraph({snapshot,query:q});
  const state=createRsiBoundedMemoryUtilityState({
    experience_graph_snapshot:snapshot,
    query:q,
    retrieval,
  });
  verifyRsiBoundedMemoryUtilityState(state,{
    experience_graph_snapshot:snapshot,
    query:q,
    retrieval,
  });
  assert.equal(state.coordinate_count,10);
  assert.equal(state.fixed_dimensional_state,true);
  assert.equal(state.per_trajectory_utility_state,false);
  assert.equal(state.trajectory_joint_reward_assignment,false);
  assert.equal(state.co_retrieved_memory_credit_update,false);
  assert.equal(state.utility_receipts_are_case_local,true);
  assert.equal(state.scalar_reward,null);
  assert.equal(state.global_candidate_score_delta,null);
  assert.equal(state.candidate_can_set_utility,false);
  assert.equal(state.candidate_can_set_case_cap,false);
  assert.equal(state.state_is_retrieval_advisory_only,true);
  assert.equal(state.execution_authority,false);
});

test('harmful-dominant memory contracts context breadth to four cases',()=>{
  const utility=Array.from({length:5},(_,i)=>createRsiExperienceUtilityReceipt({
    receipt_id:`utility.cross.harmful.${i+1}`,
    case_id:`case.utility.${i+1}`,
    target_context_digest:d('e'),
    outcome:'HARMFUL',
    evidence_digest:d(String((i+2)%10)),
    evidence_refs:[`external:utility:cross-harmful:${i+1}`],
    external_evaluator:true,
    authored_by_candidate:false,
  }));
  const snapshot=graph({utility});
  const q=query();
  const retrieval=retrieveRsiExperienceGraph({snapshot,query:q});
  const state=createRsiBoundedMemoryUtilityState({experience_graph_snapshot:snapshot,query:q,retrieval});
  assert.equal(state.mode,'HARMFUL_DOMINANT');
  assert.equal(state.recommended_case_cap,4);
  assert.ok(state.coordinates.CROSS_CONTEXT_HARMFUL>=5);
  assert.ok(state.posterior_helpful<0.5);
  assert.equal(state.exact_context_utility_dominates,true);
  assert.equal(state.cross_context_utility_discount_weight,0.25);
});

test('utility-sparse retrieval is bounded independently from semantic similarity score',()=>{
  const snapshot=graph();
  const q=query();
  const retrieval=retrieveRsiExperienceGraph({snapshot,query:q});
  const state=createRsiBoundedMemoryUtilityState({experience_graph_snapshot:snapshot,query:q,retrieval});
  assert.equal(state.mode,'EVIDENCE_SPARSE');
  assert.equal(state.recommended_case_cap,6);
  assert.equal(state.total_utility_evidence_count,0);
  assert.equal(state.coordinates.UTILITY_SPARSE_CASES,retrieval.item_count);
});

test('state is digest-bound to exact retrieval and cannot be turned into authority',()=>{
  const snapshot=graph();
  const q=query();
  const retrieval=retrieveRsiExperienceGraph({snapshot,query:q});
  const state=createRsiBoundedMemoryUtilityState({experience_graph_snapshot:snapshot,query:q,retrieval});
  assert.throws(()=>verifyRsiBoundedMemoryUtilityState({...state,candidate_can_set_case_cap:true}),/policy_invalid/);
  assert.throws(()=>verifyRsiBoundedMemoryUtilityState({...state,recommended_case_cap:12}),/case_cap_invalid|digest_mismatch/);
  assert.throws(()=>verifyRsiBoundedMemoryUtilityState({...state,execution_authority:true}),/execution_authority_invalid/);
});

test('bounded utility trust root fixes anti-contamination and authority boundaries',()=>{
  const root=rsiBoundedMemoryUtilityTrustRootSnapshot();
  assert.equal(root.fixed_dimensional_state,true);
  assert.equal(root.per_trajectory_utility_state,false);
  assert.equal(root.trajectory_joint_reward_assignment,false);
  assert.equal(root.co_retrieved_memory_credit_update,false);
  assert.equal(root.utility_receipts_are_case_local,true);
  assert.equal(root.cross_context_utility_discount_weight,0.25);
  assert.equal(root.harmful_dominant_case_cap,4);
  assert.equal(root.evidence_sparse_case_cap,6);
  assert.equal(root.candidate_can_set_utility,false);
  assert.equal(root.candidate_can_set_case_cap,false);
  assert.equal(root.scalar_reward_allowed,false);
  assert.equal(root.execution_authority,false);
  assert.equal(root.promotion_authority,false);
});
