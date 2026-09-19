import assert from 'node:assert/strict';
import crypto from 'node:crypto';
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
import {
  RsiRuntimeSkillExposureCertificateLedger,
  rsiRuntimeSkillExposureCertificateLedgerTrustRootSnapshot,
} from '../src/rsi-runtime-skill-exposure-certificate-ledger.mjs';
import { RsiRuntimeService } from '../src/rsi-runtime-service.mjs';

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


test('Phase36 zero-effect certificate ledger is durable-before-visible, restart-safe and idempotent',async(t)=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rsi-phase36-cert-ledger-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const statePath=path.join(dir,'certificates.json');
  const fx=fixture();
  const input=args(fx);
  const cert=createRsiSkillExposureReleaseCertificate(input);

  const failed=new RsiRuntimeSkillExposureCertificateLedger({statePath,source_sha:'a'.repeat(40),clock:()=>1_800_000_000_000});
  await failed.init();
  await fs.mkdir(statePath);
  await assert.rejects(()=>failed.add({certificate:cert,verification_args:input}));
  assert.equal(failed.snapshot().record_count,0);
  await fs.rm(statePath,{recursive:true,force:true});

  const ledger=new RsiRuntimeSkillExposureCertificateLedger({statePath,source_sha:'a'.repeat(40),clock:()=>1_800_000_000_000});
  await ledger.init();
  const recorded=await ledger.add({certificate:cert,verification_args:input});
  assert.equal(recorded.state,'RECORDED_ZERO_EFFECT');
  assert.equal(recorded.record.eligible_for_one_attempt_exposure_release,true);
  assert.equal(recorded.record.certificate_can_execute_release,false);
  assert.equal(recorded.record.release_effect_performed,false);
  assert.equal(ledger.snapshot().eligible_record_count,1);
  assert.equal(ledger.snapshot().ledger_can_release_hold,false);

  const restored=new RsiRuntimeSkillExposureCertificateLedger({statePath,source_sha:'a'.repeat(40),clock:()=>1_800_000_000_000});
  await restored.init();
  assert.equal(restored.snapshot().record_count,1);
  assert.equal((await restored.add({certificate:cert,verification_args:input})).state,'IDEMPOTENT');
});

test('Phase36 zero-effect certificate ledger retains rejected evidence and rejects self-rehashed authority widening',async(t)=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rsi-phase36-cert-tamper-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const statePath=path.join(dir,'certificates.json');
  const fx=fixture();
  const rejectedInput=args(fx,{certificate_id:'phase36.exposure.certificate.rejected',negative_transfer_clear:false});
  const rejected=createRsiSkillExposureReleaseCertificate(rejectedInput);
  const ledger=new RsiRuntimeSkillExposureCertificateLedger({statePath,source_sha:'a'.repeat(40)});
  await ledger.init();
  await ledger.add({certificate:rejected,verification_args:rejectedInput});
  assert.equal(ledger.snapshot().rejected_record_count,1);

  const raw=JSON.parse(await fs.readFile(statePath,'utf8'));
  raw.records[0].certificate.execution_authority=true;
  const certCore=structuredClone(raw.records[0].certificate);delete certCore.certificate_digest;
  raw.records[0].certificate.certificate_digest=digest(certCore);
  raw.records[0].certificate_digest=raw.records[0].certificate.certificate_digest;
  const recordCore=structuredClone(raw.records[0]);delete recordCore.record_digest;
  raw.records[0].record_digest=digest(recordCore);
  const stateCore=structuredClone(raw);delete stateCore.state_digest;
  raw.state_digest=digest(stateCore);
  await fs.writeFile(statePath,`${JSON.stringify(raw)}\n`,'utf8');

  const restored=new RsiRuntimeSkillExposureCertificateLedger({statePath,source_sha:'a'.repeat(40)});
  await assert.rejects(()=>restored.init(),/certificate_execution_authority_invalid/);
});

test('Phase36 runtime records verified certificate evidence without releasing hold or gaining effect authority',async(t)=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rsi-phase36-runtime-cert-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const runtime=new RsiRuntimeService({
    source_sha:'a'.repeat(40),
    ledgerPath:path.join(dir,'runtime.jsonl'),
    clock:()=>1_800_000_000_000,
  });
  await runtime.start();
  const fx=fixture();
  const input=args(fx);
  const cert=createRsiSkillExposureReleaseCertificate(input);
  const recorded=await runtime.recordSkillExposureReleaseCertificate({certificate:cert,verification_args:input});
  assert.equal(recorded.state,'RECORDED_ZERO_EFFECT');
  const snap=runtime.skillExposureReleaseCertificateLedgerSnapshot();
  assert.equal(snap.record_count,1);
  assert.equal(snap.eligible_record_count,1);
  assert.equal(snap.ledger_can_release_hold,false);
  assert.equal(snap.execution_authority,false);
  assert.equal(runtime.snapshot().runtime_skill_exposure_certificate_ledger.record_count,1);
  assert.equal(runtime.snapshot().candidate_effect_executor_exposed,false);
});

test('Phase36 certificate-ledger trust root keeps persistence separate from release execution',()=>{
  const root=rsiRuntimeSkillExposureCertificateLedgerTrustRootSnapshot();
  assert.equal(root.verified_phase36_certificate_required,true);
  assert.equal(root.durable_before_visible,true);
  assert.equal(root.certificate_is_evidence_not_effect_authority,true);
  assert.equal(root.one_attempt_release_execution_implemented_here,false);
  assert.equal(root.ledger_can_release_hold,false);
  assert.equal(root.ledger_can_change_retrieval_exposure,false);
  assert.equal(root.ledger_can_activate_skill,false);
  assert.equal(root.execution_authority,false);
  assert.equal(root.browser_authority,false);
  assert.equal(root.authority_effect,false);
});
