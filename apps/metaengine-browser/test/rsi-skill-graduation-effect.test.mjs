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
  createRsiSkillLibraryGovernance,
} from '../src/rsi-skill-library-governance.mjs';
import { createRsiBrowserOutcomeEpisode } from '../src/rsi-browser-outcome-ingest.mjs';
import { createRsiStepCreditReceipt } from '../src/rsi-runtime-credit-assignment.mjs';
import {
  createRsiLineageBuildReceipt,
  createRsiLineageStructuralProvenance,
  rsiLineageComponentRootForCapsule,
} from '../src/rsi-lineage-structural-provenance.mjs';
import { createRsiGithubAttestationVerificationReceipt } from '../src/rsi-github-attestation-verification-receipt.mjs';
import { createRsiLineageProvenanceAcceptance } from '../src/rsi-lineage-provenance-acceptance.mjs';
import { createRsiSkillLineageContaminationReview } from '../src/rsi-skill-lineage-contamination-review.mjs';
import {
  createRsiRecursiveRiskBudget,
  createRsiExternalStatisticalCertificate,
  RsiRecursiveRiskLedger,
  RSI_RISK_SPENDING_POLICIES,
} from '../src/rsi-recursive-risk-budget.mjs';
import {
  reconstructRsiDurableRecursiveRiskLedgerState,
  createRsiDurableRiskConfirmationWitness,
} from '../src/rsi-durable-recursive-risk-ledger.mjs';
import {
  createRsiExplorationGraduationPreview,
  createRsiExplorationGraduationVerifierReceipt,
  createRsiExplorationGraduationStatisticalReceipt,
  createRsiExplorationGraduationCertificate,
} from '../src/rsi-exploration-graduation-certificate.mjs';
import {
  RsiRuntimeSkillLifecycle,
  rsiRuntimeSkillLifecycleTrustRootSnapshot,
} from '../src/rsi-runtime-skill-lifecycle.mjs';

const SOURCE='a'.repeat(40);
const FUTURE_EXECUTOR=d('future-effect-executor');
const READBACK_OWNER=d('graduation-readback-owner');
const CONSUMER=d('consumer-snapshot');
const RETRIEVAL=d('retrieval-profile');
const EVALUATION=d('evaluation-contract');
const PAIRED=d('paired-instance-manifest');
const EXPLORATION_EVIDENCE=d('exploration-evidence-manifest');

