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
  createRsiSkillLibraryGovernance,
} from '../src/rsi-skill-library-governance.mjs';
import {
  RsiRuntimeSkillCurationQueue,
  createRsiSkillCurationRequest,
  createRsiSkillRevisionEvaluation,
  verifyRsiSkillRevisionEvaluation,
  rsiRuntimeSkillCurationTrustRootSnapshot,
} from '../src/rsi-runtime-skill-curation.mjs';

const SOURCE='a'.repeat(40);
const d=(char)=>`sha256:${char.repeat(64)}`;

function skill({id='skill.curation.parent',version=1,parent=null,source='b',impl='c',role='ANALYZER',capabilities=['READ_VERIFIED_CONTEXT','ANALYZE_FAILURE_CODES']}={}){
  return createRsiSkillCapsule({
    skill_id:id,version,parent_skill_digest:parent,source_candidate_sha:source.repeat(40),role,
    input_schema_digest:d('1'),output_schema_digest:d('2'),implementation_digest:d(impl),
    components:[{component_id:`${id}.component.v${version}`,artifact_digest:d('f'),kind:'TYPED_TRANSFORM'}],
    capabilities,max_context_tokens:2048,max_output_tokens:512,max_invocations:2,
    external_builder:true,authored_by_candidate:false,
  });
}

function skillEvidence(capsule,holdout='3'){
  return createRsiSkillEvidence({
    capsule,hidden_holdout_digest:d(holdout),evaluator_root_digest:d('4'),unit_test_digest:d('5'),
    runtime_feedback_digest:d('6'),attempt_count:12,success_count:10,hard_invariants_pass:true,
    verified_for_library:true,evidence_refs:[`VERIFY_${capsule.skill_id}_v${capsule.skill_version}`],
    external_evaluator:true,authored_by_candidate:false,
  });
}

function fixture(){
  const parent=skill();
  const library=createRsiVerifiedSkillLibrary({
    library_id:'runtime.skill.curation.library',
    entries:[{capsule:parent,evidence:skillEvidence(parent)}],
    external_library_owner:true,authored_by_candidate:false,
  });
  const governance=createRsiSkillLibraryGovernance({
    governance_id:'runtime.skill.curation.governance',
    library,lifecycle_evidence:[],max_active_skills:1,exploration_slots:1,
    external_library_owner:true,authored_by_candidate:false,
  });
  return {parent,library,governance};
}

function requestArgs(parentDigest){
  return {
    source_sha:SOURCE,
    request_id:'curation.request.1',
    parent_skill_digest:parentDigest,
    reason:'RELIABILITY_GAP',
    trigger_evidence_digests:[d('7'),d('8')],
    training_context_digest:d('9'),
    validation_holdout_digest:d('a'),
    meta_holdout_digest:d('b'),
    optimizer_model_family:'GPT_5_6_SOL',
    allowed_edit_ops:['ADD','DELETE','REPLACE'],
    edit_budget:4,
    external_curator:true,
    authored_by_candidate:false,
  };
}

test('curation request freezes edit budget, holdouts, parent identity and zero authority',()=>{
  const {parent,library,governance}=fixture();
  const req=createRsiSkillCurationRequest({...requestArgs(parent.skill_digest),library,governance});
  assert.equal(req.parent_skill_digest,parent.skill_digest);
  assert.equal(req.target_skill_version,2);
  assert.equal(req.edit_budget,4);
  assert.equal(req.parent_remains_library_member,true);
  assert.equal(req.parent_activation_state_unchanged,true);
  assert.equal(req.candidate_can_choose_holdout,false);
  assert.equal(req.direct_library_replacement_allowed,false);
  assert.equal(req.request_is_execution_authority,false);
  assert.equal(req.authority_effect,false);
  assert.match(req.request_digest,/^sha256:[0-9a-f]{64}$/);
});

test('training validation and meta holdouts must be independently separated',()=>{
  const {parent,library,governance}=fixture();
  assert.throws(()=>createRsiSkillCurationRequest({
    ...requestArgs(parent.skill_digest),library,governance,
    validation_holdout_digest:d('9'),
  }),/holdout_alias/);
  assert.throws(()=>createRsiSkillCurationRequest({
    ...requestArgs(parent.skill_digest),library,governance,
    edit_budget:17,
  }),/edit_budget_invalid/);
  assert.throws(()=>createRsiSkillCurationRequest({
    ...requestArgs(parent.skill_digest),library,governance,
    external_curator:false,authored_by_candidate:true,
  }),/external_curator_required/);
});

