import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createRsiSkillCapsule,
  createRsiSkillEvidence,
  createRsiVerifiedSkillLibrary,
} from '../src/rsi-verified-skill-library.mjs';
import {
  RsiSkillRelationStore,
  createRsiSkillRelationEdge,
  createRsiSkillRelationGraph,
  verifyRsiSkillRelationGraph,
  rsiSkillRelationGraphTrustRootSnapshot,
} from '../src/rsi-skill-relation-graph.mjs';

const SOURCE='a'.repeat(40);
const d=(char)=>`sha256:${char.repeat(64)}`;

function skill(id,source,impl){
  const capsule=createRsiSkillCapsule({
    skill_id:id,version:1,parent_skill_digest:null,source_candidate_sha:source.repeat(40),
    role:'ANALYZER',input_schema_digest:d('1'),output_schema_digest:d('2'),implementation_digest:d(impl),
    components:[{component_id:`${id}.component`,artifact_digest:d('f'),kind:'TYPED_TRANSFORM'}],
    capabilities:['READ_VERIFIED_CONTEXT','ANALYZE_FAILURE_CODES'],
    max_context_tokens:2048,max_output_tokens:512,max_invocations:2,
    external_builder:true,authored_by_candidate:false,
  });
  const evidence=createRsiSkillEvidence({
    capsule,hidden_holdout_digest:d(source),evaluator_root_digest:d('4'),unit_test_digest:d('5'),
    runtime_feedback_digest:d('6'),attempt_count:12,success_count:10,hard_invariants_pass:true,
    verified_for_library:true,evidence_refs:[`VERIFY_${id}`],external_evaluator:true,authored_by_candidate:false,
  });
  return {capsule,evidence};
}
function fixture(){
  const a=skill('skill.relation.a','b','b');
  const b=skill('skill.relation.b','c','c');
  const c=skill('skill.relation.c','d','d');
  const library=createRsiVerifiedSkillLibrary({
    library_id:'runtime.skill.relation.library',
    entries:[a,b,c],
    external_library_owner:true,authored_by_candidate:false,
  });
  return {a,b,c,library};
}

test('typed relation graph binds externally verified edges to exact library members',()=>{
  const {a,b,library}=fixture();
  const edge=createRsiSkillRelationEdge({
    relation_id:'relation.a.prerequisite.b',library,
    from_skill_digest:a.capsule.skill_digest,to_skill_digest:b.capsule.skill_digest,
    relation_type:'PREREQUISITE',scope:'GLOBAL_VERIFIED',
    evidence_digest:d('7'),evidence_refs:['relation:prerequisite:a-b'],
    external_evaluator:true,authored_by_candidate:false,
  });
  const graph=createRsiSkillRelationGraph({
    graph_id:'graph.runtime.skill.relation.library',library,edges:[edge],
    external_graph_owner:true,authored_by_candidate:false,
  });
  verifyRsiSkillRelationGraph(graph,library);
  assert.equal(graph.edge_count,1);
  assert.equal(graph.edges[0].relation_type,'PREREQUISITE');
  assert.equal(graph.graph_is_execution_authority,false);
  assert.equal(graph.authority_effect,false);
});

test('context-bound relations carry exact context and candidate-authored edges fail closed',()=>{
  const {a,b,library}=fixture();
  const ctx=d('8');
  const edge=createRsiSkillRelationEdge({
    relation_id:'relation.a.antagonistic.b.context',library,
    from_skill_digest:a.capsule.skill_digest,to_skill_digest:b.capsule.skill_digest,
    relation_type:'ANTAGONISTIC',scope:'CONTEXT_BOUND',context_digest:ctx,
    evidence_digest:d('9'),evidence_refs:['relation:antagonistic:a-b'],
    external_evaluator:true,authored_by_candidate:false,
  });
  assert.equal(edge.context_digest,ctx);
  assert.throws(()=>createRsiSkillRelationEdge({
    relation_id:'relation.bad',library,
    from_skill_digest:a.capsule.skill_digest,to_skill_digest:b.capsule.skill_digest,
    relation_type:'ENHANCES',scope:'GLOBAL_VERIFIED',
    evidence_digest:d('a'),evidence_refs:['relation:bad'],
    external_evaluator:false,authored_by_candidate:true,
  }),/external_evaluator_required/);
  assert.throws(()=>createRsiSkillRelationEdge({
    relation_id:'relation.global.context',library,
    from_skill_digest:a.capsule.skill_digest,to_skill_digest:b.capsule.skill_digest,
    relation_type:'ENHANCES',scope:'GLOBAL_VERIFIED',context_digest:ctx,
    evidence_digest:d('a'),evidence_refs:['relation:global-context'],
    external_evaluator:true,authored_by_candidate:false,
  }),/global_context_forbidden/);
});

