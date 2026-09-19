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

const sha=(char)=>char.repeat(40);
const dg=(label)=>`sha256:${crypto.createHash('sha256').update(label,'utf8').digest('hex')}`;

function skill(id,source='b',impl='c'){
  const capsule=createRsiSkillCapsule({
    skill_id:id,
    version:1,
    parent_skill_digest:null,
    source_candidate_sha:sha(source),
    role:'ANALYZER',
    input_schema_digest:dg(id+':input'),
    output_schema_digest:dg(id+':output'),
    implementation_digest:dg(id+':'+impl),
    components:[{component_id:id+'.component',artifact_digest:dg(id+':component'),kind:'TYPED_TRANSFORM'}],
    capabilities:['READ_VERIFIED_CONTEXT','ANALYZE_FAILURE_CODES'],
    max_context_tokens:2048,
    max_output_tokens:512,
    max_invocations:2,
    external_builder:true,
    authored_by_candidate:false,
  });
  const evidence=createRsiSkillEvidence({
    capsule,
    hidden_holdout_digest:dg(id+':holdout'),
    evaluator_root_digest:dg(id+':evaluator'),
    unit_test_digest:dg(id+':unit'),
    runtime_feedback_digest:dg(id+':runtime'),
    attempt_count:12,
    success_count:11,
    hard_invariants_pass:true,
    verified_for_library:true,
    evidence_refs:['VERIFY_'+id],
    external_evaluator:true,
    authored_by_candidate:false,
  });
  return {capsule,evidence};
}

function library(entries){
  return createRsiVerifiedSkillLibrary({
    library_id:'rsi.skill.library.phase36.certificate',
    entries,
    external_library_owner:true,
    authored_by_candidate:false,
  });
}

function lifecycle(lib,skillCapsule,{seq=1,label='shadow'}={}){
  return createRsiSkillLifecycleEvidence({
    library:lib,
    evidence_id:`phase36.${label}.${seq}`,
    skill_digest:skillCapsule.skill_digest,
    window_seq:seq,
    generation_start:seq,
    generation_end:seq,
    invocation_count:1,
    helpful_count:1,
    harmful_count:0,
    neutral_count:0,
    insufficient_evidence_count:0,
    router_engagement_count:1,
    false_positive_injection_count:0,
    hard_invariant_violation_count:0,
    measured_net_delta:0.2,
    authoring_prior:'VERIFIED_DIRECT_SKILL',
    authoring_provenance_digest:dg(`phase36:provenance:${label}:${seq}`),
    evidence_refs:[`PHASE36_SHADOW_${label}_${seq}`],
    external_evaluator:true,
    authored_by_candidate:false,
  });
}

function fixture({windows=1}={}){
  const first=skill('skill.phase36.first','b','c');
  const target=skill('skill.phase36.target','c','d');
  const lib=library([first,target]);
  const lifecycleEvidence=Array.from({length:windows},(_,index)=>lifecycle(lib,target.capsule,{seq:index+1,label:`w${windows}`}));
  const current=createRsiSkillLibraryGovernance({
    governance_id:`governance.phase36.current.w${windows}`,
    library:lib,
    lifecycle_evidence:lifecycleEvidence,
    admission_exposure_hold_skill_digests:[target.capsule.skill_digest],
    max_active_skills:4,
    exploration_slots:2,
    external_library_owner:true,
    authored_by_candidate:false,
  });
  const next=createRsiSkillLibraryGovernance({
    governance_id:`governance.phase36.next.w${windows}`,
    library:lib,
    lifecycle_evidence:lifecycleEvidence,
    admission_exposure_hold_skill_digests:[],
    max_active_skills:4,
    exploration_slots:2,
    external_library_owner:true,
    authored_by_candidate:false,
  });
  return {first,target,lib,lifecycleEvidence,current,next};
}

