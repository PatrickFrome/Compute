import crypto from 'node:crypto';

export const RSI_POST_APPEND_CONSUMER_CREDIT_SCHEMA='metaengine.rsi.post-append-consumer-credit.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;

function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]))}
function digest(v){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`}
function exactSha(v,l){const o=String(v||'').trim().toLowerCase();if(!SHA40_RE.test(o))throw new Error(`rsi_post_append_credit_${l}_sha_invalid`);return o}
function exactDigest(v,l){const o=String(v||'').trim().toLowerCase();if(!SHA256_RE.test(o))throw new Error(`rsi_post_append_credit_${l}_digest_invalid`);return o}
function boundedId(v,l){const o=String(v||'').trim();if(!SAFE_ID_RE.test(o))throw new Error(`rsi_post_append_credit_${l}_invalid`);return o}
function nonNegativeInt(v,l,max=1_000_000){const o=Number(v);if(!Number.isSafeInteger(o)||o<0||o>max)throw new Error(`rsi_post_append_credit_${l}_invalid`);return o}
function finiteNumber(v,l){const o=Number(v);if(!Number.isFinite(o))throw new Error(`rsi_post_append_credit_${l}_invalid`);return o}
function assertTrue(v,l){if(v!==true)throw new Error(`rsi_post_append_credit_${l}_required`)}
function assertFalse(v,l){if(v!==false)throw new Error(`rsi_post_append_credit_${l}_must_be_false`)}

function verifyAdmissionProvenance(provenance,skillDigest){
  if(!provenance||provenance.schema!=='metaengine.rsi.admission-exposure-hold-provenance.v1'||provenance.version!==1){
    throw new Error('rsi_post_append_credit_admission_provenance_invalid');
  }
  if(exactDigest(provenance.skill_digest,'provenance_skill')!==skillDigest)throw new Error('rsi_post_append_credit_admission_skill_mismatch');
  if(provenance.admission_state!=='CONFIRMED_APPLIED_STORAGE_ONLY'||provenance.exposure_hold_observed!==true
    ||provenance.dormant_cap_observed!==true||provenance.active_for_composition!==false
    ||provenance.retrieval_exposure_allowed!==false||provenance.release_authority!==false){
    throw new Error('rsi_post_append_credit_admission_provenance_not_storage_only');
  }
  for(const field of ['execution_authority','browser_authority','task_authority','scheduler_authority','production_mutation_authority','promotion_authority','self_update_authority','automatic_retry_allowed','authority_effect']){
    assertFalse(provenance[field],`provenance_${field}`);
  }
  for(const field of ['provenance_digest','admission_attempt_digest','admission_certificate_digest','effect_id_digest','effect_executor_identity_digest','idempotency_key_digest','admitted_successor_library_digest','confirmed_transition_digest','current_library_digest','current_governance_digest']){
    exactDigest(provenance[field],`provenance_${field}`);
  }
  return provenance;
}

export function createRsiPostAppendConsumerCredit({
  credit_id,
  source_sha,
  skill_digest,
  admission_provenance,
  current_library_digest,
  current_governance_digest,
  target_consumer_identity_digest,
  target_consumer_context_digest,
  evaluation_contract_digest,
  matched_control_receipt_digest,
  treatment_receipt_digest,
  retention_evidence_digest,
  credit_assigner_identity_digest,
  measured_net_delta,
  regression_count=0,
  negative_transfer_count=0,
  retention_regression_count=0,
  hard_invariant_failure_count=0,
  same_instances_pass=false,
  same_harness_pass=false,
  same_budget_pass=false,
  from_scratch_replay_pass=false,
  contamination_clear=false,
  retention_gate_pass=false,
  fresh_post_append_measurement=false,
  measurement_captured_after_admission=false,
  external_credit_assigner=false,
  authored_by_candidate=true,
}={}){
  const skill=exactDigest(skill_digest,'skill');
  const provenance=verifyAdmissionProvenance(admission_provenance,skill);
  const libraryDigest=exactDigest(current_library_digest,'current_library');
  const governanceDigest=exactDigest(current_governance_digest,'current_governance');
  if(provenance.current_library_digest!==libraryDigest)throw new Error('rsi_post_append_credit_library_drift');
  if(provenance.current_governance_digest!==governanceDigest)throw new Error('rsi_post_append_credit_governance_drift');
  if(external_credit_assigner!==true||authored_by_candidate!==false)throw new Error('rsi_post_append_credit_external_assigner_required');
  assertTrue(fresh_post_append_measurement,'fresh_post_append_measurement');
  assertTrue(measurement_captured_after_admission,'measurement_captured_after_admission');
  assertTrue(same_instances_pass,'same_instances_pass');
  assertTrue(same_harness_pass,'same_harness_pass');
  assertTrue(same_budget_pass,'same_budget_pass');
  assertTrue(from_scratch_replay_pass,'from_scratch_replay_pass');
  assertTrue(contamination_clear,'contamination_clear');

  const assigner=exactDigest(credit_assigner_identity_digest,'credit_assigner_identity');
  if(assigner===provenance.effect_executor_identity_digest)throw new Error('rsi_post_append_credit_assigner_effect_executor_collapse');

  const regressions=nonNegativeInt(regression_count,'regression_count');
  const negativeTransfer=nonNegativeInt(negative_transfer_count,'negative_transfer_count');
  const retentionRegressions=nonNegativeInt(retention_regression_count,'retention_regression_count');
  const hardFailures=nonNegativeInt(hard_invariant_failure_count,'hard_invariant_failure_count');
  const delta=finiteNumber(measured_net_delta,'measured_net_delta');

  let creditSign='INSUFFICIENT';
  if(regressions>0||negativeTransfer>0||retentionRegressions>0||hardFailures>0||retention_gate_pass!==true||delta<0){
    creditSign='NEGATIVE';
  }else if(delta>0){
    creditSign='POSITIVE';
  }

  const core={
    schema:RSI_POST_APPEND_CONSUMER_CREDIT_SCHEMA,version:1,
    credit_id:boundedId(credit_id,'credit_id'),
    source_sha:exactSha(source_sha,'source'),
    skill_digest:skill,
    admission_provenance_digest:provenance.provenance_digest,
    admission_attempt_digest:provenance.admission_attempt_digest,
    admission_effect_id_digest:provenance.effect_id_digest,
    admission_effect_executor_identity_digest:provenance.effect_executor_identity_digest,
    confirmed_admission_transition_digest:provenance.confirmed_transition_digest,
    current_library_digest:libraryDigest,
    current_governance_digest:governanceDigest,
    target_consumer_identity_digest:exactDigest(target_consumer_identity_digest,'target_consumer_identity'),
    target_consumer_context_digest:exactDigest(target_consumer_context_digest,'target_consumer_context'),
    evaluation_contract_digest:exactDigest(evaluation_contract_digest,'evaluation_contract'),
    matched_control_receipt_digest:exactDigest(matched_control_receipt_digest,'matched_control_receipt'),
    treatment_receipt_digest:exactDigest(treatment_receipt_digest,'treatment_receipt'),
    retention_evidence_digest:exactDigest(retention_evidence_digest,'retention_evidence'),
    credit_assigner_identity_digest:assigner,
    measured_net_delta:delta,
    regression_count:regressions,
    negative_transfer_count:negativeTransfer,
    retention_regression_count:retentionRegressions,
    hard_invariant_failure_count:hardFailures,
    same_instances_pass:true,same_harness_pass:true,same_budget_pass:true,
    from_scratch_replay_pass:true,contamination_clear:true,
    retention_gate_pass:retention_gate_pass===true,
    fresh_post_append_measurement:true,
    measurement_captured_after_admission:true,
    credit_sign:creditSign,
    storage_admission_is_credit:false,
    release_review_is_credit:false,
    review_digest_used_as_credit:false,
    candidate_can_author_credit:false,
    credit_is_activation_authority:false,
    credit_is_exposure_release_authority:false,
    retrieval_exposure_changed:false,
    skill_activation_performed:false,
    external_credit_assigner:true,
    authored_by_candidate:false,
    execution_authority:false,browser_authority:false,task_authority:false,scheduler_authority:false,
    production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...core,credit_digest:digest(core)});
}

export function verifyRsiPostAppendConsumerCredit(receipt,{
  source_sha,
  skill_digest,
  admission_provenance,
  current_library_digest,
  current_governance_digest,
}={}){
  if(!receipt||receipt.schema!==RSI_POST_APPEND_CONSUMER_CREDIT_SCHEMA||receipt.version!==1){
    throw new Error('rsi_post_append_credit_receipt_invalid');
  }
  const canonical=createRsiPostAppendConsumerCredit({
    credit_id:receipt.credit_id,
    source_sha,
    skill_digest,
    admission_provenance,
    current_library_digest,
    current_governance_digest,
    target_consumer_identity_digest:receipt.target_consumer_identity_digest,
    target_consumer_context_digest:receipt.target_consumer_context_digest,
    evaluation_contract_digest:receipt.evaluation_contract_digest,
    matched_control_receipt_digest:receipt.matched_control_receipt_digest,
    treatment_receipt_digest:receipt.treatment_receipt_digest,
    retention_evidence_digest:receipt.retention_evidence_digest,
    credit_assigner_identity_digest:receipt.credit_assigner_identity_digest,
    measured_net_delta:receipt.measured_net_delta,
    regression_count:receipt.regression_count,
    negative_transfer_count:receipt.negative_transfer_count,
    retention_regression_count:receipt.retention_regression_count,
    hard_invariant_failure_count:receipt.hard_invariant_failure_count,
    same_instances_pass:receipt.same_instances_pass,
    same_harness_pass:receipt.same_harness_pass,
    same_budget_pass:receipt.same_budget_pass,
    from_scratch_replay_pass:receipt.from_scratch_replay_pass,
    contamination_clear:receipt.contamination_clear,
    retention_gate_pass:receipt.retention_gate_pass,
    fresh_post_append_measurement:receipt.fresh_post_append_measurement,
    measurement_captured_after_admission:receipt.measurement_captured_after_admission,
    external_credit_assigner:receipt.external_credit_assigner,
    authored_by_candidate:receipt.authored_by_candidate,
  });
  if(canonical.credit_digest!==exactDigest(receipt.credit_digest,'credit'))throw new Error('rsi_post_append_credit_digest_mismatch');
  return canonical;
}

export function rsiPostAppendConsumerCreditTrustRootSnapshot(){
  return Object.freeze({
    schema:RSI_POST_APPEND_CONSUMER_CREDIT_SCHEMA,
    exact_confirmed_storage_admission_provenance_required:true,
    exact_current_library_and_governance_required:true,
    fresh_post_append_measurement_required:true,
    target_consumer_identity_required:true,
    matched_control_treatment_required:true,
    same_instances_harness_budget_required:true,
    from_scratch_replay_required:true,
    contamination_clear_required:true,
    retention_gate_required_for_positive_credit:true,
    admission_storage_is_not_credit:true,
    exposure_review_is_not_credit:true,
    credit_assigner_separate_from_storage_effect_executor:true,
    positive_credit_is_not_activation_authority:true,
    positive_credit_is_not_release_authority:true,
    negative_credit_retained:true,
    insufficient_credit_cannot_open_exploration:true,
    browser_authority:false,task_authority:false,scheduler_authority:false,execution_authority:false,
    promotion_authority:false,self_update_authority:false,authority_effect:false,
  });
}
