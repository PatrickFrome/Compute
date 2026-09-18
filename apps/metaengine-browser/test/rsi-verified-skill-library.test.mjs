import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRsiSkillCapsule,
  verifyRsiSkillCapsule,
  createRsiSkillEvidence,
  createRsiVerifiedSkillLibrary,
  verifyRsiVerifiedSkillLibrary,
  createRsiSkillCompositionPlan,
  verifyRsiSkillCompositionPlan,
  createRsiSkillUsageReceipt,
  verifyRsiSkillUsageReceipt,
  createRsiSkillPortabilityReceipt,
  verifyRsiSkillPortabilityReceipt,
  rsiVerifiedSkillLibraryTrustRootSnapshot,
} from '../src/rsi-verified-skill-library.mjs';

const sha = (char) => char.repeat(40);
const d = (char) => `sha256:${char.repeat(64)}`;

function capsule({
  id='skill.analyze.failure',
  version=1,
  role='ANALYZER',
  input=d('1'),
  output=d('2'),
  implementation=d('3'),
  capabilities=['READ_VERIFIED_CONTEXT','ANALYZE_FAILURE_CODES'],
  context=2048,
  out=512,
  invocations=2,
  parent=null,
  source='1',
}={}) {
  return createRsiSkillCapsule({
    skill_id:id,
    version,
    parent_skill_digest:parent,
    source_candidate_sha:sha(source),
    role,
    input_schema_digest:input,
    output_schema_digest:output,
    implementation_digest:implementation,
    components:[{component_id:`${id}.component`,artifact_digest:d('4'),kind:'TYPED_TRANSFORM'}],
    capabilities,
    max_context_tokens:context,
    max_output_tokens:out,
    max_invocations:invocations,
    external_builder:true,
    authored_by_candidate:false,
  });
}

function evidence(skill, {
  holdout='5',
  evaluator='6',
  tests='7',
  runtime='8',
  attempts=10,
  successes=8,
  hard=true,
  verified=true,
}={}) {
  return createRsiSkillEvidence({
    capsule:skill,
    hidden_holdout_digest:d(holdout),
    evaluator_root_digest:d(evaluator),
    unit_test_digest:d(tests),
    runtime_feedback_digest:d(runtime),
    attempt_count:attempts,
    success_count:successes,
    hard_invariants_pass:hard,
    verified_for_library:verified,
    evidence_refs:['RUN_100','HOLDOUT_100'],
    external_evaluator:true,
    authored_by_candidate:false,
  });
}

function fixtures(){
  const analyze=capsule();
  const retrieve=capsule({
    id:'skill.retrieve.memory',
    role:'RETRIEVER',
    input:d('2'),
    output:d('9'),
    implementation:d('a'),
    capabilities:['READ_VERIFIED_CONTEXT','SELECT_VERIFIED_MEMORY'],
    context:1024,
    out:256,
    invocations:1,
    source:'2',
  });
  const verify=capsule({
    id:'skill.verify.output',
    role:'VERIFIER',
    input:d('9'),
    output:d('b'),
    implementation:d('c'),
    capabilities:['CHECK_TYPED_OUTPUT'],
    context:1024,
    out:256,
    invocations:1,
    source:'3',
  });
  const entries=[
    {capsule:analyze,evidence:evidence(analyze)},
    {capsule:retrieve,evidence:evidence(retrieve,{holdout:'d'})},
    {capsule:verify,evidence:evidence(verify,{holdout:'e'})},
  ];
  const library=createRsiVerifiedSkillLibrary({
    library_id:'rsi.skill.library.1',
    entries,
    external_library_owner:true,
    authored_by_candidate:false,
  });
  return {analyze,retrieve,verify,library};
}

test('skill capsule stores typed reusable procedure metadata but no direct execution authority',()=>{
  const row=capsule();
  verifyRsiSkillCapsule(row);
  assert.equal(row.role,'ANALYZER');
  assert.equal(row.raw_prompt_text_stored,false);
  assert.equal(row.raw_model_transcript_stored,false);
  assert.equal(row.raw_page_text_stored,false);
  assert.equal(row.raw_user_input_stored,false);
  assert.equal(row.secret_material_stored,false);
  assert.equal(row.arbitrary_code_execution_surface,false);
  assert.equal(row.direct_tool_execution_allowed,false);
  assert.equal(row.candidate_can_mark_verified,false);
  assert.equal(row.execution_authority,false);
  assert.equal(row.authority_effect,false);
});

