import crypto from 'node:crypto';

import {
  verifyRsiVerifiedLineageAdmission,
} from './rsi-verified-lineage-admission.mjs';
import {
  verifyRsiSkillCapsule,
  verifyRsiSkillEvidence,
} from './rsi-verified-skill-library.mjs';
import {
  createRsiContrastiveSkillRevision,
  createRsiSkillReliabilityEvaluation,
  finalizeRsiContrastiveSkillReliability,
} from './rsi-contrastive-skill-reliability.mjs';
import {
  finalizeRsiRetentionGate,
  verifyRsiRetentionGate,
} from './rsi-regression-replay.mjs';

export const RSI_SKILL_REVISION_ADMISSION_SCHEMA='metaengine.rsi.skill-revision-admission.v1';

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
    if(value?.[field]!==false)throw new Error(`rsi_skill_revision_${label}_${field}_invalid`);
  }
  if(value?.automatic_retry_allowed!==false)throw new Error(`rsi_skill_revision_${label}_automatic_retry_invalid`);
}

export function createRsiSkillRevisionAdmission({
  successor_lineage_admission,
  reliability_revision_inputs,
  reliability_evaluation_inputs,
  successor_skill_evidence,
  retention_plan,
  retention_ledger,
  retention_receipts,
}={}){
  const lineage=verifyRsiVerifiedLineageAdmission(successor_lineage_admission);
  if(lineage.archive_active!==true)throw new Error('rsi_skill_revision_lineage_not_active');

  const revision=createRsiContrastiveSkillRevision(reliability_revision_inputs);
  zeroAuthority(revision,'revision');
  const evaluation=createRsiSkillReliabilityEvaluation({
    ...reliability_evaluation_inputs,
    revision,
  });
  zeroAuthority(evaluation,'evaluation');
  const reliability=finalizeRsiContrastiveSkillReliability({revision,evaluation});
  zeroAuthority(reliability,'reliability_result');
  if(reliability.reliability_gate_pass===false||reliability.eligible_for_v126_scope_preservation!==true){
    throw new Error('rsi_skill_revision_reliability_gate_failed');
  }

  const successor=verifyRsiSkillCapsule(revision.successor_skill);
  const successorEvidence=verifyRsiSkillEvidence(successor_skill_evidence,successor);
  zeroAuthority(successor,'successor_skill');
  zeroAuthority(successorEvidence,'successor_evidence');
  if(successor.source_candidate_sha!==lineage.candidate_sha)throw new Error('rsi_skill_revision_successor_lineage_mismatch');
  if(successorEvidence.verified_for_library!==true||successorEvidence.hard_invariants_pass!==true){
    throw new Error('rsi_skill_revision_successor_evidence_invalid');
  }

  const retention=finalizeRsiRetentionGate({
    plan:retention_plan,
    ledger:retention_ledger,
    receipts:retention_receipts,
  });
  verifyRsiRetentionGate(retention,retention_plan,retention_ledger,retention_receipts);
  zeroAuthority(retention,'retention_gate');
  if(
    retention.current_candidate_id!==lineage.candidate_id
    ||retention.current_candidate_sha!==lineage.candidate_sha
  )throw new Error('rsi_skill_revision_retention_candidate_mismatch');
  if(retention.retention_gate_pass!==true)throw new Error('rsi_skill_revision_retention_gate_failed');

  const core={
    schema:RSI_SKILL_REVISION_ADMISSION_SCHEMA,
    version:1,
    successor_lineage_admission_digest:lineage.lineage_admission_digest,
    successor_candidate_id:lineage.candidate_id,
    successor_candidate_sha:lineage.candidate_sha,
    parent_skill_id:successor.skill_id,
    parent_skill_digest:revision.parent_skill_digest,
    parent_skill_version:revision.parent_skill_version,
    successor_skill_id:successor.skill_id,
    successor_skill_digest:successor.skill_digest,
    successor_skill_version:successor.skill_version,
    successor_skill_evidence_digest:successorEvidence.evidence_digest,
    revision_digest:revision.revision_digest,
    reliability_evaluation_digest:evaluation.evaluation_digest,
    reliability_result_digest:reliability.result_digest,
    retention_gate_digest:retention.gate_digest,
    retention_ledger_digest:retention_ledger.ledger_digest,
    reliable_behavior_improved:true,
    potential_capability_preserved:true,
    retention_gate_pass:true,
    same_interface_required:true,
    same_capability_set_required:true,
    same_scope_revision_only:true,
    scope_widening_allowed:false,
    explicit_scope_expansion_requires_v126_pipeline:true,
    parent_replacement_automatic:false,
    eligible_for_external_library_version_evidence:true,
    directly_admitted_to_library:false,
    direct_activation_allowed:false,
    lifecycle_governance_required_after_library_admission:true,
    source_lineage_exact:true,
    candidate_can_self_certify_revision:false,
    candidate_can_delete_mastery_anchors:false,
    candidate_can_lower_retention_floors:false,
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

export function verifyRsiSkillRevisionAdmission(row,inputs={}){
  if(!row||typeof row!=='object'||Array.isArray(row)||row.schema!==RSI_SKILL_REVISION_ADMISSION_SCHEMA||row.version!==1){
    throw new Error('rsi_skill_revision_admission_invalid');
  }
  zeroAuthority(row,'admission');
  if(
    row.reliable_behavior_improved!==true
    ||row.potential_capability_preserved!==true
    ||row.retention_gate_pass!==true
    ||row.same_interface_required!==true
    ||row.same_capability_set_required!==true
    ||row.same_scope_revision_only!==true
    ||row.scope_widening_allowed!==false
    ||row.explicit_scope_expansion_requires_v126_pipeline!==true
    ||row.parent_replacement_automatic!==false
    ||row.eligible_for_external_library_version_evidence!==true
    ||row.directly_admitted_to_library!==false
    ||row.direct_activation_allowed!==false
    ||row.lifecycle_governance_required_after_library_admission!==true
    ||row.source_lineage_exact!==true
    ||row.candidate_can_self_certify_revision!==false
    ||row.candidate_can_delete_mastery_anchors!==false
    ||row.candidate_can_lower_retention_floors!==false
  )throw new Error('rsi_skill_revision_admission_policy_invalid');
  const expected=createRsiSkillRevisionAdmission(inputs);
  if(JSON.stringify(stable(row))!==JSON.stringify(stable(expected)))throw new Error('rsi_skill_revision_admission_mismatch');
  return expected;
}
