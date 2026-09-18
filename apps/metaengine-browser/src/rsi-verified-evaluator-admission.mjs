import crypto from 'node:crypto';

import {
  verifyRsiBenchmarkEvidenceAdmission,
} from './rsi-benchmark-provenance-guard.mjs';
import {
  verifyRsiEvaluationIntegrityAssessment,
} from './rsi-evaluation-integrity-guard.mjs';
import {
  applyRsiEvaluatorMesh,
  verifyRsiEvaluatorMeshPlan,
} from './rsi-evaluator-mesh.mjs';

export const RSI_VERIFIED_EVALUATOR_ADMISSION_SCHEMA = 'metaengine.rsi.verified-evaluator-admission.v1';
export const RSI_VERIFIED_EVALUATOR_RESULT_SCHEMA = 'metaengine.rsi.verified-evaluator-result.v1';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)), 'utf8').digest('hex')}`;
}

function zeroAuthority(value, label) {
  for (const field of [
    'execution_authority',
    'production_mutation_authority',
    'promotion_authority',
    'self_update_authority',
    'authority_effect',
  ]) {
    if (value?.[field] !== false) throw new Error(`rsi_verified_evaluator_${label}_${field}_invalid`);
  }
  if (value?.automatic_retry_allowed !== false) {
    throw new Error(`rsi_verified_evaluator_${label}_automatic_retry_invalid`);
  }
}

function candidateFromPlan(plan) {
  verifyRsiEvaluatorMeshPlan(plan);
  return {
    candidate_id: String(plan.candidate?.candidate_id || '').toLowerCase(),
    candidate_sha: String(plan.candidate?.candidate_sha || '').toLowerCase(),
    handoff_digest: String(plan.candidate?.handoff_digest || '').toLowerCase(),
  };
}

export function createRsiVerifiedEvaluatorAdmission({
  evaluator_plan,
  benchmark_policy,
  benchmark_tasks,
  benchmark_assessments,
  benchmark_admission,
  integrity_policy,
  integrity_receipt,
  integrity_assessment,
} = {}) {
  const candidate = candidateFromPlan(evaluator_plan);
  const benchmark = verifyRsiBenchmarkEvidenceAdmission(
    benchmark_admission,
    benchmark_policy,
    benchmark_assessments,
    benchmark_tasks,
  );
  const integrity = verifyRsiEvaluationIntegrityAssessment(
    integrity_assessment,
    integrity_policy,
    integrity_receipt,
  );
  zeroAuthority(benchmark, 'benchmark_admission');
  zeroAuthority(integrity, 'integrity_assessment');

  if (String(integrity.candidate_id || '').toLowerCase() !== candidate.candidate_id) {
    throw new Error('rsi_verified_evaluator_integrity_candidate_id_mismatch');
  }
  if (String(integrity.candidate_sha || '').toLowerCase() !== candidate.candidate_sha) {
    throw new Error('rsi_verified_evaluator_integrity_candidate_sha_mismatch');
  }

  const blockers = [];
  if (benchmark.eligible_for_full_holdout_evidence !== true) blockers.push('BENCHMARK_PROVENANCE_NOT_ADMITTED');
  if (Number(benchmark.contaminated_task_count || 0) > 0) blockers.push('CONTAMINATED_BENCHMARK_TASK');
  if (integrity.state !== 'INTEGRITY_VERIFIED') blockers.push(`EVALUATION_INTEGRITY_${integrity.state}`);
  if (integrity.eligible_for_archive_evidence !== true) blockers.push('INTEGRITY_NOT_ARCHIVE_ELIGIBLE');

  const core = {
    schema: RSI_VERIFIED_EVALUATOR_ADMISSION_SCHEMA,
    version: 1,
    state: blockers.length === 0 ? 'READY' : 'BLOCKED',
    blockers: blockers.sort(),
    candidate_id: candidate.candidate_id,
    candidate_sha: candidate.candidate_sha,
    handoff_digest: candidate.handoff_digest,
    evaluator_plan_id: evaluator_plan.plan_id,
    evaluator_plan_digest: evaluator_plan.plan_digest,
    benchmark_admission_digest: benchmark.admission_digest,
    integrity_assessment_digest: integrity.assessment_digest,
    benchmark_provenance_required: true,
    contamination_resistant_holdout_required: true,
    harness_integrity_required: true,
    evaluator_root_immutable: true,
    candidate_authored_integrity_evidence_allowed: false,
    visible_suite_success_alone_sufficient: false,
    archive_apply_authorized: blockers.length === 0,
    promotion_authority: false,
    self_update_authority: false,
    execution_authority: false,
    production_mutation_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, admission_digest: digest(core) });
}

export function verifyRsiVerifiedEvaluatorAdmission(row, inputs = {}) {
  if (!row || typeof row !== 'object' || Array.isArray(row) || row.schema !== RSI_VERIFIED_EVALUATOR_ADMISSION_SCHEMA) {
    throw new Error('rsi_verified_evaluator_admission_invalid');
  }
  zeroAuthority(row, 'admission');
  const expected = createRsiVerifiedEvaluatorAdmission(inputs);
  if (JSON.stringify(stable(row)) !== JSON.stringify(stable(expected))) {
    throw new Error('rsi_verified_evaluator_admission_mismatch');
  }
  return expected;
}

export function applyRsiVerifiedEvaluatorMesh({
  archive,
  candidate_handoff,
  evaluator_plan,
  evaluator_receipts,
  benchmark_policy,
  benchmark_tasks,
  benchmark_assessments,
  benchmark_admission,
  integrity_policy,
  integrity_receipt,
  integrity_assessment,
  verified_admission,
} = {}) {
  const inputs = {
    evaluator_plan,
    benchmark_policy,
    benchmark_tasks,
    benchmark_assessments,
    benchmark_admission,
    integrity_policy,
    integrity_receipt,
    integrity_assessment,
  };
  const admission = verifyRsiVerifiedEvaluatorAdmission(verified_admission, inputs);
  if (admission.state !== 'READY' || admission.archive_apply_authorized !== true) {
    throw new Error('rsi_verified_evaluator_admission_blocked');
  }

  const result = applyRsiEvaluatorMesh({
    archive,
    candidate_handoff,
    plan: evaluator_plan,
    receipts: evaluator_receipts,
  });

  const core = {
    schema: RSI_VERIFIED_EVALUATOR_RESULT_SCHEMA,
    version: 1,
    candidate_id: admission.candidate_id,
    candidate_sha: admission.candidate_sha,
    evaluator_plan_digest: admission.evaluator_plan_digest,
    verified_admission_digest: admission.admission_digest,
    evaluator_result_digest: result.result_digest,
    evaluator_state: result.state,
    archive_apply_performed: true,
    benchmark_provenance_verified: true,
    harness_integrity_verified: true,
    direct_promotion_enabled: false,
    direct_self_update_enabled: false,
    promotion_authority: false,
    self_update_authority: false,
    execution_authority: false,
    production_mutation_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, result_digest: digest(core), evaluator_result: result });
}
