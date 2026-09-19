import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import { createRsiBrowserOutcomeEpisode } from '../src/rsi-browser-outcome-ingest.mjs';
import { createRsiStepCreditReceipt } from '../src/rsi-runtime-credit-assignment.mjs';
import {
  createRsiHeldSkillCreditAdmission,
  verifyRsiHeldSkillCreditAdmission,
  rsiHeldSkillCreditAdmissionTrustRootSnapshot,
} from '../src/rsi-held-skill-credit-admission.mjs';

const SOURCE='a'.repeat(40);
const SKILL=digest('held-skill');

function digest(label){
  return `sha256:${crypto.createHash('sha256').update(String(label),'utf8').digest('hex')}`;
}

function episode({recordedAt='2026-09-18T18:30:00.000Z',command='11111111-1111-4111-8111-111111111111'}={}){
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
        result:{moved:true},
        effect_outcome:'CONFIRMED',
        lane:'MUTATION',
        effect_key:'held-skill-credit-effect',
        execution_ms:8,
        recorded_at:recordedAt,
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
      task_id:'task.held.skill.credit',
      task_signature_digest:digest('task-signature'),
      environment_fingerprint:'env.held.skill.credit',
      model_family:'GPT_5_6_SOL',
      candidate_id:`candidate_sha256_${'9'.repeat(64)}`,
      candidate_sha:'e'.repeat(40),
      proposal_digest:digest('proposal'),
      skill_digests:[SKILL],
      trajectory_id:'trajectory.held.skill.credit',
      step_index:1,
      step_count:1,
      external_attribution:true,
      authored_by_candidate:false,
    },
  });
}

function credit(ep,sign='POSITIVE',overrides={}){
  return createRsiStepCreditReceipt({
    credit_id:`credit.held.skill.${sign.toLowerCase()}`,
    episode:ep,
    credit_sign:sign,
    credit_score:sign==='POSITIVE'?0.7:sign==='NEGATIVE'?-0.7:0,
    method:'EXTERNAL_STEP_EVALUATOR',
    evaluator_digest:digest('held-credit-evaluator'),
    evaluation_digest:digest('held-credit-evaluation-'+sign),
    failure_codes:sign==='NEGATIVE'?['NEGATIVE_TRANSFER']:[],
    lesson_digests:[digest('held-credit-lesson-'+sign)],
    evidence_refs:[`evidence:held-credit:${sign.toLowerCase()}`],
    external_credit_assigner:true,
    authored_by_candidate:false,
    ...overrides,
  });
}

function provenance(overrides={}){
  return {
    schema:'metaengine.rsi.admission-exposure-hold-provenance.v1',
    version:1,
    skill_digest:SKILL,
    admission_state:'CONFIRMED_APPLIED_STORAGE_ONLY',
    exposure_hold_observed:true,
    dormant_cap_observed:true,
    active_for_composition:false,
    retrieval_exposure_allowed:false,
    release_authority:false,
    provenance_digest:digest('provenance'),
    admission_attempt_digest:digest('admission-attempt'),
    confirmed_transition_digest:digest('confirmed-transition'),
    current_library_digest:digest('current-library'),
    current_governance_digest:digest('current-governance'),
    effect_executor_identity_digest:digest('storage-effect-executor'),
    confirmed_at:'2026-09-18T18:00:00.000Z',
    execution_authority:false,
    browser_authority:false,
    task_authority:false,
    scheduler_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
    ...overrides,
  };
}

function admissionArgs(ep,receipt,overrides={}){
  const p=provenance();
  return {
    admission_id:'held.credit.admission.1',
    source_sha:SOURCE,
    episode:ep,
    credit_receipt:receipt,
    admission_provenance:p,
    current_library_digest:p.current_library_digest,
    current_governance_digest:p.current_governance_digest,
    target_consumer_snapshot_digest:digest('consumer-snapshot'),
    evaluation_contract_digest:digest('evaluation-contract'),
    retention_evidence_digest:digest('retention-evidence'),
    retention_non_regression_pass:true,
    negative_transfer_clear:true,
    same_consumer_context_pass:true,
    external_admission_owner:true,
    authored_by_candidate:false,
    ...overrides,
  };
}

