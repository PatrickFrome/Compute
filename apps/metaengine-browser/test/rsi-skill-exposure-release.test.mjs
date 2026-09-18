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
  createRsiSkillExposureReleaseCertificate,
  verifyRsiSkillExposureReleaseCertificate,
  rsiSkillExposureReleaseTrustRootSnapshot,
} from '../src/rsi-skill-exposure-release.mjs';
import { RsiRuntimeService } from '../src/rsi-runtime-service.mjs';

const SOURCE='a'.repeat(40);
const d=(c)=>`sha256:${c.repeat(64)}`;

function verifiedSkill({id,sourceChar,implChar}){
  const capsule=createRsiSkillCapsule({
    skill_id:id,version:1,parent_skill_digest:null,source_candidate_sha:sourceChar.repeat(40),
    role:'ANALYZER',input_schema_digest:d('1'),output_schema_digest:d('2'),
    implementation_digest:d(implChar),
    components:[{component_id:id+'.component',artifact_digest:d('f'),kind:'TYPED_TRANSFORM'}],
    capabilities:['READ_VERIFIED_CONTEXT','ANALYZE_FAILURE_CODES'],
    max_context_tokens:2048,max_output_tokens:512,max_invocations:2,
    external_builder:true,authored_by_candidate:false,
  });
  const evidence=createRsiSkillEvidence({
    capsule,hidden_holdout_digest:d('3'),evaluator_root_digest:d('4'),unit_test_digest:d('5'),
    runtime_feedback_digest:d('6'),attempt_count:12,success_count:11,hard_invariants_pass:true,
    verified_for_library:true,evidence_refs:['VERIFY_'+id],external_evaluator:true,authored_by_candidate:false,
  });
  return {capsule,evidence};
}

function library(entries,id='runtime.skill.library.phase36'){
  return createRsiVerifiedSkillLibrary({library_id:id,entries,external_library_owner:true,authored_by_candidate:false});
}

function certificateArgs({library,currentGovernance,preview,skillDigest,label='phase36',overrides={}}){
  return {
    certificate_id:'phase36.exposure.certificate.'+label,
    library,current_governance:currentGovernance,release_preview:preview,skill_digest:skillDigest,
    routing_context_manifest_digest:d('7'),retrieval_profile_digest:d('8'),shadow_routing_manifest_digest:d('9'),
    no_skill_ablation_receipt_digest:d('a'),coalition_ablation_receipt_digest:d('b'),
    memory_poisoning_scan_digest:d('c'),source_grounding_receipt_digest:d('d'),
    bounded_canary_policy_digest:d('e'),bounded_canary_result_digest:d('0'),negative_transfer_memory_digest:d('f'),
    shadow_context_count:4,shadow_success_count:4,shadow_hard_invariants_pass:true,
    no_skill_ablation_pass:true,coalition_ablation_pass:true,negative_transfer_clear:true,
    memory_poisoning_scan_pass:true,source_grounding_pass:true,bounded_canary_pass:true,
    canary_effect_mode:'READ_ONLY_SHADOW',
    external_governance_owner_identity_digest:d('1'),
    external_shadow_evaluator_identity_digest:d('2'),
    external_security_reviewer_identity_digest:d('3'),
    external_canary_evaluator_identity_digest:d('4'),
    external_governance_owner:true,external_shadow_evaluator:true,external_security_reviewer:true,
    external_canary_evaluator:true,authored_by_candidate:false,
    ...overrides,
  };
}

async function heldRuntime(t,label='phase36'){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rsi-phase36-exposure-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const first=verifiedSkill({id:'skill.'+label+'.first',sourceChar:'b',implChar:'c'});
  const second=verifiedSkill({id:'skill.'+label+'.second',sourceChar:'c',implChar:'d'});
  const runtime=new RsiRuntimeService({source_sha:SOURCE,ledgerPath:path.join(dir,'runtime.jsonl'),clock:()=>1_800_000_000_000});
  await runtime.start();
  const initial=library([first],label+'.library');
  await runtime.adoptVerifiedSkillLibrary({library:initial,external_library_owner:true,authored_by_candidate:false});
  const appended=library([first,second],label+'.library');
  await runtime.adoptVerifiedSkillLibrary({
    library:appended,admission_exposure_hold_skill_digests:[second.capsule.skill_digest],
    external_library_owner:true,authored_by_candidate:false,
  });
  return {dir,runtime,first,second,appended};
}

test('Phase36 release certificate requires independent shadow, ablation, poisoning, grounding and read-only canary evidence',async(t)=>{
  const fx=await heldRuntime(t,'certificate');
  const readback=fx.runtime.verifiedSkillStateReadback();
  const preview=fx.runtime.previewVerifiedSkillExposureRelease({skill_digest:fx.second.capsule.skill_digest}).preview;
  const args=certificateArgs({library:readback.library,currentGovernance:readback.governance,preview,skillDigest:fx.second.capsule.skill_digest});
  const cert=createRsiSkillExposureReleaseCertificate(args);
  assert.equal(cert.state,'ELIGIBLE_FOR_ONE_ATTEMPT_EXPOSURE_RELEASE');
  assert.equal(cert.eligible_for_one_attempt_exposure_release,true);
  assert.equal(cert.release_mode,'EXPLORATION_ACTIVE_ONLY');
  assert.equal(cert.blockers.length,0);
  assert.equal(verifyRsiSkillExposureReleaseCertificate(cert,args).certificate_digest,cert.certificate_digest);
  assert.equal(cert.browser_authority,false);
  assert.equal(cert.execution_authority,false);
  assert.equal(cert.automatic_retry_allowed,false);

  for(const [field,blocker] of [
    ['memory_poisoning_scan_pass','MEMORY_POISONING_RISK'],
    ['source_grounding_pass','SOURCE_GROUNDING_FAILURE'],
    ['negative_transfer_clear','NEGATIVE_TRANSFER_PRESENT'],
    ['coalition_ablation_pass','COALITION_ABLATION_FAILURE'],
    ['bounded_canary_pass','BOUNDED_CANARY_FAILURE'],
  ]){
    const rejected=createRsiSkillExposureReleaseCertificate(certificateArgs({
      library:readback.library,currentGovernance:readback.governance,preview,
      skillDigest:fx.second.capsule.skill_digest,label:'reject-'+field,overrides:{[field]:false},
    }));
    assert.equal(rejected.state,'REJECTED_EXPOSURE_RELEASE');
    assert.ok(rejected.blockers.includes(blocker));
  }
});

