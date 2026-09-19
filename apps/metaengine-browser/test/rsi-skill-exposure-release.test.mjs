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
  createRsiSkillExposureReleasePreview,
  verifyRsiSkillExposureReleasePreview,
  createRsiSkillExposureReleaseCertificate,
  verifyRsiSkillExposureReleaseCertificate,
  rsiSkillExposureReleaseTrustRootSnapshot,
} from '../src/rsi-skill-exposure-release.mjs';
import { createRsiSourceIdentityConvergenceEvidence } from '../src/rsi-source-identity-convergence.mjs';
import { createRsiFreshSourceIdentityConvergenceCertificate } from '../src/rsi-source-identity-freshness.mjs';

const d=(c)=>`sha256:${c.repeat(64)}`;
function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map((k)=>[k,stable(v[k])]))}
function digest(v){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`}

function freshSourceIdentityCertificate({runtimeSha='a'.repeat(40)}={}){
  const githubSha='a'.repeat(40);
  const convergence=createRsiSourceIdentityConvergenceEvidence({
    evidence_id:'phase36.source.identity.1',
    github_source_sha:githubSha,
    db_authority_baseline_sha:githubSha,
    runtime_target_git_sha:runtimeSha,
    github_ref:'refs/heads/main',
    db_authority_key:'METAENGINE_DEVOS',
    runtime_client_id:'phase36-runtime-client',
    db_alignment_epoch:87,
    github_readback_digest:d('8'),
    db_authority_readback_digest:d('9'),
    runtime_readback_digest:d('a'),
    observed_at:'2026-09-19T16:00:00Z',
    external_github_reader:true,
    external_db_reader:true,
    external_runtime_reader:true,
    authored_by_candidate:false,
  });
  return createRsiFreshSourceIdentityConvergenceCertificate({
    certificate_id:'phase36.source.freshness.1',
    convergence_evidence:convergence,
    github_readback:{source_kind:'GITHUB_API_MAIN_REF',repository:'PatrickFrome/Compute',ref:'refs/heads/main',head_sha:githubSha,readback_digest:d('8'),read_at:'2026-09-19T16:00:10Z',authored_by_candidate:false},
    db_authority_readback:{source_kind:'SUPABASE_ROADMAP_AUTHORITY_ROW',project_ref:'xpeibufgzjknrhbhpffp',authority_key:'METAENGINE_DEVOS',baseline_sha:githubSha,alignment_epoch:87,readback_digest:d('9'),read_at:'2026-09-19T16:00:15Z',authored_by_candidate:false},
    runtime_readback:{source_kind:'DURABLE_RUNTIME_STATE_ROW',project_ref:'xpeibufgzjknrhbhpffp',client_id:'phase36-runtime-client',process_incarnation_id:'phase36-process-incarnation',target_git_sha:runtimeSha,last_seen_at:'2026-09-19T16:00:18Z',readback_digest:d('a'),read_at:'2026-09-19T16:00:20Z',authored_by_candidate:false},
    evaluated_at:'2026-09-19T16:00:25Z',
    authored_by_candidate:false,
  });
}

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
  const preview=createRsiSkillExposureReleasePreview({
    library,
    current_governance:currentGovernance,
    next_governance:nextGovernance,
    skill_digest:capsule.skill_digest,
    external_governance_owner:true,
    authored_by_candidate:false,
  });
  assert.equal(verifyRsiSkillExposureReleasePreview(preview,{
    library,current_governance:currentGovernance,next_governance:nextGovernance,
    skill_digest:capsule.skill_digest,
  }).preview_digest,preview.preview_digest);
  const reviewCore={
    schema:'metaengine.rsi.dormant-skill-retrieval-review.v1',version:1,
    state:'ELIGIBLE_FOR_EXTERNAL_RETRIEVAL_EXPOSURE_ACTIVATION_REVIEW',
    library_digest:library.library_digest,governance_digest:currentGovernance.governance_digest,
    skill_digest:capsule.skill_digest,review_is_eligibility_evidence_only:true,
    admission_exposure_hold_verified:true,bounded_exploration_capacity_available:true,
    retrieval_exposure_changed:false,skill_activation_performed:false,
    lifecycle_mutation_performed:false,governance_mutation_performed:false,
    execution_authority:false,browser_authority:false,task_authority:false,production_mutation_authority:false,
    promotion_authority:false,self_update_authority:false,scheduler_authority:false,signing_authority:false,
    direct_tool_execution_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  const dormantRetrievalReview=Object.freeze({...reviewCore,retrieval_review_digest:digest(reviewCore)});
  return {capsule,library,currentGovernance,nextGovernance,preview,dormantRetrievalReview};
}

function args(fx,overrides={}){
  return {
    certificate_id:'phase36.exposure.certificate.1',
    library:fx.library,
    current_governance:fx.currentGovernance,
    next_governance:fx.nextGovernance,
    release_preview:fx.preview,
    dormant_retrieval_review:fx.dormantRetrievalReview,
    fresh_source_identity_certificate:freshSourceIdentityCertificate(),
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
  assert.equal(cert.dormant_retrieval_review_digest,fx.dormantRetrievalReview.retrieval_review_digest);
  assert.equal(cert.fresh_dormant_retrieval_review_required,true);
  assert.equal(cert.fresh_source_identity_required,true);
  assert.equal(cert.source_identity_drift_blocks_release,true);
  assert.equal(cert.runtime_process_incarnation_bound,true);
  assert.match(cert.fresh_source_identity_certificate_digest,/^sha256:[0-9a-f]{64}$/);
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

test('Phase36 certificate rejects stale or drifted source identity even when shadow evidence passes',()=>{
  const fx=fixture();
  const drifted=freshSourceIdentityCertificate({runtimeSha:'b'.repeat(40)});
  assert.equal(drifted.fresh_source_identity_converged,false);
  assert.throws(()=>createRsiSkillExposureReleaseCertificate(args(fx,{
    fresh_source_identity_certificate:drifted,
  })),/fresh_source_identity_required/);

  const valid=freshSourceIdentityCertificate();
  const stale=createRsiFreshSourceIdentityConvergenceCertificate({
    certificate_id:'phase36.source.freshness.stale',
    convergence_evidence:valid.convergence_evidence,
    github_readback:{...valid.readbacks.github,read_at:'2026-09-19T15:58:00Z'},
    db_authority_readback:valid.readbacks.db_authority,
    runtime_readback:valid.readbacks.runtime,
    evaluated_at:'2026-09-19T16:00:25Z',
    authored_by_candidate:false,
  });
  assert.equal(stale.fresh_source_identity_converged,false);
  assert.throws(()=>createRsiSkillExposureReleaseCertificate(args(fx,{
    fresh_source_identity_certificate:stale,
  })),/fresh_source_identity_required/);
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

test('Phase36 preview is bound to the exact next governance, not an opaque next digest',()=>{
  const fx=fixture();
  const forgedNext={...fx.nextGovernance,governance_digest:d('a')};
  assert.throws(()=>createRsiSkillExposureReleasePreview({
    library:fx.library,
    current_governance:fx.currentGovernance,
    next_governance:forgedNext,
    skill_digest:fx.capsule.skill_digest,
    external_governance_owner:true,
    authored_by_candidate:false,
  }),/governance_digest_mismatch/);

  assert.throws(()=>createRsiSkillExposureReleaseCertificate(args(fx,{
    next_governance:fx.currentGovernance,
  })),/target_hold_not_released|exploration_only_required|preview_digest_mismatch/);
});

test('Phase36 certificate rejects stale or non-eligible dormant retrieval review evidence',()=>{
  const fx=fixture();
  assert.throws(()=>createRsiSkillExposureReleaseCertificate(args(fx,{
    dormant_retrieval_review:{...fx.dormantRetrievalReview,state:'KEEP_DORMANT_NEGATIVE_TRANSFER'},
  })),/dormant_retrieval_review_not_eligible/);
  assert.throws(()=>createRsiSkillExposureReleaseCertificate(args(fx,{
    dormant_retrieval_review:{...fx.dormantRetrievalReview,governance_digest:d('f')},
  })),/dormant_retrieval_review_binding_mismatch/);
});

test('Phase36 exposure-release trust root requires external, bounded, exploration-only evidence and grants no effect authority',()=>{
  const root=rsiSkillExposureReleaseTrustRootSnapshot();
  assert.equal(root.exact_current_library_required,true);
  assert.equal(root.exact_current_governance_required,true);
  assert.equal(root.exact_next_governance_required,true);
  assert.equal(root.exact_next_governance_preview_required,true);
  assert.equal(root.held_dormant_skill_required,true);
  assert.equal(root.fresh_dormant_retrieval_review_required,true);
  assert.equal(root.retrieval_review_can_authorize_release,false);
  assert.equal(root.fresh_source_identity_required,true);
  assert.equal(root.source_identity_drift_blocks_release,true);
  assert.equal(root.runtime_process_incarnation_bound,true);
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