test('relation graph rejects skills outside exact verified library',()=>{
  const {a,library}=fixture();
  assert.throws(()=>createRsiSkillRelationEdge({
    relation_id:'relation.unknown',library,
    from_skill_digest:a.capsule.skill_digest,to_skill_digest:d('e'),
    relation_type:'CO_OCCURS',scope:'GLOBAL_VERIFIED',
    evidence_digest:d('9'),evidence_refs:['relation:unknown'],
    external_evaluator:true,authored_by_candidate:false,
  }),/to_skill_not_in_library/);
});

test('relation store is append-only durable and semantic conflicts fail closed',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-rsi-relations-'));
  try{
    const {a,b,library}=fixture();
    const statePath=path.join(root,'relations.json');
    const store=new RsiSkillRelationStore({statePath,source_sha:SOURCE});
    await store.init();
    const edge=createRsiSkillRelationEdge({
      relation_id:'relation.persist.a-b',library,
      from_skill_digest:a.capsule.skill_digest,to_skill_digest:b.capsule.skill_digest,
      relation_type:'PREREQUISITE',scope:'GLOBAL_VERIFIED',
      evidence_digest:d('7'),evidence_refs:['relation:persist:a-b'],
      external_evaluator:true,authored_by_candidate:false,
    });
    assert.equal((await store.add(edge,library)).state,'APPENDED');
    assert.equal((await store.add(edge,library)).state,'IDEMPOTENT');
    assert.equal(store.snapshot().edge_count,1);
    assert.equal(store.graph(library).edge_count,1);

    const conflicting=createRsiSkillRelationEdge({
      relation_id:'relation.persist.a-b.other-evidence',library,
      from_skill_digest:a.capsule.skill_digest,to_skill_digest:b.capsule.skill_digest,
      relation_type:'PREREQUISITE',scope:'GLOBAL_VERIFIED',
      evidence_digest:d('8'),evidence_refs:['relation:persist:conflict'],
      external_evaluator:true,authored_by_candidate:false,
    });
    await assert.rejects(()=>store.add(conflicting,library),/semantic_conflict/);

    const restored=new RsiSkillRelationStore({statePath,source_sha:SOURCE});
    await restored.init();
    assert.equal(restored.snapshot().edge_count,1);
    assert.equal(restored.graph(library).graph_digest,store.graph(library).graph_digest);
  }finally{await fs.rm(root,{recursive:true,force:true})}
});

test('relation trust root permits only evidence-bound constraints, never authority grants',()=>{
  const root=rsiSkillRelationGraphTrustRootSnapshot();
  assert.equal(root.exact_verified_library_membership_required,true);
  assert.equal(root.external_evidence_required,true);
  assert.equal(root.context_bound_edges_require_exact_context,true);
  assert.equal(root.append_only_relation_evidence,true);
  assert.equal(root.candidate_can_author_edges,false);
  assert.equal(root.candidate_can_delete_edges,false);
  assert.equal(root.relation_graph_can_only_constrain_or_order_selection,true);
  assert.equal(root.relation_graph_cannot_grant_skill_activity,true);
  assert.equal(root.graph_is_execution_authority,false);
  assert.equal(root.authority_effect,false);
  assert.match(root.relation_root_digest,/^sha256:[0-9a-f]{64}$/);
});