function certificateArgs(fx,preview,{label='ok',overrides={}}={}){
  return {
    certificate_id:`phase36.exposure.certificate.${label}`,
    library:fx.lib,
    current_governance:fx.current,
    next_governance:fx.next,
    release_preview:preview,
    skill_digest:fx.target.capsule.skill_digest,
    routing_context_manifest_digest:dg(label+':routing-context'),
    retrieval_profile_digest:dg(label+':retrieval-profile'),
    shadow_routing_manifest_digest:dg(label+':shadow-routing'),
    no_skill_ablation_receipt_digest:dg(label+':no-skill-ablation'),
    coalition_ablation_receipt_digest:dg(label+':coalition-ablation'),
    memory_poisoning_scan_digest:dg(label+':memory-poisoning'),
    source_grounding_receipt_digest:dg(label+':source-grounding'),
    bounded_canary_policy_digest:dg(label+':canary-policy'),
    bounded_canary_result_digest:dg(label+':canary-result'),
    negative_transfer_memory_digest:dg(label+':negative-transfer'),
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
    external_governance_owner_identity_digest:dg(label+':governance-owner'),
    external_shadow_evaluator_identity_digest:dg(label+':shadow-evaluator'),
    external_security_reviewer_identity_digest:dg(label+':security-reviewer'),
    external_canary_evaluator_identity_digest:dg(label+':canary-evaluator'),
    external_governance_owner:true,
    external_shadow_evaluator:true,
    external_security_reviewer:true,
    external_canary_evaluator:true,
    authored_by_candidate:false,
    ...overrides,
  };
}

test('Phase36 preview proves exactly one held skill can move only to bounded exploration',()=>{
  const fx=fixture({windows:1});
  const currentRow=fx.current.entries.find(row=>row.skill_digest===fx.target.capsule.skill_digest);
  const nextRow=fx.next.entries.find(row=>row.skill_digest===fx.target.capsule.skill_digest);
  assert.equal(currentRow.state,'DORMANT_CAP');
  assert.equal(currentRow.active_for_composition,false);
  assert.equal(currentRow.admission_exposure_hold,true);
  assert.equal(nextRow.state,'EXPLORATION_ACTIVE');
  assert.equal(nextRow.active_for_composition,true);

  const preview=createRsiSkillExposureReleasePreview({
    library:fx.lib,
    current_governance:fx.current,
    next_governance:fx.next,
    skill_digest:fx.target.capsule.skill_digest,
    external_governance_owner:true,
    authored_by_candidate:false,
  });
  assert.equal(preview.current_state,'DORMANT_CAP');
  assert.equal(preview.next_state,'EXPLORATION_ACTIVE');
  assert.equal(preview.hold_count_delta,-1);
  assert.equal(preview.active_count_delta,1);
  assert.equal(preview.only_target_routing_state_changed,true);
  assert.equal(preview.preview_only,true);
  assert.equal(preview.exposure_effect_performed,false);
  assert.equal(preview.release_authorized,false);
  assert.equal(preview.browser_authority,false);
  assert.equal(verifyRsiSkillExposureReleasePreview(preview,{
    library:fx.lib,current_governance:fx.current,next_governance:fx.next,
  }).preview_digest,preview.preview_digest);
});

test('Phase36 certificate requires shadow, ablation, poisoning, grounding and read-only canary evidence',()=>{
  const fx=fixture({windows:1});
  const preview=createRsiSkillExposureReleasePreview({
    library:fx.lib,current_governance:fx.current,next_governance:fx.next,
    skill_digest:fx.target.capsule.skill_digest,
    external_governance_owner:true,authored_by_candidate:false,
  });
  const args=certificateArgs(fx,preview);
  const certificate=createRsiSkillExposureReleaseCertificate(args);
  assert.equal(certificate.state,'ELIGIBLE_FOR_ONE_ATTEMPT_EXPOSURE_RELEASE');
  assert.equal(certificate.eligible_for_one_attempt_exposure_release,true);
  assert.equal(certificate.release_mode,'EXPLORATION_ACTIVE_ONLY');
  assert.equal(certificate.blockers.length,0);
  assert.equal(certificate.exposure_effect_performed,false);
  assert.equal(certificate.release_token,null);
  assert.equal(certificate.browser_authority,false);
  assert.equal(certificate.task_authority,false);
  assert.equal(certificate.execution_authority,false);
  assert.equal(certificate.promotion_authority,false);
  assert.equal(verifyRsiSkillExposureReleaseCertificate(certificate,args).certificate_digest,certificate.certificate_digest);

  for(const [field,blocker] of [
    ['memory_poisoning_scan_pass','MEMORY_POISONING_RISK'],
    ['source_grounding_pass','SOURCE_GROUNDING_FAILURE'],
    ['negative_transfer_clear','NEGATIVE_TRANSFER_PRESENT'],
    ['no_skill_ablation_pass','NO_SKILL_ABLATION_FAILURE'],
    ['coalition_ablation_pass','COALITION_ABLATION_FAILURE'],
    ['bounded_canary_pass','BOUNDED_CANARY_FAILURE'],
  ]){
    const rejected=createRsiSkillExposureReleaseCertificate(certificateArgs(fx,preview,{
      label:'reject-'+field,
      overrides:{[field]:false},
    }));
    assert.equal(rejected.state,'REJECTED_EXPOSURE_RELEASE');
    assert.ok(rejected.blockers.includes(blocker));
    assert.equal(rejected.eligible_for_one_attempt_exposure_release,false);
  }
});

