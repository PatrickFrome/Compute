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
  createRsiMemoryReliabilityProjection,
  verifyRsiMemoryReliabilityProjection,
  rsiMemoryReliabilityTrustRootSnapshot,
} from '../src/rsi-memory-reliability-tier.mjs';

const d=(c)=>`sha256:${c.repeat(64)}`;
const cid=(c)=>`candidate_sha256_${c.repeat(64)}`;

function caseRow(id,{outcome='SUCCESS',attempt=id}={}){
  const ch=String(id);
  return createRsiExperienceCase({
    case_id:`case.reliability.${id}`,
    task_id:'task.reliability',
    task_signature_digest:d('1'),
    attempt_index:attempt,
    candidate_id:cid(ch),
    candidate_sha:ch.repeat(40),
    outcome,
    environment_fingerprint:'WINDOWS_BROWSER',
    model_family:'METAENGINE_RSI',
    execution_signature_digest:d(ch),
    failure_codes:outcome==='FAILURE'?['POST_DEPLOYMENT_REGRESSION']:[],
    mechanism_tags:['BROWSER_RUNTIME'],
    lesson_digests:[],
    attribution_digests:[],
    transfer_receipt_digests:[],
    evidence_digest:d(ch),
    evidence_refs:[`evidence:reliability:${id}`],
    external_writer:true,
    authored_by_candidate:false,
  });
}

function utility(id,caseId,outcome,target=d('f')){
  return createRsiExperienceUtilityReceipt({
    receipt_id:`utility.reliability.${id}`,
    case_id:caseId,
    target_context_digest:target,
    outcome,
    evidence_digest:d(String((id%9)+1)),
    evidence_refs:[`external:reliability:${id}`],
    external_evaluator:true,
    authored_by_candidate:false,
  });
}

function graph(){
  const rows=[
    caseRow(1),
    caseRow(2),
    caseRow(3),
    caseRow(4,{outcome:'FAILURE'}),
    caseRow(5),
  ];
  const receipts=[
    utility(1,'case.reliability.1','HELPFUL'),
    utility(2,'case.reliability.1','HELPFUL'),
    utility(3,'case.reliability.2','HARMFUL'),
    utility(4,'case.reliability.2','HARMFUL'),
    utility(5,'case.reliability.3','HELPFUL'),
    utility(6,'case.reliability.3','HARMFUL'),
  ];
  return createRsiExperienceGraphSnapshot({
    graph_id:'rsi.reliability.graph',
    epoch:1,
    predecessor_snapshot_digest:null,
    task_anchors:[{
      task_id:'task.reliability',
      task_signature_digest:d('1'),
      challenge_family:'BROWSER_RUNTIME',
      hidden_manifest_digest:d('9'),
      external_writer:true,
      authored_by_candidate:false,
    }],
    cases:rows,
    similarity_edges:[],
    correction_edges:[{
      from_case_id:'case.reliability.4',
      to_case_id:'case.reliability.5',
      evidence_digest:d('8'),
      external_verifier:true,
      authored_by_candidate:false,
    }],
    utility_receipts:receipts,
  });
}

function query(){
  return createRsiExperienceGraphQuery({
    query_id:'query.reliability',
    target_context_digest:d('f'),
    task_signature_digest:d('1'),
    challenge_family:'BROWSER_RUNTIME',
    environment_fingerprint:'WINDOWS_BROWSER',
    model_family:'METAENGINE_RSI',
    failure_codes:['POST_DEPLOYMENT_REGRESSION'],
    mechanism_tags:['BROWSER_RUNTIME'],
    bridge_case_ids:['case.reliability.4'],
    external_query_context:true,
    authored_by_candidate:false,
  });
}

function fixture(){
  const snapshot=graph();
  const q=query();
  const retrieval=retrieveRsiExperienceGraph({snapshot,query:q});
  const projection=createRsiMemoryReliabilityProjection({
    experience_graph_snapshot:snapshot,
    query:q,
    retrieval,
  });
  return {snapshot,q,retrieval,projection};
}

test('reliability tiers derive HOT WARM COLD and QUARANTINED without deleting memory',()=>{
  const {snapshot,q,retrieval,projection}=fixture();
  verifyRsiMemoryReliabilityProjection(projection,{
    experience_graph_snapshot:snapshot,
    query:q,
    retrieval,
  });
  const byId=new Map(projection.rows.map(row=>[row.case_id,row]));
  assert.equal(byId.get('case.reliability.1').tier,'HOT');
  assert.equal(byId.get('case.reliability.1').tier_reason,'REPEATED_HELPFUL_EVIDENCE');

  assert.equal(byId.get('case.reliability.2').tier,'QUARANTINED');
  assert.equal(byId.get('case.reliability.2').tier_reason,'HARMFUL_HISTORY_REQUIRES_REHABILITATION_MARGIN');
  assert.equal(byId.get('case.reliability.2').candidate_guidance_allowed,false);
  assert.equal(byId.get('case.reliability.2').remains_queryable,true);
  assert.equal(byId.get('case.reliability.2').history_deleted,false);

  assert.equal(byId.get('case.reliability.3').tier,'COLD');
  assert.equal(byId.get('case.reliability.3').tier_reason,'UTILITY_CONFLICT');
  assert.equal(byId.get('case.reliability.3').utility_conflicted,true);

  assert.equal(byId.get('case.reliability.4').tier,'COLD');
  assert.equal(byId.get('case.reliability.5').tier,'WARM');
  assert.equal(byId.get('case.reliability.5').tier_reason,'VERIFIED_CORRECTION_TARGET');

  assert.deepEqual(projection.quarantined_case_ids,['case.reliability.2']);
  assert.ok(!projection.candidate_guidance_case_ids.includes('case.reliability.2'));
  assert.equal(projection.quarantine_deletes_history,false);
  assert.equal(projection.quarantined_memory_remains_queryable,true);
});

