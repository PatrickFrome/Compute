import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createVerificationSandboxPlan, verifyVerificationSandboxPlan } = require('../src/verification-sandbox-plan.cjs');

const candidateId = `candidate_sha256_${'a'.repeat(64)}`;
const digest = `sha256:${'b'.repeat(64)}`;
const head = 'c'.repeat(40);
const capsule = Object.freeze({
  candidate_id: candidateId,
  digest,
  source: Object.freeze({ head }),
  sequence: 9,
  verification_plan: Object.freeze([
    Object.freeze({ id: 'UNIT_TESTS', required: true }),
    Object.freeze({ id: 'PARSE_GATE', required: true }),
  ]),
});
const verification = Object.freeze({
  ok: true,
  candidate_id: candidateId,
  digest,
  source_head: head,
  source_current: true,
  promotion_authorized: false,
  authority_effect: false,
});

test('sandbox plan is deterministic and remains prepare-only even when a strong backend is requested', () => {
  const a = createVerificationSandboxPlan({ capsule, candidate_verification: verification, requested_backend: 'cloudflare_sandbox' });
  const b = createVerificationSandboxPlan({ capsule: structuredClone(capsule), candidate_verification: structuredClone(verification), requested_backend: 'CLOUDFLARE_SANDBOX' });
  assert.equal(a.plan_id, b.plan_id);
  assert.equal(a.mode, 'PREPARE_ONLY');
  assert.equal(a.isolation.backend_bound, false);
  assert.equal(a.isolation.execution_authority, false);
  assert.equal(a.policy.execution_authority, false);
  assert.equal(a.policy.promotion_authority, false);
});

test('plan enforces source separation, deny-default network, and bounded output surface', () => {
  const plan = createVerificationSandboxPlan({ capsule, candidate_verification: verification });
  assert.equal(plan.filesystem.source_read_only, true);
  assert.equal(plan.filesystem.host_repository_mounted, false);
  assert.deepEqual(plan.filesystem.output_allowlist, ['evidence/']);
  assert.equal(plan.network.deny_by_default, true);
  assert.equal(plan.network.inbound_exposure, false);
  assert.deepEqual(plan.network.allowed_hosts, []);
  assert.equal(plan.network.credential_brokering, false);
});

test('plan requires a current independently verified candidate binding', () => {
  assert.throws(() => createVerificationSandboxPlan({ capsule, candidate_verification: { ...verification, source_current: false } }), /verification_required/);
  assert.throws(() => createVerificationSandboxPlan({ capsule, candidate_verification: { ...verification, digest: `sha256:${'d'.repeat(64)}` } }), /verification_mismatch/);
});

test('resource ceilings fail closed instead of silently clamping', () => {
  assert.throws(() => createVerificationSandboxPlan({ capsule, candidate_verification: verification, resources: { pids: 257 } }), /pids_invalid/);
  assert.throws(() => createVerificationSandboxPlan({ capsule, candidate_verification: verification, resources: { wall_time_seconds: 901 } }), /wall_time_seconds_invalid/);
  assert.throws(() => createVerificationSandboxPlan({ capsule, candidate_verification: verification, resources: { shell: 1 } }), /resource_unknown/);
});

test('plan schema contains no command, argv, secret, host mount, execution, or promotion capability', () => {
  const encoded = JSON.stringify(createVerificationSandboxPlan({ capsule, candidate_verification: verification, requested_backend: 'VERCEL_SANDBOX' }));
  assert.equal(/"command"|"argv"|"secret"/.test(encoded), false);
  assert.equal(encoded.includes('"host_repository_mounted":false'), true);
  assert.equal(encoded.includes('"execution_authority":false'), true);
  assert.equal(encoded.includes('"promotion_authority":false'), true);
});

test('plan verification recomputes the full digest-bound shape and rejects tampering', () => {
  const plan = createVerificationSandboxPlan({ capsule, candidate_verification: verification, resources: { wall_time_seconds: 120 } });
  const receipt = verifyVerificationSandboxPlan(plan, capsule, verification);
  assert.equal(receipt.ok, true);
  assert.equal(receipt.execution_authorized, false);
  assert.equal(receipt.promotion_authorized, false);
  const tampered = structuredClone(plan);
  tampered.network.deny_by_default = false;
  assert.throws(() => verifyVerificationSandboxPlan(tampered, capsule, verification), /plan_tampered/);
});