test('Phase36 certificate fails closed on reviewer aliasing and non-independent evidence roots',()=>{
  const fx=fixture({windows:1});
  const preview=createRsiSkillExposureReleasePreview({
    library:fx.lib,current_governance:fx.current,next_governance:fx.next,
    skill_digest:fx.target.capsule.skill_digest,
    external_governance_owner:true,authored_by_candidate:false,
  });
  assert.throws(()=>createRsiSkillExposureReleaseCertificate(certificateArgs(fx,preview,{
    label:'reviewer-alias',
    overrides:{external_security_reviewer_identity_digest:dg('reviewer-alias:governance-owner')},
  })),/separation_of_duties_required/);

  const repeated=dg('evidence-root-reused');
  assert.throws(()=>createRsiSkillExposureReleaseCertificate(certificateArgs(fx,preview,{
    label:'evidence-alias',
    overrides:{
      routing_context_manifest_digest:repeated,
      retrieval_profile_digest:repeated,
    },
  })),/independent_evidence_roots_required/);
});

test('Phase36 preview rejects hold removal that would jump directly to ACTIVE',()=>{
  const fx=fixture({windows:4});
  const currentRow=fx.current.entries.find(row=>row.skill_digest===fx.target.capsule.skill_digest);
  const nextRow=fx.next.entries.find(row=>row.skill_digest===fx.target.capsule.skill_digest);
  assert.equal(currentRow.state,'DORMANT_CAP');
  assert.equal(nextRow.state,'ACTIVE');
  assert.throws(()=>createRsiSkillExposureReleasePreview({
    library:fx.lib,
    current_governance:fx.current,
    next_governance:fx.next,
    skill_digest:fx.target.capsule.skill_digest,
    external_governance_owner:true,
    authored_by_candidate:false,
  }),/exploration_only_required/);
});

test('Phase36 trust root is certificate-only and cannot release the runtime hold',()=>{
  const root=rsiSkillExposureReleaseTrustRootSnapshot();
  assert.equal(root.exact_current_library_required,true);
  assert.equal(root.exact_current_governance_required,true);
  assert.equal(root.exact_next_governance_preview_required,true);
  assert.equal(root.held_dormant_skill_required,true);
  assert.equal(root.exploration_only_release,true);
  assert.equal(root.minimum_shadow_context_count,4);
  assert.equal(root.no_skill_ablation_required,true);
  assert.equal(root.coalition_ablation_required,true);
  assert.equal(root.negative_transfer_clear_required,true);
  assert.equal(root.memory_poisoning_scan_required,true);
  assert.equal(root.source_grounding_required,true);
  assert.equal(root.read_only_shadow_canary_required,true);
  assert.equal(root.reviewer_separation_of_duties_required,true);
  assert.equal(root.automatic_full_activation_allowed,false);
  assert.equal(root.certificate_performs_exposure_effect,false);
  assert.equal(root.runtime_hold_release_implemented,false);
  assert.equal(root.one_attempt_release_required,true);
  assert.equal(root.ambiguous_release_retry_allowed,false);
  assert.equal(root.browser_authority,false);
  assert.equal(root.task_authority,false);
  assert.equal(root.execution_authority,false);
  assert.equal(root.promotion_authority,false);
  assert.equal(root.authority_effect,false);
});