test('quarantine requires repeated harmful evidence and does not overreact to one bad receipt',()=>{
  const snapshot=graph();
  const q=query();
  const oneHarmfulSnapshot=createRsiExperienceGraphSnapshot({
    graph_id:'rsi.reliability.single-harm',
    epoch:1,
    predecessor_snapshot_digest:null,
    task_anchors:snapshot.task_anchors,
    cases:snapshot.cases,
    similarity_edges:[],
    correction_edges:snapshot.correction_edges,
    utility_receipts:[
      utility(7,'case.reliability.2','HARMFUL'),
    ],
  });
  const retrieval=retrieveRsiExperienceGraph({snapshot:oneHarmfulSnapshot,query:q});
  const projection=createRsiMemoryReliabilityProjection({
    experience_graph_snapshot:oneHarmfulSnapshot,
    query:q,
    retrieval,
  });
  const row=projection.rows.find(item=>item.case_id==='case.reliability.2');
  assert.notEqual(row.tier,'QUARANTINED');
  assert.equal(row.remains_queryable,true);
});

test('cross-context harmful evidence is discounted and needs strong repeated evidence to quarantine',()=>{
  const base=graph();
  const q=query();
  const cross=[];
  for(let i=0;i<8;i+=1){
    cross.push(utility(20+i,'case.reliability.2','HARMFUL',d('e')));
  }
  const snapshot=createRsiExperienceGraphSnapshot({
    graph_id:'rsi.reliability.cross-harm',
    epoch:1,
    predecessor_snapshot_digest:null,
    task_anchors:base.task_anchors,
    cases:base.cases,
    similarity_edges:[],
    correction_edges:base.correction_edges,
    utility_receipts:cross,
  });
  const retrieval=retrieveRsiExperienceGraph({snapshot,query:q});
  const projection=createRsiMemoryReliabilityProjection({experience_graph_snapshot:snapshot,query:q,retrieval});
  const row=projection.rows.find(item=>item.case_id==='case.reliability.2');
  assert.equal(row.utility.cross_context_harmful,8);
  assert.equal(row.utility.weighted_harmful,2);
  assert.equal(row.tier,'QUARANTINED');
});

test('intrinsic verifier recomputes posterior tier and quarantine sets',()=>{
  const {projection}=fixture();
  assert.throws(()=>verifyRsiMemoryReliabilityProjection({
    ...projection,
    rows:projection.rows.map((row,index)=>index===0?{
      ...row,
      utility:{...row.utility,posterior_helpful:0.1},
    }:row),
  }),/posterior_mismatch|projection_digest_mismatch/);
  assert.throws(()=>verifyRsiMemoryReliabilityProjection({
    ...projection,
    quarantined_case_ids:[],
  }),/projection_set_mismatch|projection_digest_mismatch/);
  assert.throws(()=>verifyRsiMemoryReliabilityProjection({
    ...projection,
    candidate_can_delete_memory:true,
  }),/policy_invalid/);
});

test('reliability projection remains advisory and fully recomputable from exact graph query retrieval',()=>{
  const {snapshot,q,retrieval,projection}=fixture();
  verifyRsiMemoryReliabilityProjection(projection,{
    experience_graph_snapshot:snapshot,
    query:q,
    retrieval,
  });
  assert.equal(projection.reliability_is_contextual_not_global_truth,true);
  assert.equal(projection.quarantine_is_retrieval_filter_not_authority,true);
  assert.equal(projection.rehabilitation_requires_new_external_utility,true);
  assert.equal(projection.candidate_can_set_tier,false);
  assert.equal(projection.candidate_can_set_thresholds,false);
  assert.equal(projection.execution_authority,false);
  assert.equal(projection.promotion_authority,false);
});

