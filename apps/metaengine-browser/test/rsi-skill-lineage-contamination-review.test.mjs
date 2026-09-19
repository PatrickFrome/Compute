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
import {
  createRsiSkillLineageContaminationReview,
  verifyRsiSkillLineageContaminationReview,
  rsiSkillLineageContaminationReviewTrustRootSnapshot,
} from '../src/rsi-skill-lineage-contamination-review.mjs';

const SOURCE='a'.repeat(40);
const EFFECT_EXECUTOR=digest('effect-executor');

function digest(label){
  return `sha256:${crypto.createHash('sha256').update(String(label),'utf8').digest('hex')}`;
}

function capsule(skillId,parent=null){
  return createRsiSkillCapsule({
    skill_id:skillId,
    version:1,
    parent_skill_digest:parent,
    source_candidate_sha:SOURCE,
    role:'PLAN_TRANSFORM',
    input_schema_digest:digest(skillId+'-input'),
    output_schema_digest:digest(skillId+'-output'),
    implementation_digest:digest(skillId+'-implementation'),
    components:[{
      component_id:skillId+'.component',
      artifact_digest:digest(skillId+'-component'),
      kind:'PROCEDURAL_RECIPE',
    }],
    capabilities:['READ_VERIFIED_CONTEXT','PROPOSE_TYPED_TRANSFORM'],
    max_context_tokens:4096,
    max_output_tokens:1024,
    max_invocations:2,
    deterministic_interface:true,
    external_builder:true,
    authored_by_candidate:false,
  });
}

function evidence(skill,label){
  return createRsiSkillEvidence({
    capsule:skill,
    hidden_holdout_digest:digest(label+'-holdout'),
    evaluator_root_digest:digest(label+'-evaluator'),
    unit_test_digest:digest(label+'-unit'),
    runtime_feedback_digest:digest(label+'-runtime'),
    attempt_count:4,
    success_count:4,
    hard_invariants_pass:true,
    verified_for_library:true,
    evidence_refs:['EVIDENCE_'+label.toUpperCase().replace(/[^A-Z0-9]+/g,'_')],
    external_evaluator:true,
    authored_by_candidate:false,
  });
}

function fixture(){
  const ancestor=capsule('skill.lineage.ancestor');
  const target=capsule('skill.lineage.target',ancestor.skill_digest);
  const descendant=capsule('skill.lineage.descendant',target.skill_digest);
  const library=createRsiVerifiedSkillLibrary({
    library_id:'rsi.skill.library.lineage.deterministic',
    entries:[
      {capsule:ancestor,evidence:evidence(ancestor,'ancestor')},
      {capsule:target,evidence:evidence(target,'target')},
      {capsule:descendant,evidence:evidence(descendant,'descendant')},
    ],
    external_library_owner:true,
    authored_by_candidate:false,
  });
  return {ancestor,target,descendant,library};
}

function provenance(fx,skill,label,{forgeImplementation=false}={}){
  const builder=digest(label+'-trusted-builder');
  const recipe=digest(label+'-trusted-recipe');
  const materials=digest(label+'-trusted-materials');
  const receipt=createRsiLineageBuildReceipt({
    receipt_id:'lineage.build.'+label,
    subject_skill_digest:skill.skill_digest,
    source_candidate_sha:skill.source_candidate_sha,
    implementation_digest:forgeImplementation?digest(label+'-forged-implementation'):skill.implementation_digest,
    component_root_digest:rsiLineageComponentRootForCapsule(skill),
    parent_material_skill_digest:skill.parent_skill_digest,
    material_manifest_digest:materials,
    product_manifest_digest:digest(label+'-products'),
    build_recipe_digest:recipe,
    builder_identity_digest:builder,
    external_builder:true,
    authored_by_candidate:false,
  });
  return createRsiLineageStructuralProvenance({
    attestation_id:'lineage.provenance.'+label,
    library:fx.library,
    skill_digest:skill.skill_digest,
    build_receipt:receipt,
    expected_builder_identity_digest:builder,
    expected_build_recipe_digest:recipe,
    expected_material_manifest_digest:materials,
    provenance_reviewer_identity_digest:digest(label+'-provenance-reviewer'),
    effect_executor_identity_digest:EFFECT_EXECUTOR,
    external_provenance_owner:true,
    authored_by_candidate:false,
  });
}

