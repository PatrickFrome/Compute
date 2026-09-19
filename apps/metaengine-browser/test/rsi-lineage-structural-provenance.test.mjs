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
  verifyRsiLineageStructuralProvenance,
  rsiLineageStructuralProvenanceTrustRootSnapshot,
  rsiLineageComponentRootForCapsule,
} from '../src/rsi-lineage-structural-provenance.mjs';

const SOURCE='a'.repeat(40);
function digest(label){
  return `sha256:${crypto.createHash('sha256').update(String(label),'utf8').digest('hex')}`;
}

function fixture(){
  const parent=createRsiSkillCapsule({
    skill_id:'skill.provenance.parent',
    version:1,
    parent_skill_digest:null,
    source_candidate_sha:SOURCE,
    role:'ANALYZER',
    input_schema_digest:digest('parent-input'),
    output_schema_digest:digest('parent-output'),
    implementation_digest:digest('parent-implementation'),
    components:[{
      component_id:'skill.provenance.parent.component',
      artifact_digest:digest('parent-component'),
      kind:'TYPED_TRANSFORM',
    }],
    capabilities:['READ_VERIFIED_CONTEXT','ANALYZE_FAILURE_CODES'],
    max_context_tokens:2048,
    max_output_tokens:512,
    max_invocations:2,
    external_builder:true,
    authored_by_candidate:false,
  });
  const child=createRsiSkillCapsule({
    skill_id:'skill.provenance.child',
    version:1,
    parent_skill_digest:parent.skill_digest,
    source_candidate_sha:SOURCE,
    role:'ANALYZER',
    input_schema_digest:digest('child-input'),
    output_schema_digest:digest('child-output'),
    implementation_digest:digest('child-implementation'),
    components:[
      {component_id:'skill.provenance.child.component.a',artifact_digest:digest('child-component-a'),kind:'TYPED_TRANSFORM'},
      {component_id:'skill.provenance.child.component.b',artifact_digest:digest('child-component-b'),kind:'PROCEDURAL_RECIPE'},
    ],
    capabilities:['READ_VERIFIED_CONTEXT','ANALYZE_FAILURE_CODES'],
    max_context_tokens:2048,
    max_output_tokens:512,
    max_invocations:2,
    external_builder:true,
    authored_by_candidate:false,
  });
  const evidenceFor=(skill,label)=>createRsiSkillEvidence({
    capsule:skill,
    hidden_holdout_digest:digest(label+'-holdout'),
    evaluator_root_digest:digest(label+'-evaluator'),
    unit_test_digest:digest(label+'-unit'),
    runtime_feedback_digest:digest(label+'-runtime'),
    attempt_count:4,
    success_count:4,
    hard_invariants_pass:true,
    verified_for_library:true,
    evidence_refs:['PROVENANCE_'+label.toUpperCase()],
    external_evaluator:true,
    authored_by_candidate:false,
  });
  const library=createRsiVerifiedSkillLibrary({
    library_id:'rsi.skill.library.provenance.fixture',
    entries:[
      {capsule:parent,evidence:evidenceFor(parent,'parent')},
      {capsule:child,evidence:evidenceFor(child,'child')},
    ],
    external_library_owner:true,
    authored_by_candidate:false,
  });
  return {parent,child,library};
}

function buildReceipt(fx,overrides={}){
  return createRsiLineageBuildReceipt({
    receipt_id:'lineage.build.receipt.child.1',
    subject_skill_digest:fx.child.skill_digest,
    source_candidate_sha:fx.child.source_candidate_sha,
    implementation_digest:fx.child.implementation_digest,
    component_root_digest:rsiLineageComponentRootForCapsule(fx.child),
    parent_material_skill_digest:fx.parent.skill_digest,
    material_manifest_digest:digest('trusted-material-manifest'),
    product_manifest_digest:digest('product-manifest'),
    build_recipe_digest:digest('trusted-build-recipe'),
    builder_identity_digest:digest('trusted-builder'),
    external_builder:true,
    authored_by_candidate:false,
    ...overrides,
  });
}

function attestationArgs(fx,receipt,overrides={}){
  return {
    attestation_id:'lineage.structural.provenance.child.1',
    library:fx.library,
    skill_digest:fx.child.skill_digest,
    build_receipt:receipt,
    expected_builder_identity_digest:digest('trusted-builder'),
    expected_build_recipe_digest:digest('trusted-build-recipe'),
    expected_material_manifest_digest:digest('trusted-material-manifest'),
    provenance_reviewer_identity_digest:digest('provenance-reviewer'),
    effect_executor_identity_digest:digest('effect-executor'),
    external_provenance_owner:true,
    authored_by_candidate:false,
    ...overrides,
  };
}

