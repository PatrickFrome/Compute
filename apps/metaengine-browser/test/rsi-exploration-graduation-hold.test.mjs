import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRsiSkillCapsule,
  createRsiSkillEvidence,
  createRsiVerifiedSkillLibrary,
} from '../src/rsi-verified-skill-library.mjs';
import {
  createRsiSkillLifecycleEvidence,
  createRsiSkillLibraryGovernance,
  verifyRsiSkillLibraryGovernance,
  createRsiSkillActivationView,
  rsiSkillLibraryGovernanceTrustRootSnapshot,
} from '../src/rsi-skill-library-governance.mjs';

const sha=(char)=>char.repeat(40);
const d=(char)=>`sha256:${char.repeat(64)}`;

function fixture(){
  const skill=createRsiSkillCapsule({
    skill_id:'skill.exploration.graduation.fixture',
    version:1,
    parent_skill_digest:null,
    source_candidate_sha:sha('1'),
    role:'ANALYZER',
    input_schema_digest:d('1'),
    output_schema_digest:d('2'),
    implementation_digest:d('3'),
    components:[{component_id:'skill.exploration.graduation.component',artifact_digest:d('4'),kind:'TYPED_TRANSFORM'}],
    capabilities:['READ_VERIFIED_CONTEXT','ANALYZE_FAILURE_CODES'],
    max_context_tokens:2048,
    max_output_tokens:512,
    max_invocations:2,
    external_builder:true,
    authored_by_candidate:false,
  });
  const evidence=createRsiSkillEvidence({
    capsule:skill,
    hidden_holdout_digest:d('5'),
    evaluator_root_digest:d('6'),
    unit_test_digest:d('7'),
    runtime_feedback_digest:d('8'),
    attempt_count:12,
    success_count:10,
    hard_invariants_pass:true,
    verified_for_library:true,
    evidence_refs:['EXPLORATION_GRADUATION_FIXTURE'],
    external_evaluator:true,
    authored_by_candidate:false,
  });
  const library=createRsiVerifiedSkillLibrary({
    library_id:'rsi.skill.library.exploration.graduation.fixture',
    entries:[{capsule:skill,evidence}],
    external_library_owner:true,
    authored_by_candidate:false,
  });
  const lifecycle=createRsiSkillLifecycleEvidence({
    library,
    evidence_id:'window.exploration.graduation.1',
    skill_digest:skill.skill_digest,
    window_seq:1,
    generation_start:1,
    generation_end:1,
    invocation_count:8,
    helpful_count:7,
    harmful_count:0,
    neutral_count:1,
    insufficient_evidence_count:0,
    router_engagement_count:8,
    false_positive_injection_count:0,
    hard_invariant_violation_count:0,
    measured_net_delta:0.4,
    authoring_prior:'VERIFIED_DIRECT_SKILL',
    authoring_provenance_digest:d('9'),
    evidence_refs:['EXPLORATION_GRADUATION_LIFECYCLE'],
    external_evaluator:true,
    authored_by_candidate:false,
  });
  return {skill,library,lifecycle};
}

test('R9 exploration-only hold prevents a proven-positive skill from auto-promoting to ACTIVE',()=>{
  const {skill,library,lifecycle}=fixture();
  const baseline=createRsiSkillLibraryGovernance({
    governance_id:'governance.exploration.graduation.baseline',
    library,
    lifecycle_evidence:[lifecycle],
    external_library_owner:true,
    authored_by_candidate:false,
  });
  assert.equal(baseline.entries[0].state,'ACTIVE');

  const held=createRsiSkillLibraryGovernance({
    governance_id:'governance.exploration.graduation.held',
    library,
    lifecycle_evidence:[lifecycle],
    exploration_only_skill_digests:[skill.skill_digest],
    external_library_owner:true,
    authored_by_candidate:false,
  });
  verifyRsiSkillLibraryGovernance(held,library);
  assert.equal(held.entries[0].proven_positive,true);
  assert.equal(held.entries[0].state,'EXPLORATION_ACTIVE');
  assert.equal(held.entries[0].active_for_composition,true);
  assert.equal(held.entries[0].exploration_only_hold,true);
  assert.deepEqual(held.exploration_only_skill_digests,[skill.skill_digest]);
  assert.equal(held.exploration_only_prevents_full_active,true);
  assert.equal(held.exploration_only_release_requires_external_governance,true);

  const view=createRsiSkillActivationView({
    governance:held,
    library,
    requested_skill_digests:[skill.skill_digest],
    external_planner:true,
    authored_by_candidate:false,
  });
  assert.equal(view.selected[0].governance_state,'EXPLORATION_ACTIVE');
});

test('R9 admission and graduation holds cannot overlap on one skill',()=>{
  const {skill,library,lifecycle}=fixture();
  assert.throws(()=>createRsiSkillLibraryGovernance({
    governance_id:'governance.exploration.graduation.overlap',
    library,
    lifecycle_evidence:[lifecycle],
    admission_exposure_hold_skill_digests:[skill.skill_digest],
    exploration_only_skill_digests:[skill.skill_digest],
    external_library_owner:true,
    authored_by_candidate:false,
  }),/hold_kind_overlap_forbidden/);
});

test('R9 governance trust root makes full activation require separate external graduation',()=>{
  const root=rsiSkillLibraryGovernanceTrustRootSnapshot();
  assert.equal(root.exploration_only_holds_supported,true);
  assert.equal(root.exploration_only_prevents_full_active,true);
  assert.equal(root.exploration_only_release_requires_external_governance,true);
  assert.equal(root.candidate_can_change_governance,false);
  assert.equal(root.promotion_authority,false);
  assert.equal(root.authority_effect,false);
});