test('Phase36 runtime releases exactly one held skill into exploration without full activation authority',async(t)=>{
  const fx=await heldRuntime(t,'runtime');
  const before=fx.runtime.verifiedSkillStateReadback();
  const previewEnvelope=fx.runtime.previewVerifiedSkillExposureRelease({skill_digest:fx.second.capsule.skill_digest});
  const preview=previewEnvelope.preview;
  assert.equal(preview.current_state,'DORMANT_CAP');
  assert.equal(preview.next_state,'EXPLORATION_ACTIVE');
  assert.equal(preview.only_target_state_changed,true);
  assert.equal(preview.active_count_delta,1);
  assert.equal(preview.hold_count_delta,-1);

  const args=certificateArgs({
    library:before.library,currentGovernance:before.governance,preview,
    skillDigest:fx.second.capsule.skill_digest,label:'runtime',
  });
  const cert=createRsiSkillExposureReleaseCertificate(args);
  const result=await fx.runtime.applySkillExposureRelease({
    attempt_id:'phase36.exposure.release.runtime.1',
    certificate:cert,
    certificate_args:args,
  });
  assert.equal(result.state,'CONFIRMED');
  assert.equal(result.release_mode,'EXPLORATION_ACTIVE_ONLY');
  assert.equal(result.retrieval_exposure_changed,true);
  assert.equal(result.full_activation_authorized,false);
  assert.equal(result.browser_authority,false);
  assert.equal(result.execution_authority,false);

  const after=fx.runtime.verifiedSkillStateReadback();
  assert.equal(after.admission_exposure_hold_skill_digests.length,0);
  assert.equal(after.governance_digest,preview.next_governance_digest);
  const row=after.governance.entries.find(x=>x.skill_digest===fx.second.capsule.skill_digest);
  assert.equal(row.state,'EXPLORATION_ACTIVE');
  assert.equal(row.active_for_composition,true);
  assert.equal(row.admission_exposure_held,false);
  const active=fx.runtime.createSkillActivationView([fx.second.capsule.skill_digest]);
  assert.equal(active.selected_count,1);
  assert.equal(active.selected[0].governance_state,'EXPLORATION_ACTIVE');
  assert.equal(fx.runtime.snapshot().execution_authority,false);
  assert.equal(fx.runtime.snapshot().promotion_authority,false);

  const duplicate=await fx.runtime.applySkillExposureRelease({
    attempt_id:'phase36.exposure.release.runtime.1',
    certificate:cert,
    certificate_args:args,
  });
  assert.equal(duplicate.state,'ALREADY_RECORDED');
  assert.equal(duplicate.attempt_state,'CONFIRMED');
  assert.equal(duplicate.retrieval_exposure_changed,true);
  assert.equal(fx.runtime.verifiedSkillStateReadback().governance_digest,preview.next_governance_digest);
});

test('Phase36 preview refuses unheld skills and certificate requires reviewer separation of duties',async(t)=>{
  const fx=await heldRuntime(t,'separation');
  assert.throws(()=>fx.runtime.previewVerifiedSkillExposureRelease({skill_digest:fx.first.capsule.skill_digest}),/hold_required/);
  const readback=fx.runtime.verifiedSkillStateReadback();
  const preview=fx.runtime.previewVerifiedSkillExposureRelease({skill_digest:fx.second.capsule.skill_digest}).preview;
  assert.throws(()=>createRsiSkillExposureReleaseCertificate(certificateArgs({
    library:readback.library,currentGovernance:readback.governance,preview,
    skillDigest:fx.second.capsule.skill_digest,label:'same-reviewer',
    overrides:{external_security_reviewer_identity_digest:d('1')},
  })),/separation_of_duties_required/);
});

test('Phase36 trust root allows only externally evidenced exploration release',()=>{
  const root=rsiSkillExposureReleaseTrustRootSnapshot();
  assert.equal(root.exact_current_library_required,true);
  assert.equal(root.exact_current_governance_required,true);
  assert.equal(root.exact_next_governance_preview_required,true);
  assert.equal(root.held_dormant_skill_required,true);
  assert.equal(root.exploration_only_release,true);
  assert.equal(root.only_target_governance_state_may_change,true);
  assert.equal(root.no_skill_ablation_required,true);
  assert.equal(root.coalition_ablation_required,true);
  assert.equal(root.negative_transfer_clear_required,true);
  assert.equal(root.memory_poisoning_scan_required,true);
  assert.equal(root.source_grounding_required,true);
  assert.equal(root.read_only_shadow_canary_required,true);
  assert.equal(root.automatic_full_activation_allowed,false);
  assert.equal(root.one_attempt_release_required,true);
  assert.equal(root.ambiguous_release_retry_allowed,false);
  assert.equal(root.authority_effect,false);
});