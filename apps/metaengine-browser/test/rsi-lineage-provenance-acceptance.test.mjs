import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import {
  createRsiSkillCapsule,
  createRsiSkillEvidence,
  createRsiVerifiedSkillLibrary,
} from '../src/rsi-verified-skill-library.mjs';
import {
  createRsiLineageBuildReceipt,
  createRsiLineageStructuralProvenance,
  rsiLineageComponentRootForCapsule,
} from '../src/rsi-lineage-structural-provenance.mjs';
import { createRsiGithubAttestationVerificationReceipt } from '../src/rsi-github-attestation-verification-receipt.mjs';
import {
  createRsiLineageProvenanceAcceptance,
  verifyRsiLineageProvenanceAcceptance,
  rsiLineageProvenanceAcceptanceTrustRootSnapshot,
} from '../src/rsi-lineage-provenance-acceptance.mjs';

const SOURCE='a'.repeat(40);
function d(label){return `sha256:${crypto.createHash('sha256').update(String(label)).digest('hex')}`;}

function fixture(){
  const skill=createRsiSkillCapsule({
    skill_id:'skill.provenance.acceptance',
    version:1,
    parent_skill_digest:null,
    source_candidate_sha:SOURCE,
    role:'ANALYZER',
    input_schema_digest:d('input'),
    output_schema_digest:d('output'),
    implementation_digest:d('implementation'),
    components:[{component_id:'skill.provenance.acceptance.component',artifact_digest:d('component'),kind:'TYPED_TRANSFORM'}],
    capabilities:['READ_VERIFIED_CONTEXT','ANALYZE_FAILURE_CODES'],
    max_context_tokens:2048,max_output_tokens:512,max_invocations:2,
    external_builder:true,authored_by_candidate:false,
  });
  const evidence=createRsiSkillEvidence({
    capsule:skill,
    hidden_holdout_digest:d('holdout'),
    evaluator_root_digest:d('evaluator'),
    unit_test_digest:d('unit'),
    runtime_feedback_digest:d('runtime'),
    attempt_count:4,success_count:4,hard_invariants_pass:true,verified_for_library:true,
    evidence_refs:['PROVENANCE_ACCEPTANCE_FIXTURE'],
    external_evaluator:true,authored_by_candidate:false,
  });
  const library=createRsiVerifiedSkillLibrary({
    library_id:'rsi.skill.library.provenance.acceptance',
    entries:[{capsule:skill,evidence}],
    external_library_owner:true,authored_by_candidate:false,
  });
  const builder=d('trusted-builder');
  const recipe=d('trusted-recipe');
  const materials=d('trusted-materials');
  const receipt=createRsiLineageBuildReceipt({
    receipt_id:'lineage.build.acceptance',
    subject_skill_digest:skill.skill_digest,
    source_candidate_sha:skill.source_candidate_sha,
    implementation_digest:skill.implementation_digest,
    component_root_digest:rsiLineageComponentRootForCapsule(skill),
    parent_material_skill_digest:null,
    material_manifest_digest:materials,
    product_manifest_digest:d('products'),
    build_recipe_digest:recipe,
    builder_identity_digest:builder,
    external_builder:true,authored_by_candidate:false,
  });
  const structural=createRsiLineageStructuralProvenance({
    attestation_id:'lineage.structural.acceptance',
    library,skill_digest:skill.skill_digest,build_receipt:receipt,
    expected_builder_identity_digest:builder,
    expected_build_recipe_digest:recipe,
    expected_material_manifest_digest:materials,
    provenance_reviewer_identity_digest:d('provenance-reviewer'),
    effect_executor_identity_digest:d('effect-executor'),
    external_provenance_owner:true,authored_by_candidate:false,
  });
  return {skill,library,structural};
}

function githubReceipt(structural,overrides={}){
  return createRsiGithubAttestationVerificationReceipt({
    verification_id:'rsi.github.attestation.acceptance',
    subject_digest:d('attested-provenance-bundle-file'),
    provenance_bundle_digest:d('provenance-bundle'),
    structural_attestation_digest:structural.attestation_digest,
    repository:'PatrickFrome/Compute',
    signer_workflow:'.github/workflows/rsi-lineage-provenance-attestation.yml',
    signer_digest:SOURCE,
    source_ref:'refs/heads/main',
    source_digest:SOURCE,
    cert_oidc_issuer:'https://token.actions.githubusercontent.com',
    predicate_type:'https://github.com/PatrickFrome/Compute/attestations/rsi-lineage-provenance/v1',
    trusted_root_digest:d('fresh-trusted-root'),
    verification_json_digest:d('verification-json'),
    verification_result_count:1,
    gh_attestation_verify_executed:true,
    signature_verified:true,
    signer_identity_verified:true,
    subject_digest_verified:true,
    trusted_root_verified:true,
    deny_self_hosted_runners:true,
    external_attestation_verifier:true,
    authored_by_candidate:false,
    ...overrides,
  });
}

