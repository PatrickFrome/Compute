import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import test from 'node:test';

import {
  createRsiSkillCapsule,
  createRsiSkillEvidence,
  createRsiVerifiedSkillLibrary,
} from '../src/rsi-verified-skill-library.mjs';
import {
  createRsiSkillLineageContaminationReview,
  verifyRsiSkillLineageContaminationReview,
  rsiSkillLineageContaminationReviewTrustRootSnapshot,
} from '../src/rsi-skill-lineage-contamination-review.mjs';
import { rsiRuntimeSkillLifecycleTrustRootSnapshot } from '../src/rsi-runtime-skill-lifecycle.mjs';

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
    library_id:'rsi.skill.library.lineage.gate',
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

function finding(skillDigest,label,status='CLEAN',overrides={}){
  return {
    skill_digest:skillDigest,
    status,
    causal_provenance_digest:digest(label+'-causal-provenance'),
    negative_transfer_receipt_digest:digest(label+'-negative-transfer'),
    semantic_consistency_digest:digest(label+'-semantic-consistency'),
    provenance_reviewer_identity_digest:digest(label+'-provenance-reviewer'),
    security_reviewer_identity_digest:digest(label+'-security-reviewer'),
    semantic_reviewer_identity_digest:digest(label+'-semantic-reviewer'),
    ...overrides,
  };
}

