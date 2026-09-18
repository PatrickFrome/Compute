import crypto from 'node:crypto';

import {
  verifyRsiSkillCapsule,
  verifyRsiSkillEvidence,
} from './rsi-verified-skill-library.mjs';

export const RSI_SKILL_TRAJECTORY_RECEIPT_SCHEMA = 'metaengine.rsi.skill-trajectory-receipt.v1';
export const RSI_SKILL_RELIABILITY_DATASET_SCHEMA = 'metaengine.rsi.skill-reliability-dataset.v1';
export const RSI_SKILL_CONTRASTIVE_REVISION_SCHEMA = 'metaengine.rsi.skill-contrastive-revision.v1';
export const RSI_SKILL_RELIABILITY_EVAL_SCHEMA = 'metaengine.rsi.skill-reliability-evaluation.v1';
export const RSI_SKILL_RELIABILITY_RESULT_SCHEMA = 'metaengine.rsi.skill-reliability-result.v1';

const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const SAFE_TOKEN_RE=/^[A-Z0-9][A-Z0-9_.:-]{0,95}$/;
const MAX_RECEIPTS=2048;
const MAX_COHORTS=256;
const MAX_REPEATS=16;
const MAX_EVIDENCE_REFS=32;

const OUTCOMES=new Set([
  'SUCCESS',
  'FAILURE',
  'CORRECT_LIMIT',
  'UNSUPPORTED_ACTION',
  'UNSUPPORTED_CLAIM',
  'MISSED_CLARIFICATION',
  'POLICY_VIOLATION',
  'INSUFFICIENT_EVIDENCE',
]);

const CONTRAST_CODES=new Set([
  'ACTED_ON_INCOMPLETE_INFORMATION',
  'MISSED_CLARIFICATION',
  'UNSUPPORTED_CAPABILITY_CLAIM',
  'UNSUPPORTED_ACTION_ATTEMPT',
  'POLICY_CONSTRAINT_MISSED',
  'INCONSISTENT_TOOL_ROUTING',
  'SUCCESS_PATTERN_MISSING_FROM_FAILURE',
  'LIMIT_AWARENESS_PATTERN',
  'OTHER_EXTERNALLY_VERIFIED_PATTERN',
]);