test('R9 structural provenance derives PASS from exact subject material builder recipe and manifest bindings',()=>{
  const fx=fixture();
  const receipt=buildReceipt(fx);
  const attestation=createRsiLineageStructuralProvenance(attestationArgs(fx,receipt));
  assert.equal(attestation.provenance_integrity_state,'PASS');
  assert.equal(attestation.structurally_verified,true);
  assert.deepEqual(attestation.blockers,[]);
  assert.ok(Object.values(attestation.checks).every(Boolean));
  assert.equal(attestation.cryptographic_signature_verified,false);
  assert.equal(attestation.slsa_or_in_toto_compliance_claimed,false);
  assert.equal(attestation.attestation_is_effect_authority,false);
  assert.equal(attestation.authority_effect,false);

  const verified=verifyRsiLineageStructuralProvenance(attestation,attestationArgs(fx,receipt));
  assert.equal(verified.attestation_digest,attestation.attestation_digest);
});

test('R9 structural provenance mechanically fails a forged implementation or parent material',()=>{
  const fx=fixture();
  const forgedImplementation=createRsiLineageStructuralProvenance(attestationArgs(
    fx,
    buildReceipt(fx,{implementation_digest:digest('forged-implementation')}),
  ));
  assert.equal(forgedImplementation.provenance_integrity_state,'FAIL');
  assert.equal(forgedImplementation.structurally_verified,false);
  assert.ok(forgedImplementation.blockers.includes('IMPLEMENTATION_MATCH'));

  const forgedParent=createRsiLineageStructuralProvenance(attestationArgs(
    fx,
    buildReceipt(fx,{parent_material_skill_digest:digest('wrong-parent')}),
  ));
  assert.equal(forgedParent.provenance_integrity_state,'FAIL');
  assert.ok(forgedParent.blockers.includes('PARENT_MATERIAL_MATCH'));
});

test('R9 structural provenance fails closed on builder recipe and material-manifest drift',()=>{
  const fx=fixture();
  const receipt=buildReceipt(fx);
  for(const [field,value,blocker] of [
    ['expected_builder_identity_digest',digest('other-builder'),'BUILDER_IDENTITY_MATCH'],
    ['expected_build_recipe_digest',digest('other-recipe'),'BUILD_RECIPE_MATCH'],
    ['expected_material_manifest_digest',digest('other-materials'),'MATERIAL_MANIFEST_MATCH'],
  ]){
    const attestation=createRsiLineageStructuralProvenance(attestationArgs(fx,receipt,{[field]:value}));
    assert.equal(attestation.provenance_integrity_state,'FAIL');
    assert.ok(attestation.blockers.includes(blocker));
  }
});

test('R9 provenance reviewer must be separated from trusted builder and effect executor',()=>{
  const fx=fixture();
  const receipt=buildReceipt(fx);
  assert.throws(
    ()=>createRsiLineageStructuralProvenance(attestationArgs(fx,receipt,{
      provenance_reviewer_identity_digest:digest('trusted-builder'),
    })),
    /reviewer_separation_required/,
  );
  assert.throws(
    ()=>createRsiLineageStructuralProvenance(attestationArgs(fx,receipt,{
      provenance_reviewer_identity_digest:digest('effect-executor'),
    })),
    /reviewer_separation_required/,
  );
});

test('R9 structural provenance root explicitly does not overclaim signature or SLSA/in-toto compliance',()=>{
  const root=rsiLineageStructuralProvenanceTrustRootSnapshot();
  assert.equal(root.exact_library_subject_required,true);
  assert.equal(root.exact_source_candidate_required,true);
  assert.equal(root.exact_parent_material_required,true);
  assert.equal(root.external_expected_builder_required,true);
  assert.equal(root.provenance_reviewer_separate_from_builder_and_effect_executor,true);
  assert.equal(root.structural_attestation_is_not_signature_authority,true);
  assert.equal(root.slsa_or_in_toto_compliance_claimed,false);
  assert.equal(root.attestation_is_effect_authority,false);
  assert.equal(root.authority_effect,false);
});
