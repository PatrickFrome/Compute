import crypto from 'node:crypto';

import {
  verifyRsiCandidateMaterializationGate,
} from './rsi-candidate-materialization-gate.mjs';
import {
  finalizeRsiIsolatedCandidateBuild,
  verifyRsiCandidateWorkspacePreflight,
} from './rsi-isolated-candidate-builder.mjs';
import {
  createRsiEvaluatorMeshPlan,
  verifyRsiEvaluatorMeshPlan,
} from './rsi-evaluator-mesh.mjs';

export const RSI_CANDIDATE_FINALIZATION_GATE_SCHEMA = 'metaengine.rsi.candidate-finalization-gate.v1';

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
    if (value?.[field] !== false) throw new Error(`rsi_finalization_gate_${label}_${field}_invalid`);
  }
  if (value?.automatic_retry_allowed !== false) {
    throw new Error(`rsi_finalization_gate_${label}_automatic_retry_invalid`);
  }
}

function sameIncarnation(left, right) {
  return left.workspace_id === right.workspace_id
    && left.task_id === right.task_id
    && left.workspace_generation === right.workspace_generation
    && left.lease_generation === right.lease_generation
    && left.agent_id === right.agent_id
    && left.agent_generation_epoch === right.agent_generation_epoch
    && left.tab_id === right.tab_id
    && left.target_id === right.target_id;
}

export function finalizeRsiCandidateForEvaluation({
  materialization_gate,
  materialization_gate_inputs,
  materialization_receipt,
  now_ms = Date.now(),
  max_snapshot_age_ms = 30_000,
} = {}) {
  const gate = verifyRsiCandidateMaterializationGate(
    materialization_gate,
    materialization_gate_inputs,
  );
  zeroAuthority(gate, 'materialization_gate');

  const receiptSnapshot = materialization_receipt?.workspace?.binding_snapshot;
  const receiptWorkspaceId = String(materialization_receipt?.workspace?.workspace_id || '').toLowerCase();
  const current = verifyRsiCandidateWorkspacePreflight(receiptSnapshot, {
    parent_sha: gate.source_sha,
    target_branch: gate.target_branch,
    workspace_id: receiptWorkspaceId,
    expected_task_id: gate.implementation_task_id,
    now_ms,
    max_snapshot_age_ms,
  });

  if (!sameIncarnation(gate.workspace_preflight, current)) {
    throw new Error('rsi_finalization_gate_workspace_incarnation_drift');
  }

  const handoff = finalizeRsiIsolatedCandidateBuild({
    build_plan: gate.targeted_build.generic_build_plan,
    materialization_receipt,
  });
  zeroAuthority(handoff, 'candidate_handoff');

  if (
    handoff.parent_sha !== gate.source_sha
    || handoff.target_branch !== gate.target_branch
    || handoff.build_plan_digest !== gate.targeted_build.generic_build_plan.plan_digest
    || handoff.workspace_binding_readback_digest !== current.binding_snapshot_digest
    || handoff.eligible_for_evaluation !== true
    || handoff.eligible_for_promotion !== false
    || handoff.materialization_replay_authorized !== false
  ) {
    throw new Error('rsi_finalization_gate_handoff_binding_invalid');
  }

  const evaluatorPlan = createRsiEvaluatorMeshPlan({ candidate_handoff: handoff });
  verifyRsiEvaluatorMeshPlan(evaluatorPlan);
  zeroAuthority(evaluatorPlan, 'evaluator_plan');

  const core = {
    schema: RSI_CANDIDATE_FINALIZATION_GATE_SCHEMA,
    version: 1,
    materialization_gate_digest: gate.gate_digest,
    source_sha: gate.source_sha,
    target_branch: gate.target_branch,
    implementation_task_id: gate.implementation_task_id,
    workspace_id: gate.workspace_id,
    workspace_preflight_digest: gate.workspace_preflight.preflight_digest,
    materialization_workspace_preflight_digest: current.preflight_digest,
    candidate_id: handoff.candidate_capsule.candidate_id,
    candidate_sha: handoff.candidate_sha,
    candidate_handoff_digest: handoff.handoff_digest,
    evaluator_plan_id: evaluatorPlan.plan_id,
    evaluator_plan_digest: evaluatorPlan.plan_digest,
    candidate_handoff: handoff,
    evaluator_plan: evaluatorPlan,
    candidate_materialized: true,
    candidate_executed_in_production: false,
    candidate_eligible_for_evaluation: true,
    candidate_eligible_for_promotion: false,
    archive_mutation_performed: false,
    benchmark_provenance_required_before_archive: true,
    evaluation_integrity_required_before_archive: true,
    verified_evaluator_admission_required_before_archive: true,
    materialization_replay_authorized: false,
    no_blind_retry_after_ambiguous_effect: true,
    direct_promotion_enabled: false,
    direct_self_update_enabled: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, finalization_digest: digest(core) });
}
