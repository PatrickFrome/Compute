import crypto from 'node:crypto';

import {
  verifyRsiVerifiedLineageAdmission,
} from './rsi-verified-lineage-admission.mjs';
import {
  verifyRsiSkillCapsule,
  verifyRsiSkillEvidence,
  verifyRsiSkillPortabilityReceipt,
  createRsiVerifiedSkillLibrary,
} from './rsi-verified-skill-library.mjs';
import {
  createRsiSkillLibraryGovernance,
  verifyRsiSkillLibraryGovernance,
} from './rsi-skill-library-governance.mjs';

export const RSI_LINEAGE_SKILL_ADMISSION_SCHEMA='metaengine.rsi.lineage-skill-admission.v1';

function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.keys(value).sort().map((key)=>[key,stable(value[key])]));
}
function digest(value){
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)),'utf8').digest('hex')}`;
}
function zeroAuthority(value,label){
  for(const field of ['execution_authority','production_mutation_authority','promotion_authority','self_update_authority','scheduler_authority','signing_authority','direct_tool_execution_authority','authority_effect']){
    if(value?.[field]!==false)throw new Error(`rsi_lineage_skill_${label}_${field}_invalid`);
  }
  if(value?.automatic_retry_allowed!==false)throw new Error(`rsi_lineage_skill_${label}_automatic_retry_invalid`);
}

export function admitRsiLineageSkill({
  lineage_admission,
  skill,
  skill_evidence,
  portability_receipts,
  library_id,
  existing_entries=[],
  lifecycle_evidence=[],
  governance_id,
  max_active_skills=64,
  exploration_slots=8,
  external_library_owner=false,
  authored_by_candidate=true,
}={}){
  const lineage=verifyRsiVerifiedLineageAdmission(lineage_admission);
  if (
    lineage.archive_active!==true
    || lineage.skill_distillation_research_eligible!==true
    || lineage.direct_skill_library_admission_allowed!==false
    || lineage.transfer_evidence_required_before_skill_library!==true
    || lineage.lifecycle_governance_required_before_skill_activation!==true
  ) throw new Error('rsi_lineage_skill_lineage_not_eligible');
  if(external_library_owner!==true||authored_by_candidate!==false)throw new Error('rsi_lineage_skill_external_owner_required');

  const checkedSkill=verifyRsiSkillCapsule(skill);
  const checkedEvidence=verifyRsiSkillEvidence(skill_evidence,checkedSkill);
  zeroAuthority(checkedSkill,'skill');
  zeroAuthority(checkedEvidence,'skill_evidence');
  if(checkedSkill.source_candidate_sha!==lineage.candidate_sha)throw new Error('rsi_lineage_skill_source_candidate_mismatch');
  if(checkedEvidence.source_candidate_sha!==lineage.candidate_sha
     ||checkedEvidence.verified_for_library!==true
     ||checkedEvidence.hard_invariants_pass!==true){
    throw new Error('rsi_lineage_skill_evidence_not_verified');
  }

  if(!Array.isArray(portability_receipts)||portability_receipts.length<2||portability_receipts.length>32){
    throw new Error('rsi_lineage_skill_transfer_receipts_invalid');
  }
  const checkedPortability=portability_receipts.map((receipt)=>{
    const checked=verifyRsiSkillPortabilityReceipt(receipt,checkedSkill,checkedEvidence);
    zeroAuthority(checked,'portability_receipt');
    return checked;
  });
  const receiptDigests=new Set();
  const contexts=new Set();
  const holdouts=new Set();
  const families=new Set();
  for(const row of checkedPortability){
    if(receiptDigests.has(row.receipt_digest))throw new Error('rsi_lineage_skill_transfer_receipt_duplicate');
    receiptDigests.add(row.receipt_digest);
    contexts.add(row.target_context_digest);
    holdouts.add(row.target_holdout_digest);
    families.add(`${row.target_model_family}::${row.target_environment_family}`);
    if(row.outcome==='NEGATIVE_TRANSFER'||row.negative_transfer_memory===true){
      throw new Error('rsi_lineage_skill_negative_transfer_blocks_admission');
    }
    if(row.outcome!=='PORTABLE_VERIFIED'||row.portable_to_target!==true||row.hard_invariants_pass!==true||Number(row.measured_delta)<=0){
      throw new Error('rsi_lineage_skill_transfer_not_verified');
    }
  }
  if(contexts.size<2||holdouts.size<2)throw new Error('rsi_lineage_skill_transfer_diversity_insufficient');

  const entries=[
    ...existing_entries.map((row)=>structuredClone(row)),
    {capsule:checkedSkill,evidence:checkedEvidence},
  ];
  const library=createRsiVerifiedSkillLibrary({
    library_id,
    entries,
    external_library_owner:true,
    authored_by_candidate:false,
  });
  const governance=createRsiSkillLibraryGovernance({
    governance_id,
    library,
    lifecycle_evidence,
    max_active_skills,
    exploration_slots,
    external_library_owner:true,
    authored_by_candidate:false,
  });
  verifyRsiSkillLibraryGovernance(governance,library);
  const governanceRow=governance.entries.find((row)=>row.skill_digest===checkedSkill.skill_digest);
  if(!governanceRow)throw new Error('rsi_lineage_skill_governance_row_missing');

  const core={
    schema:RSI_LINEAGE_SKILL_ADMISSION_SCHEMA,
    version:1,
    lineage_admission_digest:lineage.lineage_admission_digest,
    candidate_id:lineage.candidate_id,
    candidate_sha:lineage.candidate_sha,
    archive_state:lineage.archive_state,
    skill_id:checkedSkill.skill_id,
    skill_version:checkedSkill.skill_version,
    skill_digest:checkedSkill.skill_digest,
    skill_evidence_digest:checkedEvidence.evidence_digest,
    portability_receipt_digests:[...receiptDigests].sort(),
    verified_transfer_context_count:contexts.size,
    verified_transfer_holdout_count:holdouts.size,
    verified_transfer_family_count:families.size,
    negative_transfer_present:false,
    minimum_independent_transfer_contexts:2,
    library_id:library.library_id,
    library_digest:library.library_digest,
    governance_id:governance.governance_id,
    governance_digest:governance.governance_digest,
    governance_state:governanceRow.state,
    active_for_composition:governanceRow.active_for_composition,
    library,
    governance,
    append_only_library_evidence:true,
    cross_context_transfer_verified:true,
    lifecycle_governance_applied:true,
    activation_view_created:false,
    direct_activation_allowed:false,
    external_planner_required_for_activation_view:true,
    negative_transfer_blocks_admission:true,
    retired_or_quarantined_reactivation_allowed:false,
    raw_trajectory_ingested:false,
    raw_model_transcript_ingested:false,
    raw_page_text_ingested:false,
    skill_memory_is_execution_authority:false,
    eligible_for_promotion:false,
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
  return Object.freeze({...core,admission_digest:digest(core)});
}

export function verifyRsiLineageSkillAdmission(row,inputs={}){
  if(!row||typeof row!=='object'||Array.isArray(row)||row.schema!==RSI_LINEAGE_SKILL_ADMISSION_SCHEMA||row.version!==1){
    throw new Error('rsi_lineage_skill_admission_invalid');
  }
  zeroAuthority(row,'admission');
  if(
    row.append_only_library_evidence!==true
    ||row.cross_context_transfer_verified!==true
    ||row.lifecycle_governance_applied!==true
    ||row.activation_view_created!==false
    ||row.direct_activation_allowed!==false
    ||row.external_planner_required_for_activation_view!==true
    ||row.negative_transfer_blocks_admission!==true
    ||row.retired_or_quarantined_reactivation_allowed!==false
    ||row.raw_trajectory_ingested!==false
    ||row.raw_model_transcript_ingested!==false
    ||row.raw_page_text_ingested!==false
    ||row.skill_memory_is_execution_authority!==false
    ||row.eligible_for_promotion!==false
  )throw new Error('rsi_lineage_skill_admission_policy_invalid');
  const expected=admitRsiLineageSkill(inputs);
  if(JSON.stringify(stable(row))!==JSON.stringify(stable(expected)))throw new Error('rsi_lineage_skill_admission_mismatch');
  return expected;
}
