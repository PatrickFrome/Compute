import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import {
  createRsiSkillCapsule,
  createRsiSkillEvidence,
  createRsiVerifiedSkillLibrary,
} from '../src/rsi-verified-skill-library.mjs';
import {
  createRsiSkillLifecycleEvidence,
  createRsiSkillLibraryGovernance,
} from '../src/rsi-skill-library-governance.mjs';
import {
  createRsiSkillExposureReleaseCertificate,
  verifyRsiSkillExposureReleaseCertificate,
  rsiSkillExposureReleaseTrustRootSnapshot,
} from '../src/rsi-skill-exposure-release.mjs';

const d=(c)=>`sha256:${c.repeat(64)}`;
function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map((k)=>[k,stable(v[k])]))}
function digest(v){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`}

function fixture(){
  const capsule=createRsiSkillCapsule({
    skill_id:'skill.phase36.certificate',
    version:1,
    parent_skill_digest:null,
    source_candidate_sha:'b'.repeat(40),
    role:'ANALYZER',
    input_schema_digest:d('1'),
    output_schema_digest:d('2'),
    implementation_digest:d('3'),
    components:[{component_id:'skill.phase36.certificate.component',artifact_digest:d('4'),kind:'TYPED_TRANSFORM'}],
    capabilities:['READ_VERIFIED_CONTEXT','ANALYZE_FAILURE_CODES'],
    max_context_tokens:2048,
    max_output_tokens:512,
    max_invocations:2,
    external_builder:true,
    authored_by_candidate:false,
  });
  const evidence=createRsiSkillEvidence({
    capsule,
    hidden_holdout_digest:d('5'),
    evaluator_root_digest:d('6'),
    unit_test_digest:d('7'),
    runtime_feedback_digest:d('8'),
    attempt_count:12,
    success_count:11,
    hard_invariants_pass:true,
    verified_for_library:true,
    evidence_refs:['VERIFY_PHASE36_CERTIFICATE'],
    external_evaluator:true,
    authored_by_candidate:false,
  });
  const library=createRsiVerifiedSkillLibrary({
    library_id:'phase36.certificate.library',
    entries:[{capsule,evidence}],
    external_library_owner:true,
    authored_by_candidate:false,
  });
  const lifecycle=createRsiSkillLifecycleEvidence({
    library,
    evidence_id:'phase36.certificate.window.1',
    skill_digest:capsule.skill_digest,
    window_seq:1,
    generation_start:1,
    generation_end:1,
    invocation_count:1,
    helpful_count:1,
    harmful_count:0,
    neutral_count:0,
    insufficient_evidence_count:0,
    router_engagement_count:1,
    false_positive_injection_count:0,
    hard_invariant_violation_count:0,
    measured_net_delta:0.25,
    authoring_prior:'VERIFIED_DIRECT_SKILL',
    authoring_provenance_digest:d('9'),
    evidence_refs:['shadow:phase36.certificate'],
    external_evaluator:true,
    authored_by_candidate:false,
  });
  const currentGovernance=createRsiSkillLibraryGovernance({
    governance_id:'phase36.certificate.governance',
    library,
    lifecycle_evidence:[lifecycle],
    admission_exposure_hold_skill_digests:[capsule.skill_digest],
    external_library_owner:true,
    authored_by_candidate:false,
  });
  const nextGovernance=createRsiSkillLibraryGovernance({
    governance_id:'phase36.certificate.governance',
    library,
    lifecycle_evidence:[lifecycle],
    admission_exposure_hold_skill_digests:[],
    external_library_owner:true,
    authored_by_candidate:false,
  });
  const currentRow=currentGovernance.entries.find((row)=>row.skill_digest===capsule.skill_digest);
  const nextRow=nextGovernance.entries.find((row)=>row.skill_digest===capsule.skill_digest);
  assert.equal(currentRow.state,'DORMANT_CAP');
  assert.equal(currentRow.admission_exposure_held,true);
  assert.equal(nextRow.state,'EXPLORATION_ACTIVE');
  assert.equal(nextRow.admission_exposure_held,false);
  const previewCore={
    schema:'metaengine.rsi.skill-exposure-release-preview.v1',
    version:1,
    library_digest:library.library_digest,
    current_governance_digest:currentGovernance.governance_digest,
    next_governance_digest:nextGovernance.governance_digest,
    skill_digest:capsule.skill_digest,
    current_state:currentRow.state,
    current_active_for_composition:currentRow.active_for_composition,
    current_admission_exposure_held:currentRow.admission_exposure_held,
    next_state:nextRow.state,
    next_active_for_composition:nextRow.active_for_composition,
    next_admission_exposure_held:nextRow.admission_exposure_held,
    changed_skill_digests:[capsule.skill_digest],
    only_target_state_changed:true,
    active_count_delta:nextGovernance.active_count-currentGovernance.active_count,
    hold_count_delta:nextGovernance.admission_exposure_hold_count-currentGovernance.admission_exposure_hold_count,
    preview_is_effect_authority:false,
    execution_authority:false,
    browser_authority:false,
    task_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    signing_authority:false,
    direct_tool_execution_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  const preview=Object.freeze({...previewCore,preview_digest:digest(previewCore)});
  return {capsule,library,currentGovernance,nextGovernance,preview};
}

function args(fx,overrides={}){
  return {
    certificate_id:'phase36.exposure.certificate.1',
    library:fx.library,
    current_governance:fx.currentGovernance,
    release_preview:fx.preview,
    skill_digest:fx.capsule.skill_digest,
    routing_context_manifest_digest:d('a'),
    retrieval_profile_digest:d('b'),
    shadow_routing_manifest_digest:d('c'),
    no_skill_ablation_receipt_digest:d('d'),
    coalition_ablation_receipt_digest:d('e'),
    memory_poisoning_scan_digest:d('f'),
    source_grounding_receipt_digest:d('0'),
    bounded_canary_policy_digest:d('1'),
    bounded_canary_result_digest:d('2'),
    negative_transfer_memory_digest:d('3'),
    shadow_context_count:4,
    shadow_success_count:4,
    shadow_hard_invariants_pass:true,
    no_skill_ablation_pass:true,
    coalition_ablation_pass:true,
    negative_transfer_clear:true,
    memory_poisoning_scan_pass:true,
    source_grounding_pass:true,
    bounded_canary_pass:true,
    canary_effect_mode:'READ_ONLY_SHADOW',
    external_governance_owner_identity_digest:d('4'),
    external_shadow_evaluator_identity_digest:d('5'),
    external_security_reviewer_identity_digest:d('6'),
    external_canary_evaluator_identity_digest:d('7'),
    external_governance_owner:true,
    external_shadow_evaluator:true,
    external_security_reviewer:true,
    external_canary_evaluator:true,
    authored_by_candidate:false,
    ...overrides,
  };
}

test('Phase36 certificate keeps release zero-authority and requires multi-context shadow, ablations, poison, grounding and read-only canary evidence',()=>{
  const fx=fixture();
  const input=args(fx);
  const cert=createRsiSkillExposureReleaseCertificate(input);
  assert.equal(cert.state,'ELIGIBLE_FOR_ONE_ATTEMPT_EXPOSURE_RELEASE');
  assert.equal(cert.eligible_for_one_attempt_exposure_release,true);
  assert.equal(cert.release_mode,'EXPLORATION_ACTIVE_ONLY');
  assert.deepEqual(cert.blockers,[]);
  assert.equal(cert.release_token,null);
  assert.equal(cert.browser_authority,false);
  assert.equal(cert.execution_authority,false);
  assert.equal(cert.promotion_authority,false);
  assert.equal(cert.automatic_retry_allowed,false);
  assert.equal(verifyRsiSkillExposureReleaseCertificate(cert,input).certificate_digest,cert.certificate_digest);

  const cases=[
    ['shadow_context_count',2,'INSUFFICIENT_SHADOW_CONTEXTS'],
    ['shadow_success_count',3,'SHADOW_CONTEXT_FAILURE'],
    ['shadow_hard_invariants_pass',false,'SHADOW_HARD_INVARIANT_FAILURE'],
    ['no_skill_ablation_pass',false,'NO_SKILL_ABLATION_FAILURE'],
    ['coalition_ablation_pass',false,'COALITION_ABLATION_FAILURE'],
    ['negative_transfer_clear',false,'NEGATIVE_TRANSFER_PRESENT'],
    ['memory_poisoning_scan_pass',false,'MEMORY_POISONING_RISK'],
    ['source_grounding_pass',false,'SOURCE_GROUNDING_FAILURE'],
    ['bounded_canary_pass',false,'BOUNDED_CANARY_FAILURE'],
    ['canary_effect_mode','MUTATING','CANARY_NOT_READ_ONLY_SHADOW'],
  ];
  for(const [field,value,blocker] of cases){
    const rejected=createRsiSkillExposureReleaseCertificate(args(fx,{certificate_id:`phase36.exposure.reject.${field}`,[field]:value}));
    assert.equal(rejected.state,'REJECTED_EXPOSURE_RELEASE');
    assert.ok(rejected.blockers.includes(blocker));
    assert.equal(rejected.eligible_for_one_attempt_exposure_release,false);
  }
});

test('Phase36 certificate rejects reviewer identity collapse and forged release preview',()=>{
  const fx=fixture();
  assert.throws(()=>createRsiSkillExposureReleaseCertificate(args(fx,{
    external_security_reviewer_identity_digest:d('4'),
  })),/separation_of_duties_required/);

  const forged={...fx.preview,next_state:'ACTIVE'};
  delete forged.preview_digest;
  forged.preview_digest=digest(forged);
  assert.throws(()=>createRsiSkillExposureReleaseCertificate(args(fx,{
    release_preview:forged,
  })),/exploration_only_required/);
});

test('Phase36 exposure-release trust root requires external, bounded, exploration-only evidence and grants no effect authority',()=>{
  const root=rsiSkillExposureReleaseTrustRootSnapshot();
  assert.equal(root.exact_current_library_required,true);
  assert.equal(root.exact_current_governance_required,true);
  assert.equal(root.exact_next_governance_preview_required,true);
  assert.equal(root.held_dormant_skill_required,true);
  assert.equal(root.exploration_only_release,true);
  assert.equal(root.minimum_shadow_context_count,3);
  assert.equal(root.all_shadow_contexts_must_pass,true);
  assert.equal(root.no_skill_ablation_required,true);
  assert.equal(root.coalition_ablation_required,true);
  assert.equal(root.negative_transfer_clear_required,true);
  assert.equal(root.memory_poisoning_scan_required,true);
  assert.equal(root.source_grounding_required,true);
  assert.equal(root.read_only_shadow_canary_required,true);
  assert.equal(root.reviewer_separation_of_duties_required,true);
  assert.equal(root.automatic_full_activation_allowed,false);
  assert.equal(root.one_attempt_release_required,true);
  assert.equal(root.ambiguous_release_retry_allowed,false);
  assert.equal(root.execution_authority,false);
  assert.equal(root.browser_authority,false);
  assert.equal(root.promotion_authority,false);
  assert.equal(root.authority_effect,false);
});