test('accepted shadow revision requires strict heldout improvement, meta non-regression and invariant pass',()=>{
  const {parent,library,governance}=fixture();
  const req=createRsiSkillCurationRequest({...requestArgs(parent.skill_digest),library,governance});
  const successor=skill({version:2,parent:parent.skill_digest,source:'c',impl:'d'});
  const evaluation=createRsiSkillRevisionEvaluation({
    evaluation_id:'evaluation.curation.request.1',
    request:req,library,governance,successor_skill:successor,
    baseline_validation_score:0.60,candidate_validation_score:0.72,
    baseline_meta_score:0.55,candidate_meta_score:0.56,
    hard_invariants_pass:true,evaluator_digest:d('c'),evaluation_digest:d('d'),
    evidence_refs:['eval:heldout:1'],external_evaluator:true,authored_by_candidate:false,
  });
  verifyRsiSkillRevisionEvaluation(evaluation,{request:req,library,governance});
  assert.equal(evaluation.accepted_for_existing_reliability_gate,true);
  assert.equal(evaluation.state,'ELIGIBLE_FOR_EXISTING_RELIABILITY_GATE');
  assert.equal(evaluation.direct_library_replacement_allowed,false);
  assert.equal(evaluation.parent_activation_state_unchanged,true);
  assert.equal(evaluation.existing_reliability_gate_required,true);
  assert.equal(evaluation.existing_scope_preservation_gate_required,true);
});

test('equal validation, meta regression or failed invariants reject without replacing the parent',()=>{
  const {parent,library,governance}=fixture();
  const req=createRsiSkillCurationRequest({...requestArgs(parent.skill_digest),library,governance});
  const successor=skill({version:2,parent:parent.skill_digest,source:'c',impl:'d'});
  for(const [id,params] of [
    ['equal',{baseline_validation_score:0.6,candidate_validation_score:0.6,baseline_meta_score:0.5,candidate_meta_score:0.6,hard_invariants_pass:true}],
    ['meta',{baseline_validation_score:0.6,candidate_validation_score:0.7,baseline_meta_score:0.6,candidate_meta_score:0.5,hard_invariants_pass:true}],
    ['hard',{baseline_validation_score:0.6,candidate_validation_score:0.7,baseline_meta_score:0.5,candidate_meta_score:0.6,hard_invariants_pass:false}],
  ]){
    const evaluation=createRsiSkillRevisionEvaluation({
      evaluation_id:`evaluation.reject.${id}`,request:req,library,governance,successor_skill:successor,
      ...params,evaluator_digest:d('c'),evaluation_digest:d('d'),
      evidence_refs:[`eval:reject:${id}`],external_evaluator:true,authored_by_candidate:false,
    });
    assert.equal(evaluation.state,'REJECTED_HELDOUT_REVISION');
    assert.equal(evaluation.accepted_for_existing_reliability_gate,false);
    assert.equal(evaluation.rejected_revision_retained,true);
    assert.equal(evaluation.direct_library_replacement_allowed,false);
  }
});

test('successor cannot widen interface capabilities or sever parent lineage',()=>{
  const {parent,library,governance}=fixture();
  const req=createRsiSkillCurationRequest({...requestArgs(parent.skill_digest),library,governance});
  const drifted=skill({
    version:2,parent:parent.skill_digest,source:'c',impl:'d',role:'RETRIEVER',
    capabilities:['READ_VERIFIED_CONTEXT','SELECT_VERIFIED_MEMORY'],
  });
  assert.throws(()=>createRsiSkillRevisionEvaluation({
    evaluation_id:'evaluation.drift',request:req,library,governance,successor_skill:drifted,
    baseline_validation_score:0.5,candidate_validation_score:0.8,baseline_meta_score:0.5,candidate_meta_score:0.8,
    hard_invariants_pass:true,evaluator_digest:d('c'),evaluation_digest:d('d'),
    evidence_refs:['eval:drift'],external_evaluator:true,authored_by_candidate:false,
  }),/successor_interface_drift/);

  const wrongParent=skill({version:2,parent:d('e'),source:'c',impl:'d'});
  assert.throws(()=>createRsiSkillRevisionEvaluation({
    evaluation_id:'evaluation.parent',request:req,library,governance,successor_skill:wrongParent,
    baseline_validation_score:0.5,candidate_validation_score:0.8,baseline_meta_score:0.5,candidate_meta_score:0.8,
    hard_invariants_pass:true,evaluator_digest:d('c'),evaluation_digest:d('d'),
    evidence_refs:['eval:parent'],external_evaluator:true,authored_by_candidate:false,
  }),/successor_parent_mismatch/);
});