test('skill capability allowlist rejects shell, network, scheduler, promotion and unknown capability widening',()=>{
  for(const capability of [
    'DIRECT_TOOL_EXECUTION','SHELL','EVAL','PROCESS','NETWORK_AUTHORITY',
    'SCHEDULER_AUTHORITY','PROMOTION_AUTHORITY','SELF_UPDATE_AUTHORITY',
    'SIGNING_AUTHORITY','SECRET_READ_AUTHORITY','MODEL_TEXT_AUTHORITY',
  ]){
    assert.throws(()=>capsule({capabilities:[capability]}),/forbidden_capability/);
  }
  assert.throws(()=>capsule({capabilities:['DO_ANYTHING']}),/unknown_capability/);
});

test('only externally verified hard-invariant-passing skills enter reusable library',()=>{
  const good=capsule();
  const goodEvidence=evidence(good);
  const library=createRsiVerifiedSkillLibrary({
    library_id:'rsi.skill.library.good',
    entries:[{capsule:good,evidence:goodEvidence}],
    external_library_owner:true,
    authored_by_candidate:false,
  });
  verifyRsiVerifiedSkillLibrary(library);
  assert.equal(library.entries[0].state,'VERIFIED');
  assert.equal(library.entries[0].reusable,true);
  assert.equal(library.entries[0].direct_execution_allowed,false);
  assert.equal(library.cross_context_portability_requires_receipt,true);

  const unverified=evidence(good,{verified:false});
  assert.throws(()=>createRsiVerifiedSkillLibrary({
    library_id:'rsi.skill.library.bad',
    entries:[{capsule:good,evidence:unverified}],
    external_library_owner:true,
    authored_by_candidate:false,
  }),/unverified_entry/);

  assert.throws(()=>createRsiSkillEvidence({
    capsule:good,
    hidden_holdout_digest:d('5'),
    evaluator_root_digest:d('6'),
    unit_test_digest:d('7'),
    runtime_feedback_digest:d('8'),
    attempt_count:2,
    success_count:2,
    hard_invariants_pass:false,
    verified_for_library:true,
    evidence_refs:['RUN_200'],
    external_evaluator:true,
    authored_by_candidate:false,
  }),/verified_without_hard_invariants/);
});

test('composition admits only verified skills with exact interface compatibility and DAG topology',()=>{
  const {analyze,retrieve,verify,library}=fixtures();
  const plan=createRsiSkillCompositionPlan({
    plan_id:'rsi.skill.plan.pipeline.1',
    library,
    input_schema_digest:d('1'),
    output_schema_digest:d('b'),
    nodes:[
      {node_id:'analyze',skill_id:analyze.skill_id,skill_version:1,skill_digest:analyze.skill_digest,max_invocations:1},
      {node_id:'retrieve',skill_id:retrieve.skill_id,skill_version:1,skill_digest:retrieve.skill_digest,max_invocations:1},
      {node_id:'verify',skill_id:verify.skill_id,skill_version:1,skill_digest:verify.skill_digest,max_invocations:1},
    ],
    edges:[
      {from:'analyze',to:'retrieve'},
      {from:'retrieve',to:'verify'},
    ],
    max_total_context_tokens:8192,
    max_total_output_tokens:2048,
    external_planner:true,
    authored_by_candidate:false,
  });
  verifyRsiSkillCompositionPlan(plan,library);
  assert.deepEqual(plan.topological_order,['analyze','retrieve','verify']);
  assert.equal(plan.max_depth,3);
  assert.equal(plan.composition_is_dag,true);
  assert.equal(plan.exact_interface_compatibility_required,true);
  assert.equal(plan.verified_library_skills_only,true);
  assert.equal(plan.direct_execution_allowed,false);
  assert.equal(plan.candidate_can_inject_unverified_skill,false);
  assert.equal(plan.authority_effect,false);
});

