import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRsiSkillCapsule,
  createRsiSkillEvidence,
} from '../src/rsi-verified-skill-library.mjs';
import {
  createRsiSkillScopeUnit,
  verifyRsiSkillScopeUnit,
  createRsiSkillCompatibilityReceipt,
  verifyRsiSkillCompatibilityReceipt,
  createRsiSkillAbstractionCandidate,
  verifyRsiSkillAbstractionCandidate,
  createRsiSkillScopePreservationReceipt,
  verifyRsiSkillScopePreservationReceipt,
  finalizeRsiSkillScopeExpansion,
  rsiSkillScopeExpansionTrustRootSnapshot,
} from '../src/rsi-skill-scope-expansion.mjs';

const sha=(c)=>c.repeat(40);
const d=(c)=>`sha256:${c.repeat(64)}`;

function skill(id,char='1',overrides={}){
  return createRsiSkillCapsule({
    skill_id:id,
    version:1,
    source_candidate_sha:sha(char),
    role:'ANALYZER',
    input_schema_digest:d('1'),
    output_schema_digest:d('2'),
    implementation_digest:d(char),
    components:[{component_id:`${id}.component`,artifact_digest:d('f'),kind:'TYPED_TRANSFORM'}],
    capabilities:['READ_VERIFIED_CONTEXT','ANALYZE_FAILURE_CODES'],
    max_context_tokens:2048,
    max_output_tokens:512,
    max_invocations:2,
    external_builder:true,
    authored_by_candidate:false,
    ...overrides,
  });
}

function evidence(s,char='1'){
  return createRsiSkillEvidence({
    capsule:s,
    hidden_holdout_digest:d('a'),
    evaluator_root_digest:d('b'),
    unit_test_digest:d('c'),
    runtime_feedback_digest:d(char),
    attempt_count:10,
    success_count:9,
    hard_invariants_pass:true,
    verified_for_library:true,
    evidence_refs:[`RUN_SKILL_${char}`],
    external_evaluator:true,
    authored_by_candidate:false,
  });
}

function unit(id,char,instance){
  const s=skill(`skill.patch.${id}`,char);
  const e=evidence(s,char);
  const u=createRsiSkillScopeUnit({
    unit_id:`scope.unit.${id}`,
    skill:s,
    evidence:e,
    scope_level:'INSTANCE_PATCH',
    validated_instance_digests:[d(instance)],
    mechanism_signature_digest:d('9'),
    evidence_refs:[`SOURCE_REPLAY_${id}`],
    external_scope_owner:true,
    authored_by_candidate:false,
  });
  return {skill:s,evidence:e,unit:u};
}

function baseFixture(){
  const a=unit('alpha','3','3');
  const b=unit('beta','4','4');
  const units=[a.unit,b.unit];
  const directed=[
    {source_unit_id:a.unit.unit_id,target_unit_id:b.unit.unit_id,success:true,evidence_digest:d('5')},
    {source_unit_id:b.unit.unit_id,target_unit_id:a.unit.unit_id,success:true,evidence_digest:d('6')},
  ];
  const compatibility=createRsiSkillCompatibilityReceipt({
    compatibility_id:'scope.compatibility.alpha-beta',
    units,
    directed_cross_replays:directed,
    mechanism_check_method:'HYBRID_MECHANISM_CHECK_V1',
    shared_mechanism_digest:d('9'),
    mechanism_compatible:true,
    mechanism_evidence_digest:d('7'),
    evidence_refs:['CROSS_REPLAY_300','MECHANISM_CHECK_300'],
    external_replay_evaluator:true,
    external_mechanism_assessor:true,
    authored_by_candidate:false,
  });
  const abstractSkill=skill('skill.functional.failure-analysis','7',{
    implementation_digest:d('8'),
  });
  const candidate=createRsiSkillAbstractionCandidate({
    candidate_id:'scope.abstraction.failure-analysis',
    units,
    compatibility_receipt:compatibility,
    abstract_skill:abstractSkill,
    target_scope_level:'FUNCTIONAL_SKILL',
    external_abstraction_builder:true,
    authored_by_candidate:false,
  });
  const preservation=createRsiSkillScopePreservationReceipt({
    preservation_id:'scope.preservation.failure-analysis',
    candidate,
    units,
    compatibility_receipt:compatibility,
    source_replays:[
      {source_instance_digest:d('3'),success:true,evidence_digest:d('a')},
      {source_instance_digest:d('4'),success:true,evidence_digest:d('b')},
    ],
    observed_capabilities:['READ_VERIFIED_CONTEXT','ANALYZE_FAILURE_CODES'],
    capability_analysis_digest:d('c'),
    evidence_refs:['SOURCE_PRESERVATION_300','CAPABILITY_ANALYSIS_300'],
    external_source_replay_evaluator:true,
    external_capability_analyzer:true,
    authored_by_candidate:false,
  });
  return {a,b,units,directed,compatibility,abstractSkill,candidate,preservation};
}