function reviewArgs(fx,findings){
  return {
    review_id:'phase36.lineage.review.focused',
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

test('R8D lineage review derives ancestor and descendant closure from the existing verified library',()=>{
  const fx=fixture();
  const findings=[
    finding(fx.ancestor.skill_digest,'ancestor'),
    finding(fx.target.skill_digest,'target'),
    finding(fx.descendant.skill_digest,'descendant'),
  ];
  const review=createRsiSkillLineageContaminationReview(reviewArgs(fx,findings));
  assert.equal(review.state,'CLEAR_FOR_ZERO_EFFECT_EXPOSURE_PRECOMMIT');
  assert.equal(review.eligible_for_exposure_precommit,true);
  assert.deepEqual(review.ancestor_skill_digests,[fx.ancestor.skill_digest]);
  assert.deepEqual(review.descendant_skill_digests,[fx.descendant.skill_digest]);
  assert.deepEqual(
    [...review.closure_skill_digests].sort(),
    [fx.ancestor.skill_digest,fx.target.skill_digest,fx.descendant.skill_digest].sort(),
  );
  assert.equal(review.finding_count,3);
  assert.equal(review.three_heterogeneous_reviewers_per_skill_required,true);
  assert.equal(review.structural_behavioral_semantic_critic_separation_required,true);
  assert.equal(review.review_is_effect_authority,false);
  assert.equal(review.authority_effect,false);
  assert.equal(
    verifyRsiSkillLineageContaminationReview(review,{
      source_sha:SOURCE,
      library:fx.library,
      target_skill_digest:fx.target.skill_digest,
      current_governance_digest:digest('current-governance'),
      effect_executor_identity_digest:EFFECT_EXECUTOR,
    }).review_digest,
    review.review_digest,
  );
});

test('R8D lineage review fails closed on incomplete, contaminated or correlated criticism',()=>{
  const fx=fixture();
  const clean=[
    finding(fx.ancestor.skill_digest,'ancestor'),
    finding(fx.target.skill_digest,'target'),
    finding(fx.descendant.skill_digest,'descendant'),
  ];

  assert.throws(
    ()=>createRsiSkillLineageContaminationReview(reviewArgs(fx,clean.slice(0,2))),
    /exact_closure_coverage_required/,
  );

  const contaminated=createRsiSkillLineageContaminationReview(reviewArgs(fx,[
    clean[0],clean[1],finding(fx.descendant.skill_digest,'descendant-contaminated','CONTAMINATED'),
  ]));
  assert.equal(contaminated.state,'BLOCKED_LINEAGE_CONTAMINATION_OR_INCOMPLETE');
  assert.equal(contaminated.eligible_for_exposure_precommit,false);
  assert.ok(contaminated.blockers.includes('LINEAGE_CONTAMINATION_DETECTED'));

  const sharedReviewer=digest('shared-reviewer');
  assert.throws(
    ()=>createRsiSkillLineageContaminationReview(reviewArgs(fx,[
      clean[0],
      finding(fx.target.skill_digest,'target-correlated','CLEAN',{
        provenance_reviewer_identity_digest:sharedReviewer,
        semantic_reviewer_identity_digest:sharedReviewer,
      }),
      clean[2],
    ])),
    /three_reviewer_separation_required/,
  );

  assert.throws(
    ()=>createRsiSkillLineageContaminationReview(reviewArgs(fx,[
      clean[0],
      finding(fx.target.skill_digest,'target-executor-collision','CLEAN',{
        semantic_reviewer_identity_digest:EFFECT_EXECUTOR,
      }),
      clean[2],
    ])),
    /reviewer_effect_executor_separation_required/,
  );
});

test('R8D stable-source exposure preparation keeps certificate ledger first and requires lineage review before PREPARED',async()=>{
  const lifecycle=await fs.readFile(new URL('../src/rsi-runtime-skill-lifecycle.mjs',import.meta.url),'utf8');
  const service=await fs.readFile(new URL('../src/rsi-runtime-service.mjs',import.meta.url),'utf8');

  const lifecyclePrepare=lifecycle.slice(
    lifecycle.indexOf('async prepareExposureReleaseAttempt({'),
    lifecycle.indexOf('async recordExposureReleaseAttempted({'),
  );
  const lineageVerify=lifecyclePrepare.indexOf('verifyRsiSkillLineageContaminationReview(lineage_contamination_review');
  const preparedTransition=lifecyclePrepare.indexOf("appendReleaseTransition({transitions:[]},'PREPARED'");
  assert.ok(lineageVerify>=0);
  assert.ok(preparedTransition>lineageVerify);
  assert.match(lifecyclePrepare,/lineage_contamination_review:structuredClone\(lineageReview\)/);
  assert.match(lifecyclePrepare,/lineage_contamination_review_digest:lineageReview\.review_digest/);
  assert.match(lifecycle,/MAX_EXPOSURE_RELEASE_ATTEMPT_BYTES=64\*1024/);
  assert.match(lifecycle,/attempt_payload_budget_exceeded/);

  const servicePrepare=service.slice(
    service.indexOf('async prepareSkillExposureReleaseAttempt({'),
    service.indexOf('async executeSkillExposureReleaseAttempt({'),
  );
  const certificateLedgerRead=servicePrepare.indexOf('this.#skillExposureCertificateLedger.get(certificate_id)');
  const lifecycleCall=servicePrepare.indexOf('this.#skillLifecycle.prepareExposureReleaseAttempt');
  assert.ok(certificateLedgerRead>=0);
  assert.ok(lifecycleCall>certificateLedgerRead);
  assert.match(servicePrepare,/lineage_contamination_review/);
  assert.match(servicePrepare,/lineage_contamination_review_digest: result\.lineage_contamination_review_digest/);

  const root=rsiRuntimeSkillLifecycleTrustRootSnapshot();
  assert.equal(root.durable_verified_release_certificate_record_required,true);
  assert.equal(root.exposure_release_lineage_contamination_review_required,true);
  assert.equal(root.exposure_release_lineage_review_uses_existing_parent_skill_digest,true);
  assert.equal(root.exposure_release_lineage_review_three_heterogeneous_critics_required,true);
  assert.equal(root.exposure_release_lineage_review_is_effect_authority,false);
  assert.equal(root.exposure_release_effect_attempt_limit,1);
  assert.equal(root.blind_retry_for_exposure_release_effect,false);
  assert.equal(root.authority_effect,false);
});

test('R8D candidate, tournament and promotion roots freeze lineage contamination policy',async()=>{
  const paths=[
    '../src/rsi-isolated-candidate-builder.mjs',
    '../src/rsi-shadow-tournament.mjs',
    '../src/rsi-promotion-admission-gate.mjs',
  ];
  for(const relative of paths){
    const source=await fs.readFile(new URL(relative,import.meta.url),'utf8');
    assert.match(source,/rsi-skill-lineage-contamination-review\.mjs/);
  }
  const root=rsiSkillLineageContaminationReviewTrustRootSnapshot();
  assert.equal(root.existing_verified_library_reused,true);
  assert.equal(root.second_lineage_graph_allowed,false);
  assert.equal(root.three_heterogeneous_reviewers_per_skill_required,true);
  assert.equal(root.structural_behavioral_semantic_critic_separation_required,true);
  assert.equal(root.reviewer_effect_executor_separation_required,true);
  assert.equal(root.candidate_can_author_review,false);
  assert.equal(root.review_is_effect_authority,false);
  assert.equal(root.execution_authority,false);
  assert.equal(root.promotion_authority,false);
  assert.equal(root.self_update_authority,false);
  assert.equal(root.automatic_retry_allowed,false);
  assert.equal(root.authority_effect,false);
});
