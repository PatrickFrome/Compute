import crypto from 'node:crypto';

import {
  verifyRsiDevosImplementationAdoption,
  verifyRsiFrontierReviewResult,
} from './rsi-devos-implementation-adoption.mjs';
import {
  verifyRsiCandidateWorkspacePreflight,
} from './rsi-isolated-candidate-builder.mjs';
import {
  prepareRsiTargetedCandidateBuild,
  verifyRsiTargetedCandidateBuild,
} from './rsi-targeted-candidate-builder.mjs';

export const RSI_CANDIDATE_MATERIALIZATION_GATE_SCHEMA = 'metaengine.rsi.candidate-materialization-gate.v1';

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
    if (value?.[field] !== false) throw new Error(`rsi_materialization_gate_${label}_${field}_invalid`);
  }
  if (value?.automatic_retry_allowed !== false) {
    throw new Error(`rsi_materialization_gate_${label}_automatic_retry_invalid`);
  }
}

export function prepareRsiCandidateMaterializationGate({
  review_result,
  adoption,
  source_snapshot,
  workspace_binding_snapshot,
  workspace_id,
  implementation_task_id,
  now_ms = Date.now(),
  max_snapshot_age_ms = 30_000,
  sequence = 1,
  previous_candidate_id = null,
  requested_backend = null,
} = {}) {
  const review = verifyRsiFrontierReviewResult(review_result);
  const checkedAdoption = verifyRsiDevosImplementationAdoption(adoption, { review_result: review });
  zeroAuthority(checkedAdoption, 'adoption');

  if (
    checkedAdoption.source_sha !== review.source_sha
    || checkedAdoption.target_branch !== review.experiment_plan.target_branch
    || checkedAdoption.plan_digest !== review.experiment_plan.plan_digest
    || checkedAdoption.mutation_contract_digest !== review.mutation_contract.contract_digest
  ) {
    throw new Error('rsi_materialization_gate_adoption_binding_invalid');
  }

  const workspacePreflight = verifyRsiCandidateWorkspacePreflight(workspace_binding_snapshot, {
    parent_sha: checkedAdoption.source_sha,
    target_branch: checkedAdoption.target_branch,
    workspace_id,
    expected_task_id: implementation_task_id,
    now_ms,
    max_snapshot_age_ms,
  });

  const targetedBuild = prepareRsiTargetedCandidateBuild({
    experiment_plan: review.experiment_plan,
    hypothesis: review.hypothesis,
    mutation_contract: review.mutation_contract,
    source_snapshot,
    mutations: checkedAdoption.implementation_task_spec.exact_mutation_set,
    sequence,
    previous_candidate_id,
    requested_backend,
  });
  verifyRsiTargetedCandidateBuild(targetedBuild, {
    hypothesis: review.hypothesis,
    mutation_contract: review.mutation_contract,
  });

  if (
    targetedBuild.generic_build_plan.source.parent_sha !== checkedAdoption.source_sha
    || targetedBuild.generic_build_plan.target_branch !== checkedAdoption.target_branch
    || targetedBuild.generic_build_plan.source.source_snapshot_digest == null
  ) {
    throw new Error('rsi_materialization_gate_build_binding_invalid');
  }

  const core = {
    schema: RSI_CANDIDATE_MATERIALIZATION_GATE_SCHEMA,
    version: 1,
    source_sha: checkedAdoption.source_sha,
    target_branch: checkedAdoption.target_branch,
    implementation_task_id: String(implementation_task_id || '').toLowerCase(),
    workspace_id: String(workspace_id || '').toLowerCase(),
    adoption_digest: checkedAdoption.adoption_digest,
    review_digest: review.review_digest,
    hypothesis_digest: review.hypothesis.hypothesis_digest,
    experiment_plan_digest: review.experiment_plan.plan_digest,
    mutation_contract_digest: review.mutation_contract.contract_digest,
    workspace_preflight: workspacePreflight,
    targeted_build: targetedBuild,
    exact_source_snapshot_digest: targetedBuild.generic_build_plan.source.source_snapshot_digest,
    exact_mutation_set: structuredClone(targetedBuild.exact_mutation_set),
    ready_for_existing_devos_materializer: true,
    materialization_not_yet_performed: true,
    materialization_receipt_required: true,
    finalization_must_reverify_workspace_binding: true,
    sandbox_plan_required_after_materialization: true,
    external_evaluator_required_after_materialization: true,
    benchmark_provenance_required_after_materialization: true,
    evaluation_integrity_required_after_materialization: true,
    no_second_scheduler: true,
    no_blind_retry_after_ambiguous_effect: true,
    browser_materialization_authority: false,
    candidate_can_mutate_trust_roots: false,
    direct_promotion_enabled: false,
    direct_self_update_enabled: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, gate_digest: digest(core) });
}

export function verifyRsiCandidateMaterializationGate(row, inputs = {}) {
  if (!row || typeof row !== 'object' || Array.isArray(row) || row.schema !== RSI_CANDIDATE_MATERIALIZATION_GATE_SCHEMA) {
    throw new Error('rsi_materialization_gate_invalid');
  }
  zeroAuthority(row, 'gate');
  const expected = prepareRsiCandidateMaterializationGate(inputs);
  if (JSON.stringify(stable(row)) !== JSON.stringify(stable(expected))) {
    throw new Error('rsi_materialization_gate_mismatch');
  }
  return expected;
}