test('instance patch preserves one locally validated behavior before any abstraction claim',()=>{
  const {a}=baseFixture();
  verifyRsiSkillScopeUnit(a.unit,a.skill,a.evidence);
  assert.equal(a.unit.scope_level,'INSTANCE_PATCH');
  assert.equal(a.unit.validated_instance_count,1);
  assert.equal(a.unit.source_behavior_preserved,true);
  assert.equal(a.unit.scope_portability_claimed,false);
  assert.equal(a.unit.semantic_similarity_is_compatibility_authority,false);
  assert.equal(a.unit.model_mechanism_judgment_is_compatibility_authority,false);
  assert.equal(a.unit.authority_effect,false);
});

test('compatibility requires every directed cross-instance replay plus shared mechanism evidence',()=>{
  const {units,compatibility}=baseFixture();
  verifyRsiSkillCompatibilityReceipt(compatibility,units);
  assert.equal(compatibility.directed_cross_replay_count,2);
  assert.equal(compatibility.all_directed_cross_replays_pass,true);
  assert.equal(compatibility.mechanism_compatible,true);
  assert.equal(compatibility.compatible_for_abstraction,true);
  assert.equal(compatibility.semantic_similarity_used_for_candidate_retrieval_only,true);
  assert.equal(compatibility.semantic_similarity_is_compatibility_authority,false);
  assert.equal(compatibility.mechanism_judgment_alone_is_compatibility_authority,false);
  assert.equal(compatibility.authority_effect,false);
});

test('mechanism judgment cannot override a failed directed replay',()=>{
  const {units,directed}=baseFixture();
  const failed=directed.map((row,index)=>index===0?{...row,success:false}:row);
  const receipt=createRsiSkillCompatibilityReceipt({
    compatibility_id:'scope.compatibility.failed',
    units,
    directed_cross_replays:failed,
    mechanism_check_method:'EXTERNAL_LLM_MECHANISM_CHECK_V1',
    shared_mechanism_digest:d('9'),
    mechanism_compatible:true,
    mechanism_evidence_digest:d('7'),
    evidence_refs:['CROSS_REPLAY_FAIL_301'],
    external_replay_evaluator:true,
    external_mechanism_assessor:true,
    authored_by_candidate:false,
  });
  assert.equal(receipt.mechanism_compatible,true);
  assert.equal(receipt.all_directed_cross_replays_pass,false);
  assert.equal(receipt.compatible_for_abstraction,false);
  assert.throws(()=>createRsiSkillAbstractionCandidate({
    candidate_id:'scope.abstraction.illegal',
    units,
    compatibility_receipt:receipt,
    abstract_skill:skill('skill.functional.illegal','7'),
    target_scope_level:'FUNCTIONAL_SKILL',
    external_abstraction_builder:true,
    authored_by_candidate:false,
  }),/incompatible_units/);
});

test('abstraction expands exactly one hierarchy level and cannot widen interface or capabilities',()=>{
  const {units,compatibility,candidate}=baseFixture();
  verifyRsiSkillAbstractionCandidate(candidate,units,compatibility);
  assert.equal(candidate.target_scope_level,'FUNCTIONAL_SKILL');
  assert.equal(candidate.source_max_scope_rank,0);
  assert.equal(candidate.target_scope_rank,1);
  assert.equal(candidate.source_instance_count,2);
  assert.equal(candidate.source_preservation_required,true);
  assert.equal(candidate.behavioral_integrity_required,true);
  assert.equal(candidate.v124_library_evidence_still_required,true);
  assert.equal(candidate.candidate_can_self_commit,false);

  const widened=skill('skill.functional.widened','7',{
    capabilities:['READ_VERIFIED_CONTEXT','ANALYZE_FAILURE_CODES','CHECK_TYPED_OUTPUT'],
  });
  assert.throws(()=>createRsiSkillAbstractionCandidate({
    candidate_id:'scope.abstraction.widened',
    units,
    compatibility_receipt:compatibility,
    abstract_skill:widened,
    target_scope_level:'FUNCTIONAL_SKILL',
    external_abstraction_builder:true,
    authored_by_candidate:false,
  }),/capability_widening/);

  assert.throws(()=>createRsiSkillAbstractionCandidate({
    candidate_id:'scope.abstraction.skipped-level',
    units,
    compatibility_receipt:compatibility,
    abstract_skill:skill('skill.strategic.skipped','7'),
    target_scope_level:'STRATEGIC_SKILL',
    external_abstraction_builder:true,
    authored_by_candidate:false,
  }),/level_not_adjacent/);
});