test('composition fails on interface mismatch, cycles and missing library skill',()=>{
  const {analyze,retrieve,library}=fixtures();
  assert.throws(()=>createRsiSkillCompositionPlan({
    plan_id:'rsi.skill.plan.mismatch',
    library,
    input_schema_digest:d('1'),
    output_schema_digest:d('9'),
    nodes:[
      {node_id:'node.a',skill_id:analyze.skill_id,skill_version:1,skill_digest:analyze.skill_digest,max_invocations:1},
      {node_id:'node.r',skill_id:retrieve.skill_id,skill_version:1,skill_digest:retrieve.skill_digest,max_invocations:1},
    ],
    edges:[{from:'node.r',to:'node.a'}],
    max_total_context_tokens:8192,
    max_total_output_tokens:2048,
    external_planner:true,
    authored_by_candidate:false,
  }),/interface_mismatch/);

  const loopA=capsule({id:'skill.loop.a',input:d('f'),output:d('f'),source:'4'});
  const loopB=capsule({id:'skill.loop.b',role:'PLAN_TRANSFORM',input:d('f'),output:d('f'),source:'5'});
  const loopLib=createRsiVerifiedSkillLibrary({
    library_id:'rsi.skill.library.loop',
    entries:[{capsule:loopA,evidence:evidence(loopA)},{capsule:loopB,evidence:evidence(loopB,{holdout:'e'})}],
    external_library_owner:true,
    authored_by_candidate:false,
  });
  assert.throws(()=>createRsiSkillCompositionPlan({
    plan_id:'rsi.skill.plan.cycle',
    library:loopLib,
    input_schema_digest:d('f'),
    output_schema_digest:d('f'),
    nodes:[
      {node_id:'loop.a',skill_id:loopA.skill_id,skill_version:1,skill_digest:loopA.skill_digest,max_invocations:1},
      {node_id:'loop.b',skill_id:loopB.skill_id,skill_version:1,skill_digest:loopB.skill_digest,max_invocations:1},
    ],
    edges:[{from:'loop.a',to:'loop.b'},{from:'loop.b',to:'loop.a'}],
    max_total_context_tokens:8192,
    max_total_output_tokens:2048,
    external_planner:true,
    authored_by_candidate:false,
  }),/cycle_forbidden/);

  const fake=capsule({id:'skill.not.in.library',source:'6'});
  assert.throws(()=>createRsiSkillCompositionPlan({
    plan_id:'rsi.skill.plan.fake',
    library,
    input_schema_digest:d('1'),
    output_schema_digest:d('2'),
    nodes:[{node_id:'fake',skill_id:fake.skill_id,skill_version:1,skill_digest:fake.skill_digest,max_invocations:1}],
    edges:[],
    max_total_context_tokens:8192,
    max_total_output_tokens:2048,
    external_planner:true,
    authored_by_candidate:false,
  }),/skill_not_in_library/);
});

test('composition budget is hard-bounded before any skill activation',()=>{
  const {analyze,library}=fixtures();
  assert.throws(()=>createRsiSkillCompositionPlan({
    plan_id:'rsi.skill.plan.budget',
    library,
    input_schema_digest:d('1'),
    output_schema_digest:d('2'),
    nodes:[{node_id:'node.a',skill_id:analyze.skill_id,skill_version:1,skill_digest:analyze.skill_digest,max_invocations:2}],
    edges:[],
    max_total_context_tokens:2048,
    max_total_output_tokens:512,
    external_planner:true,
    authored_by_candidate:false,
  }),/context_budget_exceeded|output_budget_exceeded/);
});

