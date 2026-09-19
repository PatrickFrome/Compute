import crypto from 'node:crypto';

import { verifyRsiVerifiedSkillLibrary } from './rsi-verified-skill-library.mjs';
import { verifyRsiSkillLibraryGovernance } from './rsi-skill-library-governance.mjs';
import { verifyRsiSkillLineageContaminationReview } from './rsi-skill-lineage-contamination-review.mjs';
import {
  verifyRsiRecursiveRiskBudget,
  verifyRsiExternalStatisticalCertificate,
  verifyRsiRiskConfirmation,
} from './rsi-recursive-risk-budget.mjs';
import { verifyRsiDurableRiskConfirmationWitness } from './rsi-durable-recursive-risk-ledger.mjs';

export const RSI_EXPLORATION_GRADUATION_PREVIEW_SCHEMA='metaengine.rsi.exploration-graduation-preview.v1';
export const RSI_EXPLORATION_GRADUATION_VERIFIER_RECEIPT_SCHEMA='metaengine.rsi.exploration-graduation-verifier-receipt.v1';
export const RSI_EXPLORATION_GRADUATION_STATISTICAL_RECEIPT_SCHEMA='metaengine.rsi.exploration-graduation-statistical-receipt.v1';
export const RSI_EXPLORATION_GRADUATION_CERTIFICATE_SCHEMA='metaengine.rsi.exploration-graduation-certificate.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const VERIFIER_KINDS=new Set(['PROCESS','OUTCOME']);
const VERIFIER_STATES=new Set(['PASS','FAIL','UNCONTROLLABLE']);
const STATISTICAL_METHOD='E_VALUE_EXTERNAL_V1';