test('source-preserving consolidation requires replay on every constituent instance',()=>{
  const {candidate,units,compatibility,preservation}=baseFixture();
  verifyRsiSkillScopePreservationReceipt(preservation,candidate,units,compatibility);
  assert.equal(preservation.source_replay_count,2);
  assert.equal(preservation.all_source_replays_pass,true);
  assert.equal(preservation.behavioral_integrity_pass,true);
  assert.equal(preservation.eligible_for_scope_commit,true);

  assert.throws(()=>createRsiSkillScopePreservationReceipt({
    preservation_id:'scope.preservation.incomplete',
    candidate,units,compatibility_receipt:compatibility,
    source_replays:[{source_instance_digest:d('3'),success:true,evidence_digest:d('a')}],
    observed_capabilities:['READ_VERIFIED_CONTEXT','ANALYZE_FAILURE_CODES'],
    capability_analysis_digest:d('c'),
    evidence_refs:['SOURCE_PRESERVATION_INCOMPLETE'],
    external_source_replay_evaluator:true,
    external_capability_analyzer:true,
    authored_by_candidate:false,
  }),/source_replay_set_incomplete/);
});

test('behavioral integrity rejects undeclared or overdeclared capability drift',()=>{
  const {candidate,units,compatibility}=baseFixture();
  const drift=createRsiSkillScopePreservationReceipt({
    preservation_id:'scope.preservation.capability-drift',
    candidate,units,compatibility_receipt:compatibility,
    source_replays:[
      {source_instance_digest:d('3'),success:true,evidence_digest:d('a')},
      {source_instance_digest:d('4'),success:true,evidence_digest:d('b')},
    ],
    observed_capabilities:['READ_VERIFIED_CONTEXT'],
    capability_analysis_digest:d('c'),
    evidence_refs:['CAPABILITY_DRIFT_302'],
    external_source_replay_evaluator:true,
    external_capability_analyzer:true,
    authored_by_candidate:false,
  });
  assert.equal(drift.all_source_replays_pass,true);
  assert.equal(drift.behavioral_integrity_pass,false);
  assert.deepEqual(drift.overdeclared_capabilities,['ANALYZE_FAILURE_CODES']);
  assert.equal(drift.eligible_for_scope_commit,false);
  const result=finalizeRsiSkillScopeExpansion({
    candidate,units,compatibility_receipt:compatibility,preservation_receipt:drift,
  });
  assert.equal(result.state,'REJECTED_SCOPE_EXPANSION');
});

test('successful scope expansion still requires independent V1.24 library evidence before commit',()=>{
  const {candidate,units,compatibility,preservation}=baseFixture();
  const result=finalizeRsiSkillScopeExpansion({
    candidate,units,compatibility_receipt:compatibility,preservation_receipt:preservation,
  });
  assert.equal(result.state,'ELIGIBLE_FOR_V124_LIBRARY_EVIDENCE');
  assert.equal(result.eligible_for_v124_library_evidence,true);
  assert.equal(result.directly_committed_to_library,false);
  assert.equal(result.v124_external_skill_evidence_required,true);
  assert.equal(result.source_preservation_verified,true);
  assert.equal(result.behavioral_integrity_verified,true);
  assert.equal(result.semantic_similarity_is_commit_authority,false);
  assert.equal(result.mechanism_judgment_is_commit_authority,false);
  assert.equal(result.skill_scope_expansion_is_promotion_authority,false);
  assert.equal(result.authority_effect,false);
});

test('scope-expansion trust root encodes behavioral validation rather than semantic merge authority',()=>{
  const root=rsiSkillScopeExpansionTrustRootSnapshot();
  assert.deepEqual(root.scope_levels,['INSTANCE_PATCH','FUNCTIONAL_SKILL','STRATEGIC_SKILL']);
  assert.equal(root.instance_patch_first,true);
  assert.equal(root.cross_instance_replay_required,true);
  assert.equal(root.source_preserving_consolidation_required,true);
  assert.equal(root.exact_capability_set_required,true);
  assert.equal(root.semantic_similarity_is_authority,false);
  assert.equal(root.llm_mechanism_judgment_is_authority,false);
  assert.equal(root.v124_external_library_evidence_required,true);
  assert.equal(root.candidate_can_self_commit,false);
  assert.equal(root.candidate_can_widen_capabilities,false);
  assert.equal(root.behavioral_integrity_analysis_required,true);
  assert.equal(root.authority_effect,false);
  assert.match(root.scope_root_digest,/^sha256:[0-9a-f]{64}$/);
});
