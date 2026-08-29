import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createBackendBindingCandidate, validateBackendObservation, BACKEND_OBSERVATION_SCHEMA } = require('../src/verification-sandbox-backend-binding.cjs');

const planCore = {
  schema: 'metaengine.development-plane.verification-sandbox-plan.v1',
  version: '1.0.0',
  mode: 'PREPARE_ONLY',
  candidate: {
    candidate_id: `candidate_sha256_${'a'.repeat(64)}`,
    digest: `sha256:${'b'.repeat(64)}`,
    source_head: 'c'.repeat(40),
    sequence: 1,
    verification_plan: [{ id: 'UNIT_TESTS', required: true }],
  },
  isolation: {
    requested_backend: 'VERCEL_SANDBOX',
    backend_bound: false,
    backend_identity: null,
    accepted_backends: ['CLOUDFLARE_SANDBOX','FIRECRACKER','GVISOR','KATA','VERCEL_SANDBOX'],
    required_boundary: 'VM_OR_STRONGER_OR_USERSPACE_KERNEL',
    execution_authority: false,
  },
  filesystem: {
    materialization_strategy: 'IMMUTABLE_SNAPSHOT',
    source_read_only: true,
    host_repository_mounted: false,
    writable_layer: 'PRIVATE_DIRECTORY',
    output_allowlist: ['evidence/'],
    allow_special_files: false,
  },
  network: { deny_by_default: true, inbound_exposure: false, allowed_hosts: [], allowed_cidrs: [], credential_brokering: false },
  resources: { wall_time_seconds: 120, memory_bytes: 2147483648, pids: 96, disk_bytes: 2147483648, output_bytes: 16777216 },
  evidence_contract: { sandbox_identity_receipt_required: true, input_manifest_digest_required: true, verification_receipts_required: true, output_manifest_digest_required: true, teardown_receipt_required: true },
  policy: { candidate_only: true, prepare_only: true, execution_authority: false, arbitrary_command_authority: false, browser_actuation_authority: false, direct_promote_current: false, promotion_authority: false, signed_attestation_authority: false, authority_effect: false },
  authority_effect: false,
};
function stable(v){ if(Array.isArray(v)) return `[${v.map(stable).join(',')}]`; if(v&&typeof v==='object') return `{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`; return JSON.stringify(v); }
const crypto = await import('node:crypto');
const hash = crypto.createHash('sha256').update(stable(planCore)).digest('hex');
const plan = Object.freeze({ ...planCore, plan_id: `sandbox_plan_sha256_${hash}`, digest: `sha256:${hash}` });

const observation = Object.freeze({
  schema: BACKEND_OBSERVATION_SCHEMA,
  provider: 'VERCEL_SANDBOX',
  session_id: 'sbx_test123',
  isolation_class: 'FIRECRACKER_MICROVM',
  runtime_digest: `sha256:${'1'.repeat(64)}`,
  image_digest: `sha256:${'2'.repeat(64)}`,
  input_manifest_digest: `sha256:${'3'.repeat(64)}`,
  output_manifest_digest: `sha256:${'4'.repeat(64)}`,
  teardown_receipt_digest: `sha256:${'5'.repeat(64)}`,
  created_at: '2026-08-29T10:00:00.000Z',
  stopped_at: '2026-08-29T10:01:00.000Z',
  network_policy: { deny_by_default: true, allowed_domains: [], allowed_cidrs: [], exposed_ports: [] },
  secrets: { environment_secret_injection: false, credential_brokering: false },
  materialization: { host_repository_mounted: false, source_read_only: true },
  teardown: { stopped: true, persistent_state_deleted: true },
});

test('binding candidate is digest-bound to a closed PREPARE_ONLY plan', () => {
  const binding = createBackendBindingCandidate({ plan });
  assert.equal(binding.backend.provider, 'VERCEL_SANDBOX');
  assert.equal(binding.backend.required_isolation_class, 'FIRECRACKER_MICROVM');
  assert.equal(binding.policy.backend_bound, false);
  assert.equal(binding.policy.execution_authorized, false);
  assert.equal(binding.network.policy, 'DENY_ALL_FOR_INITIAL_VERIFICATION');
  assert.deepEqual(binding.network.allowed_domains, []);
  assert.equal(binding.lifecycle.persistent, false);
});

test('provider name never grants trust or execution', () => {
  const binding = createBackendBindingCandidate({ plan, provider: 'VERCEL_SANDBOX' });
  assert.equal(binding.policy.provider_name_is_not_trust, true);
  assert.equal(binding.policy.self_reported_observation_is_not_trust, true);
  assert.equal(binding.policy.backend_bound, false);
  assert.equal(binding.policy.execution_authorized, false);
});

test('structurally valid provider observation remains unattested and non-authoritative', () => {
  const binding = createBackendBindingCandidate({ plan });
  const receipt = validateBackendObservation(binding, observation);
  assert.equal(receipt.structurally_valid, true);
  assert.equal(receipt.trust_state, 'PROVIDER_OBSERVED_UNATTESTED');
  assert.equal(receipt.backend_bound, false);
  assert.equal(receipt.execution_authorized, false);
  assert.equal(receipt.promotion_authorized, false);
});

test('network, secret, filesystem, and teardown relaxations fail closed', () => {
  const binding = createBackendBindingCandidate({ plan });
  assert.throws(() => validateBackendObservation(binding, { ...observation, network_policy: { ...observation.network_policy, allowed_domains: ['example.com'] } }), /network_invalid/);
  assert.throws(() => validateBackendObservation(binding, { ...observation, secrets: { ...observation.secrets, environment_secret_injection: true } }), /secret_policy_invalid/);
  assert.throws(() => validateBackendObservation(binding, { ...observation, materialization: { ...observation.materialization, host_repository_mounted: true } }), /materialization_invalid/);
  assert.throws(() => validateBackendObservation(binding, { ...observation, teardown: { ...observation.teardown, persistent_state_deleted: false } }), /teardown_invalid/);
});

test('provider/isolation/session mismatch fails closed', () => {
  const binding = createBackendBindingCandidate({ plan });
  assert.throws(() => validateBackendObservation(binding, { ...observation, provider: 'CLOUDFLARE_SANDBOX' }), /provider_mismatch/);
  assert.throws(() => validateBackendObservation(binding, { ...observation, isolation_class: 'DEDICATED_VM' }), /isolation_class_invalid/);
  assert.throws(() => validateBackendObservation(binding, { ...observation, session_id: 'not-a-vercel-session' }), /session_id_invalid/);
});

test('tampering with the source plan or binding digest is rejected', () => {
  const binding = createBackendBindingCandidate({ plan });
  const badPlan = structuredClone(plan);
  badPlan.network.deny_by_default = false;
  assert.throws(() => createBackendBindingCandidate({ plan: badPlan }), /plan_network_invalid|plan_digest_mismatch/);
  const tampered = structuredClone(binding);
  tampered.policy.backend_bound = true;
  assert.throws(() => validateBackendObservation(tampered, observation), /candidate_tampered/);
});