function finding(fx,skill,label,states={},overrides={}){
  return {
    skill_digest:skill.skill_digest,
    provenance_attestation:provenance(fx,skill,label,{forgeImplementation:states.provenanceFail===true}),
    security_negative_transfer_state:states.security||'PASS',
    semantic_consistency_state:states.semantic||'PASS',
    negative_transfer_receipt_digest:digest(label+'-negative-transfer'),
    semantic_consistency_digest:digest(label+'-semantic-consistency'),
    security_reviewer_identity_digest:digest(label+'-security-reviewer'),
    semantic_reviewer_identity_digest:digest(label+'-semantic-reviewer'),
    ...overrides,
  };
}

function reviewArgs(fx,findings){
  return {
    review_id:'phase36.lineage.review.deterministic',
    source_sha:SOURCE,
    library:fx.library,
    target_skill_digest:fx.target.skill_digest,
    current_governance_digest:digest('current-governance'),
    target_consumer_snapshot_digest:digest('consumer-snapshot'),
    effect_executor_identity_digest:EFFECT_EXECUTOR,
    findings,
    external_review_owner:true,
    authored_by_candidate:false,
  };
}

test('R9 lineage review derives CLEAN only from structural provenance plus PASS security and semantic predicates',()=>{
  const fx=fixture();
  const review=createRsiSkillLineageContaminationReview(reviewArgs(fx,[
    finding(fx,fx.ancestor,'ancestor'),
    finding(fx,fx.target,'target'),
    finding(fx,fx.descendant,'descendant'),
  ]));

  assert.equal(review.state,'CLEAR_FOR_ZERO_EFFECT_EXPOSURE_PRECOMMIT');
  assert.equal(review.eligible_for_exposure_precommit,true);
  assert.equal(review.finding_count,3);
  assert.ok(review.findings.every((row)=>row.status==='CLEAN'));
  assert.ok(review.findings.every((row)=>row.provenance_integrity_state==='PASS'));
  assert.ok(review.findings.every((row)=>row.provenance_state_derived_from_structural_attestation===true));
  assert.equal(review.structural_provenance_attestation_required,true);
  assert.equal(review.candidate_supplied_provenance_state_allowed,false);
  assert.equal(review.candidate_supplied_status_allowed,false);
  assert.equal(review.reviewer_votes_are_not_authority,true);
  assert.equal(review.authority_effect,false);

  const verified=verifyRsiSkillLineageContaminationReview(review,{
    source_sha:SOURCE,
    library:fx.library,
    target_skill_digest:fx.target.skill_digest,
    current_governance_digest:digest('current-governance'),
    effect_executor_identity_digest:EFFECT_EXECUTOR,
  });
  assert.equal(verified.review_digest,review.review_digest);
});

test('R9 lineage review derives CONTAMINATED from a structurally mismatched provenance receipt',()=>{
  const fx=fixture();
  const review=createRsiSkillLineageContaminationReview(reviewArgs(fx,[
    finding(fx,fx.ancestor,'ancestor'),
    finding(fx,fx.target,'target',{provenanceFail:true}),
    finding(fx,fx.descendant,'descendant'),
  ]));
  const target=review.findings.find((row)=>row.skill_digest===fx.target.skill_digest);
  assert.equal(target.provenance_integrity_state,'FAIL');
  assert.equal(target.status,'CONTAMINATED');
  assert.equal(review.eligible_for_exposure_precommit,false);
  assert.ok(review.blockers.includes('LINEAGE_CONTAMINATION_DETECTED'));
});