function d(label){
  return `sha256:${crypto.createHash('sha256').update(String(label),'utf8').digest('hex')}`;
}
function uuidFor(n){
  return `${String(n).padStart(8,'0')}-0000-4000-8000-${String(n).padStart(12,'0')}`;
}
function stableState(value){
  if(Array.isArray(value))return value.map(stableState);
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.keys(value).sort().map((key)=>[key,stableState(value[key])]));
}
function lifecycleStateDigest(value){
  const clone=structuredClone(value);
  delete clone.state_digest;
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stableState(clone)),'utf8').digest('hex')}`;
}

function verifiedSkill({id='skill.graduation.fixture',source='b',impl='c'}={}){
  const capsule=createRsiSkillCapsule({
    skill_id:id,
    version:1,
    parent_skill_digest:null,
    source_candidate_sha:source.repeat(40),
    role:'ANALYZER',
    input_schema_digest:d('input'),
    output_schema_digest:d('output'),
    implementation_digest:d(impl),
    components:[{component_id:`${id}.component`,artifact_digest:d('component'),kind:'TYPED_TRANSFORM'}],
    capabilities:['READ_VERIFIED_CONTEXT','ANALYZE_FAILURE_CODES'],
    max_context_tokens:2048,
    max_output_tokens:512,
    max_invocations:2,
    deterministic_interface:true,
    external_builder:true,
    authored_by_candidate:false,
  });
  const evidence=createRsiSkillEvidence({
    capsule,
    hidden_holdout_digest:d('holdout'),
    evaluator_root_digest:d('library-evaluator'),
    unit_test_digest:d('unit'),
    runtime_feedback_digest:d('runtime'),
    attempt_count:12,
    success_count:10,
    hard_invariants_pass:true,
    verified_for_library:true,
    evidence_refs:[`VERIFY_${id}`],
    external_evaluator:true,
    authored_by_candidate:false,
  });
  return {capsule,evidence};
}
function library(entries,id='runtime.skill.library.graduation'){
  return createRsiVerifiedSkillLibrary({
    library_id:id,
    entries,
    external_library_owner:true,
    authored_by_candidate:false,
  });
}
function episode({command,skillDigest,step=1,count=1,predecessor=null,effect='CONFIRMED'}){
  return createRsiBrowserOutcomeEpisode({
    source_sha:SOURCE,
    readback:{
      schema:'metaengine.rsi.result-receipt-readback.v1',
      command_id:command,
      found:true,
      terminal:true,
      status:'COMPLETED',
      receipt:{
        schema:'metaengine.native-supervisor.command-receipt.v2',
        command_id:command,
        action:'SCROLL',
        platform:'CHATGPT',
        result:{moved:true,raw_value:'must-not-enter-skill-state'},
        effect_outcome:effect,
        lane:'MUTATION',
        effect_key:`effect-${command.slice(0,8)}`,
        execution_ms:9.5,
        recorded_at:'2026-09-20T18:00:00.000Z',
        authority_effect:false,
      },
      error:null,
      execution_authority:false,
      production_mutation_authority:false,
      promotion_authority:false,
      self_update_authority:false,
      automatic_retry_allowed:false,
      authority_effect:false,
    },
    attribution:{
      task_id:'task.skill.graduation.1',
      task_signature_digest:d('8'),
      environment_fingerprint:'env.browser.chatgpt.v1',
      model_family:'GPT_5_6_SOL',
      candidate_id:`candidate_sha256_${'9'.repeat(64)}`,
      candidate_sha:'d'.repeat(40),
      proposal_digest:d('a'),
      skill_digests:[skillDigest],
      trajectory_id:'trajectory.skill.graduation.1',
      step_index:step,
      step_count:count,
      predecessor_episode_digest:predecessor,
      external_attribution:true,
      authored_by_candidate:false,
    },
  });
}
function credit(ep,{sign='POSITIVE',score=0.6,id=null}={}){
  return createRsiStepCreditReceipt({
    credit_id:id||`credit.${ep.command_id}`,
    episode:ep,
    credit_sign:sign,
    credit_score:score,
    method:'EXTERNAL_STEP_EVALUATOR',
    evaluator_digest:d('b'),
    evaluation_digest:d('c'),
    failure_codes:sign==='NEGATIVE'?['SKILL_HARMFUL_OUTCOME']:[],
    lesson_digests:[d('d')],
    evidence_refs:[`eval:${ep.command_id}`],
    external_credit_assigner:true,
    authored_by_candidate:false,
  });
}
function lineage(fx){
  const builder=d('trusted-builder');
  const recipe=d('trusted-recipe');
  const materials=d('trusted-materials');
  const build=createRsiLineageBuildReceipt({
    receipt_id:'graduation.build.receipt',
    subject_skill_digest:fx.capsule.skill_digest,
    source_candidate_sha:fx.capsule.source_candidate_sha,
    implementation_digest:fx.capsule.implementation_digest,
    component_root_digest:rsiLineageComponentRootForCapsule(fx.capsule),
    parent_material_skill_digest:null,
    material_manifest_digest:materials,
    product_manifest_digest:d('products'),
    build_recipe_digest:recipe,
    builder_identity_digest:builder,
    external_builder:true,
    authored_by_candidate:false,
  });
  const structural=createRsiLineageStructuralProvenance({
    attestation_id:'graduation.structural.provenance',
    library:fx.library,
    skill_digest:fx.capsule.skill_digest,
    build_receipt:build,
    expected_builder_identity_digest:builder,
    expected_build_recipe_digest:recipe,
    expected_material_manifest_digest:materials,
    provenance_reviewer_identity_digest:d('provenance-reviewer'),
    effect_executor_identity_digest:FUTURE_EXECUTOR,
    external_provenance_owner:true,
    authored_by_candidate:false,
  });
  const github=createRsiGithubAttestationVerificationReceipt({
    verification_id:'graduation.github.attestation',
    subject_digest:d('attested-file'),
    provenance_bundle_digest:d('provenance-bundle'),
    structural_attestation_digest:structural.attestation_digest,
    repository:'PatrickFrome/Compute',
    signer_workflow:'.github/workflows/rsi-lineage-provenance-attestation.yml',
    signer_digest:SOURCE,
    source_ref:'refs/heads/main',
    source_digest:SOURCE,
    cert_oidc_issuer:'https://token.actions.githubusercontent.com',
    predicate_type:'https://github.com/PatrickFrome/Compute/attestations/rsi-lineage-provenance/v1',
    trusted_root_digest:d('trusted-root'),
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
  });
  const provenance=createRsiLineageProvenanceAcceptance({
    acceptance_id:'graduation.provenance.acceptance',
    library:fx.library,
    skill_digest:fx.capsule.skill_digest,
    structural_attestation:structural,
    github_verification_receipt:github,
    external_provenance_acceptor:true,
    authored_by_candidate:false,
  });
  return createRsiSkillLineageContaminationReview({
    review_id:'graduation.lineage.review',
    source_sha:SOURCE,
    library:fx.library,
    target_skill_digest:fx.capsule.skill_digest,
    current_governance_digest:fx.current.governance_digest,
    target_consumer_snapshot_digest:CONSUMER,
    effect_executor_identity_digest:FUTURE_EXECUTOR,
    findings:[{
      skill_digest:fx.capsule.skill_digest,
      provenance_acceptance:provenance,
      security_negative_transfer_state:'PASS',
      semantic_consistency_state:'PASS',
      negative_transfer_receipt_digest:d('lineage-negative-transfer'),
      semantic_consistency_digest:d('lineage-semantic-consistency'),
      security_reviewer_identity_digest:d('lineage-security-reviewer'),
      semantic_reviewer_identity_digest:d('lineage-semantic-reviewer'),
    }],
    external_review_owner:true,
    authored_by_candidate:false,
  });
}
function preview(fx){
  return createRsiExplorationGraduationPreview({
    preview_id:'graduation.phase37a.preview',
    library:fx.library,
    current_governance:fx.current,
    next_governance:fx.next,
    skill_digest:fx.capsule.skill_digest,
    external_governance_owner:true,
    authored_by_candidate:false,
  });
}
function verifier(fx,kind){
  return createRsiExplorationGraduationVerifierReceipt({
    receipt_id:`graduation.${kind.toLowerCase()}.verifier`,
    kind,
    source_sha:SOURCE,
    skill_digest:fx.capsule.skill_digest,
    library_digest:fx.library.library_digest,
    governance_digest:fx.current.governance_digest,
    target_consumer_snapshot_digest:CONSUMER,
    target_retrieval_profile_digest:RETRIEVAL,
    evaluation_contract_digest:EVALUATION,
    paired_instance_manifest_digest:PAIRED,
    exploration_evidence_manifest_digest:EXPLORATION_EVIDENCE,
    verifier_identity_digest:d(`${kind.toLowerCase()}-verifier-identity`),
    evidence_digest:d(`${kind.toLowerCase()}-verifier-evidence`),
    verdict:'PASS',
    external_verifier:true,
    authored_by_candidate:false,
  });
}
function statistical(fx){
  const holdout=d('statistical-holdout');
  const evaluatorRoot=d('statistical-evaluator-root');
  const candidateId=`skill:${fx.capsule.skill_digest}`;
  const candidateSha=fx.capsule.source_candidate_sha;
  const parentSha='f'.repeat(40);
  const budget=createRsiRecursiveRiskBudget({
    budget_id:'graduation.recursive.risk',
    global_alpha:0.05,
    spending_policy:RSI_RISK_SPENDING_POLICIES.TELESCOPING_ANYTIME,
    evidence_family:'RSI_PHASE37A_GRADUATION',
  });
  const externalCertificate=createRsiExternalStatisticalCertificate({
    certificate_id:'graduation.external.statistical.certificate',
    budget,
    confirmation_index:1,
    candidate_id:candidateId,
    candidate_sha:candidateSha,
    parent_sha:parentSha,
    tournament_plan_digest:PAIRED,
    holdout_digest:holdout,
    evaluator_root_digest:evaluatorRoot,
    method:'E_VALUE_EXTERNAL_V1',
    alpha_used:0.01,
    superiority_certified:true,
    paired_evaluation:true,
    independent_holdout:true,
    stopping_rule_precommitted:true,
    optional_stopping_used:false,
    familywise_valid:true,
    screening_spent_alpha:false,
    confirmation_triggered:true,
    sample_count:32,
    evidence_refs:['GRADUATION_EXTERNAL_E_VALUE'],
    external_verifier:true,
    authored_by_candidate:false,
  });
  const ledger=new RsiRecursiveRiskLedger({budget});
  const confirmation=ledger.confirm({
    certificate:externalCertificate,
    candidate_id:candidateId,
    candidate_sha:candidateSha,
    parent_sha:parentSha,
    tournament_plan_digest:PAIRED,
    holdout_digest:holdout,
    evaluator_root_digest:evaluatorRoot,
  });
  return createRsiExplorationGraduationStatisticalReceipt({
    receipt_id:'graduation.statistical.receipt',
    source_sha:SOURCE,
    skill_digest:fx.capsule.skill_digest,
    library_digest:fx.library.library_digest,
    governance_digest:fx.current.governance_digest,
    target_consumer_snapshot_digest:CONSUMER,
    target_retrieval_profile_digest:RETRIEVAL,
    evaluation_contract_digest:EVALUATION,
    paired_instance_manifest_digest:PAIRED,
    exploration_evidence_manifest_digest:EXPLORATION_EVIDENCE,
    statistical_holdout_digest:holdout,
    statistical_evaluator_root_digest:evaluatorRoot,
    recursive_risk_budget:budget,
    external_statistical_certificate:externalCertificate,
    risk_confirmation:confirmation,
    candidate_id:candidateId,
    candidate_sha:candidateSha,
    parent_sha:parentSha,
    statistical_acceptor_identity_digest:d('statistical-acceptor-identity'),
    false_admission_alpha_ppm:10000,
    anytime_valid_e_value_microunits:100_000_000,
    paired_sample_count:32,
    minimum_paired_sample_count:16,
    external_statistical_acceptor:true,
    authored_by_candidate:false,
  });
}
function certificateFixture(fx){
  const statisticalReceipt=statistical(fx);
  const durableState=reconstructRsiDurableRecursiveRiskLedgerState({
    source_sha:SOURCE,
    budget:statisticalReceipt.recursive_risk_budget,
    rows:[{
      certificate:statisticalReceipt.external_statistical_certificate,
      confirmation:statisticalReceipt.risk_confirmation,
    }],
  });
  const durableWitness=createRsiDurableRiskConfirmationWitness({
    durable_ledger_state:durableState,
    source_sha:SOURCE,
    recursive_risk_budget:statisticalReceipt.recursive_risk_budget,
    confirmation_digest:statisticalReceipt.risk_confirmation_digest,
    readback_owner_identity_digest:d('durable-risk-readback-owner'),
    external_readback_owner:true,
    authored_by_candidate:false,
  });
  const args={
    certificate_id:'graduation.phase37a.certificate',
    source_sha:SOURCE,
    library:fx.library,
    current_governance:fx.current,
    next_governance:fx.next,
    preview:preview(fx),
    skill_digest:fx.capsule.skill_digest,
    target_consumer_snapshot_digest:CONSUMER,
    target_retrieval_profile_digest:RETRIEVAL,
    evaluation_contract_digest:EVALUATION,
    exploration_evidence_manifest_digest:EXPLORATION_EVIDENCE,
    process_verifier_receipt:verifier(fx,'PROCESS'),
    outcome_verifier_receipt:verifier(fx,'OUTCOME'),
    statistical_receipt:statisticalReceipt,
    durable_risk_confirmation_witness:durableWitness,
    durable_risk_ledger_state:durableState,
    lineage_review:lineage(fx),
    future_effect_executor_identity_digest:FUTURE_EXECUTOR,
    certificate_owner_identity_digest:d('certificate-owner'),
    retention_receipt_digest:d('retention-receipt'),
    retention_non_regression_pass:true,
    cost_latency_receipt_digest:d('cost-latency-receipt'),
    cost_budget_pass:true,
    latency_budget_pass:true,
    negative_transfer_receipt_digest:d('negative-transfer-receipt'),
    negative_transfer_clear:true,
    coalition_ablation_receipt_digest:d('coalition-ablation-receipt'),
    coalition_ablation_pass:true,
    no_skill_ablation_receipt_digest:d('no-skill-ablation-receipt'),
    no_skill_ablation_pass:true,
    source_grounding_receipt_digest:d('source-grounding-receipt'),
    source_grounding_pass:true,
    memory_poisoning_scan_digest:d('memory-poisoning-scan'),
    memory_poisoning_scan_pass:true,
    external_certificate_owner:true,
    authored_by_candidate:false,
  };
  return {certificate:createRsiExplorationGraduationCertificate(args),args};
}

async function seedExplorationOnlyStore(statePath,skill,libraryId){
  const seed=new RsiRuntimeSkillLifecycle({statePath,source_sha:SOURCE});
  await seed.init();
  await seed.adoptVerifiedLibrary({
    library:library([skill],libraryId),
    external_library_owner:true,
    authored_by_candidate:false,
  });
  // Five distinct positively-credited outcomes push the skill past
  // min_positive_observations=4 with positive net delta, so removing the
  // exploration-only hold projects to a fully ACTIVE governance entry.
  for(let index=0;index<5;index+=1){
    const ep=episode({command:uuidFor(400+index),skillDigest:skill.capsule.skill_digest});
    await seed.recordCreditedOutcome({
      episode:ep,
      credit_receipt:credit(ep,{sign:'POSITIVE',score:0.25,id:`credit.graduation.seed.${index}`}),
      generation:1,
      authoring_prior:'VERIFIED_DIRECT_SKILL',
      authoring_provenance_digest:d('e'),
      external_evaluator:true,
      authored_by_candidate:false,
    });
  }
  const persisted=JSON.parse(await fs.readFile(statePath,'utf8'));
  persisted.exploration_only_skill_digests=[skill.capsule.skill_digest];
  persisted.exploration_only_skill_count=1;
  persisted.exploration_only_prevents_full_active=true;
  persisted.exploration_only_release_requires_external_governance=true;
  persisted.state_digest=lifecycleStateDigest(persisted);
  await fs.writeFile(statePath,JSON.stringify(persisted)+'\n','utf8');
  const store=new RsiRuntimeSkillLifecycle({statePath,source_sha:SOURCE});
  await store.init();
  return store;
}
function lifecycleFixture(store,skill){
  const gp=store.graduationGovernancePreview(skill.capsule.skill_digest);
  return {
    capsule:skill.capsule,
    library:store.verifiedLibrarySnapshot(),
    current:gp.current_governance,
    next:gp.next_governance,
  };
}
const EXECUTOR_ARGS={external_certificate_owner:true,external_effect_executor:true,authored_by_candidate:false};

test('Phase37B one-attempt graduation effect promotes EXPLORATION_ACTIVE to ACTIVE with restart durability',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'rsi-graduation-effect-'));
  try{
    const statePath=path.join(root,'skill-state.json');
    const skill=verifiedSkill({id:'skill.graduation.happy',source:'b',impl:'c'});
    const store=await seedExplorationOnlyStore(statePath,skill,'runtime.skill.library.graduation.happy');
    assert.equal(store.snapshot().exploration_only_skill_count,1);
    assert.equal(store.governance().entries[0].state,'EXPLORATION_ACTIVE');

    const gp=store.graduationGovernancePreview(skill.capsule.skill_digest);
    assert.equal(gp.preview_only,true);
    assert.equal(gp.hold_mutation_performed,false);
    assert.equal(gp.full_activation_authorized,false);
    assert.equal(gp.current_governance.entries[0].state,'EXPLORATION_ACTIVE');
    assert.equal(gp.next_governance.entries[0].state,'ACTIVE');
    assert.equal(store.snapshot().governance_digest,gp.current_governance_digest);

    const fx=lifecycleFixture(store,skill);
    const {certificate,args}=certificateFixture(fx);
    assert.equal(certificate.state,'ELIGIBLE_FOR_PHASE37B_ONE_ATTEMPT_GRADUATION_REVIEW');

    const prepared=await store.prepareSkillGraduationAttempt({
      attempt_id:'graduation.attempt.1',
      graduation_certificate:certificate,
      graduation_certificate_args:args,
      effect_id_digest:d('graduation-effect-id'),
      idempotency_key_digest:d('graduation-idempotency-key'),
      effect_executor_identity_digest:FUTURE_EXECUTOR,
      ...EXECUTOR_ARGS,
    });
    assert.equal(prepared.state,'PREPARED');

    const idempotent=await store.prepareSkillGraduationAttempt({
      attempt_id:'graduation.attempt.1',
      graduation_certificate:certificate,
      graduation_certificate_args:args,
      effect_id_digest:d('graduation-effect-id'),
      idempotency_key_digest:d('graduation-idempotency-key'),
      effect_executor_identity_digest:FUTURE_EXECUTOR,
      ...EXECUTOR_ARGS,
    });
    assert.equal(idempotent.state,'IDEMPOTENT');
    assert.equal(idempotent.current_state,'PREPARED');

    const attempted=await store.recordSkillGraduationAttempted({
      attempt_id:'graduation.attempt.1',
      effect_executor_identity_digest:FUTURE_EXECUTOR,
      external_effect_executor:true,
      authored_by_candidate:false,
    });
    assert.equal(attempted.state,'ATTEMPTED');
    assert.equal(attempted.effect_attempt_count,1);
    assert.equal(attempted.same_effect_id_retry_allowed,false);

    const executed=await store.executePreparedSkillGraduationAttempt({
      attempt_id:'graduation.attempt.1',
      effect_executor_identity_digest:FUTURE_EXECUTOR,
      external_effect_executor:true,
      authored_by_candidate:false,
    });
    assert.equal(executed.state,'CONFIRMED_ACTIVE');
    assert.equal(executed.exploration_hold_released,true);
    assert.equal(executed.new_authority_granted,false);
    assert.equal(executed.pre_effect_readback_passed,true);
    assert.equal(executed.governance_digest,gp.next_governance_digest);
    assert.equal(store.snapshot().exploration_only_skill_count,0);
    assert.equal(store.governance().entries[0].state,'ACTIVE');
    assert.equal(store.governance().entries[0].active_for_composition,true);
    assert.equal(store.governance().entries[0].exploration_only_hold===true,false);
    assert.equal(store.snapshot().authority_effect,false);

    await assert.rejects(
      ()=>store.executePreparedSkillGraduationAttempt({
        attempt_id:'graduation.attempt.1',
        effect_executor_identity_digest:FUTURE_EXECUTOR,
        external_effect_executor:true,
        authored_by_candidate:false,
      }),
      /graduation_attempt_not_prepared/,
    );

    const restored=new RsiRuntimeSkillLifecycle({statePath,source_sha:SOURCE});
    await restored.init();
    const restoredSnapshot=restored.snapshot();
    assert.equal(restoredSnapshot.graduation_attempt_count,1);
    assert.deepEqual(restoredSnapshot.graduation_attempt_state_counts,{CONFIRMED_ACTIVE:1});
    assert.equal(restoredSnapshot.exploration_only_skill_count,0);
    assert.equal(restored.governance().entries[0].state,'ACTIVE');
    const attempt=restored.graduationAttemptSnapshot('graduation.attempt.1');
    assert.equal(attempt.current_state,'CONFIRMED_ACTIVE');
    assert.equal(attempt.effect_attempt_count,1);
    assert.deepEqual(attempt.transitions.map(row=>row.state),['PREPARED','ATTEMPTED','CONFIRMED_ACTIVE']);
    assert.equal(attempt.authority_effect,false);
    assert.equal(attempt.graduation_does_not_grant_execution_authority,true);
  }finally{await fs.rm(root,{recursive:true,force:true})}
});

test('Phase37B rejects non-designated executors, non-external callers, drift, and non-exploration targets',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'rsi-graduation-effect-negative-'));
  try{
    const statePath=path.join(root,'skill-state.json');
    const skill=verifiedSkill({id:'skill.graduation.negative',source:'b',impl:'c'});
    const store=await seedExplorationOnlyStore(statePath,skill,'runtime.skill.library.graduation.negative');
    const fx=lifecycleFixture(store,skill);
    const {certificate,args}=certificateFixture(fx);

    await assert.rejects(
      ()=>store.prepareSkillGraduationAttempt({
        attempt_id:'graduation.attempt.n1',
        graduation_certificate:certificate,
        graduation_certificate_args:args,
        effect_id_digest:d('graduation-effect-id-n1'),
        idempotency_key_digest:d('graduation-idempotency-key-n1'),
        effect_executor_identity_digest:FUTURE_EXECUTOR,
        external_certificate_owner:false,
        external_effect_executor:true,
        authored_by_candidate:false,
      }),
      /graduation_external_owners_required/,
    );
    await assert.rejects(
      ()=>store.prepareSkillGraduationAttempt({
        attempt_id:'graduation.attempt.n2',
        graduation_certificate:certificate,
        graduation_certificate_args:args,
        effect_id_digest:d('graduation-effect-id-n2'),
        idempotency_key_digest:d('graduation-idempotency-key-n2'),
        effect_executor_identity_digest:d('not-the-designated-executor'),
        ...EXECUTOR_ARGS,
      }),
      /graduation_executor_not_designated/,
    );
    const collidingCertificateFixture=certificateFixture(fx);
    await assert.rejects(
      ()=>store.prepareSkillGraduationAttempt({
        attempt_id:'graduation.attempt.n3',
        graduation_certificate:collidingCertificateFixture.certificate,
        graduation_certificate_args:collidingCertificateFixture.args,
        effect_id_digest:d('graduation-effect-id-n3'),
        idempotency_key_digest:d('graduation-idempotency-key-n3'),
        effect_executor_identity_digest:collidingCertificateFixture.args.certificate_owner_identity_digest,
        ...EXECUTOR_ARGS,
      }),
      /graduation_executor_not_designated/,
    );

    const driftedGovernanceStore=await (async()=>{
      const driftPath=path.join(root,'drift-state.json');
      return seedExplorationOnlyStore(driftPath,skill,'runtime.skill.library.graduation.negative');
    })();
    const ep6=episode({command:uuidFor(500),skillDigest:skill.capsule.skill_digest});
    await driftedGovernanceStore.recordCreditedOutcome({
      episode:ep6,
      credit_receipt:credit(ep6,{sign:'POSITIVE',score:0.25,id:'credit.graduation.drift.extra'}),
      generation:1,
      authoring_prior:'VERIFIED_DIRECT_SKILL',
      authoring_provenance_digest:d('e'),
      external_evaluator:true,
      authored_by_candidate:false,
    });
    const driftedFx=lifecycleFixture(driftedGovernanceStore,skill);
    const driftedCertificateFixture=certificateFixture(driftedFx);
    assert.notEqual(driftedCertificateFixture.certificate.current_governance_digest,certificate.current_governance_digest);
    await assert.rejects(
      ()=>store.prepareSkillGraduationAttempt({
        attempt_id:'graduation.attempt.n4',
        graduation_certificate:driftedCertificateFixture.certificate,
        graduation_certificate_args:driftedCertificateFixture.args,
        effect_id_digest:d('graduation-effect-id-n4'),
        idempotency_key_digest:d('graduation-idempotency-key-n4'),
        effect_executor_identity_digest:FUTURE_EXECUTOR,
        ...EXECUTOR_ARGS,
      }),
      /graduation_current_governance_drift/,
    );

    const blockedArgs=structuredClone(args);
    blockedArgs.memory_poisoning_scan_pass=false;
    const blockedCertificate=createRsiExplorationGraduationCertificate(blockedArgs);
    await assert.rejects(
      ()=>store.prepareSkillGraduationAttempt({
        attempt_id:'graduation.attempt.n5',
        graduation_certificate:blockedCertificate,
        graduation_certificate_args:blockedArgs,
        effect_id_digest:d('graduation-effect-id-n5'),
        idempotency_key_digest:d('graduation-idempotency-key-n5'),
        effect_executor_identity_digest:FUTURE_EXECUTOR,
        ...EXECUTOR_ARGS,
      }),
      /graduation_certificate_not_eligible/,
    );

    const prepared=await store.prepareSkillGraduationAttempt({
      attempt_id:'graduation.attempt.n6',
      graduation_certificate:certificate,
      graduation_certificate_args:args,
      effect_id_digest:d('graduation-effect-id-n6'),
      idempotency_key_digest:d('graduation-idempotency-key-n6'),
      effect_executor_identity_digest:FUTURE_EXECUTOR,
      ...EXECUTOR_ARGS,
    });
    assert.equal(prepared.state,'PREPARED');

    await assert.rejects(
      ()=>store.prepareSkillGraduationAttempt({
        attempt_id:'graduation.attempt.n7',
        graduation_certificate:certificate,
        graduation_certificate_args:args,
        effect_id_digest:d('graduation-effect-id-n7'),
        idempotency_key_digest:d('graduation-idempotency-key-n7'),
        effect_executor_identity_digest:FUTURE_EXECUTOR,
        ...EXECUTOR_ARGS,
      }),
      /graduation_skill_attempt_conflict/,
    );

    await assert.rejects(
      ()=>store.recordSkillGraduationAttempted({
        attempt_id:'graduation.attempt.n6',
        effect_executor_identity_digest:d('wrong-executor'),
        external_effect_executor:true,
        authored_by_candidate:false,
      }),
      /graduation_executor_identity_mismatch/,
    );

    const epDrift=episode({command:uuidFor(501),skillDigest:skill.capsule.skill_digest});
    await store.recordCreditedOutcome({
      episode:epDrift,
      credit_receipt:credit(epDrift,{sign:'POSITIVE',score:0.25,id:'credit.graduation.negative.drift'}),
      generation:1,
      authoring_prior:'VERIFIED_DIRECT_SKILL',
      authoring_provenance_digest:d('e'),
      external_evaluator:true,
      authored_by_candidate:false,
    });
    await assert.rejects(
      ()=>store.recordSkillGraduationAttempted({
        attempt_id:'graduation.attempt.n6',
        effect_executor_identity_digest:FUTURE_EXECUTOR,
        external_effect_executor:true,
        authored_by_candidate:false,
      }),
      /graduation_pre_effect_governance_drift/,
    );
  }finally{await fs.rm(root,{recursive:true,force:true})}
});

test('Phase37B pre-effect drift after durable ATTEMPTED becomes reconciliation-only and never replays the effect',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'rsi-graduation-effect-drift-'));
  try{
    const statePath=path.join(root,'skill-state.json');
    const skill=verifiedSkill({id:'skill.graduation.drift',source:'b',impl:'c'});
    const store=await seedExplorationOnlyStore(statePath,skill,'runtime.skill.library.graduation.drift');
    const fx=lifecycleFixture(store,skill);
    const {certificate,args}=certificateFixture(fx);
    await store.prepareSkillGraduationAttempt({
      attempt_id:'graduation.attempt.drift',
      graduation_certificate:certificate,
      graduation_certificate_args:args,
      effect_id_digest:d('graduation-effect-drift'),
      idempotency_key_digest:d('graduation-idempotency-drift'),
      effect_executor_identity_digest:FUTURE_EXECUTOR,
      ...EXECUTOR_ARGS,
    });
    await store.recordSkillGraduationAttempted({
      attempt_id:'graduation.attempt.drift',
      effect_executor_identity_digest:FUTURE_EXECUTOR,
      external_effect_executor:true,
      authored_by_candidate:false,
    });

    const epDrift=episode({command:uuidFor(502),skillDigest:skill.capsule.skill_digest});
    await store.recordCreditedOutcome({
      episode:epDrift,
      credit_receipt:credit(epDrift,{sign:'POSITIVE',score:0.25,id:'credit.graduation.drift.extra'}),
      generation:1,
      authoring_prior:'VERIFIED_DIRECT_SKILL',
      authoring_provenance_digest:d('e'),
      external_evaluator:true,
      authored_by_candidate:false,
    });

    const drifted=await store.executePreparedSkillGraduationAttempt({
      attempt_id:'graduation.attempt.drift',
      effect_executor_identity_digest:FUTURE_EXECUTOR,
      external_effect_executor:true,
      authored_by_candidate:false,
    });
    assert.equal(drifted.state,'PRE_EFFECT_DRIFT_RECONCILIATION_REQUIRED');
    assert.equal(drifted.effect_performed,false);
    assert.equal(drifted.pre_effect_readback_passed,false);
    assert.equal(drifted.same_effect_id_retry_allowed,false);

    await assert.rejects(
      ()=>store.executePreparedSkillGraduationAttempt({
        attempt_id:'graduation.attempt.drift',
        effect_executor_identity_digest:FUTURE_EXECUTOR,
        external_effect_executor:true,
        authored_by_candidate:false,
      }),
      /graduation_attempt_not_prepared/,
    );

    const reconciled=await store.reconcileSkillGraduationAttempt({
      attempt_id:'graduation.attempt.drift',
      readback_owner_identity_digest:READBACK_OWNER,
      external_readback_owner:true,
      authored_by_candidate:false,
    });
    assert.equal(reconciled.state,'RECONCILIATION_ONLY');
    assert.equal(reconciled.additional_effect_attempt_performed,false);
    assert.equal(reconciled.reconciliation_complete,false);
    assert.equal(store.snapshot().exploration_only_skill_count,1);

    await assert.rejects(
      ()=>store.reconcileSkillGraduationAttempt({
        attempt_id:'graduation.attempt.drift',
        readback_owner_identity_digest:FUTURE_EXECUTOR,
        external_readback_owner:true,
        authored_by_candidate:false,
      }),
      /graduation_readback_separation_invalid/,
    );
  }finally{await fs.rm(root,{recursive:true,force:true})}
});

test('Phase37B crash-after-effect reconciles to CONFIRMED_ACTIVE and crash-before-effect to a new attempt',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'rsi-graduation-effect-crash-'));
  try{
    const statePath=path.join(root,'skill-state.json');
    const skill=verifiedSkill({id:'skill.graduation.crash',source:'b',impl:'c'});
    const store=await seedExplorationOnlyStore(statePath,skill,'runtime.skill.library.graduation.crash');
    const fx=lifecycleFixture(store,skill);
    const {certificate,args}=certificateFixture(fx);
    await store.prepareSkillGraduationAttempt({
      attempt_id:'graduation.attempt.crash',
      graduation_certificate:certificate,
      graduation_certificate_args:args,
      effect_id_digest:d('graduation-effect-crash'),
      idempotency_key_digest:d('graduation-idempotency-crash'),
      effect_executor_identity_digest:FUTURE_EXECUTOR,
      ...EXECUTOR_ARGS,
    });
    await store.recordSkillGraduationAttempted({
      attempt_id:'graduation.attempt.crash',
      effect_executor_identity_digest:FUTURE_EXECUTOR,
      external_effect_executor:true,
      authored_by_candidate:false,
    });

    // Simulate a crash AFTER the effect committed but BEFORE the CONFIRMED_ACTIVE
    // transition persisted: the durable state on disk already reflects the hold
    // release, while the attempt row is still ATTEMPTED.
    const persisted=JSON.parse(await fs.readFile(statePath,'utf8'));
    persisted.exploration_only_skill_digests=[];
    persisted.exploration_only_skill_count=0;
    persisted.exploration_only_prevents_full_active=true;
    persisted.exploration_only_release_requires_external_governance=true;
    persisted.state_digest=lifecycleStateDigest(persisted);
    await fs.writeFile(statePath,JSON.stringify(persisted)+'\n','utf8');

    const recovered=new RsiRuntimeSkillLifecycle({statePath,source_sha:SOURCE});
    await recovered.init();
    const confirmed=await recovered.reconcileSkillGraduationAttempt({
      attempt_id:'graduation.attempt.crash',
      readback_owner_identity_digest:READBACK_OWNER,
      external_readback_owner:true,
      authored_by_candidate:false,
    });
    assert.equal(confirmed.state,'CONFIRMED_ACTIVE');
    assert.equal(confirmed.additional_effect_attempt_performed,false);
    assert.equal(recovered.governance().entries[0].state,'ACTIVE');

    // Crash BEFORE the effect: durable state still holds the exploration hold and
    // the predecessor governance; readback classifies a fresh attempt as required.
    const statePath2=path.join(root,'skill-state-2.json');
    const skill2=verifiedSkill({id:'skill.graduation.crash2',source:'c',impl:'d'});
    const store2=await seedExplorationOnlyStore(statePath2,skill2,'runtime.skill.library.graduation.crash2');
    const fx2=lifecycleFixture(store2,skill2);
    const fixture2=certificateFixture(fx2);
    await store2.prepareSkillGraduationAttempt({
      attempt_id:'graduation.attempt.crash2',
      graduation_certificate:fixture2.certificate,
      graduation_certificate_args:fixture2.args,
      effect_id_digest:d('graduation-effect-crash2'),
      idempotency_key_digest:d('graduation-idempotency-crash2'),
      effect_executor_identity_digest:FUTURE_EXECUTOR,
      ...EXECUTOR_ARGS,
    });
    await store2.recordSkillGraduationAttempted({
      attempt_id:'graduation.attempt.crash2',
      effect_executor_identity_digest:FUTURE_EXECUTOR,
      external_effect_executor:true,
      authored_by_candidate:false,
    });
    const recovered2=new RsiRuntimeSkillLifecycle({statePath:statePath2,source_sha:SOURCE});
    await recovered2.init();
    const notApplied=await recovered2.reconcileSkillGraduationAttempt({
      attempt_id:'graduation.attempt.crash2',
      readback_owner_identity_digest:READBACK_OWNER,
      external_readback_owner:true,
      authored_by_candidate:false,
    });
    assert.equal(notApplied.state,'CONFIRMED_NOT_ACTIVE_NEW_ATTEMPT_REQUIRED');
    assert.equal(notApplied.new_attempt_required,true);
    assert.equal(recovered2.governance().entries[0].state,'EXPLORATION_ACTIVE');
  }finally{await fs.rm(root,{recursive:true,force:true})}
});

test('graduation lifecycle trust root records one-attempt graduation policy without new authority',()=>{
  const root=rsiRuntimeSkillLifecycleTrustRootSnapshot();
  assert.equal(root.graduation_attempts_append_only,true);
  assert.equal(root.graduation_effect_attempt_limit,1);
  assert.equal(root.blind_retry_for_graduation_effect,false);
  assert.equal(root.pre_effect_state_readback_after_graduation_attempt_persist_required,true);
  assert.equal(root.ambiguous_graduation_effect_requires_readback_only_reconciliation,true);
  assert.equal(root.graduation_releases_exploration_hold_only,true);
  assert.equal(root.graduation_does_not_grant_execution_authority,true);
  assert.equal(root.graduation_does_not_mutate_library,true);
  assert.equal(root.graduation_executor_bound_to_certificate_future_executor,true);
  assert.equal(root.graduation_certificate_must_be_eligible_phase37b,true);
  assert.equal(root.graduation_projected_governance_cas_required,true);
  assert.equal(root.exploration_only_prevents_full_active,true);
  assert.equal(root.authority_effect,false);
});
