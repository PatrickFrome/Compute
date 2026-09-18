import crypto from 'node:crypto';

import {
  RsiVerifiedEvolutionArchive,
} from './rsi-verified-evolution-archive.mjs';
import {
  createRsiShadowTournamentPlan,
  verifyRsiShadowTournamentResult,
} from './rsi-shadow-tournament.mjs';
import {
  createRsiCladeNode,
  verifyRsiCladeNode,
} from './rsi-clade-metaproductivity.mjs';

export const RSI_VERIFIED_LINEAGE_ADMISSION_SCHEMA = 'metaengine.rsi.verified-lineage-admission.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const CANDIDATE_ID_RE=/^candidate_sha256_[0-9a-f]{64}$/;

function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.keys(value).sort().map((key)=>[key,stable(value[key])]));
}
function digest(value){
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)),'utf8').digest('hex')}`;
}
function zeroAuthority(value,label){
  for(const field of ['execution_authority','production_mutation_authority','promotion_authority','self_update_authority','authority_effect']){
    if(value?.[field]!==false)throw new Error(`rsi_lineage_${label}_${field}_invalid`);
  }
  if(value?.automatic_retry_allowed!==false)throw new Error(`rsi_lineage_${label}_automatic_retry_invalid`);
}
function candidateIdentity(handoff){
  const candidateId=String(handoff?.candidate_capsule?.candidate_id||'').toLowerCase();
  const candidateSha=String(handoff?.candidate_sha||'').toLowerCase();
  const parentSha=String(handoff?.parent_sha||'').toLowerCase();
  const handoffDigest=String(handoff?.handoff_digest||'').toLowerCase();
  if(!CANDIDATE_ID_RE.test(candidateId)||!SHA40_RE.test(candidateSha)||!SHA40_RE.test(parentSha)||!SHA256_RE.test(handoffDigest)){
    throw new Error('rsi_lineage_candidate_identity_invalid');
  }
  if(candidateSha===parentSha)throw new Error('rsi_lineage_candidate_noop');
  zeroAuthority(handoff,'candidate_handoff');
  return {candidate_id:candidateId,candidate_sha:candidateSha,parent_sha:parentSha,handoff_digest:handoffDigest};
}
function verifyVerifiedEvaluatorResult(row,candidate){
  if(!row||typeof row!=='object'||Array.isArray(row)||row.schema!=='metaengine.rsi.verified-evaluator-result.v1'||row.version!==1){
    throw new Error('rsi_lineage_verified_evaluator_result_invalid');
  }
  zeroAuthority(row,'verified_evaluator_result');
  if(
    row.candidate_id!==candidate.candidate_id
    ||row.candidate_sha!==candidate.candidate_sha
    ||row.benchmark_provenance_verified!==true
    ||row.harness_integrity_verified!==true
    ||row.mechanical_artifact_audit_verified!==true
    ||row.no_op_ablation_verified!==true
    ||row.sandbox_boundary_verified!==true
    ||row.archive_apply_performed!==true
    ||row.direct_promotion_enabled!==false
    ||row.direct_self_update_enabled!==false
  )throw new Error('rsi_lineage_verified_evaluator_policy_invalid');
  if(!row.evaluator_result||row.evaluator_result.candidate_id!==candidate.candidate_id||row.evaluator_result.candidate_sha!==candidate.candidate_sha){
    throw new Error('rsi_lineage_evaluator_candidate_binding_invalid');
  }
  return row;
}

export function verifyRsiVerifiedLineageAdmission(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row) || row.schema !== RSI_VERIFIED_LINEAGE_ADMISSION_SCHEMA || row.version !== 1) {
    throw new Error('rsi_lineage_admission_invalid');
  }
  zeroAuthority(row,'admission');
  if (!CANDIDATE_ID_RE.test(String(row.candidate_id || '').toLowerCase())
      || !SHA40_RE.test(String(row.candidate_sha || '').toLowerCase())
      || !SHA40_RE.test(String(row.parent_sha || '').toLowerCase())
      || !SHA256_RE.test(String(row.verified_evaluator_result_digest || '').toLowerCase())
      || !SHA256_RE.test(String(row.tournament_plan_digest || '').toLowerCase())
      || !SHA256_RE.test(String(row.tournament_result_digest || '').toLowerCase())
      || !SHA256_RE.test(String(row.archive_admission_digest || '').toLowerCase())
      || !SHA256_RE.test(String(row.archive_snapshot_digest || '').toLowerCase())
      || !SHA256_RE.test(String(row.clade_node_digest || '').toLowerCase())) {
    throw new Error('rsi_lineage_admission_identity_invalid');
  }
  if (
    row.diverse_lineage_retention_required !== true
    || row.scalar_rank_authoritative !== false
    || row.non_elite_stepping_stones_may_remain_active !== true
    || row.direct_skill_library_admission_allowed !== false
    || row.transfer_evidence_required_before_skill_library !== true
    || row.lifecycle_governance_required_before_skill_activation !== true
    || row.candidate_can_edit_archive !== false
    || row.candidate_can_edit_clade_statistics !== false
    || row.eligible_for_promotion !== false
    || row.direct_promotion_enabled !== false
    || row.direct_self_update_enabled !== false
  ) throw new Error('rsi_lineage_admission_policy_invalid');
  const clade = verifyRsiCladeNode(row.clade_node);
  if (clade.node_digest !== row.clade_node_digest
      || clade.candidate_id !== row.candidate_id
      || clade.candidate_sha !== row.candidate_sha
      || clade.parent_candidate_id !== row.parent_candidate_id) {
    throw new Error('rsi_lineage_admission_clade_binding_invalid');
  }
  const clone=structuredClone(row);
  delete clone.lineage_admission_digest;
  const expected=digest(clone);
  if (row.lineage_admission_digest !== expected) throw new Error('rsi_lineage_admission_digest_mismatch');
  return Object.freeze(structuredClone(row));
}

export function admitRsiVerifiedLineage({
  archive,
  candidate_handoff,
  verified_evaluator_result,
  workload,
  tournament_receipts,
  tournament_result,
  pair_count=5,
  parent_candidate_id=null,
  benchmark_solved,
  benchmark_total,
}={}){
  if(!(archive instanceof RsiVerifiedEvolutionArchive))throw new Error('rsi_lineage_verified_archive_required');
  const candidate=candidateIdentity(candidate_handoff);
  const verifiedEval=verifyVerifiedEvaluatorResult(verified_evaluator_result,candidate);

  if(parent_candidate_id!=null){
    const parentId=String(parent_candidate_id||'').toLowerCase();
    if(!CANDIDATE_ID_RE.test(parentId))throw new Error('rsi_lineage_parent_candidate_id_invalid');
    const parent=archive.get(parentId);
    if(!parent||String(parent.candidate_sha||'').toLowerCase()!==candidate.parent_sha){
      throw new Error('rsi_lineage_parent_archive_binding_invalid');
    }
  }

  const tournamentPlan=createRsiShadowTournamentPlan({
    candidate_handoff,
    evaluator_result:verifiedEval.evaluator_result,
    workload,
    pair_count,
  });
  verifyRsiShadowTournamentResult({plan:tournamentPlan,result:tournament_result});

  const archiveAdmission=archive.admit({
    plan:tournamentPlan,
    result:tournament_result,
    receipts:tournament_receipts,
  });

  const solved=Number(benchmark_solved);
  const total=Number(benchmark_total);
  if(!Number.isSafeInteger(total)||total<1||!Number.isSafeInteger(solved)||solved<0||solved>total){
    throw new Error('rsi_lineage_benchmark_count_invalid');
  }

  const cladeNode=createRsiCladeNode({
    node_id:`clade:${candidate.candidate_id.slice('candidate_sha256_'.length, 'candidate_sha256_'.length+24)}`,
    candidate_id:candidate.candidate_id,
    candidate_sha:candidate.candidate_sha,
    parent_candidate_id:parent_candidate_id==null?null:String(parent_candidate_id).toLowerCase(),
    benchmark_solved:solved,
    benchmark_total:total,
    evaluation_digest:archiveAdmission.admission_digest,
    expansion_count:0,
    external_evaluator:true,
    authored_by_candidate:false,
  });
  verifyRsiCladeNode(cladeNode);

  const archiveSnapshot=archive.snapshot();
  const skillResearchEligible=archiveAdmission.archive_active===true
    && ['PARETO_ELITE','STEPPING_STONE'].includes(archiveAdmission.archive_state);

  const core={
    schema:RSI_VERIFIED_LINEAGE_ADMISSION_SCHEMA,
    version:1,
    candidate_id:candidate.candidate_id,
    candidate_sha:candidate.candidate_sha,
    parent_sha:candidate.parent_sha,
    parent_candidate_id:parent_candidate_id==null?null:String(parent_candidate_id).toLowerCase(),
    verified_evaluator_result_digest:verifiedEval.result_digest,
    tournament_plan_id:tournamentPlan.plan_id,
    tournament_plan_digest:tournamentPlan.plan_digest,
    tournament_result_digest:tournament_result.result_digest,
    archive_admission_digest:archiveAdmission.admission_digest,
    archive_state:archiveAdmission.archive_state,
    archive_active:archiveAdmission.archive_active,
    archive_snapshot_digest:archiveSnapshot.snapshot_digest,
    clade_node:cladeNode,
    clade_node_digest:cladeNode.node_digest,
    diverse_lineage_retention_required:true,
    scalar_rank_authoritative:false,
    non_elite_stepping_stones_may_remain_active:true,
    skill_distillation_research_eligible:skillResearchEligible,
    direct_skill_library_admission_allowed:false,
    transfer_evidence_required_before_skill_library:true,
    lifecycle_governance_required_before_skill_activation:true,
    candidate_can_edit_archive:false,
    candidate_can_edit_clade_statistics:false,
    eligible_for_promotion:false,
    direct_promotion_enabled:false,
    direct_self_update_enabled:false,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...core,lineage_admission_digest:digest(core)});
}
