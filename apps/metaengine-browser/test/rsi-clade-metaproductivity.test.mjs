import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRsiCladeNode,
  verifyRsiCladeNode,
  createRsiCladeArchive,
  verifyRsiCladeArchive,
  createRsiCladeMetaproductivitySnapshot,
  verifyRsiCladeMetaproductivitySnapshot,
  createRsiCladeExpansionPlan,
  verifyRsiCladeExpansionPlan,
  rsiCladeMetaproductivityTrustRootSnapshot,
} from '../src/rsi-clade-metaproductivity.mjs';

const sha=(c)=>c.repeat(40);
const d=(c)=>`sha256:${c.repeat(64)}`;
const cid=(c)=>`candidate_sha256_${c.repeat(64)}`;

function node(char,{parent=null,solved,total=100,expansions=0}={}){
  return createRsiCladeNode({
    node_id:`node.${char}`,
    candidate_id:cid(char),
    candidate_sha:sha(char),
    parent_candidate_id:parent,
    benchmark_solved:solved,
    benchmark_total:total,
    evaluation_digest:d(char),
    expansion_count:expansions,
    external_evaluator:true,
    authored_by_candidate:false,
  });
}

function archive(){
  return createRsiCladeArchive({
    archive_id:'clade.archive.fixture',
    nodes:[
      node('1',{solved:95,total:100,expansions:3}),
      node('2',{parent:cid('1'),solved:10,total:100}),
      node('3',{solved:55,total:100,expansions:1}),
      node('4',{parent:cid('3'),solved:90,total:100}),
      node('5',{parent:cid('3'),solved:92,total:100}),
      node('6',{parent:cid('4'),solved:94,total:100}),
    ],
  });
}

test('clade node uses external benchmark evidence and direct score is not expansion authority',()=>{
  const row=node('1',{solved:90,total:100});
  verifyRsiCladeNode(row);
  assert.equal(row.benchmark_score,0.9);
  assert.equal(row.external_evaluator,true);
  assert.equal(row.authored_by_candidate,false);
  assert.equal(row.direct_score_is_expansion_authority,false);
  assert.equal(row.candidate_can_edit_clade_statistics,false);
  assert.equal(row.authority_effect,false);
  assert.throws(()=>createRsiCladeNode({
    node_id:'node.bad',candidate_id:cid('7'),candidate_sha:sha('7'),benchmark_solved:1,benchmark_total:1,
    evaluation_digest:d('7'),external_evaluator:false,authored_by_candidate:true,
  }),/external_origin_required/);
});

test('archive rejects missing parents and cycles',()=>{
  const good=archive();
  verifyRsiCladeArchive(good);
  assert.equal(good.direct_score_is_not_metaproductivity,true);
  assert.equal(good.clade_statistics_external_only,true);
  assert.equal(good.candidate_can_edit_archive,false);

  assert.throws(()=>createRsiCladeArchive({
    archive_id:'bad.parent',
    nodes:[node('7',{parent:cid('8'),solved:1,total:2})],
  }),/parent_missing/);

  const a=node('a',{parent:cid('b'),solved:1,total:2});
  const b=node('b',{parent:cid('a'),solved:1,total:2});
  assert.throws(()=>createRsiCladeArchive({archive_id:'bad.cycle',nodes:[a,b]}),/cycle_forbidden/);
});

test('HGM-inspired proxy exposes metaproductivity-performance mismatch instead of equating direct score with future potential',()=>{
  const a=archive();
  const snapshot=createRsiCladeMetaproductivitySnapshot({archive:a});
  verifyRsiCladeMetaproductivitySnapshot(snapshot,a);
  const highDirectLowClade=snapshot.rows.find((row)=>row.candidate_id===cid('1'));
  const lowDirectHighClade=snapshot.rows.find((row)=>row.candidate_id===cid('3'));
  assert.equal(highDirectLowClade.direct_benchmark_score,0.95);
  assert.equal(lowDirectHighClade.direct_benchmark_score,0.55);
  assert.ok(highDirectLowClade.cmp_proxy_mean < 0.2);
  assert.ok(lowDirectHighClade.cmp_proxy_mean > 0.9);
  assert.ok(lowDirectHighClade.cmp_proxy_mean > highDirectLowClade.cmp_proxy_mean);
  assert.equal(snapshot.metaproductivity_performance_mismatch_explicit,true);
  assert.equal(snapshot.direct_benchmark_score_not_primary_expansion_signal,true);
  assert.equal(snapshot.true_cmp_oracle_available,false);
  assert.equal(lowDirectHighClade.clade_metaproductivity_proxy_only,true);
});