test('usage receipt is external learning evidence only and helpful outcome requires hard invariants',()=>{
  const {analyze,library}=fixtures();
  const plan=createRsiSkillCompositionPlan({
    plan_id:'rsi.skill.plan.usage',
    library,
    input_schema_digest:d('1'),
    output_schema_digest:d('2'),
    nodes:[{node_id:'node.a',skill_id:analyze.skill_id,skill_version:1,skill_digest:analyze.skill_digest,max_invocations:1}],
    edges:[],
    max_total_context_tokens:4096,
    max_total_output_tokens:1024,
    external_planner:true,
    authored_by_candidate:false,
  });
  const receipt=createRsiSkillUsageReceipt({
    plan,library,
    target_context_digest:d('a'),
    hidden_holdout_digest:d('b'),
    evaluator_root_digest:d('c'),
    outcome:'HELPFUL',
    measured_delta:0.11,
    hard_invariants_pass:true,
    evidence_refs:['TARGET_RUN_300'],
    external_evaluator:true,
    authored_by_candidate:false,
  });
  verifyRsiSkillUsageReceipt(receipt,plan,library);
  assert.equal(receipt.usage_feedback_is_skill_memory_only,true);
  assert.equal(receipt.usage_receipt_is_promotion_authority,false);
  assert.equal(receipt.authority_effect,false);

  assert.throws(()=>createRsiSkillUsageReceipt({
    plan,library,
    target_context_digest:d('a'),
    hidden_holdout_digest:d('b'),
    evaluator_root_digest:d('c'),
    outcome:'HELPFUL',
    measured_delta:0.11,
    hard_invariants_pass:false,
    evidence_refs:['TARGET_RUN_301'],
    external_evaluator:true,
    authored_by_candidate:false,
  }),/helpful_without_hard_invariants/);
});

test('skill portability requires independent target-context receipt and preserves negative transfer',()=>{
  const skill=capsule();
  const ev=evidence(skill);
  const positive=createRsiSkillPortabilityReceipt({
    skill,evidence:ev,
    target_model_family:'GLM_5',
    target_environment_family:'LINUX_SANDBOX',
    target_context_digest:d('9'),
    target_holdout_digest:d('a'),
    evaluator_root_digest:d('b'),
    outcome:'PORTABLE_VERIFIED',
    hard_invariants_pass:true,
    measured_delta:0.08,
    evidence_refs:['TRANSFER_RUN_400'],
    external_evaluator:true,
    authored_by_candidate:false,
  });
  verifyRsiSkillPortabilityReceipt(positive,skill,ev);
  assert.equal(positive.portable_to_target,true);
  assert.equal(positive.candidate_can_self_certify_portability,false);
  assert.equal(positive.authority_effect,false);

  const negative=createRsiSkillPortabilityReceipt({
    skill,evidence:ev,
    target_model_family:'GLM_5',
    target_environment_family:'LINUX_SANDBOX',
    target_context_digest:d('9'),
    target_holdout_digest:d('a'),
    evaluator_root_digest:d('b'),
    outcome:'NEGATIVE_TRANSFER',
    hard_invariants_pass:true,
    measured_delta:-0.06,
    evidence_refs:['TRANSFER_RUN_401'],
    external_evaluator:true,
    authored_by_candidate:false,
  });
  assert.equal(negative.portable_to_target,false);
  assert.equal(negative.negative_transfer_memory,true);

  assert.throws(()=>createRsiSkillPortabilityReceipt({
    skill,evidence:ev,
    target_model_family:'GLM_5',
    target_environment_family:'LINUX_SANDBOX',
    target_context_digest:d('9'),
    target_holdout_digest:d('a'),
    evaluator_root_digest:d('b'),
    outcome:'PORTABLE_VERIFIED',
    hard_invariants_pass:true,
    measured_delta:0.5,
    evidence_refs:['MODEL_SELF_REPORT'],
    external_evaluator:false,
    authored_by_candidate:true,
  }),/external_origin_required/);
});

test('skill-library trust root exposes compositional reuse without widening authority',()=>{
  const root=rsiVerifiedSkillLibraryTrustRootSnapshot();
  assert.equal(root.stable_versioning_required,true);
  assert.equal(root.verified_library_skills_only,true);
  assert.equal(root.exact_interface_compatibility_required,true);
  assert.equal(root.composition_is_dag,true);
  assert.equal(root.cross_context_portability_requires_receipt,true);
  assert.equal(root.candidate_can_mark_skill_verified,false);
  assert.equal(root.candidate_can_activate_skill_directly,false);
  assert.equal(root.candidate_can_self_certify_portability,false);
  assert.equal(root.arbitrary_code_execution_surface,false);
  assert.equal(root.direct_tool_execution_allowed,false);
  assert.equal(root.skill_library_is_promotion_authority,false);
  assert.equal(root.authority_effect,false);
  assert.match(root.skill_root_digest,/^sha256:[0-9a-f]{64}$/);
});
