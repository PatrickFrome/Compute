import crypto from 'node:crypto';

import {
  prepareRsiIsolatedCandidateBuild,
  verifyRsiIsolatedCandidateBuildPlan,
} from './rsi-isolated-candidate-builder.mjs';
import { RSI_DEVOS_EXPERIMENT_PLAN_SCHEMA } from './rsi-devos-experiment-plan.mjs';
import {
  RSI_MUTATION_CONTRACT_SCHEMA,
  verifyRsiMutationContract,
} from './supervisor-rsi-mutation-contract.mjs';

export const RSI_TARGETED_CANDIDATE_BUILD_SCHEMA = 'metaengine.rsi.targeted-candidate-build.v1';

const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function sha256(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value)), 'utf8').digest('hex');
}

function assertZeroAuthority(value, label) {
  for (const field of [
    'execution_authority',
    'production_mutation_authority',
    'promotion_authority',
    'self_update_authority',
    'authority_effect',
  ]) {
    if (value?.[field] !== false) throw new Error(`rsi_targeted_${label}_${field}_invalid`);
  }
  if (value?.automatic_retry_allowed !== false) throw new Error(`rsi_targeted_${label}_automatic_retry_invalid`);
}

function normalizeMutationSet(mutations) {
  if (!Array.isArray(mutations) || mutations.length < 1) {
    throw new Error('rsi_targeted_mutations_invalid');
  }
  const seen = new Set();
  return mutations.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('rsi_targeted_mutation_entry_invalid');
    }
    const path = String(entry.path || '');
    const change = String(entry.change || '').toUpperCase();
    if (!path || seen.has(path)) throw new Error('rsi_targeted_mutation_duplicate_or_empty');
    seen.add(path);
    return { path, change };
  }).sort((a, b) => a.path.localeCompare(b.path) || a.change.localeCompare(b.change));
}

function assertExperimentPlan(plan, hypothesis, mutationContract) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan) || plan.schema !== RSI_DEVOS_EXPERIMENT_PLAN_SCHEMA) {
    throw new Error('rsi_targeted_experiment_plan_invalid');
  }
  assertZeroAuthority(plan, 'experiment');
  if (!SHA256_HEX_RE.test(String(plan.plan_digest || ''))) {
    throw new Error('rsi_targeted_experiment_plan_digest_invalid');
  }
  const material = { ...plan };
  delete material.plan_digest;
  if (sha256(material) !== plan.plan_digest) {
    throw new Error('rsi_targeted_experiment_plan_digest_mismatch');
  }

  if (
    plan.hypothesis_id !== hypothesis.hypothesis_id
    || plan.hypothesis_digest !== hypothesis.hypothesis_digest
    || plan.task_spec?.rsi?.hypothesis_id !== hypothesis.hypothesis_id
    || plan.task_spec?.rsi?.hypothesis_digest !== hypothesis.hypothesis_digest
  ) {
    throw new Error('rsi_targeted_experiment_hypothesis_binding_mismatch');
  }
  if (
    plan.source_sha !== mutationContract.source_sha
    || plan.task_spec?.rsi?.source_sha !== mutationContract.source_sha
    || String(plan.task_spec?.rsi?.signal || '').toUpperCase() !== mutationContract.signal
    || String(plan.task_spec?.rsi?.mutation_surface || '').toUpperCase() !== mutationContract.mutation_surface
  ) {
    throw new Error('rsi_targeted_experiment_contract_binding_mismatch');
  }
}

export function prepareRsiTargetedCandidateBuild({
  experiment_plan,
  hypothesis,
  mutation_contract,
  source_snapshot,
  mutations,
  sequence = 1,
  previous_candidate_id = null,
  requested_backend = null,
} = {}) {
  if (mutation_contract?.schema !== RSI_MUTATION_CONTRACT_SCHEMA) {
    throw new Error('rsi_targeted_mutation_contract_invalid');
  }
  const verifiedContract = verifyRsiMutationContract(mutation_contract, { hypothesis });
  assertExperimentPlan(experiment_plan, hypothesis, mutation_contract);

  const actualMutations = normalizeMutationSet(mutations);
  const expectedMutations = normalizeMutationSet(verifiedContract.allowed_mutations);
  if (JSON.stringify(actualMutations) !== JSON.stringify(expectedMutations)) {
    throw new Error('rsi_targeted_mutation_set_mismatch');
  }

  const sourceFiles = new Set(Array.isArray(source_snapshot?.source_files) ? source_snapshot.source_files : []);
  for (const entry of expectedMutations) {
    if (!sourceFiles.has(entry.path)) throw new Error('rsi_targeted_source_snapshot_missing_target');
  }

  const buildPlan = prepareRsiIsolatedCandidateBuild({
    experiment_plan,
    source_snapshot,
    mutations: expectedMutations,
    sequence,
    previous_candidate_id,
    requested_backend,
  });
  verifyRsiIsolatedCandidateBuildPlan(buildPlan);

  const material = {
    schema: RSI_TARGETED_CANDIDATE_BUILD_SCHEMA,
    version: 1,
    experiment_id: experiment_plan.experiment_id,
    source_sha: experiment_plan.source_sha,
    hypothesis_id: hypothesis.hypothesis_id,
    hypothesis_digest: hypothesis.hypothesis_digest,
    mutation_contract_digest: mutation_contract.contract_digest,
    exact_mutation_set: expectedMutations,
    generic_build_plan: buildPlan,
    generic_build_plan_digest: buildPlan.plan_digest,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };

  return Object.freeze({
    ...material,
    targeted_plan_digest: `sha256:${sha256(material)}`,
  });
}

export function verifyRsiTargetedCandidateBuild(envelope, { hypothesis, mutation_contract } = {}) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw new Error('rsi_targeted_build_invalid');
  }
  assertZeroAuthority(envelope, 'build');
  if (envelope.schema !== RSI_TARGETED_CANDIDATE_BUILD_SCHEMA || envelope.version !== 1) {
    throw new Error('rsi_targeted_build_schema_invalid');
  }
  const verifiedContract = verifyRsiMutationContract(mutation_contract, { hypothesis });
  if (
    envelope.hypothesis_id !== hypothesis.hypothesis_id
    || envelope.hypothesis_digest !== hypothesis.hypothesis_digest
    || envelope.mutation_contract_digest !== mutation_contract.contract_digest
  ) {
    throw new Error('rsi_targeted_build_binding_mismatch');
  }
  if (JSON.stringify(normalizeMutationSet(envelope.exact_mutation_set)) !== JSON.stringify(normalizeMutationSet(verifiedContract.allowed_mutations))) {
    throw new Error('rsi_targeted_build_mutation_set_mismatch');
  }
  if (envelope.generic_build_plan_digest !== envelope.generic_build_plan?.plan_digest) {
    throw new Error('rsi_targeted_build_generic_digest_mismatch');
  }
  verifyRsiIsolatedCandidateBuildPlan(envelope.generic_build_plan);

  const material = { ...structuredClone(envelope) };
  delete material.targeted_plan_digest;
  const expected = `sha256:${sha256(material)}`;
  if (envelope.targeted_plan_digest !== expected) {
    throw new Error('rsi_targeted_build_digest_mismatch');
  }
  return Object.freeze({ ok: true, targeted_plan_digest: expected });
}