test('R9 lineage review derives CONTAMINATED and UNKNOWN from security and semantic evidence states',()=>{
  const fx=fixture();
  const contaminated=createRsiSkillLineageContaminationReview(reviewArgs(fx,[
    finding(fx,fx.ancestor,'ancestor'),
    finding(fx,fx.target,'target',{security:'FAIL'}),
    finding(fx,fx.descendant,'descendant'),
  ]));
  assert.equal(contaminated.eligible_for_exposure_precommit,false);
  assert.ok(contaminated.blockers.includes('LINEAGE_CONTAMINATION_DETECTED'));

  const unknown=createRsiSkillLineageContaminationReview(reviewArgs(fx,[
    finding(fx,fx.ancestor,'ancestor'),
    finding(fx,fx.target,'target',{semantic:'UNKNOWN'}),
    finding(fx,fx.descendant,'descendant'),
  ]));
  assert.equal(unknown.eligible_for_exposure_precommit,false);
  assert.ok(unknown.blockers.includes('LINEAGE_CONTAMINATION_UNKNOWN'));
});

test('R9 rejects candidate-supplied final or provenance status and incomplete closure',()=>{
  const fx=fixture();
  const clean=[
    finding(fx,fx.ancestor,'ancestor'),
    finding(fx,fx.target,'target'),
    finding(fx,fx.descendant,'descendant'),
  ];
  assert.throws(
    ()=>createRsiSkillLineageContaminationReview(reviewArgs(fx,clean.slice(0,2))),
    /exact_closure_coverage_required/,
  );
  assert.throws(
    ()=>createRsiSkillLineageContaminationReview(reviewArgs(fx,[
      clean[0],{...clean[1],status:'CLEAN'},clean[2],
    ])),
    /candidate_status_forbidden/,
  );
  assert.throws(
    ()=>createRsiSkillLineageContaminationReview(reviewArgs(fx,[
      clean[0],{...clean[1],provenance_integrity_state:'PASS'},clean[2],
    ])),
    /candidate_provenance_state_forbidden/,
  );
});

test('R9 keeps provenance security semantic reviewers distinct and disjoint from effect executor',()=>{
  const fx=fixture();
  const clean=[
    finding(fx,fx.ancestor,'ancestor'),
    finding(fx,fx.target,'target'),
    finding(fx,fx.descendant,'descendant'),
  ];
  const targetProvenanceReviewer=clean[1].provenance_attestation.provenance_reviewer_identity_digest;

  assert.throws(
    ()=>createRsiSkillLineageContaminationReview(reviewArgs(fx,[
      clean[0],
      {...clean[1],security_reviewer_identity_digest:targetProvenanceReviewer},
      clean[2],
    ])),
    /three_reviewer_separation_required/,
  );
  assert.throws(
    ()=>createRsiSkillLineageContaminationReview(reviewArgs(fx,[
      clean[0],
      {...clean[1],semantic_reviewer_identity_digest:EFFECT_EXECUTOR},
      clean[2],
    ])),
    /reviewer_effect_executor_separation_required/,
  );
});

test('R9 trust root freezes structural provenance and zero-effect deterministic verdict semantics',()=>{
  const root=rsiSkillLineageContaminationReviewTrustRootSnapshot();
  assert.equal(root.version,3);
  assert.equal(root.existing_verified_library_reused,true);
  assert.equal(root.second_lineage_graph_allowed,false);
  assert.equal(root.deterministic_predicate_status_derivation_required,true);
  assert.equal(root.structural_provenance_attestation_required,true);
  assert.equal(root.candidate_supplied_provenance_state_allowed,false);
  assert.equal(root.candidate_supplied_status_allowed,false);
  assert.equal(root.reviewer_votes_are_not_authority,true);
  assert.equal(root.independent_predicate_evidence_required,true);
  assert.equal(root.review_is_effect_authority,false);
  assert.equal(root.execution_authority,false);
  assert.equal(root.promotion_authority,false);
  assert.equal(root.self_update_authority,false);
  assert.equal(root.automatic_retry_allowed,false);
  assert.equal(root.authority_effect,false);
});