function plainObject(value){
  if(!value||typeof value!=='object'||Array.isArray(value)) return false;
  const proto=Object.getPrototypeOf(value);
  return proto===Object.prototype||proto===null;
}
function stable(value){
  if(Array.isArray(value)) return value.map(stable);
  if(!value||typeof value!=='object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((k)=>[k,stable(value[k])]));
}
function digest(value){
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)),'utf8').digest('hex')}`;
}
function exactDigest(value,label){
  const out=String(value||'').toLowerCase();
  if(!SHA256_RE.test(out)) throw new Error(`rsi_reliability_${label}_digest_invalid`);
  return out;
}
function boundedId(value,label){
  const out=String(value||'').trim();
  if(!SAFE_ID_RE.test(out)) throw new Error(`rsi_reliability_${label}_invalid`);
  return out;
}
function boundedToken(value,label){
  const out=String(value||'').trim().toUpperCase();
  if(!SAFE_TOKEN_RE.test(out)) throw new Error(`rsi_reliability_${label}_invalid`);
  return out;
}
function positiveInt(value,label,max=Number.MAX_SAFE_INTEGER){
  const out=Number(value);
  if(!Number.isSafeInteger(out)||out<1||out>max) throw new Error(`rsi_reliability_${label}_invalid`);
  return out;
}
function nonNegativeInt(value,label,max=Number.MAX_SAFE_INTEGER){
  const out=Number(value);
  if(!Number.isSafeInteger(out)||out<0||out>max) throw new Error(`rsi_reliability_${label}_invalid`);
  return out;
}
function finiteNumber(value,label){
  const out=Number(value);
  if(!Number.isFinite(out)) throw new Error(`rsi_reliability_${label}_invalid`);
  return out;
}
function normalizeRefs(value){
  if(!Array.isArray(value)||value.length<1||value.length>MAX_EVIDENCE_REFS) throw new Error('rsi_reliability_evidence_refs_invalid');
  const seen=new Set();
  return Object.freeze(value.map((raw)=>{
    const ref=boundedId(raw,'evidence_ref');
    if(seen.has(ref)) throw new Error('rsi_reliability_evidence_ref_duplicate');
    seen.add(ref); return ref;
  }).sort());
}
function zeroAuthority(extra={}){
  return Object.freeze({
    ...extra,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    signing_authority:false,
    direct_tool_execution_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  });
}
function assertZeroAuthority(value,label){
  for(const field of [
    'execution_authority','production_mutation_authority','promotion_authority',
    'self_update_authority','scheduler_authority','signing_authority',
    'direct_tool_execution_authority','authority_effect',
  ]){
    if(value?.[field]!==false) throw new Error(`rsi_reliability_${label}_${field}_invalid`);
  }
  if(value?.automatic_retry_allowed!==false) throw new Error(`rsi_reliability_${label}_automatic_retry_invalid`);
}
function isCorrectOutcome(outcome){
  return outcome==='SUCCESS'||outcome==='CORRECT_LIMIT';
}
function isLimitViolation(outcome){
  return ['UNSUPPORTED_ACTION','UNSUPPORTED_CLAIM','MISSED_CLARIFICATION','POLICY_VIOLATION'].includes(outcome);
}

export function createRsiSkillTrajectoryReceipt({
  receipt_id,
  skill,
  skill_evidence,
  cohort_id,
  repeat_index,
  state_signature_digest,
  deployment_view_digest,
  outcome,
  invoked_skill,
  capability_sufficient,
  clarification_required,
  unsupported_success_claim,
  evidence_digest,
  evidence_refs,
  external_evaluator=false,
  authored_by_candidate=true,
}={}){
  const checkedSkill=verifyRsiSkillCapsule(skill);
  const checkedEvidence=verifyRsiSkillEvidence(skill_evidence,checkedSkill);
  if(checkedEvidence.verified_for_library!==true||checkedEvidence.hard_invariants_pass!==true) throw new Error('rsi_reliability_skill_not_verified');
  if(external_evaluator!==true||authored_by_candidate!==false) throw new Error('rsi_reliability_trajectory_external_origin_required');
  const normalizedOutcome=boundedToken(outcome,'outcome');
  if(!OUTCOMES.has(normalizedOutcome)) throw new Error('rsi_reliability_outcome_invalid');
  if(invoked_skill!==true) throw new Error('rsi_reliability_invoked_skill_required');
  const sufficient=capability_sufficient===true;
  const clarify=clarification_required===true;
  const unsupportedClaim=unsupported_success_claim===true;
  if(normalizedOutcome==='CORRECT_LIMIT'&&(sufficient||unsupportedClaim)) throw new Error('rsi_reliability_correct_limit_inconsistent');
  if(normalizedOutcome==='SUCCESS'&&unsupportedClaim) throw new Error('rsi_reliability_success_claim_inconsistent');

  const core={
    schema:RSI_SKILL_TRAJECTORY_RECEIPT_SCHEMA,
    version:1,
    receipt_id:boundedId(receipt_id,'receipt_id'),
    skill_id:checkedSkill.skill_id,
    skill_version:checkedSkill.skill_version,
    skill_digest:checkedSkill.skill_digest,
    skill_evidence_digest:checkedEvidence.evidence_digest,
    cohort_id:boundedId(cohort_id,'cohort_id'),
    repeat_index:positiveInt(repeat_index,'repeat_index',MAX_REPEATS),
    state_signature_digest:exactDigest(state_signature_digest,'state_signature'),
    deployment_view_digest:exactDigest(deployment_view_digest,'deployment_view'),
    outcome:normalizedOutcome,
    correct_outcome:isCorrectOutcome(normalizedOutcome),
    limit_violation:isLimitViolation(normalizedOutcome),
    invoked_skill:true,
    capability_sufficient:sufficient,
    clarification_required:clarify,
    unsupported_success_claim:unsupportedClaim,
    evidence_digest:exactDigest(evidence_digest,'trajectory_evidence'),
    evidence_refs:normalizeRefs(evidence_refs),
    external_evaluator:true,
    authored_by_candidate:false,
    raw_model_transcript_stored:false,
    raw_page_text_stored:false,
    raw_user_input_stored:false,
    privileged_diagnosis_exposed_to_actor:false,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    signing_authority:false,
    direct_tool_execution_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...core,trajectory_digest:digest(core)});
}

export function verifyRsiSkillTrajectoryReceipt(receipt,skill,skill_evidence){
  if(!plainObject(receipt)||receipt.schema!==RSI_SKILL_TRAJECTORY_RECEIPT_SCHEMA||receipt.version!==1) throw new Error('rsi_reliability_trajectory_invalid');
  assertZeroAuthority(receipt,'trajectory');
  if(
    receipt.external_evaluator!==true
    ||receipt.authored_by_candidate!==false
    ||receipt.raw_model_transcript_stored!==false
    ||receipt.raw_page_text_stored!==false
    ||receipt.raw_user_input_stored!==false
    ||receipt.privileged_diagnosis_exposed_to_actor!==false
  ) throw new Error('rsi_reliability_trajectory_policy_invalid');
  const canonical=createRsiSkillTrajectoryReceipt({
    receipt_id:receipt.receipt_id,
    skill,skill_evidence,
    cohort_id:receipt.cohort_id,
    repeat_index:receipt.repeat_index,
    state_signature_digest:receipt.state_signature_digest,
    deployment_view_digest:receipt.deployment_view_digest,
    outcome:receipt.outcome,
    invoked_skill:receipt.invoked_skill,
    capability_sufficient:receipt.capability_sufficient,
    clarification_required:receipt.clarification_required,
    unsupported_success_claim:receipt.unsupported_success_claim,
    evidence_digest:receipt.evidence_digest,
    evidence_refs:receipt.evidence_refs,
    external_evaluator:true,
    authored_by_candidate:false,
  });
  if(canonical.trajectory_digest!==exactDigest(receipt.trajectory_digest,'trajectory')) throw new Error('rsi_reliability_trajectory_digest_mismatch');
  return canonical;
}

function summarizeCohorts(receipts){
  const groups=new Map();
  for(const row of receipts){
    if(!groups.has(row.cohort_id)) groups.set(row.cohort_id,[]);
    groups.get(row.cohort_id).push(row);
  }
  if(groups.size<1||groups.size>MAX_COHORTS) throw new Error('rsi_reliability_cohort_count_invalid');
  const summaries=[];
  for(const [cohortId,rows] of groups){
    rows.sort((a,b)=>a.repeat_index-b.repeat_index);
    if(rows.length<2||rows.length>MAX_REPEATS) throw new Error('rsi_reliability_repeat_count_invalid');
    const expectedState=rows[0].state_signature_digest;
    const expectedDeployment=rows[0].deployment_view_digest;
    if(rows.some((row)=>row.state_signature_digest!==expectedState||row.deployment_view_digest!==expectedDeployment)) {
      throw new Error('rsi_reliability_repeated_trial_context_drift');
    }
    const indices=new Set(rows.map((row)=>row.repeat_index));
    if(indices.size!==rows.length) throw new Error('rsi_reliability_repeat_index_duplicate');
    const correct=rows.filter((row)=>row.correct_outcome).length;
    const limitViolations=rows.filter((row)=>row.limit_violation).length;
    summaries.push(Object.freeze({
      cohort_id:cohortId,
      state_signature_digest:expectedState,
      deployment_view_digest:expectedDeployment,
      repeat_count:rows.length,
      correct_count:correct,
      incorrect_count:rows.length-correct,
      limit_violation_count:limitViolations,
      potential_success:correct>0,
      consistent_success:correct===rows.length,
      consistency_rate:correct/rows.length,
      outcome_counts:Object.freeze(Object.fromEntries([...OUTCOMES].sort().map((outcome)=>[outcome,rows.filter((row)=>row.outcome===outcome).length]))),
    }));
  }
  return Object.freeze(summaries.sort((a,b)=>a.cohort_id.localeCompare(b.cohort_id)));
}

export function createRsiSkillReliabilityDataset({
  dataset_id,
  skill,
  skill_evidence,
  trajectory_receipts,
  hidden_repeated_trial_set_digest,
  external_dataset_owner=false,
  authored_by_candidate=true,
}={}){
  const checkedSkill=verifyRsiSkillCapsule(skill);
  verifyRsiSkillEvidence(skill_evidence,checkedSkill);
  if(external_dataset_owner!==true||authored_by_candidate!==false) throw new Error('rsi_reliability_dataset_external_origin_required');
  if(!Array.isArray(trajectory_receipts)||trajectory_receipts.length<2||trajectory_receipts.length>MAX_RECEIPTS) throw new Error('rsi_reliability_dataset_receipts_invalid');
  const receipts=trajectory_receipts.map((row)=>verifyRsiSkillTrajectoryReceipt(row,checkedSkill,skill_evidence));
  const digests=new Set();
  for(const row of receipts){
    if(digests.has(row.trajectory_digest)) throw new Error('rsi_reliability_trajectory_duplicate');
    digests.add(row.trajectory_digest);
  }
  const cohorts=summarizeCohorts(receipts);
  const potentialCount=cohorts.filter((row)=>row.potential_success).length;
  const consistentCount=cohorts.filter((row)=>row.consistent_success).length;
  const limitViolationCount=cohorts.reduce((sum,row)=>sum+row.limit_violation_count,0);
  const totalTrials=receipts.length;
  const core={
    schema:RSI_SKILL_RELIABILITY_DATASET_SCHEMA,
    version:1,
    dataset_id:boundedId(dataset_id,'dataset_id'),
    skill_id:checkedSkill.skill_id,
    skill_version:checkedSkill.skill_version,
    skill_digest:checkedSkill.skill_digest,
    skill_evidence_digest:skill_evidence.evidence_digest,
    hidden_repeated_trial_set_digest:exactDigest(hidden_repeated_trial_set_digest,'hidden_trial_set'),
    trajectory_digests:Object.freeze(receipts.map((row)=>row.trajectory_digest).sort()),
    trajectory_count:totalTrials,
    cohorts,
    cohort_count:cohorts.length,
    potential_success_cohort_count:potentialCount,
    consistent_success_cohort_count:consistentCount,
    potential_success_rate:potentialCount/cohorts.length,
    consistent_success_rate:consistentCount/cohorts.length,
    reliability_gap:(potentialCount-consistentCount)/cohorts.length,
    limit_violation_count:limitViolationCount,
    limit_violation_rate:limitViolationCount/totalTrials,
    pass_any_and_pass_all_both_reported:true,
    repeated_trials_required:true,
    deployment_faithful_context_required:true,
    consistency_is_first_class_metric:true,
    limit_awareness_is_first_class_metric:true,
    external_dataset_owner:true,
    authored_by_candidate:false,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    signing_authority:false,
    direct_tool_execution_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...core,dataset_digest:digest(core)});
}

export function verifyRsiSkillReliabilityDataset(dataset,skill,skill_evidence){
  if(!plainObject(dataset)||dataset.schema!==RSI_SKILL_RELIABILITY_DATASET_SCHEMA||dataset.version!==1) throw new Error('rsi_reliability_dataset_invalid');
  assertZeroAuthority(dataset,'dataset');
  if(
    dataset.pass_any_and_pass_all_both_reported!==true
    ||dataset.repeated_trials_required!==true
    ||dataset.deployment_faithful_context_required!==true
    ||dataset.consistency_is_first_class_metric!==true
    ||dataset.limit_awareness_is_first_class_metric!==true
    ||dataset.external_dataset_owner!==true
    ||dataset.authored_by_candidate!==false
  ) throw new Error('rsi_reliability_dataset_policy_invalid');
  const receiptByDigest=new Map();
  // Verification is intentionally digest-bound; full trajectory objects are supplied via _trajectory_receipts.
  if(!Array.isArray(dataset._trajectory_receipts)) throw new Error('rsi_reliability_dataset_verification_receipts_required');
  for(const row of dataset._trajectory_receipts) receiptByDigest.set(row.trajectory_digest,row);
  const receipts=dataset.trajectory_digests.map((d)=>{
    const row=receiptByDigest.get(d);
    if(!row) throw new Error('rsi_reliability_dataset_trajectory_missing');
    return row;
  });
  const canonical=createRsiSkillReliabilityDataset({
    dataset_id:dataset.dataset_id,
    skill,skill_evidence,
    trajectory_receipts:receipts,
    hidden_repeated_trial_set_digest:dataset.hidden_repeated_trial_set_digest,
    external_dataset_owner:true,
    authored_by_candidate:false,
  });
  const compare=structuredClone(dataset);
  delete compare._trajectory_receipts;
  if(canonical.dataset_digest!==exactDigest(compare.dataset_digest,'dataset')) throw new Error('rsi_reliability_dataset_digest_mismatch');
  return canonical;
}

function datasetWithReceipts(dataset,receipts){
  return Object.freeze({...dataset,_trajectory_receipts:Object.freeze(receipts)});
}

export function attachRsiReliabilityDatasetReceipts(dataset,receipts){
  if(!plainObject(dataset)||dataset.schema!==RSI_SKILL_RELIABILITY_DATASET_SCHEMA) throw new Error('rsi_reliability_dataset_invalid');
  if(!Array.isArray(receipts)||receipts.length!==dataset.trajectory_count) throw new Error('rsi_reliability_dataset_receipt_attachment_invalid');
  return datasetWithReceipts(dataset,receipts);
}

export function createRsiContrastiveSkillRevision({
  revision_id,
  parent_skill,
  parent_skill_evidence,
  reliability_dataset,
  trajectory_receipts,
  successor_skill,
  contrast_codes,
  contrast_evidence_digest,
  evidence_refs,
  external_curator=false,
  authored_by_candidate=true,
}={}){
  const parent=verifyRsiSkillCapsule(parent_skill);
  verifyRsiSkillEvidence(parent_skill_evidence,parent);
  const dataset=verifyRsiSkillReliabilityDataset(
    attachRsiReliabilityDatasetReceipts(reliability_dataset,trajectory_receipts),
    parent,parent_skill_evidence,
  );
  if(external_curator!==true||authored_by_candidate!==false) throw new Error('rsi_reliability_revision_external_origin_required');
  const successor=verifyRsiSkillCapsule(successor_skill);
  if(successor.skill_id!==parent.skill_id) throw new Error('rsi_reliability_successor_skill_id_mismatch');
  if(successor.skill_version!==parent.skill_version+1) throw new Error('rsi_reliability_successor_version_not_advanced');
  if(successor.parent_skill_digest!==parent.skill_digest) throw new Error('rsi_reliability_successor_parent_mismatch');
  if(successor.role!==parent.role||successor.input_schema_digest!==parent.input_schema_digest||successor.output_schema_digest!==parent.output_schema_digest) {
    throw new Error('rsi_reliability_successor_interface_drift');
  }
  if(JSON.stringify(successor.capabilities)!==JSON.stringify(parent.capabilities)) throw new Error('rsi_reliability_successor_capability_drift');
  if(!Array.isArray(contrast_codes)||contrast_codes.length<1||contrast_codes.length>16) throw new Error('rsi_reliability_contrast_codes_invalid');
  const codes=[...new Set(contrast_codes.map((raw)=>{
    const code=boundedToken(raw,'contrast_code');
    if(!CONTRAST_CODES.has(code)) throw new Error('rsi_reliability_contrast_code_invalid');
    return code;
  }))].sort();
  const core={
    schema:RSI_SKILL_CONTRASTIVE_REVISION_SCHEMA,
    version:1,
    revision_id:boundedId(revision_id,'revision_id'),
    parent_skill_digest:parent.skill_digest,
    parent_skill_version:parent.skill_version,
    successor_skill:successor,
    successor_skill_digest:successor.skill_digest,
    successor_skill_version:successor.skill_version,
    dataset_digest:dataset.dataset_digest,
    hidden_repeated_trial_set_digest:dataset.hidden_repeated_trial_set_digest,
    baseline_potential_success_rate:dataset.potential_success_rate,
    baseline_consistent_success_rate:dataset.consistent_success_rate,
    baseline_reliability_gap:dataset.reliability_gap,
    baseline_limit_violation_rate:dataset.limit_violation_rate,
    contrast_codes:Object.freeze(codes),
    contrast_evidence_digest:exactDigest(contrast_evidence_digest,'contrast_evidence'),
    evidence_refs:normalizeRefs(evidence_refs),
    success_failure_contrast_required:true,
    invoked_skill_grouping_required:true,
    deployment_faithful_reconstruction_required:true,
    de_hardcoding_required:true,
    task_identifiers_allowed_in_successor:false,
    memorized_answers_allowed_in_successor:false,
    environment_specific_values_allowed_in_successor:false,
    reliability_evaluation_required:true,
    v126_source_preservation_still_required:true,
    v124_library_evidence_still_required:true,
    external_curator:true,
    authored_by_candidate:false,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    signing_authority:false,
    direct_tool_execution_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...core,revision_digest:digest(core)});
}

export function createRsiSkillReliabilityEvaluation({
  evaluation_id,
  revision,
  parent_skill,
  parent_skill_evidence,
  baseline_dataset,
  baseline_trajectory_receipts,
  successor_skill_evidence,
  successor_dataset,
  successor_trajectory_receipts,
  hard_invariants_pass,
  max_potential_regression=0,
  evidence_refs,
  external_evaluator=false,
  authored_by_candidate=true,
}={}){
  if(!plainObject(revision)||revision.schema!==RSI_SKILL_CONTRASTIVE_REVISION_SCHEMA||revision.version!==1) throw new Error('rsi_reliability_revision_invalid');
  assertZeroAuthority(revision,'revision');
  const parent=verifyRsiSkillCapsule(parent_skill);
  verifyRsiSkillEvidence(parent_skill_evidence,parent);
  const baseline=verifyRsiSkillReliabilityDataset(
    attachRsiReliabilityDatasetReceipts(baseline_dataset,baseline_trajectory_receipts),parent,parent_skill_evidence,
  );
  const successor=verifyRsiSkillCapsule(revision.successor_skill);
  const successorEvidence=verifyRsiSkillEvidence(successor_skill_evidence,successor);
  const after=verifyRsiSkillReliabilityDataset(
    attachRsiReliabilityDatasetReceipts(successor_dataset,successor_trajectory_receipts),successor,successorEvidence,
  );
  if(external_evaluator!==true||authored_by_candidate!==false) throw new Error('rsi_reliability_evaluation_external_origin_required');
  if(baseline.hidden_repeated_trial_set_digest!==after.hidden_repeated_trial_set_digest) throw new Error('rsi_reliability_hidden_trial_set_drift');
  if(baseline.cohort_count!==after.cohort_count) throw new Error('rsi_reliability_cohort_count_drift');
  const regression=finiteNumber(max_potential_regression,'max_potential_regression');
  if(regression<0||regression>0.2) throw new Error('rsi_reliability_max_potential_regression_invalid');
  const hard=hard_invariants_pass===true;
  const potentialDelta=after.potential_success_rate-baseline.potential_success_rate;
  const consistencyDelta=after.consistent_success_rate-baseline.consistent_success_rate;
  const limitViolationDelta=after.limit_violation_rate-baseline.limit_violation_rate;
  const reliableGain=consistencyDelta>0||limitViolationDelta<0;
  const potentialPreserved=potentialDelta>=-regression;
  const pass=hard&&reliableGain&&potentialPreserved;
  const core={
    schema:RSI_SKILL_RELIABILITY_EVAL_SCHEMA,
    version:1,
    evaluation_id:boundedId(evaluation_id,'evaluation_id'),
    revision_digest:exactDigest(revision.revision_digest,'revision'),
    parent_skill_digest:parent.skill_digest,
    successor_skill_digest:successor.skill_digest,
    baseline_dataset_digest:baseline.dataset_digest,
    successor_dataset_digest:after.dataset_digest,
    hidden_repeated_trial_set_digest:baseline.hidden_repeated_trial_set_digest,
    baseline_potential_success_rate:baseline.potential_success_rate,
    successor_potential_success_rate:after.potential_success_rate,
    potential_success_delta:potentialDelta,
    baseline_consistent_success_rate:baseline.consistent_success_rate,
    successor_consistent_success_rate:after.consistent_success_rate,
    consistent_success_delta:consistencyDelta,
    baseline_limit_violation_rate:baseline.limit_violation_rate,
    successor_limit_violation_rate:after.limit_violation_rate,
    limit_violation_delta:limitViolationDelta,
    baseline_reliability_gap:baseline.reliability_gap,
    successor_reliability_gap:after.reliability_gap,
    max_potential_regression:regression,
    hard_invariants_pass:hard,
    reliable_behavior_improved:reliableGain,
    potential_capability_preserved:potentialPreserved,
    reliability_gate_pass:pass,
    repeated_trial_same_hidden_set_required:true,
    consistency_and_limit_awareness_both_evaluated:true,
    pass_any_alone_is_not_sufficient:true,
    external_evaluator:true,
    authored_by_candidate:false,
    evidence_refs:normalizeRefs(evidence_refs),
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    signing_authority:false,
    direct_tool_execution_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...core,evaluation_digest:digest(core)});
}

export function finalizeRsiContrastiveSkillReliability({
  revision,
  evaluation,
}={}){
  if(!plainObject(revision)||revision.schema!==RSI_SKILL_CONTRASTIVE_REVISION_SCHEMA||revision.version!==1) throw new Error('rsi_reliability_revision_invalid');
  assertZeroAuthority(revision,'revision');
  if(!plainObject(evaluation)||evaluation.schema!==RSI_SKILL_RELIABILITY_EVAL_SCHEMA||evaluation.version!==1) throw new Error('rsi_reliability_evaluation_invalid');
  assertZeroAuthority(evaluation,'evaluation');
  if(evaluation.revision_digest!==revision.revision_digest) throw new Error('rsi_reliability_revision_evaluation_mismatch');
  const pass=evaluation.reliability_gate_pass===true;
  const core={
    schema:RSI_SKILL_RELIABILITY_RESULT_SCHEMA,
    version:1,
    revision_digest:revision.revision_digest,
    evaluation_digest:evaluation.evaluation_digest,
    parent_skill_digest:revision.parent_skill_digest,
    successor_skill_digest:revision.successor_skill_digest,
    state:pass?'ELIGIBLE_FOR_V126_SCOPE_PRESERVATION':'REJECTED_RELIABILITY_REVISION',
    eligible_for_v126_scope_preservation:pass,
    directly_replaces_parent_skill:false,
    v126_source_preservation_required:true,
    v124_external_library_evidence_required:true,
    repeated_trial_consistency_required:true,
    limit_awareness_required:true,
    pass_any_only_promotion_forbidden:true,
    skill_reliability_result_is_promotion_authority:false,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    signing_authority:false,
    direct_tool_execution_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...core,result_digest:digest(core)});
}

export function rsiContrastiveSkillReliabilityTrustRootSnapshot(){
  const root={
    schema:'metaengine.rsi.contrastive-skill-reliability-root.v1',
    version:1,
    policy_path:'apps/metaengine-browser/src/rsi-contrastive-skill-reliability.mjs',
    mechanism:'TRAJECTORY_CONTRASTIVE_RELIABILITY_EVOLUTION',
    repeated_trials_required:true,
    pass_any_and_pass_all_both_reported:true,
    consistency_is_first_class_metric:true,
    limit_awareness_is_first_class_metric:true,
    skill_invocation_grouping_required:true,
    deployment_faithful_reconstruction_required:true,
    success_failure_contrast_required:true,
    de_hardcoding_required:true,
    candidate_can_self_rewrite:false,
    candidate_can_self_certify_reliability:false,
    v126_source_preservation_required:true,
    v124_external_library_evidence_required:true,
    raw_model_transcript_stored:false,
    raw_page_text_stored:false,
    raw_user_input_stored:false,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    signing_authority:false,
    direct_tool_execution_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...root,reliability_root_digest:digest(root)});
}
