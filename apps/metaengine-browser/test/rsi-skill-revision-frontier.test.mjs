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
import { createRsiSkillLibraryGovernance } from '../src/rsi-skill-library-governance.mjs';
import {
  createRsiSkillCurationRequest,
  createRsiSkillRevisionEvaluation,
} from '../src/rsi-runtime-skill-curation.mjs';
import {
  RsiSkillRevisionFrontier,
  createRsiSkillRevisionFrontierCandidate,
  verifyRsiSkillRevisionFrontierCandidate,
  rsiSkillRevisionFrontierTrustRootSnapshot,
} from '../src/rsi-skill-revision-frontier.mjs';

const SOURCE='a'.repeat(40);
const d=(char)=>`sha256:${char.repeat(64)}`;

function skill({version=1,parent=null,source='b',impl='c'}={}){
  return createRsiSkillCapsule({
    skill_id:'skill.frontier.parent',version,parent_skill_digest:parent,
    source_candidate_sha:source.repeat(40),role:'ANALYZER',
    input_schema_digest:d('1'),output_schema_digest:d('2'),implementation_digest:d(impl),
    components:[{component_id:`skill.frontier.component.v${version}.${impl}`,artifact_digest:d('f'),kind:'TYPED_TRANSFORM'}],
    capabilities:['READ_VERIFIED_CONTEXT','ANALYZE_FAILURE_CODES'],
    max_context_tokens:2048,max_output_tokens:512,max_invocations:2,
    external_builder:true,authored_by_candidate:false,
  });
}

function fixture(){
  const parent=skill();
  const evidence=createRsiSkillEvidence({
    capsule:parent,hidden_holdout_digest:d('3'),evaluator_root_digest:d('4'),
    unit_test_digest:d('5'),runtime_feedback_digest:d('6'),attempt_count:12,success_count:10,
    hard_invariants_pass:true,verified_for_library:true,evidence_refs:['VERIFY_skill.frontier.parent'],
    external_evaluator:true,authored_by_candidate:false,
  });
  const library=createRsiVerifiedSkillLibrary({
    library_id:'runtime.skill.frontier.library',
    entries:[{capsule:parent,evidence}],
    external_library_owner:true,authored_by_candidate:false,
  });
  const governance=createRsiSkillLibraryGovernance({
    governance_id:'runtime.skill.frontier.governance',library,lifecycle_evidence:[],
    max_active_skills:1,exploration_slots:1,external_library_owner:true,authored_by_candidate:false,
  });
  return {parent,library,governance};
}

function accepted({parent,library,governance,id,impl,budget,baseVal,candVal,baseMeta,candMeta}){
  const request=createRsiSkillCurationRequest({
    source_sha:SOURCE,request_id:`curation.frontier.${id}`,library,governance,parent_skill_digest:parent.skill_digest,
    reason:'RELIABILITY_GAP',trigger_evidence_digests:[d('7'),d('8')],
    training_context_digest:d('9'),validation_holdout_digest:d('a'),meta_holdout_digest:d('b'),
    optimizer_model_family:'GPT_5_6_SOL',allowed_edit_ops:['ADD','DELETE','REPLACE'],edit_budget:budget,
    external_curator:true,authored_by_candidate:false,
  });
  const successor=skill({version:2,parent:parent.skill_digest,source:'c',impl});
  const evaluation=createRsiSkillRevisionEvaluation({
    evaluation_id:`evaluation.frontier.${id}`,request,library,governance,successor_skill:successor,
    baseline_validation_score:baseVal,candidate_validation_score:candVal,
    baseline_meta_score:baseMeta,candidate_meta_score:candMeta,
    hard_invariants_pass:true,evaluator_digest:d('c'),evaluation_digest:d('d'),
    evidence_refs:[`eval:frontier:${id}`],external_evaluator:true,authored_by_candidate:false,
  });
  const candidate=createRsiSkillRevisionFrontierCandidate({
    source_sha:SOURCE,request,evaluation,library,governance,
    external_frontier_owner:true,authored_by_candidate:false,
  });
  return {request,evaluation,candidate};
}

test('frontier candidate is exact-bound to accepted heldout evaluation and has no direct adoption authority',()=>{
  const {parent,library,governance}=fixture();
  const row=accepted({parent,library,governance,id:'a',impl:'d',budget:4,baseVal:0.5,candVal:0.6,baseMeta:0.5,candMeta:0.55});
  verifyRsiSkillRevisionFrontierCandidate(row.candidate,{request:row.request,evaluation:row.evaluation,library,governance});
  assert.equal(row.candidate.validation_delta,0.1);
  assert.equal(row.candidate.meta_delta,0.05);
  assert.equal(row.candidate.edit_budget,4);
  assert.equal(row.candidate.archive_retained,true);
  assert.equal(row.candidate.direct_library_replacement_allowed,false);
  assert.equal(row.candidate.frontier_is_execution_authority,false);
  assert.equal(row.candidate.authority_effect,false);
});