test('durable curation queue is idempotent, single-assignment and remembers rejected revisions',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-rsi-curation-'));
  const statePath=path.join(root,'curation.json');
  try{
    const {parent,library,governance}=fixture();
    const req=createRsiSkillCurationRequest({...requestArgs(parent.skill_digest),library,governance});
    const queue=new RsiRuntimeSkillCurationQueue({statePath,source_sha:SOURCE});
    await queue.init();
    const first=await queue.enqueue({request:req,library,governance});
    const again=await queue.enqueue({request:req,library,governance});
    assert.equal(first.state,'QUEUED');
    assert.equal(again.state,'IDEMPOTENT');

    const successor=skill({version:2,parent:parent.skill_digest,source:'c',impl:'d'});
    const evaluated=await queue.evaluateRevision({
      request_id:req.request_id,library,governance,successor_skill:successor,
      baseline_validation_score:0.6,candidate_validation_score:0.59,
      baseline_meta_score:0.5,candidate_meta_score:0.5,hard_invariants_pass:true,
      evaluator_digest:d('c'),evaluation_digest:d('d'),evidence_refs:['eval:rejected'],
      external_evaluator:true,authored_by_candidate:false,
    });
    assert.equal(evaluated.evaluation.state,'REJECTED_HELDOUT_REVISION');
    assert.equal(queue.snapshot().rejected_count,1);
    assert.deepEqual(queue.snapshot().rejected_revision_buffer,[successor.skill_digest]);

    const same=await queue.recordEvaluation({
      request_id:req.request_id,evaluation:evaluated.evaluation,library,governance,
    });
    assert.equal(same.state,'IDEMPOTENT');

    const restored=new RsiRuntimeSkillCurationQueue({statePath,source_sha:SOURCE});
    await restored.init();
    assert.equal(restored.snapshot().record_count,1);
    assert.equal(restored.snapshot().rejected_count,1);
    assert.deepEqual(restored.snapshot().rejected_revision_buffer,[successor.skill_digest]);

    const raw=await fs.readFile(statePath,'utf8');
    assert.doesNotMatch(raw,/"raw_page_text"\s*:/);
    assert.doesNotMatch(raw,/"raw_user_input"\s*:/);
    assert.match(raw,/"raw_page_text_stored":false/);
    assert.match(raw,/"raw_user_input_stored":false/);
  }finally{await fs.rm(root,{recursive:true,force:true})}
});

test('curation trust root keeps optimizer outside execution, promotion and library replacement authority',()=>{
  const root=rsiRuntimeSkillCurationTrustRootSnapshot();
  assert.equal(root.frozen_executor_required,true);
  assert.equal(root.separate_external_curator_required,true);
  assert.equal(root.training_validation_meta_holdouts_must_be_distinct,true);
  assert.equal(root.strict_validation_improvement_required,true);
  assert.equal(root.meta_non_regression_required,true);
  assert.equal(root.rejected_revision_buffer_required,true);
  assert.equal(root.parent_library_entry_preserved,true);
  assert.equal(root.direct_library_replacement_allowed,false);
  assert.equal(root.candidate_can_self_accept_revision,false);
  assert.equal(root.queue_is_execution_authority,false);
  assert.equal(root.execution_authority,false);
  assert.equal(root.promotion_authority,false);
  assert.equal(root.self_update_authority,false);
  assert.equal(root.authority_effect,false);
  assert.match(root.curation_root_digest,/^sha256:[0-9a-f]{64}$/);
});
