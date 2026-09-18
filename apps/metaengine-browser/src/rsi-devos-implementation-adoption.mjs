import crypto from 'node:crypto';

import { RSI_DEVOS_EXPERIMENT_PLAN_SCHEMA } from './rsi-devos-experiment-plan.mjs';
import {
  RSI_MUTATION_CONTRACT_SCHEMA,
  verifyRsiMutationContract,
} from './supervisor-rsi-mutation-contract.mjs';

export const RSI_FRONTIER_REVIEW_RESULT_SCHEMA = 'metaengine.rsi.frontier-review-result.v1';
export const RSI_DEVOS_IMPLEMENTATION_ADOPTION_SCHEMA = 'metaengine.rsi.devos-implementation-adoption.v1';

const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const OPPORTUNITY = /^opp:[0-9a-f]{24}$/;
const HYPOTHESIS = /^rsi_hyp_[0-9a-f]{24}$/;
const EXPERIMENT = /^rsi_exp_[0-9a-f]{24}$/;
const BRANCH = /^work\/rsi\/[a-z0-9][a-z0-9-]{1,199}$/;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function hashHex(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value)), 'utf8').digest('hex');
}

function digest(value) {
  return `sha256:${hashHex(value)}`;
}

function zeroAuthority(value, label) {
  for (const field of [
    'execution_authority',
    'production_mutation_authority',
    'promotion_authority',
    'self_update_authority',
    'authority_effect',
  ]) {
    if (value?.[field] !== false) throw new Error(`rsi_adoption_${label}_${field}_invalid`);
  }
  if (value?.automatic_retry_allowed !== false) {
    throw new Error(`rsi_adoption_${label}_automatic_retry_invalid`);
  }
}

function verifyHypothesis(hypothesis) {
  if (!hypothesis || typeof hypothesis !== 'object' || Array.isArray(hypothesis)) {
    throw new Error('rsi_adoption_hypothesis_invalid');
  }
  zeroAuthority(hypothesis, 'hypothesis');
  if (hypothesis.schema !== 'metaengine.rsi.experiment-hypothesis.v1' || hypothesis.version !== 1) {
    throw new Error('rsi_adoption_hypothesis_schema_invalid');
  }
  if (!SHA40.test(String(hypothesis.source_sha || ''))) throw new Error('rsi_adoption_hypothesis_source_invalid');
  if (!HYPOTHESIS.test(String(hypothesis.hypothesis_id || '')) || !SHA256.test(String(hypothesis.hypothesis_digest || ''))) {
    throw new Error('rsi_adoption_hypothesis_identity_invalid');
  }
  if (
    hypothesis.shadow_only !== true
    || hypothesis.candidate_can_modify_hypothesis !== false
    || hypothesis.candidate_can_modify_acceptance_contract !== false
    || hypothesis.requires_existing_devos_scheduler !== true
    || hypothesis.requires_independent_evaluator !== true
  ) throw new Error('rsi_adoption_hypothesis_policy_invalid');

  const material = structuredClone(hypothesis);
  delete material.hypothesis_id;
  delete material.hypothesis_digest;
  const expected = digest(material);
  if (expected !== hypothesis.hypothesis_digest) throw new Error('rsi_adoption_hypothesis_digest_mismatch');
  if (hypothesis.hypothesis_id !== `rsi_hyp_${expected.slice('sha256:'.length, 'sha256:'.length + 24)}`) {
    throw new Error('rsi_adoption_hypothesis_id_mismatch');
  }
  return hypothesis;
}

function verifyPlan(plan, hypothesis) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan) || plan.schema !== RSI_DEVOS_EXPERIMENT_PLAN_SCHEMA) {
    throw new Error('rsi_adoption_plan_invalid');
  }
  zeroAuthority(plan, 'plan');
  if (!EXPERIMENT.test(String(plan.experiment_id || '')) || !HEX64.test(String(plan.plan_digest || ''))) {
    throw new Error('rsi_adoption_plan_identity_invalid');
  }
  if (!BRANCH.test(String(plan.target_branch || ''))) throw new Error('rsi_adoption_plan_branch_invalid');
  if (
    plan.requires_existing_devos_scheduler !== true
    || plan.lease_created !== false
    || plan.agent_assigned !== false
    || plan.workspace_bound !== false
    || plan.command_created !== false
  ) throw new Error('rsi_adoption_plan_prelease_invalid');

  const material = structuredClone(plan);
  delete material.plan_digest;
  if (hashHex(material) !== plan.plan_digest) throw new Error('rsi_adoption_plan_digest_mismatch');

  if (
    plan.source_sha !== hypothesis.source_sha
    || plan.hypothesis_id !== hypothesis.hypothesis_id
    || plan.hypothesis_digest !== hypothesis.hypothesis_digest
    || plan.task_spec?.rsi?.source_sha !== hypothesis.source_sha
    || plan.task_spec?.rsi?.hypothesis_id !== hypothesis.hypothesis_id
    || plan.task_spec?.rsi?.hypothesis_digest !== hypothesis.hypothesis_digest
    || plan.task_spec?.rsi?.opportunity_id !== hypothesis.opportunity_id
  ) throw new Error('rsi_adoption_plan_hypothesis_binding_invalid');

  return plan;
}