test('rejected heldout revision cannot enter Pareto archive',()=>{
  const {parent,library,governance}=fixture();
  const request=createRsiSkillCurationRequest({
    source_sha:SOURCE,request_id:'curation.frontier.rejected',library,governance,parent_skill_digest:parent.skill_digest,
    reason:'RELIABILITY_GAP',trigger_evidence_digests:[d('7'),d('8')],
    training_context_digest:d('9'),validation_holdout_digest:d('a'),meta_holdout_digest:d('b'),
    optimizer_model_family:'GPT_5_6_SOL',edit_budget:4,external_curator:true,authored_by_candidate:false,
  });
  const successor=skill({version:2,parent:parent.skill_digest,source:'c',impl:'e'});
  const evaluation=createRsiSkillRevisionEvaluation({
    evaluation_id:'evaluation.frontier.rejected',request,library,governance,successor_skill:successor,
    baseline_validation_score:0.6,candidate_validation_score:0.59,
    baseline_meta_score:0.5,candidate_meta_score:0.5,hard_invariants_pass:true,
    evaluator_digest:d('c'),evaluation_digest:d('d'),evidence_refs:['eval:frontier:rejected'],
    external_evaluator:true,authored_by_candidate:false,
  });
  assert.equal(evaluation.state,'REJECTED_HELDOUT_REVISION');
  assert.throws(()=>createRsiSkillRevisionFrontierCandidate({
    source_sha:SOURCE,request,evaluation,library,governance,
    external_frontier_owner:true,authored_by_candidate:false,
  }),/only_accepted_revision_allowed/);
});

test('Pareto frontier retains tradeoffs, removes dominated member from frontier view, and keeps full archive',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-rsi-frontier-'));
  const statePath=path.join(root,'frontier.json');
  try{
    const {parent,library,governance}=fixture();
    const a=accepted({parent,library,governance,id:'a',impl:'d',budget:4,baseVal:0.5,candVal:0.6,baseMeta:0.5,candMeta:0.55});
    const b=accepted({parent,library,governance,id:'b',impl:'e',budget:3,baseVal:0.5,candVal:0.62,baseMeta:0.5,candMeta:0.56});
    const c=accepted({parent,library,governance,id:'c',impl:'f',budget:2,baseVal:0.5,candVal:0.65,baseMeta:0.5,candMeta:0.52});

    const frontier=new RsiSkillRevisionFrontier({statePath,source_sha:SOURCE});
    await frontier.init();
    await frontier.add({candidate:a.candidate});
    await frontier.add({candidate:b.candidate});
    await frontier.add({candidate:c.candidate});
    assert.equal(frontier.snapshot().archive_count,3);
    assert.equal(frontier.snapshot().frontier_count,2);

    const rows=frontier.frontier({parent_skill_digest:parent.skill_digest,max_candidates:8});
    assert.deepEqual(rows.map(x=>x.request_id).sort(),['curation.frontier.b','curation.frontier.c']);
    assert.ok(!rows.some(x=>x.request_id==='curation.frontier.a'));
    assert.ok(frontier.snapshot().frontier_candidate_digests.every(x=>/^sha256:[0-9a-f]{64}$/.test(x)));

    const restored=new RsiSkillRevisionFrontier({statePath,source_sha:SOURCE});
    await restored.init();
    assert.equal(restored.snapshot().archive_count,3);
    assert.equal(restored.snapshot().frontier_count,2);
    assert.deepEqual(restored.frontier({parent_skill_digest:parent.skill_digest}).map(x=>x.request_id).sort(),['curation.frontier.b','curation.frontier.c']);
  }finally{await fs.rm(root,{recursive:true,force:true})}
});

test('same frontier candidate is idempotent and conflicting successor evaluation is fenced',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-rsi-frontier-conflict-'));
  try{
    const {parent,library,governance}=fixture();
    const a=accepted({parent,library,governance,id:'a',impl:'d',budget:4,baseVal:0.5,candVal:0.6,baseMeta:0.5,candMeta:0.55});
    const frontier=new RsiSkillRevisionFrontier({statePath:path.join(root,'frontier.json'),source_sha:SOURCE});
    await frontier.init();
    const first=await frontier.add({candidate:a.candidate});
    const again=await frontier.add({candidate:a.candidate});
    assert.equal(first.state,'ARCHIVED');
    assert.equal(again.state,'IDEMPOTENT');
    assert.equal(frontier.snapshot().archive_count,1);

    const tampered={...a.candidate,evaluation_result_digest:d('e'),frontier_candidate_digest:d('f')};
    await assert.rejects(()=>frontier.add({candidate:tampered}),/successor_evaluation_conflict/);
    assert.equal(frontier.snapshot().archive_count,1);
  }finally{await fs.rm(root,{recursive:true,force:true})}
});

test('frontier trust root preserves diverse archive without greedy replacement or authority expansion',()=>{
  const root=rsiSkillRevisionFrontierTrustRootSnapshot();
  assert.equal(root.accepted_heldout_revisions_only,true);
  assert.equal(root.pareto_frontier_required,true);
  assert.equal(root.archive_is_append_only,true);
  assert.equal(root.dominated_candidates_retained,true);
  assert.equal(root.diverse_lineages_preserved,true);
  assert.equal(root.greedy_single_winner_replacement_forbidden,true);
  assert.equal(root.existing_reliability_gate_required,true);
  assert.equal(root.direct_library_replacement_allowed,false);
  assert.equal(root.candidate_can_select_frontier,false);
  assert.equal(root.frontier_is_execution_authority,false);
  assert.equal(root.execution_authority,false);
  assert.equal(root.authority_effect,false);
  assert.match(root.frontier_root_digest,/^sha256:[0-9a-f]{64}$/);
});