test('R9 positive held-skill credit requires fresh post-admission retention-safe exact-consumer evidence',()=>{
  const ep=episode();
  const receipt=credit(ep,'POSITIVE');
  const row=createRsiHeldSkillCreditAdmission(admissionArgs(ep,receipt));
  assert.equal(row.state,'ADMISSIBLE_POSITIVE_EXPLORATION_CREDIT');
  assert.equal(row.measurement_after_admission,true);
  assert.equal(row.positive_credit_eligible_for_lifecycle_evidence,true);
  assert.equal(row.credit_is_activation_authority,false);
  assert.equal(row.credit_is_exposure_release_authority,false);
  assert.equal(row.authority_effect,false);
  assert.equal(
    verifyRsiHeldSkillCreditAdmission(row,admissionArgs(ep,receipt)).admission_digest,
    row.admission_digest,
  );
});

test('R9 positive held-skill credit stays insufficient unless every freshness and retention gate passes',()=>{
  const ep=episode();
  const receipt=credit(ep,'POSITIVE');
  for(const field of ['retention_non_regression_pass','negative_transfer_clear','same_consumer_context_pass']){
    const row=createRsiHeldSkillCreditAdmission(admissionArgs(ep,receipt,{[field]:false}));
    assert.equal(row.state,'INSUFFICIENT_HELD_SKILL_CREDIT');
    assert.equal(row.positive_credit_eligible_for_lifecycle_evidence,false);
  }
});

test('R9 rejects pre-admission measurements and current library or governance drift',()=>{
  const early=episode({
    recordedAt:'2026-09-18T17:59:59.000Z',
    command:'22222222-2222-4222-8222-222222222222',
  });
  assert.throws(
    ()=>createRsiHeldSkillCreditAdmission(admissionArgs(early,credit(early,'POSITIVE'))),
    /measurement_not_post_admission/,
  );

  const ep=episode({command:'33333333-3333-4333-8333-333333333333'});
  const receipt=credit(ep,'POSITIVE');
  assert.throws(
    ()=>createRsiHeldSkillCreditAdmission(admissionArgs(ep,receipt,{current_library_digest:digest('drifted-library')})),
    /current_library_drift/,
  );
  assert.throws(
    ()=>createRsiHeldSkillCreditAdmission(admissionArgs(ep,receipt,{current_governance_digest:digest('drifted-governance')})),
    /current_governance_drift/,
  );
});

test('R9 retains negative held-skill credit as safety evidence without granting activation',()=>{
  const ep=episode({command:'44444444-4444-4444-8444-444444444444'});
  const receipt=credit(ep,'NEGATIVE');
  const row=createRsiHeldSkillCreditAdmission(admissionArgs(ep,receipt,{
    retention_non_regression_pass:false,
    negative_transfer_clear:false,
    same_consumer_context_pass:false,
  }));
  assert.equal(row.state,'ADMISSIBLE_NEGATIVE_SAFETY_CREDIT');
  assert.equal(row.negative_credit_eligible_for_safety_evidence,true);
  assert.equal(row.positive_credit_eligible_for_lifecycle_evidence,false);
  assert.equal(row.skill_activation_performed,false);
  assert.equal(row.retrieval_exposure_changed,false);
});

test('R9 held-credit trust root keeps credit separate from exposure and activation authority',()=>{
  const root=rsiHeldSkillCreditAdmissionTrustRootSnapshot();
  assert.equal(root.confirmed_storage_admission_provenance_required,true);
  assert.equal(root.measurement_must_be_after_confirmed_admission,true);
  assert.equal(root.exact_current_library_and_governance_required,true);
  assert.equal(root.positive_credit_requires_retention_non_regression,true);
  assert.equal(root.positive_credit_requires_negative_transfer_clear,true);
  assert.equal(root.positive_credit_requires_same_consumer_context,true);
  assert.equal(root.negative_credit_retained_as_safety_evidence,true);
  assert.equal(root.credit_is_not_activation_authority,true);
  assert.equal(root.credit_is_not_exposure_release_authority,true);
  assert.equal(root.authority_effect,false);
});