export function verifyRsiFrontierReviewResult(review) {
  if (!review || typeof review !== 'object' || Array.isArray(review) || review.schema !== RSI_FRONTIER_REVIEW_RESULT_SCHEMA) {
    throw new Error('rsi_adoption_review_invalid');
  }
  zeroAuthority(review, 'review');
  if (
    review.version !== 1
    || review.verdict !== 'ACCEPT'
    || review.reviewed_by_external_agent !== true
    || review.authored_by_candidate !== false
    || review.candidate_materialization_performed !== false
    || review.implementation_dispatched !== false
    || review.review_is_execution_authority !== false
  ) throw new Error('rsi_adoption_review_policy_invalid');

  const hypothesis = verifyHypothesis(review.hypothesis);
  const plan = verifyPlan(review.experiment_plan, hypothesis);
  if (review.mutation_contract?.schema !== RSI_MUTATION_CONTRACT_SCHEMA) {
    throw new Error('rsi_adoption_mutation_contract_invalid');
  }
  const verifiedMutation = verifyRsiMutationContract(review.mutation_contract, { hypothesis });

  if (
    String(review.source_sha || '').toLowerCase() !== hypothesis.source_sha
    || review.opportunity_id !== hypothesis.opportunity_id
    || review.hypothesis_digest !== hypothesis.hypothesis_digest
    || review.plan_digest !== plan.plan_digest
    || review.mutation_contract_digest !== review.mutation_contract.contract_digest
    || JSON.stringify(verifiedMutation.allowed_mutations) !== JSON.stringify(review.mutation_contract.allowed_mutations)
  ) throw new Error('rsi_adoption_review_binding_invalid');

  const material = structuredClone(review);
  delete material.review_digest;
  const expected = digest(material);
  if (review.review_digest !== expected) throw new Error('rsi_adoption_review_digest_mismatch');
  return review;
}

export function createRsiDevosImplementationAdoption({ review_result } = {}) {
  const review = verifyRsiFrontierReviewResult(review_result);
  const plan = review.experiment_plan;
  const hypothesis = review.hypothesis;
  const contract = review.mutation_contract;

  const taskSpec = {
    schema: 'metaengine.rsi.implementation-task.v1',
    objective: 'Materialize exactly one isolated RSI candidate from the independently accepted hypothesis and mutation contract, then produce sandbox/evaluator handoff evidence. Do not promote, install, self-update, or mutate evaluator/trust roots.',
    source: 'TRUSTED_RSI_ADVISORY_ADOPTION',
    source_sha: plan.source_sha,
    experiment_id: plan.experiment_id,
    opportunity_id: review.opportunity_id,
    hypothesis_id: hypothesis.hypothesis_id,
    hypothesis_digest: hypothesis.hypothesis_digest,
    experiment_plan_digest: plan.plan_digest,
    mutation_contract_digest: contract.contract_digest,
    target_branch: plan.target_branch,
    exact_mutation_set: structuredClone(contract.allowed_mutations),
    isolated_candidate_builder_required: true,
    verification_sandbox_required: true,
    immutable_source_snapshot_required: true,
    exact_base_sha_readback_required: true,
    current_workspace_lease_required: true,
    external_evaluator_required: true,
    benchmark_provenance_required: true,
    evaluation_integrity_required: true,
    candidate_can_modify_acceptance_contract: false,
    candidate_can_modify_evaluator_root: false,
    candidate_can_modify_promotion_root: false,
    candidate_can_invoke_self_update: false,
    no_main_or_production_promotion: true,
    no_production_ddl: true,
    no_second_scheduler: true,
    no_blind_retry_after_ambiguous_effect: true,
    page_model_worker_authority: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };

  const core = {
    schema: RSI_DEVOS_IMPLEMENTATION_ADOPTION_SCHEMA,
    version: 1,
    source_sha: plan.source_sha,
    target_branch: plan.target_branch,
    experiment_id: plan.experiment_id,
    opportunity_id: review.opportunity_id,
    review_digest: review.review_digest,
    hypothesis_digest: hypothesis.hypothesis_digest,
    plan_digest: plan.plan_digest,
    mutation_contract_digest: contract.contract_digest,
    implementation_task_spec: taskSpec,
    existing_devos_scheduler_required: true,
    implementation_task_not_yet_enqueued: true,
    candidate_not_yet_materialized: true,
    external_scheduler_must_revalidate_current_source: true,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, adoption_digest: digest(core) });
}

export function verifyRsiDevosImplementationAdoption(row, { review_result } = {}) {
  if (!row || typeof row !== 'object' || Array.isArray(row) || row.schema !== RSI_DEVOS_IMPLEMENTATION_ADOPTION_SCHEMA) {
    throw new Error('rsi_adoption_envelope_invalid');
  }
  zeroAuthority(row, 'envelope');
  const expected = createRsiDevosImplementationAdoption({ review_result });
  if (JSON.stringify(stable(row)) !== JSON.stringify(stable(expected))) {
    throw new Error('rsi_adoption_envelope_mismatch');
  }
  return expected;
}