function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.keys(value).sort().map((key)=>[key,stable(value[key])]));
}
function digest(value){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)),'utf8').digest('hex')}`;}
function exactSha(value,label){const out=String(value||'').trim().toLowerCase();if(!SHA40_RE.test(out))throw new Error(`rsi_graduation_${label}_sha_invalid`);return out;}
function exactDigest(value,label){const out=String(value||'').trim().toLowerCase();if(!SHA256_RE.test(out))throw new Error(`rsi_graduation_${label}_digest_invalid`);return out;}
function boundedId(value,label){const out=String(value||'').trim();if(!SAFE_ID_RE.test(out))throw new Error(`rsi_graduation_${label}_invalid`);return out;}
function positiveInt(value,label,max=Number.MAX_SAFE_INTEGER){const out=Number(value);if(!Number.isSafeInteger(out)||out<1||out>max)throw new Error(`rsi_graduation_${label}_invalid`);return out;}
function assertFalse(value,label){if(value!==false)throw new Error(`rsi_graduation_${label}_must_be_false`);}
function zero(extra={}){
  return Object.freeze({
    ...extra,
    execution_authority:false,
    browser_authority:false,
    task_authority:false,
    scheduler_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    signing_authority:false,
    direct_tool_execution_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  });
}
function assertZero(row,label){
  for(const field of ['execution_authority','browser_authority','task_authority','scheduler_authority','production_mutation_authority','promotion_authority','self_update_authority','signing_authority','direct_tool_execution_authority','authority_effect']){
    if(row?.[field]!==false)throw new Error(`rsi_graduation_${label}_${field}_invalid`);
  }
  if(row?.automatic_retry_allowed!==false)throw new Error(`rsi_graduation_${label}_automatic_retry_invalid`);
}
function same(a,b){return JSON.stringify(stable(a))===JSON.stringify(stable(b));}
function setFrom(value){return new Set(Array.isArray(value)?value:[]);}
function entry(governance,skillDigest,label){
  const row=governance.entries.find((candidate)=>candidate.skill_digest===skillDigest);
  if(!row)throw new Error(`rsi_graduation_${label}_entry_missing`);
  return row;
}
function stripGraduationFields(row){
  const out=structuredClone(row);
  delete out.state;
  delete out.exploration_only_hold;
  return out;
}

export function createRsiExplorationGraduationPreview({
  preview_id,
  library,
  current_governance,
  next_governance,
  skill_digest,
  external_governance_owner=false,
  authored_by_candidate=true,
}={}){
  if(external_governance_owner!==true||authored_by_candidate!==false){
    throw new Error('rsi_graduation_preview_external_governance_owner_required');
  }
  const checkedLibrary=verifyRsiVerifiedSkillLibrary(library);
  const current=verifyRsiSkillLibraryGovernance(current_governance,checkedLibrary);
  const next=verifyRsiSkillLibraryGovernance(next_governance,checkedLibrary);
  const skill=exactDigest(skill_digest,'preview_skill');
  const before=entry(current,skill,'preview_current');
  const after=entry(next,skill,'preview_next');

  if(before.state!=='EXPLORATION_ACTIVE'||before.active_for_composition!==true
    ||before.exploration_only_hold!==true||before.admission_exposure_hold===true
    ||before.proven_positive!==true){
    throw new Error('rsi_graduation_preview_current_exploration_state_required');
  }
  if(after.state!=='ACTIVE'||after.active_for_composition!==true
    ||after.exploration_only_hold===true||after.admission_exposure_hold===true
    ||after.proven_positive!==true){
    throw new Error('rsi_graduation_preview_projected_active_state_required');
  }
  if(current.governance_id!==next.governance_id||!same(current.config,next.config)
    ||current.library_digest!==next.library_digest||current.library_digest!==checkedLibrary.library_digest){
    throw new Error('rsi_graduation_preview_governance_identity_drift');
  }

  const currentHolds=setFrom(current.exploration_only_skill_digests);
  const nextHolds=setFrom(next.exploration_only_skill_digests);
  if(!currentHolds.has(skill)||nextHolds.has(skill)||currentHolds.size-nextHolds.size!==1){
    throw new Error('rsi_graduation_preview_target_hold_delta_invalid');
  }
  for(const held of currentHolds){
    if(held!==skill&&!nextHolds.has(held))throw new Error('rsi_graduation_preview_non_target_hold_removed');
  }
  for(const held of nextHolds){
    if(!currentHolds.has(held))throw new Error('rsi_graduation_preview_non_target_hold_added');
  }

  const currentAdmission=setFrom(current.admission_exposure_hold_skill_digests);
  const nextAdmission=setFrom(next.admission_exposure_hold_skill_digests);
  if(currentAdmission.size!==nextAdmission.size||[...currentAdmission].some((held)=>!nextAdmission.has(held))){
    throw new Error('rsi_graduation_preview_admission_hold_drift');
  }

  if(current.entry_count!==next.entry_count
    ||current.active_count!==next.active_count
    ||current.dormant_count!==next.dormant_count
    ||current.retired_count!==next.retired_count
    ||current.quarantined_count!==next.quarantined_count
    ||current.lifecycle_evidence_count!==next.lifecycle_evidence_count){
    throw new Error('rsi_graduation_preview_count_drift');
  }

  const nextByDigest=new Map(next.entries.map((row)=>[row.skill_digest,row]));
  for(const beforeRow of current.entries){
    const afterRow=nextByDigest.get(beforeRow.skill_digest);
    if(!afterRow)throw new Error('rsi_graduation_preview_entry_set_drift');
    if(beforeRow.skill_digest===skill){
      if(!same(stripGraduationFields(beforeRow),stripGraduationFields(afterRow))){
        throw new Error('rsi_graduation_preview_target_non_state_drift');
      }
    }else if(!same(beforeRow,afterRow)){
      throw new Error('rsi_graduation_preview_non_target_entry_changed');
    }
  }

  const core=zero({
    schema:RSI_EXPLORATION_GRADUATION_PREVIEW_SCHEMA,
    version:1,
    preview_id:boundedId(preview_id,'preview_id'),
    library_digest:checkedLibrary.library_digest,
    current_governance_digest:current.governance_digest,
    next_governance_digest:next.governance_digest,
    skill_digest:skill,
    current_state:'EXPLORATION_ACTIVE',
    next_state:'ACTIVE',
    active_count_delta:0,
    exploration_only_hold_count_delta:-1,
    admission_hold_count_delta:0,
    only_target_governance_state_changed:true,
    exact_current_and_next_governance_bound:true,
    target_proven_positive_required:true,
    current_exploration_only_hold:true,
    next_exploration_only_hold:false,
    full_activation_effect_authorized:false,
    full_activation_effect_performed:false,
    exploration_hold_release_authorized:false,
    exploration_hold_release_performed:false,
    governance_mutation_performed:false,
    preview_only:true,
    external_governance_owner:true,
    authored_by_candidate:false,
  });
  return Object.freeze({...core,preview_digest:digest(core)});
}

export function verifyRsiExplorationGraduationPreview(preview,args={}){
  if(!preview||preview.schema!==RSI_EXPLORATION_GRADUATION_PREVIEW_SCHEMA||preview.version!==1){
    throw new Error('rsi_graduation_preview_invalid');
  }
  assertZero(preview,'preview');
  if(preview.current_state!=='EXPLORATION_ACTIVE'||preview.next_state!=='ACTIVE'
    ||preview.active_count_delta!==0||preview.exploration_only_hold_count_delta!==-1
    ||preview.admission_hold_count_delta!==0||preview.only_target_governance_state_changed!==true
    ||preview.exact_current_and_next_governance_bound!==true||preview.target_proven_positive_required!==true
    ||preview.current_exploration_only_hold!==true||preview.next_exploration_only_hold!==false
    ||preview.full_activation_effect_authorized!==false||preview.full_activation_effect_performed!==false
    ||preview.exploration_hold_release_authorized!==false||preview.exploration_hold_release_performed!==false
    ||preview.governance_mutation_performed!==false||preview.preview_only!==true
    ||preview.external_governance_owner!==true||preview.authored_by_candidate!==false){
    throw new Error('rsi_graduation_preview_policy_invalid');
  }
  const canonical=createRsiExplorationGraduationPreview({
    ...args,
    preview_id:preview.preview_id,
    skill_digest:preview.skill_digest,
    external_governance_owner:true,
    authored_by_candidate:false,
  });
  if(canonical.preview_digest!==exactDigest(preview.preview_digest,'preview')){
    throw new Error('rsi_graduation_preview_digest_mismatch');
  }
  return canonical;
}

export function createRsiExplorationGraduationVerifierReceipt({
  receipt_id,
  kind,
  source_sha,
  skill_digest,
  library_digest,
  governance_digest,
  target_consumer_snapshot_digest,
  target_retrieval_profile_digest,
  evaluation_contract_digest,
  paired_instance_manifest_digest,
  exploration_evidence_manifest_digest,
  verifier_identity_digest,
  evidence_digest,
  verdict,
  external_verifier=false,
  authored_by_candidate=true,
}={}){
  if(external_verifier!==true||authored_by_candidate!==false){
    throw new Error('rsi_graduation_verifier_external_verifier_required');
  }
  const normalizedKind=String(kind||'').trim().toUpperCase();
  const normalizedVerdict=String(verdict||'').trim().toUpperCase();
  if(!VERIFIER_KINDS.has(normalizedKind))throw new Error('rsi_graduation_verifier_kind_invalid');
  if(!VERIFIER_STATES.has(normalizedVerdict))throw new Error('rsi_graduation_verifier_verdict_invalid');
  const core=zero({
    schema:RSI_EXPLORATION_GRADUATION_VERIFIER_RECEIPT_SCHEMA,
    version:1,
    receipt_id:boundedId(receipt_id,'verifier_receipt_id'),
    kind:normalizedKind,
    source_sha:exactSha(source_sha,'verifier_source'),
    skill_digest:exactDigest(skill_digest,'verifier_skill'),
    library_digest:exactDigest(library_digest,'verifier_library'),
    governance_digest:exactDigest(governance_digest,'verifier_governance'),
    target_consumer_snapshot_digest:exactDigest(target_consumer_snapshot_digest,'verifier_consumer'),
    target_retrieval_profile_digest:exactDigest(target_retrieval_profile_digest,'verifier_retrieval'),
    evaluation_contract_digest:exactDigest(evaluation_contract_digest,'verifier_evaluation_contract'),
    paired_instance_manifest_digest:exactDigest(paired_instance_manifest_digest,'verifier_paired_instances'),
    exploration_evidence_manifest_digest:exactDigest(exploration_evidence_manifest_digest,'verifier_exploration_evidence'),
    verifier_identity_digest:exactDigest(verifier_identity_digest,'verifier_identity'),
    evidence_digest:exactDigest(evidence_digest,'verifier_evidence'),
    verdict:normalizedVerdict,
    pass:normalizedVerdict==='PASS',
    uncontrollable_environment_failure:normalizedVerdict==='UNCONTROLLABLE',
    controllable_failure:normalizedVerdict==='FAIL',
    process_and_outcome_are_separate:true,
    model_self_report_is_not_acceptance_authority:true,
    environment_grounded_readback_preferred:true,
    verifier_receipt_is_effect_authority:false,
    external_verifier:true,
    authored_by_candidate:false,
  });
  return Object.freeze({...core,receipt_digest:digest(core)});
}

export function verifyRsiExplorationGraduationVerifierReceipt(receipt,{kind}={}){
  if(!receipt||receipt.schema!==RSI_EXPLORATION_GRADUATION_VERIFIER_RECEIPT_SCHEMA||receipt.version!==1){
    throw new Error('rsi_graduation_verifier_receipt_invalid');
  }
  assertZero(receipt,'verifier_receipt');
  const expectedKind=String(kind||receipt.kind||'').trim().toUpperCase();
  if(receipt.kind!==expectedKind||!VERIFIER_KINDS.has(expectedKind)
    ||receipt.process_and_outcome_are_separate!==true
    ||receipt.model_self_report_is_not_acceptance_authority!==true
    ||receipt.environment_grounded_readback_preferred!==true
    ||receipt.verifier_receipt_is_effect_authority!==false
    ||receipt.external_verifier!==true||receipt.authored_by_candidate!==false){
    throw new Error('rsi_graduation_verifier_receipt_policy_invalid');
  }
  const canonical=createRsiExplorationGraduationVerifierReceipt({
    receipt_id:receipt.receipt_id,
    kind:receipt.kind,
    source_sha:receipt.source_sha,
    skill_digest:receipt.skill_digest,
    library_digest:receipt.library_digest,
    governance_digest:receipt.governance_digest,
    target_consumer_snapshot_digest:receipt.target_consumer_snapshot_digest,
    target_retrieval_profile_digest:receipt.target_retrieval_profile_digest,
    evaluation_contract_digest:receipt.evaluation_contract_digest,
    paired_instance_manifest_digest:receipt.paired_instance_manifest_digest,
    exploration_evidence_manifest_digest:receipt.exploration_evidence_manifest_digest,
    verifier_identity_digest:receipt.verifier_identity_digest,
    evidence_digest:receipt.evidence_digest,
    verdict:receipt.verdict,
    external_verifier:true,
    authored_by_candidate:false,
  });
  if(canonical.receipt_digest!==exactDigest(receipt.receipt_digest,'verifier_receipt')){
    throw new Error('rsi_graduation_verifier_receipt_digest_mismatch');
  }
  return canonical;
}

export function createRsiExplorationGraduationStatisticalReceipt({
  receipt_id,
  source_sha,
  skill_digest,
  library_digest,
  governance_digest,
  target_consumer_snapshot_digest,
  target_retrieval_profile_digest,
  evaluation_contract_digest,
  paired_instance_manifest_digest,
  exploration_evidence_manifest_digest,
  statistical_holdout_digest,
  statistical_evaluator_root_digest,
  recursive_risk_budget,
  external_statistical_certificate,
  risk_confirmation,
  candidate_id,
  candidate_sha,
  parent_sha,
  statistical_acceptor_identity_digest,
  false_admission_alpha_ppm,
  anytime_valid_e_value_microunits,
  paired_sample_count,
  minimum_paired_sample_count,
  external_statistical_acceptor=false,
  authored_by_candidate=true,
}={}){
  if(external_statistical_acceptor!==true||authored_by_candidate!==false){
    throw new Error('rsi_graduation_statistical_external_acceptor_required');
  }
  const pairedManifest=exactDigest(paired_instance_manifest_digest,'statistical_paired_instances');
  const holdout=exactDigest(statistical_holdout_digest,'statistical_holdout');
  const evaluatorRoot=exactDigest(statistical_evaluator_root_digest,'statistical_evaluator_root');
  const budget=verifyRsiRecursiveRiskBudget(recursive_risk_budget);
  const confirmation=verifyRsiRiskConfirmation(risk_confirmation);
  const checkedExternal=verifyRsiExternalStatisticalCertificate(external_statistical_certificate,{
    budget,
    expected_confirmation_index:confirmation.confirmation_index,
    candidate_id,
    candidate_sha,
    parent_sha,
    tournament_plan_digest:pairedManifest,
    holdout_digest:holdout,
    evaluator_root_digest:evaluatorRoot,
  });
  if(confirmation.state!=='STATISTICAL_GATE_PASS_FOR_EXTERNAL_REVIEW'
    ||confirmation.superiority_certified!==true
    ||confirmation.budget_digest!==budget.budget_digest
    ||confirmation.certificate_digest!==checkedExternal.certificate_digest
    ||confirmation.candidate_id!==checkedExternal.candidate_id
    ||confirmation.candidate_sha!==checkedExternal.candidate_sha
    ||confirmation.parent_sha!==checkedExternal.parent_sha
    ||confirmation.tournament_plan_digest!==pairedManifest
    ||confirmation.holdout_digest!==holdout
    ||confirmation.evaluator_root_digest!==evaluatorRoot){
    throw new Error('rsi_graduation_statistical_existing_risk_confirmation_mismatch');
  }
  if(checkedExternal.method!==STATISTICAL_METHOD
    ||checkedExternal.paired_evaluation!==true
    ||checkedExternal.independent_holdout!==true
    ||checkedExternal.stopping_rule_precommitted!==true
    ||checkedExternal.optional_stopping_used!==false
    ||checkedExternal.familywise_valid!==true
    ||checkedExternal.screening_spent_alpha!==false
    ||checkedExternal.confirmation_triggered!==true){
    throw new Error('rsi_graduation_statistical_external_certificate_policy_invalid');
  }

  const alphaPpm=positiveInt(false_admission_alpha_ppm,'false_admission_alpha_ppm',1_000_000);
  const expectedAlpha=alphaPpm/1_000_000;
  if(Math.abs(checkedExternal.alpha_used-expectedAlpha)>1e-12){
    throw new Error('rsi_graduation_statistical_alpha_policy_mismatch');
  }
  const eValueMicro=positiveInt(anytime_valid_e_value_microunits,'anytime_valid_e_value_microunits');
  const pairs=positiveInt(paired_sample_count,'paired_sample_count');
  const minPairs=positiveInt(minimum_paired_sample_count,'minimum_paired_sample_count');
  if(pairs!==checkedExternal.sample_count){
    throw new Error('rsi_graduation_statistical_paired_sample_count_mismatch');
  }
  const thresholdMicro=Math.ceil(1_000_000_000_000/alphaPpm);
  const pass=eValueMicro>=thresholdMicro&&pairs>=minPairs;
  const core=zero({
    schema:RSI_EXPLORATION_GRADUATION_STATISTICAL_RECEIPT_SCHEMA,
    version:1,
    receipt_id:boundedId(receipt_id,'statistical_receipt_id'),
    source_sha:exactSha(source_sha,'statistical_source'),
    skill_digest:exactDigest(skill_digest,'statistical_skill'),
    library_digest:exactDigest(library_digest,'statistical_library'),
    governance_digest:exactDigest(governance_digest,'statistical_governance'),
    target_consumer_snapshot_digest:exactDigest(target_consumer_snapshot_digest,'statistical_consumer'),
    target_retrieval_profile_digest:exactDigest(target_retrieval_profile_digest,'statistical_retrieval'),
    evaluation_contract_digest:exactDigest(evaluation_contract_digest,'statistical_evaluation_contract'),
    paired_instance_manifest_digest:pairedManifest,
    exploration_evidence_manifest_digest:exactDigest(exploration_evidence_manifest_digest,'statistical_exploration_evidence'),
    statistical_holdout_digest:holdout,
    statistical_evaluator_root_digest:evaluatorRoot,
    recursive_risk_budget:structuredClone(budget),
    recursive_risk_budget_digest:budget.budget_digest,
    external_statistical_certificate:structuredClone(checkedExternal),
    external_statistical_certificate_digest:checkedExternal.certificate_digest,
    risk_confirmation:structuredClone(confirmation),
    risk_confirmation_digest:confirmation.confirmation_digest,
    confirmation_index:confirmation.confirmation_index,
    candidate_id:checkedExternal.candidate_id,
    candidate_sha:checkedExternal.candidate_sha,
    parent_sha:checkedExternal.parent_sha,
    statistical_acceptor_identity_digest:exactDigest(statistical_acceptor_identity_digest,'statistical_acceptor_identity'),
    method:STATISTICAL_METHOD,
    false_admission_alpha_ppm:alphaPpm,
    alpha_used:checkedExternal.alpha_used,
    allocated_alpha:confirmation.allocated_alpha,
    cumulative_alpha_spent:confirmation.cumulative_alpha_spent,
    global_alpha:confirmation.global_alpha,
    anytime_valid_e_value_microunits:eValueMicro,
    anytime_valid_threshold_microunits:thresholdMicro,
    paired_sample_count:pairs,
    minimum_paired_sample_count:minPairs,
    paired_same_instances_required:true,
    numerical_anytime_valid_threshold_required:true,
    insufficient_evidence_abstain_required:true,
    existing_recursive_risk_budget_required:true,
    existing_recursive_risk_confirmation_required:true,
    global_familywise_risk_budget_required:true,
    confirmation_triggered_spending_required:true,
    independent_holdout_required:true,
    stopping_rule_precommitted_required:true,
    optional_stopping_used:false,
    screening_spent_alpha:false,
    external_estimator_required:true,
    local_module_does_not_estimate_e_value:true,
    second_statistical_risk_ledger_created:false,
    state:pass?'PASS':'INSUFFICIENT_EVIDENCE',
    pass,
    statistical_receipt_is_effect_authority:false,
    external_statistical_acceptor:true,
    authored_by_candidate:false,
  });
  return Object.freeze({...core,receipt_digest:digest(core)});
}

export function verifyRsiExplorationGraduationStatisticalReceipt(receipt){
  if(!receipt||receipt.schema!==RSI_EXPLORATION_GRADUATION_STATISTICAL_RECEIPT_SCHEMA||receipt.version!==1){
    throw new Error('rsi_graduation_statistical_receipt_invalid');
  }
  assertZero(receipt,'statistical_receipt');
  if(receipt.method!==STATISTICAL_METHOD||receipt.paired_same_instances_required!==true
    ||receipt.numerical_anytime_valid_threshold_required!==true
    ||receipt.insufficient_evidence_abstain_required!==true
    ||receipt.existing_recursive_risk_budget_required!==true
    ||receipt.existing_recursive_risk_confirmation_required!==true
    ||receipt.global_familywise_risk_budget_required!==true
    ||receipt.confirmation_triggered_spending_required!==true
    ||receipt.independent_holdout_required!==true
    ||receipt.stopping_rule_precommitted_required!==true
    ||receipt.optional_stopping_used!==false||receipt.screening_spent_alpha!==false
    ||receipt.external_estimator_required!==true||receipt.local_module_does_not_estimate_e_value!==true
    ||receipt.second_statistical_risk_ledger_created!==false
    ||receipt.statistical_receipt_is_effect_authority!==false
    ||receipt.external_statistical_acceptor!==true||receipt.authored_by_candidate!==false){
    throw new Error('rsi_graduation_statistical_receipt_policy_invalid');
  }
  const canonical=createRsiExplorationGraduationStatisticalReceipt({
    receipt_id:receipt.receipt_id,
    source_sha:receipt.source_sha,
    skill_digest:receipt.skill_digest,
    library_digest:receipt.library_digest,
    governance_digest:receipt.governance_digest,
    target_consumer_snapshot_digest:receipt.target_consumer_snapshot_digest,
    target_retrieval_profile_digest:receipt.target_retrieval_profile_digest,
    evaluation_contract_digest:receipt.evaluation_contract_digest,
    paired_instance_manifest_digest:receipt.paired_instance_manifest_digest,
    exploration_evidence_manifest_digest:receipt.exploration_evidence_manifest_digest,
    statistical_holdout_digest:receipt.statistical_holdout_digest,
    statistical_evaluator_root_digest:receipt.statistical_evaluator_root_digest,
    recursive_risk_budget:receipt.recursive_risk_budget,
    external_statistical_certificate:receipt.external_statistical_certificate,
    risk_confirmation:receipt.risk_confirmation,
    candidate_id:receipt.candidate_id,
    candidate_sha:receipt.candidate_sha,
    parent_sha:receipt.parent_sha,
    statistical_acceptor_identity_digest:receipt.statistical_acceptor_identity_digest,
    false_admission_alpha_ppm:receipt.false_admission_alpha_ppm,
    anytime_valid_e_value_microunits:receipt.anytime_valid_e_value_microunits,
    paired_sample_count:receipt.paired_sample_count,
    minimum_paired_sample_count:receipt.minimum_paired_sample_count,
    external_statistical_acceptor:true,
    authored_by_candidate:false,
  });
  if(canonical.receipt_digest!==exactDigest(receipt.receipt_digest,'statistical_receipt')){
    throw new Error('rsi_graduation_statistical_receipt_digest_mismatch');
  }
  return canonical;
}

export function createRsiExplorationGraduationCertificate({
  certificate_id,
  source_sha,
  library,
  current_governance,
  next_governance,
  preview,
  skill_digest,
  target_consumer_snapshot_digest,
  target_retrieval_profile_digest,
  evaluation_contract_digest,
  exploration_evidence_manifest_digest,
  process_verifier_receipt,
  outcome_verifier_receipt,
  statistical_receipt,
  durable_risk_confirmation_witness,
  durable_risk_ledger_state,
  lineage_review,
  future_effect_executor_identity_digest,
  certificate_owner_identity_digest,
  retention_receipt_digest,
  retention_non_regression_pass=false,
  cost_latency_receipt_digest,
  cost_budget_pass=false,
  latency_budget_pass=false,
  negative_transfer_receipt_digest,
  negative_transfer_clear=false,
  coalition_ablation_receipt_digest,
  coalition_ablation_pass=false,
  no_skill_ablation_receipt_digest,
  no_skill_ablation_pass=false,
  source_grounding_receipt_digest,
  source_grounding_pass=false,
  memory_poisoning_scan_digest,
  memory_poisoning_scan_pass=false,
  external_certificate_owner=false,
  authored_by_candidate=true,
}={}){
  if(external_certificate_owner!==true||authored_by_candidate!==false){
    throw new Error('rsi_graduation_certificate_external_owner_required');
  }
  const source=exactSha(source_sha,'certificate_source');
  const checkedLibrary=verifyRsiVerifiedSkillLibrary(library);
  const current=verifyRsiSkillLibraryGovernance(current_governance,checkedLibrary);
  const next=verifyRsiSkillLibraryGovernance(next_governance,checkedLibrary);
  const skill=exactDigest(skill_digest,'certificate_skill');
  const targetLibraryEntry=checkedLibrary.entries.find((entry)=>entry.skill_digest===skill);
  if(!targetLibraryEntry)throw new Error('rsi_graduation_certificate_target_skill_missing');
  const expectedStatisticalCandidateId=`skill:${skill}`;
  const expectedStatisticalCandidateSha=exactSha(targetLibraryEntry.capsule.source_candidate_sha,'target_skill_source_candidate');
  const checkedPreview=verifyRsiExplorationGraduationPreview(preview,{
    library:checkedLibrary,
    current_governance:current,
    next_governance:next,
    skill_digest:skill,
  });
  const consumer=exactDigest(target_consumer_snapshot_digest,'certificate_consumer');
  const retrieval=exactDigest(target_retrieval_profile_digest,'certificate_retrieval');
  const evaluation=exactDigest(evaluation_contract_digest,'certificate_evaluation_contract');
  const explorationEvidence=exactDigest(exploration_evidence_manifest_digest,'certificate_exploration_evidence');
  const futureExecutor=exactDigest(future_effect_executor_identity_digest,'future_effect_executor');
  const owner=exactDigest(certificate_owner_identity_digest,'certificate_owner');

  const processReceipt=verifyRsiExplorationGraduationVerifierReceipt(process_verifier_receipt,{kind:'PROCESS'});
  const outcomeReceipt=verifyRsiExplorationGraduationVerifierReceipt(outcome_verifier_receipt,{kind:'OUTCOME'});
  const statistical=verifyRsiExplorationGraduationStatisticalReceipt(statistical_receipt);
  if(statistical.candidate_id!==expectedStatisticalCandidateId
    ||statistical.candidate_sha!==expectedStatisticalCandidateSha){
    throw new Error('rsi_graduation_certificate_statistical_target_skill_identity_mismatch');
  }
  const durableWitness=verifyRsiDurableRiskConfirmationWitness(durable_risk_confirmation_witness,{
    durable_ledger_state:durable_risk_ledger_state,
    source_sha:source,
    recursive_risk_budget:statistical.recursive_risk_budget,
  });
  if(durableWitness.source_sha!==source
    ||durableWitness.budget_digest!==statistical.recursive_risk_budget_digest
    ||durableWitness.confirmation_digest!==statistical.risk_confirmation_digest
    ||durableWitness.external_statistical_certificate_digest!==statistical.external_statistical_certificate_digest
    ||durableWitness.confirmation_index!==statistical.confirmation_index
    ||durableWitness.candidate_id!==statistical.candidate_id
    ||durableWitness.candidate_sha!==statistical.candidate_sha
    ||durableWitness.parent_sha!==statistical.parent_sha
    ||durableWitness.tournament_plan_digest!==statistical.paired_instance_manifest_digest
    ||durableWitness.holdout_digest!==statistical.statistical_holdout_digest
    ||durableWitness.evaluator_root_digest!==statistical.statistical_evaluator_root_digest
    ||durableWitness.allocated_alpha!==statistical.allocated_alpha
    ||durableWitness.cumulative_alpha_spent!==statistical.cumulative_alpha_spent){
    throw new Error('rsi_graduation_certificate_durable_risk_witness_binding_mismatch');
  }
  const lineage=verifyRsiSkillLineageContaminationReview(lineage_review,{
    source_sha:source,
    library:checkedLibrary,
    target_skill_digest:skill,
    current_governance_digest:current.governance_digest,
    effect_executor_identity_digest:futureExecutor,
  });

  const shared=[
    ['source_sha',source],
    ['skill_digest',skill],
    ['library_digest',checkedLibrary.library_digest],
    ['governance_digest',current.governance_digest],
    ['target_consumer_snapshot_digest',consumer],
    ['target_retrieval_profile_digest',retrieval],
    ['evaluation_contract_digest',evaluation],
    ['exploration_evidence_manifest_digest',explorationEvidence],
  ];
  for(const [field,value] of shared){
    if(processReceipt[field]!==value||outcomeReceipt[field]!==value||statistical[field]!==value){
      throw new Error(`rsi_graduation_certificate_cross_receipt_${field}_mismatch`);
    }
  }
  if(processReceipt.paired_instance_manifest_digest!==outcomeReceipt.paired_instance_manifest_digest
    ||processReceipt.paired_instance_manifest_digest!==statistical.paired_instance_manifest_digest){
    throw new Error('rsi_graduation_certificate_paired_instance_manifest_mismatch');
  }
  if(lineage.library_digest!==checkedLibrary.library_digest
    ||lineage.current_governance_digest!==current.governance_digest
    ||lineage.target_skill_digest!==skill
    ||lineage.target_consumer_snapshot_digest!==consumer
    ||lineage.effect_executor_identity_digest!==futureExecutor){
    throw new Error('rsi_graduation_certificate_lineage_binding_mismatch');
  }

  const identities=[
    owner,
    processReceipt.verifier_identity_digest,
    outcomeReceipt.verifier_identity_digest,
    statistical.statistical_acceptor_identity_digest,
    durableWitness.readback_owner_identity_digest,
    futureExecutor,
  ];
  if(new Set(identities).size!==identities.length){
    throw new Error('rsi_graduation_certificate_cross_stage_identity_separation_required');
  }
  const lineagePrincipalIds=[];
  for(const finding of lineage.findings){
    lineagePrincipalIds.push(
      finding.provenance_acceptance.structural_attestation.expected_builder_identity_digest,
      finding.provenance_reviewer_identity_digest,
      finding.security_reviewer_identity_digest,
      finding.semantic_reviewer_identity_digest,
    );
  }
  if(lineagePrincipalIds.some((identity)=>identities.includes(identity))){
    throw new Error('rsi_graduation_certificate_lineage_principal_identity_alias_forbidden');
  }

  const evidenceRoots=[
    processReceipt.evidence_digest,
    outcomeReceipt.evidence_digest,
    statistical.receipt_digest,
    lineage.review_digest,
    exactDigest(retention_receipt_digest,'retention_receipt'),
    exactDigest(cost_latency_receipt_digest,'cost_latency_receipt'),
    exactDigest(negative_transfer_receipt_digest,'negative_transfer_receipt'),
    exactDigest(coalition_ablation_receipt_digest,'coalition_ablation_receipt'),
    exactDigest(no_skill_ablation_receipt_digest,'no_skill_ablation_receipt'),
    exactDigest(source_grounding_receipt_digest,'source_grounding_receipt'),
    exactDigest(memory_poisoning_scan_digest,'memory_poisoning_scan'),
    durableWitness.witness_digest,
  ];
  if(new Set(evidenceRoots).size!==evidenceRoots.length){
    throw new Error('rsi_graduation_certificate_independent_evidence_roots_required');
  }

  const blockers=[];
  let abstain=false;
  if(processReceipt.uncontrollable_environment_failure||outcomeReceipt.uncontrollable_environment_failure){
    abstain=true;
    blockers.push('UNCONTROLLABLE_ENVIRONMENT_REQUIRES_FRESH_MATCHED_EVIDENCE');
  }
  if(!processReceipt.pass&&!processReceipt.uncontrollable_environment_failure)blockers.push('PROCESS_VERIFIER_FAILED');
  if(!outcomeReceipt.pass&&!outcomeReceipt.uncontrollable_environment_failure)blockers.push('OUTCOME_VERIFIER_FAILED');
  if(statistical.pass!==true)blockers.push('INSUFFICIENT_ANYTIME_VALID_EVIDENCE');
  if(lineage.eligible_for_exposure_precommit!==true||lineage.state!=='CLEAR_FOR_ZERO_EFFECT_EXPOSURE_PRECOMMIT'){
    blockers.push('LINEAGE_CONTAMINATION_NOT_CLEAR');
  }
  if(retention_non_regression_pass!==true)blockers.push('RETENTION_REGRESSION');
  if(cost_budget_pass!==true)blockers.push('COST_BUDGET_FAILED');
  if(latency_budget_pass!==true)blockers.push('LATENCY_BUDGET_FAILED');
  if(negative_transfer_clear!==true)blockers.push('NEGATIVE_TRANSFER_NOT_CLEAR');
  if(coalition_ablation_pass!==true)blockers.push('COALITION_ABLATION_FAILED');
  if(no_skill_ablation_pass!==true)blockers.push('NO_SKILL_ABLATION_FAILED');
  if(source_grounding_pass!==true)blockers.push('SOURCE_GROUNDING_FAILED');
  if(memory_poisoning_scan_pass!==true)blockers.push('MEMORY_POISONING_SCAN_FAILED');

  const eligible=blockers.length===0;
  const state=eligible
    ?'ELIGIBLE_FOR_PHASE37B_ONE_ATTEMPT_GRADUATION_REVIEW'
    :abstain&&blockers.every((value)=>value==='UNCONTROLLABLE_ENVIRONMENT_REQUIRES_FRESH_MATCHED_EVIDENCE')
      ?'ABSTAIN_UNCONTROLLABLE_ENVIRONMENT'
      :'GRADUATION_CERTIFICATE_BLOCKED';

  const core=zero({
    schema:RSI_EXPLORATION_GRADUATION_CERTIFICATE_SCHEMA,
    version:1,
    certificate_id:boundedId(certificate_id,'certificate_id'),
    source_sha:source,
    skill_digest:skill,
    library_digest:checkedLibrary.library_digest,
    current_governance_digest:current.governance_digest,
    projected_next_governance_digest:next.governance_digest,
    preview_digest:checkedPreview.preview_digest,
    target_consumer_snapshot_digest:consumer,
    target_retrieval_profile_digest:retrieval,
    evaluation_contract_digest:evaluation,
    exploration_evidence_manifest_digest:explorationEvidence,
    paired_instance_manifest_digest:statistical.paired_instance_manifest_digest,
    process_verifier_receipt_digest:processReceipt.receipt_digest,
    outcome_verifier_receipt_digest:outcomeReceipt.receipt_digest,
    statistical_receipt_digest:statistical.receipt_digest,
    statistical_candidate_id:statistical.candidate_id,
    statistical_candidate_sha:statistical.candidate_sha,
    target_skill_source_candidate_sha:expectedStatisticalCandidateSha,
    deterministic_skill_statistical_candidate_binding:true,
    durable_risk_confirmation_witness_digest:durableWitness.witness_digest,
    durable_risk_ledger_state_digest:durableWitness.durable_ledger_state_digest,
    durable_risk_readback_owner_identity_digest:durableWitness.readback_owner_identity_digest,
    durable_risk_confirmation_index:durableWitness.confirmation_index,
    durable_risk_confirmation_count:durableWitness.confirmation_count,
    restart_durable_statistical_confirmation_bound:true,
    lineage_review_digest:lineage.review_digest,
    future_effect_executor_identity_digest:futureExecutor,
    certificate_owner_identity_digest:owner,
    retention_receipt_digest:evidenceRoots[4],
    cost_latency_receipt_digest:evidenceRoots[5],
    negative_transfer_receipt_digest:evidenceRoots[6],
    coalition_ablation_receipt_digest:evidenceRoots[7],
    no_skill_ablation_receipt_digest:evidenceRoots[8],
    source_grounding_receipt_digest:evidenceRoots[9],
    memory_poisoning_scan_digest:evidenceRoots[10],
    process_verifier_pass:processReceipt.pass,
    outcome_verifier_pass:outcomeReceipt.pass,
    uncontrollable_environment_failure:abstain,
    anytime_valid_acceptance_pass:statistical.pass,
    retention_non_regression_pass:retention_non_regression_pass===true,
    cost_budget_pass:cost_budget_pass===true,
    latency_budget_pass:latency_budget_pass===true,
    negative_transfer_clear:negative_transfer_clear===true,
    lineage_contamination_clear:lineage.eligible_for_exposure_precommit===true,
    coalition_ablation_pass:coalition_ablation_pass===true,
    no_skill_ablation_pass:no_skill_ablation_pass===true,
    source_grounding_pass:source_grounding_pass===true,
    memory_poisoning_scan_pass:memory_poisoning_scan_pass===true,
    blockers:Object.freeze([...new Set(blockers)].sort()),
    state,
    eligible_for_phase37b_one_attempt_graduation_review:eligible,
    paired_same_instances_required:true,
    process_and_outcome_verifiers_separate:true,
    controllable_and_uncontrollable_failures_separate:true,
    numerical_anytime_valid_threshold_required:true,
    fixed_false_admission_budget_required:true,
    durable_recursive_risk_witness_required:true,
    restart_durable_statistical_confirmation_required:true,
    exact_consumer_retrieval_source_binding_required:true,
    deterministic_skill_statistical_candidate_binding_required:true,
    retention_cost_latency_negative_transfer_required:true,
    contamination_and_ablation_checks_required:true,
    certificate_only:true,
    exploration_hold_release_authorized:false,
    exploration_hold_release_performed:false,
    full_activation_authorized:false,
    full_activation_performed:false,
    graduation_effect_attempted:false,
    graduation_token:null,
    external_certificate_owner:true,
    authored_by_candidate:false,
  });
  return Object.freeze({...core,certificate_digest:digest(core)});
}

export function verifyRsiExplorationGraduationCertificate(certificate,args={}){
  if(!certificate||certificate.schema!==RSI_EXPLORATION_GRADUATION_CERTIFICATE_SCHEMA||certificate.version!==1){
    throw new Error('rsi_graduation_certificate_invalid');
  }
  assertZero(certificate,'certificate');
  if(certificate.paired_same_instances_required!==true
    ||certificate.process_and_outcome_verifiers_separate!==true
    ||certificate.controllable_and_uncontrollable_failures_separate!==true
    ||certificate.numerical_anytime_valid_threshold_required!==true
    ||certificate.fixed_false_admission_budget_required!==true
    ||certificate.durable_recursive_risk_witness_required!==true
    ||certificate.restart_durable_statistical_confirmation_required!==true
    ||certificate.restart_durable_statistical_confirmation_bound!==true
    ||certificate.exact_consumer_retrieval_source_binding_required!==true
    ||certificate.deterministic_skill_statistical_candidate_binding_required!==true
    ||certificate.deterministic_skill_statistical_candidate_binding!==true
    ||certificate.retention_cost_latency_negative_transfer_required!==true
    ||certificate.contamination_and_ablation_checks_required!==true
    ||certificate.certificate_only!==true
    ||certificate.exploration_hold_release_authorized!==false
    ||certificate.exploration_hold_release_performed!==false
    ||certificate.full_activation_authorized!==false
    ||certificate.full_activation_performed!==false
    ||certificate.graduation_effect_attempted!==false
    ||certificate.graduation_token!==null
    ||certificate.external_certificate_owner!==true
    ||certificate.authored_by_candidate!==false){
    throw new Error('rsi_graduation_certificate_policy_invalid');
  }
  const canonical=createRsiExplorationGraduationCertificate({
    ...args,
    certificate_id:certificate.certificate_id,
    source_sha:certificate.source_sha,
    skill_digest:certificate.skill_digest,
    target_consumer_snapshot_digest:certificate.target_consumer_snapshot_digest,
    target_retrieval_profile_digest:certificate.target_retrieval_profile_digest,
    evaluation_contract_digest:certificate.evaluation_contract_digest,
    exploration_evidence_manifest_digest:certificate.exploration_evidence_manifest_digest,
    future_effect_executor_identity_digest:certificate.future_effect_executor_identity_digest,
    certificate_owner_identity_digest:certificate.certificate_owner_identity_digest,
    retention_receipt_digest:certificate.retention_receipt_digest,
    retention_non_regression_pass:certificate.retention_non_regression_pass,
    cost_latency_receipt_digest:certificate.cost_latency_receipt_digest,
    cost_budget_pass:certificate.cost_budget_pass,
    latency_budget_pass:certificate.latency_budget_pass,
    negative_transfer_receipt_digest:certificate.negative_transfer_receipt_digest,
    negative_transfer_clear:certificate.negative_transfer_clear,
    coalition_ablation_receipt_digest:certificate.coalition_ablation_receipt_digest,
    coalition_ablation_pass:certificate.coalition_ablation_pass,
    no_skill_ablation_receipt_digest:certificate.no_skill_ablation_receipt_digest,
    no_skill_ablation_pass:certificate.no_skill_ablation_pass,
    source_grounding_receipt_digest:certificate.source_grounding_receipt_digest,
    source_grounding_pass:certificate.source_grounding_pass,
    memory_poisoning_scan_digest:certificate.memory_poisoning_scan_digest,
    memory_poisoning_scan_pass:certificate.memory_poisoning_scan_pass,
    external_certificate_owner:true,
    authored_by_candidate:false,
  });
  if(canonical.certificate_digest!==exactDigest(certificate.certificate_digest,'certificate')){
    throw new Error('rsi_graduation_certificate_digest_mismatch');
  }
  return canonical;
}

export function rsiExplorationGraduationCertificateTrustRootSnapshot(){
  const root=zero({
    schema:'metaengine.rsi.exploration-graduation-certificate-root.v1',
    version:1,
    policy_path:'apps/metaengine-browser/src/rsi-exploration-graduation-certificate.mjs',
    current_exploration_only_hold_required:true,
    target_proven_positive_required:true,
    exact_projected_active_governance_required:true,
    only_target_state_and_exploration_hold_may_change:true,
    same_active_count_required:true,
    paired_same_instances_required:true,
    e_value_external_contract_required:true,
    existing_recursive_risk_budget_required:true,
    existing_recursive_risk_confirmation_required:true,
    durable_recursive_risk_witness_required:true,
    restart_durable_statistical_confirmation_required:true,
    external_durable_readback_owner_separate_from_acceptor_and_effect_required:true,
    second_statistical_risk_ledger_created:false,
    numerical_anytime_valid_threshold_required:true,
    insufficient_evidence_abstains:true,
    process_and_outcome_verifiers_separate:true,
    controllable_and_uncontrollable_failures_separate:true,
    environment_grounded_readback_preferred:true,
    exact_consumer_retrieval_source_binding_required:true,
    deterministic_skill_statistical_candidate_binding_required:true,
    lineage_builder_reviewer_certificate_effect_separation_required:true,
    retention_non_regression_required:true,
    cost_and_latency_budgets_required:true,
    negative_transfer_clear_required:true,
    current_lineage_contamination_clear_required:true,
    coalition_and_no_skill_ablation_required:true,
    source_grounding_required:true,
    memory_poisoning_scan_required:true,
    certificate_owner_statistical_process_outcome_effect_executor_separation_required:true,
    existing_lineage_review_reused:true,
    second_statistical_estimator_created:false,
    candidate_can_author_certificate:false,
    certificate_is_activation_authority:false,
    certificate_is_effect_authority:false,
    phase37b_one_attempt_effect_remains_separate:true,
  });
  return Object.freeze({...root,root_digest:digest(root)});
}