test('R9 provenance is PASS only when structural and existing GitHub crypto receipt bind exactly',()=>{
  const fx=fixture();
  const receipt=githubReceipt(fx.structural);
  const row=createRsiLineageProvenanceAcceptance({
    acceptance_id:'lineage.provenance.acceptance.pass',
    library:fx.library,
    skill_digest:fx.skill.skill_digest,
    structural_attestation:fx.structural,
    github_verification_receipt:receipt,
    external_provenance_acceptor:true,
    authored_by_candidate:false,
  });
  assert.equal(row.provenance_integrity_state,'PASS');
  assert.deepEqual(row.blockers,[]);
  assert.equal(row.structural_and_cryptographic_conjunction_required,true);
  assert.equal(row.provenance_does_not_imply_semantic_or_security_acceptance,true);
  assert.equal(row.authority_effect,false);
  assert.equal(verifyRsiLineageProvenanceAcceptance(row,{
    library:fx.library,
    skill_digest:fx.skill.skill_digest,
  }).acceptance_digest,row.acceptance_digest);
});

test('R9 missing cryptographic proof is UNKNOWN rather than CLEAN',()=>{
  const fx=fixture();
  const row=createRsiLineageProvenanceAcceptance({
    acceptance_id:'lineage.provenance.acceptance.missing',
    library:fx.library,
    skill_digest:fx.skill.skill_digest,
    structural_attestation:fx.structural,
    github_verification_receipt:null,
    external_provenance_acceptor:true,
    authored_by_candidate:false,
  });
  assert.equal(row.provenance_integrity_state,'UNKNOWN');
  assert.ok(row.blockers.includes('CRYPTOGRAPHIC_PROVENANCE_VERIFICATION_MISSING'));
});

test('R9 structural failure dominates even when no crypto receipt exists',()=>{
  const fx=fixture();
  const badReceipt={...fx.structural.build_receipt,implementation_digest:d('forged')};
  const badStructural=createRsiLineageStructuralProvenance({
    attestation_id:'lineage.structural.acceptance.fail',
    library:fx.library,
    skill_digest:fx.skill.skill_digest,
    build_receipt:{
      ...badReceipt,
      receipt_digest:createRsiLineageBuildReceipt({
        receipt_id:badReceipt.receipt_id,
        subject_skill_digest:badReceipt.subject_skill_digest,
        source_candidate_sha:badReceipt.source_candidate_sha,
        implementation_digest:d('forged'),
        component_root_digest:badReceipt.component_root_digest,
        parent_material_skill_digest:badReceipt.parent_material_skill_digest,
        material_manifest_digest:badReceipt.material_manifest_digest,
        product_manifest_digest:badReceipt.product_manifest_digest,
        build_recipe_digest:badReceipt.build_recipe_digest,
        builder_identity_digest:badReceipt.builder_identity_digest,
        external_builder:true,authored_by_candidate:false,
      }).receipt_digest,
    },
    expected_builder_identity_digest:fx.structural.expected_builder_identity_digest,
    expected_build_recipe_digest:fx.structural.expected_build_recipe_digest,
    expected_material_manifest_digest:fx.structural.expected_material_manifest_digest,
    provenance_reviewer_identity_digest:d('other-provenance-reviewer'),
    effect_executor_identity_digest:d('other-effect-executor'),
    external_provenance_owner:true,authored_by_candidate:false,
  });
  const row=createRsiLineageProvenanceAcceptance({
    acceptance_id:'lineage.provenance.acceptance.fail',
    library:fx.library,
    skill_digest:fx.skill.skill_digest,
    structural_attestation:badStructural,
    github_verification_receipt:null,
    external_provenance_acceptor:true,
    authored_by_candidate:false,
  });
  assert.equal(row.provenance_integrity_state,'FAIL');
  assert.ok(row.blockers.includes('STRUCTURAL_PROVENANCE_FAILED'));
});

test('R9 mismatched cryptographic-to-structural binding is FAIL',()=>{
  const fx=fixture();
  const receipt=githubReceipt(fx.structural,{structural_attestation_digest:d('other-structural')});
  const row=createRsiLineageProvenanceAcceptance({
    acceptance_id:'lineage.provenance.acceptance.binding-fail',
    library:fx.library,
    skill_digest:fx.skill.skill_digest,
    structural_attestation:fx.structural,
    github_verification_receipt:receipt,
    external_provenance_acceptor:true,
    authored_by_candidate:false,
  });
  assert.equal(row.provenance_integrity_state,'FAIL');
  assert.ok(row.blockers.includes('CRYPTOGRAPHIC_STRUCTURAL_ATTESTATION_BINDING_MISMATCH'));
});

test('R9 provenance acceptance trust root creates no signer and grants no effect authority',()=>{
  const root=rsiLineageProvenanceAcceptanceTrustRootSnapshot();
  assert.equal(root.structural_and_cryptographic_conjunction_required,true);
  assert.equal(root.existing_github_attestation_verification_required,true);
  assert.equal(root.missing_crypto_proof_maps_to_unknown,true);
  assert.equal(root.second_signing_authority_created,false);
  assert.equal(root.acceptance_is_effect_authority,false);
  assert.equal(root.signing_authority,false);
  assert.equal(root.authority_effect,false);
});