test('leaf clades remain uncertain rather than inheriting their own direct benchmark score as metaproductivity',()=>{
  const a=archive();
  const snapshot=createRsiCladeMetaproductivitySnapshot({archive:a});
  const leaf=snapshot.rows.find((row)=>row.candidate_id===cid('2'));
  assert.equal(leaf.descendant_count,0);
  assert.equal(leaf.descendant_benchmark_total,0);
  assert.equal(leaf.cmp_proxy_posterior_alpha,1);
  assert.equal(leaf.cmp_proxy_posterior_beta,1);
  assert.equal(leaf.cmp_proxy_mean,0.5);
  assert.ok(leaf.cmp_proxy_variance>0.08);
  assert.notEqual(leaf.cmp_proxy_mean,leaf.direct_benchmark_score);
});

test('seeded Thompson clade expansion can prefer lower direct-score ancestor with stronger descendants',()=>{
  const a=archive();
  const snapshot=createRsiCladeMetaproductivitySnapshot({archive:a});
  const plan=createRsiCladeExpansionPlan({
    snapshot,archive:a,expansion_slots:1,evaluation_slots:2,round_id:'clade-round-1',
  });
  verifyRsiCladeExpansionPlan(plan,snapshot,a);
  assert.equal(plan.expansion_targets.length,1);
  const selected=plan.expansion_targets[0];
  const directChampion=snapshot.rows.find((row)=>row.candidate_id===cid('1'));
  const selectedSnapshot=snapshot.rows.find((row)=>row.candidate_id===selected.candidate_id);
  assert.notEqual(selected.candidate_id,cid('1'),'direct-score champion must not automatically win clade expansion');
  assert.ok(selected.direct_benchmark_score<directChampion.direct_benchmark_score);
  assert.ok(selectedSnapshot.descendant_count>0);
  assert.ok(selectedSnapshot.cmp_proxy_mean>directChampion.cmp_proxy_mean);
  assert.equal(plan.seeded_thompson_sampling_on_clade_proxy,true);
  assert.equal(plan.direct_score_not_primary_expansion_signal,true);
  assert.equal(plan.scheduler_action_authorized,false);
  assert.equal(plan.expansion_targets[0].scheduler_action_authorized,false);
  assert.equal(plan.authority_effect,false);
});

test('evaluation scheduling is decoupled from expansion and prioritizes uncertain clades',()=>{
  const a=archive();
  const snapshot=createRsiCladeMetaproductivitySnapshot({archive:a});
  const plan=createRsiCladeExpansionPlan({
    snapshot,archive:a,expansion_slots:2,evaluation_slots:2,round_id:'clade-round-uncertainty',
  });
  assert.equal(plan.expansion_and_evaluation_decoupled,true);
  assert.equal(plan.uncertainty_guides_additional_evaluation,true);
  assert.equal(plan.evaluation_targets.length,2);
  assert.equal(plan.evaluation_targets.every((row)=>row.scheduler_action_authorized===false),true);
  assert.equal(plan.evaluation_targets.some((row)=>row.descendant_count===0),true);
  assert.equal(plan.true_cmp_oracle_claimed,false);
});

test('exact same clade state and round deterministically replays expansion/evaluation proposals',()=>{
  const a=archive();
  const snapshot=createRsiCladeMetaproductivitySnapshot({archive:a});
  const input={snapshot,archive:a,expansion_slots:3,evaluation_slots:2,round_id:'clade-round-replay'};
  const left=createRsiCladeExpansionPlan(input);
  const right=createRsiCladeExpansionPlan(input);
  assert.equal(left.plan_digest,right.plan_digest);
  assert.deepEqual(left.expansion_targets,right.expansion_targets);
  assert.deepEqual(left.evaluation_targets,right.evaluation_targets);
});

test('clade plan never becomes scheduler, evaluator or promotion authority',()=>{
  const a=archive();
  const snapshot=createRsiCladeMetaproductivitySnapshot({archive:a});
  const plan=createRsiCladeExpansionPlan({snapshot,archive:a,expansion_slots:1,evaluation_slots:1,round_id:'clade-round-safe'});
  assert.throws(()=>verifyRsiCladeExpansionPlan({
    ...plan,
    scheduler_action_authorized:true,
  },snapshot,a),/policy_invalid|scheduler_authority_invalid/);
});

test('clade metaproductivity trust root records approximation limits and authority fences',()=>{
  const root=rsiCladeMetaproductivityTrustRootSnapshot();
  assert.equal(root.estimator,'DESCENDANT_BETA_POSTERIOR_PROXY_V1');
  assert.equal(root.hgm_inspired,true);
  assert.equal(root.true_cmp_oracle_available,false);
  assert.equal(root.metaproductivity_performance_mismatch_explicit,true);
  assert.equal(root.seeded_thompson_sampling_on_clade_proxy,true);
  assert.equal(root.expansion_and_evaluation_decoupled,true);
  assert.equal(root.direct_score_is_expansion_authority,false);
  assert.equal(root.candidate_can_edit_clade_statistics,false);
  assert.equal(root.scheduler_action_authorized,false);
  assert.equal(root.authority_effect,false);
  assert.match(root.clade_root_digest,/^sha256:[0-9a-f]{64}$/);
});
