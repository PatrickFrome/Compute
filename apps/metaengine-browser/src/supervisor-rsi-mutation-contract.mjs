import crypto from 'node:crypto';

import { RSI_EXPERIMENT_HYPOTHESIS_SCHEMA } from './supervisor-rsi-experiment-hypothesis.mjs';

export const RSI_MUTATION_CONTRACT_SCHEMA = 'metaengine.rsi.mutation-contract.v1';

const SHA40_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const HYPOTHESIS_ID_RE = /^rsi_hyp_[0-9a-f]{24}$/;

const PROFILE = Object.freeze({
  RESULT_DELIVERY_STALL_AFTER_EFFECT_BINDING: Object.freeze({
    mutation_surface: 'BROWSER_RUNTIME',
    allowed_mutations: Object.freeze([
      Object.freeze({
        path: 'apps/metaengine-browser/src/result-delivery-transport.mjs',
        change: 'CREATE',
      }),
    ]),
    immutable_causal_components: Object.freeze([
      'apps/metaengine-browser/src/native-supervisor-client-core-base.mjs',
      'apps/metaengine-browser/src/native-supervisor-client-base.mjs',
    ]),
  }),
});

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)), 'utf8').digest('hex')}`;
}

function assertZeroAuthority(value, label) {
  for (const field of [
    'execution_authority',
    'production_mutation_authority',
    'promotion_authority',
    'self_update_authority',
    'authority_effect',
  ]) {
    if (value?.[field] !== false) throw new Error(`rsi_mutation_contract_${label}_${field}_invalid`);
  }
  if (value?.automatic_retry_allowed !== false) throw new Error(`rsi_mutation_contract_${label}_automatic_retry_invalid`);
}

function assertHypothesis(hypothesis) {
  if (!hypothesis || typeof hypothesis !== 'object' || Array.isArray(hypothesis)) {
    throw new Error('rsi_mutation_contract_hypothesis_invalid');
  }
  if (hypothesis.schema !== RSI_EXPERIMENT_HYPOTHESIS_SCHEMA || hypothesis.version !== 1) {
    throw new Error('rsi_mutation_contract_hypothesis_schema_invalid');
  }
  assertZeroAuthority(hypothesis, 'hypothesis');

  if (!SHA40_RE.test(String(hypothesis.source_sha || ''))) {
    throw new Error('rsi_mutation_contract_source_sha_invalid');
  }
  if (!HYPOTHESIS_ID_RE.test(String(hypothesis.hypothesis_id || ''))) {
    throw new Error('rsi_mutation_contract_hypothesis_id_invalid');
  }
  if (!SHA256_RE.test(String(hypothesis.hypothesis_digest || ''))) {
    throw new Error('rsi_mutation_contract_hypothesis_digest_invalid');
  }
  if (
    hypothesis.shadow_only !== true
    || hypothesis.candidate_can_modify_hypothesis !== false
    || hypothesis.candidate_can_modify_acceptance_contract !== false
  ) {
    throw new Error('rsi_mutation_contract_hypothesis_policy_invalid');
  }

  const material = { ...hypothesis };
  delete material.hypothesis_id;
  delete material.hypothesis_digest;
  if (digest(material) !== hypothesis.hypothesis_digest) {
    throw new Error('rsi_mutation_contract_hypothesis_digest_mismatch');
  }

  const signal = String(hypothesis.signal || '').toUpperCase();
  const registered = PROFILE[signal];
  if (!registered) throw new Error('rsi_mutation_contract_signal_unregistered');
  if (String(hypothesis.mutation_surface || '').toUpperCase() !== registered.mutation_surface) {
    throw new Error('rsi_mutation_contract_surface_mismatch');
  }
  return { signal, registered };
}

function contractMaterial(hypothesis, signal, registered) {
  return {
    schema: RSI_MUTATION_CONTRACT_SCHEMA,
    version: 1,
    source_sha: String(hypothesis.source_sha).toLowerCase(),
    hypothesis_id: hypothesis.hypothesis_id,
    hypothesis_digest: hypothesis.hypothesis_digest,
    signal,
    mutation_surface: registered.mutation_surface,
    allowed_mutations: registered.allowed_mutations.map((entry) => ({ ...entry })),
    exact_mutation_set_required: true,
    max_mutated_files: registered.allowed_mutations.length,
    candidate_can_extend_mutation_set: false,
    immutable_causal_components: [...registered.immutable_causal_components],
    native_supervisor_mutation_allowed: false,
    supervisor_trust_root_mutation_allowed: false,
    test_root_mutation_allowed: false,
    workflow_root_mutation_allowed: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
}

export function buildRsiMutationContract({ hypothesis } = {}) {
  const { signal, registered } = assertHypothesis(hypothesis);
  const material = contractMaterial(hypothesis, signal, registered);
  return Object.freeze({
    ...material,
    contract_digest: digest(material),
  });
}

export function verifyRsiMutationContract(contract, { hypothesis } = {}) {
  const { signal, registered } = assertHypothesis(hypothesis);
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) {
    throw new Error('rsi_mutation_contract_invalid');
  }
  assertZeroAuthority(contract, 'contract');
  if (contract.schema !== RSI_MUTATION_CONTRACT_SCHEMA || contract.version !== 1) {
    throw new Error('rsi_mutation_contract_schema_invalid');
  }
  if (contract.source_sha !== String(hypothesis.source_sha).toLowerCase()) {
    throw new Error('rsi_mutation_contract_source_mismatch');
  }
  if (
    contract.hypothesis_id !== hypothesis.hypothesis_id
    || contract.hypothesis_digest !== hypothesis.hypothesis_digest
  ) {
    throw new Error('rsi_mutation_contract_hypothesis_binding_mismatch');
  }
  if (contract.signal !== signal || contract.mutation_surface !== registered.mutation_surface) {
    throw new Error('rsi_mutation_contract_profile_binding_mismatch');
  }

  const expected = contractMaterial(hypothesis, signal, registered);
  const expectedDigest = digest(expected);
  if (contract.contract_digest !== expectedDigest) {
    throw new Error('rsi_mutation_contract_digest_mismatch');
  }
  const actualMaterial = { ...contract };
  delete actualMaterial.contract_digest;
  if (digest(actualMaterial) !== expectedDigest) {
    throw new Error('rsi_mutation_contract_material_mismatch');
  }
  if (JSON.stringify(stable(actualMaterial)) !== JSON.stringify(stable(expected))) {
    throw new Error('rsi_mutation_contract_profile_drift');
  }

  return Object.freeze({
    ok: true,
    contract_digest: expectedDigest,
    allowed_mutations: expected.allowed_mutations.map((entry) => ({ ...entry })),
  });
}