test('memory reliability trust root fixes thresholds and preserves immutable history',()=>{
  const root=rsiMemoryReliabilityTrustRootSnapshot();
  assert.deepEqual(root.tiers,['HOT','WARM','COLD','QUARANTINED']);
  assert.equal(root.policy.quarantine_exact_harmful_min,2);
  assert.equal(root.policy.cross_context_weight,0.25);
  assert.equal(root.conflicted_utility_never_hot,true);
  assert.equal(root.repeated_harmful_evidence_can_quarantine,true);
  assert.equal(root.quarantine_exit_requires_exact_helpful_evidence,true);
  assert.equal(root.rehabilitation_exact_helpful_min,2);
  assert.equal(root.rehabilitation_helpful_margin,1);
  assert.equal(root.balancing_conflicting_feedback_is_not_rehabilitation,true);
  assert.equal(root.cross_context_helpful_evidence_alone_cannot_rehabilitate,true);
  assert.equal(root.rehabilitated_memory_returns_cold_not_hot,true);
  assert.equal(root.quarantined_memory_remains_queryable,true);
  assert.equal(root.quarantine_deletes_history,false);
  assert.equal(root.quarantine_is_retrieval_filter_not_authority,true);
  assert.equal(root.rehabilitation_requires_new_external_utility,true);
  assert.equal(root.candidate_can_set_tier,false);
  assert.equal(root.candidate_can_set_thresholds,false);
  assert.equal(root.candidate_can_delete_memory,false);
  assert.equal(root.execution_authority,false);
});


test('balancing helpful feedback does not silently rehabilitate a previously harmful memory',()=>{
  const base=graph();
  const q=query();
  const balanced=createRsiExperienceGraphSnapshot({
    graph_id:'rsi.reliability.balanced-harm',
    epoch:1,
    predecessor_snapshot_digest:null,
    task_anchors:base.task_anchors,
    cases:base.cases,
    similarity_edges:[],
    correction_edges:base.correction_edges,
    utility_receipts:[
      ...base.utility_receipts,
      utility(40,'case.reliability.2','HELPFUL'),
      utility(41,'case.reliability.2','HELPFUL'),
    ],
  });
  const retrieval=retrieveRsiExperienceGraph({snapshot:balanced,query:q});
  const projection=createRsiMemoryReliabilityProjection({experience_graph_snapshot:balanced,query:q,retrieval});
  const row=projection.rows.find(item=>item.case_id==='case.reliability.2');
  assert.equal(row.utility.exact_harmful,2);
  assert.equal(row.utility.exact_helpful,2);
  assert.equal(row.tier,'QUARANTINED');
  assert.equal(row.severe_harm_history,true);
  assert.equal(row.rehabilitation_evidence_satisfied,false);
  assert.equal(row.candidate_guidance_allowed,false);
});

test('rehabilitation requires multiple exact helpful receipts and a strict positive evidence margin',()=>{
  const base=graph();
  const q=query();
  const rehabilitated=createRsiExperienceGraphSnapshot({
    graph_id:'rsi.reliability.rehabilitated-harm',
    epoch:1,
    predecessor_snapshot_digest:null,
    task_anchors:base.task_anchors,
    cases:base.cases,
    similarity_edges:[],
    correction_edges:base.correction_edges,
    utility_receipts:[
      ...base.utility_receipts,
      utility(50,'case.reliability.2','HELPFUL'),
      utility(51,'case.reliability.2','HELPFUL'),
      utility(52,'case.reliability.2','HELPFUL'),
    ],
  });
  const retrieval=retrieveRsiExperienceGraph({snapshot:rehabilitated,query:q});
  const projection=createRsiMemoryReliabilityProjection({experience_graph_snapshot:rehabilitated,query:q,retrieval});
  const row=projection.rows.find(item=>item.case_id==='case.reliability.2');
  assert.equal(row.utility.exact_harmful,2);
  assert.equal(row.utility.exact_helpful,3);
  assert.equal(row.tier,'COLD');
  assert.equal(row.tier_reason,'EXTERNALLY_REHABILITATED_HARMFUL_HISTORY');
  assert.equal(row.severe_harm_history,true);
  assert.equal(row.rehabilitation_evidence_satisfied,true);
  assert.equal(row.candidate_guidance_allowed,true);
  assert.equal(row.remains_queryable,true);
});

test('cross-context helpful evidence alone cannot rehabilitate severe harmful history',()=>{
  const base=graph();
  const q=query();
  const receipts=[...base.utility_receipts];
  for(let i=0;i<16;i+=1){
    receipts.push(utility(60+i,'case.reliability.2','HELPFUL',d('e')));
  }
  const snapshot=createRsiExperienceGraphSnapshot({
    graph_id:'rsi.reliability.cross-help-rehab',
    epoch:1,
    predecessor_snapshot_digest:null,
    task_anchors:base.task_anchors,
    cases:base.cases,
    similarity_edges:[],
    correction_edges:base.correction_edges,
    utility_receipts:receipts,
  });
  const retrieval=retrieveRsiExperienceGraph({snapshot,query:q});
  const projection=createRsiMemoryReliabilityProjection({experience_graph_snapshot:snapshot,query:q,retrieval});
  const row=projection.rows.find(item=>item.case_id==='case.reliability.2');
  assert.ok(row.utility.weighted_helpful>row.utility.weighted_harmful);
  assert.equal(row.utility.exact_helpful,0);
  assert.equal(row.tier,'QUARANTINED');
  assert.equal(row.rehabilitation_evidence_satisfied,false);
});
