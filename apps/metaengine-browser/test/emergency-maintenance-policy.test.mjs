import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  EMERGENCY_MAINTENANCE_GRANT_SCHEMA,
  EMERGENCY_MAINTENANCE_MAX_TTL_MS,
  EMERGENCY_MAINTENANCE_SCOPES,
  EMERGENCY_NON_BYPASSABLE_INVARIANTS,
  canonicalEmergencyMaintenancePayload,
  emergencyMaintenancePolicyContract,
  planEmergencyMaintenanceBypass,
  verifyEmergencyMaintenanceGrant,
} from '../src/emergency-maintenance-policy.mjs';

const BUILD_SHA = '5480daf4e0c95ec6a4329b7f93e91478e0eedfd0';
const NOW = Date.parse('2026-09-09T12:00:00.000Z');

function fixture(overrides = {}) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const grant = {
    schema: EMERGENCY_MAINTENANCE_GRANT_SCHEMA,
    grant_id: '11111111-1111-4111-8111-111111111111',
    nonce: 'a'.repeat(64),
    subject_build_sha: BUILD_SHA,
    issued_at: '2026-09-09T11:59:30.000Z',
    expires_at: '2026-09-09T12:03:30.000Z',
    reason: 'Recover autonomous development after a verified control-plane deadlock',
    scopes: ['SELF_UPDATE_HOLD_OVERRIDE', 'SUPERVISOR_CONTINUITY_OVERRIDE'],
    ...overrides,
  };
  const canonical = canonicalEmergencyMaintenancePayload(grant);
  grant.signature_base64 = crypto.sign(null, Buffer.from(canonical, 'utf8'), privateKey).toString('base64');
  return { grant, publicKey, privateKey };
}

test('valid signed emergency grant is exact-build, bounded-time and scope constrained', () => {
  const { grant, publicKey } = fixture();
  const verified = verifyEmergencyMaintenanceGrant({
    grant,
    public_key: publicKey,
    expected_build_sha: BUILD_SHA,
    now_ms: NOW,
  });
  assert.equal(verified.signature_verified, true);
  assert.equal(verified.subject_build_sha, BUILD_SHA);
  assert.deepEqual(verified.scopes, ['SELF_UPDATE_HOLD_OVERRIDE', 'SUPERVISOR_CONTINUITY_OVERRIDE']);
  assert.equal(verified.one_shot, true);
  assert.equal(verified.automatic_reclose, true);
  assert.equal(verified.replay_fence_required, true);
  assert.equal(verified.authority_effect, false);
});

test('tampering, wrong build, wrong key and expired grants fail closed', () => {
  const { grant, publicKey } = fixture();
  const other = crypto.generateKeyPairSync('ed25519').publicKey;

  assert.throws(() => verifyEmergencyMaintenanceGrant({
    grant: { ...grant, reason: 'Tampered emergency reason' },
    public_key: publicKey,
    expected_build_sha: BUILD_SHA,
    now_ms: NOW,
  }), /signature_mismatch/);

  assert.throws(() => verifyEmergencyMaintenanceGrant({
    grant,
    public_key: publicKey,
    expected_build_sha: '1'.repeat(40),
    now_ms: NOW,
  }), /build_binding_mismatch/);

  assert.throws(() => verifyEmergencyMaintenanceGrant({
    grant,
    public_key: other,
    expected_build_sha: BUILD_SHA,
    now_ms: NOW,
  }), /signature_mismatch/);

  assert.throws(() => verifyEmergencyMaintenanceGrant({
    grant,
    public_key: publicKey,
    expected_build_sha: BUILD_SHA,
    now_ms: Date.parse(grant.expires_at),
  }), /grant_not_active/);
});

test('grant TTL is capped and unknown or duplicate scopes are rejected before signature authority', () => {
  const tooLong = fixture({
    expires_at: new Date(Date.parse('2026-09-09T11:59:30.000Z') + EMERGENCY_MAINTENANCE_MAX_TTL_MS + 1).toISOString(),
  });
  assert.throws(() => canonicalEmergencyMaintenancePayload(tooLong.grant), /ttl_invalid/);

  assert.throws(() => canonicalEmergencyMaintenancePayload({
    ...fixture().grant,
    scopes: ['SELF_UPDATE_HOLD_OVERRIDE', 'SELF_UPDATE_HOLD_OVERRIDE'],
  }), /scope_not_allowed/);

  assert.throws(() => canonicalEmergencyMaintenancePayload({
    ...fixture().grant,
    scopes: ['ARBITRARY_EXECUTION_FORBIDDEN'],
  }), /scope_not_allowed/);
});

test('verified grant produces only a one-shot audited bypass plan for an explicitly granted protection', () => {
  const { grant, publicKey } = fixture();
  const verified = verifyEmergencyMaintenanceGrant({
    grant,
    public_key: publicKey,
    expected_build_sha: BUILD_SHA,
    now_ms: NOW,
  });
  const plan = planEmergencyMaintenanceBypass({
    verified_grant: verified,
    scope: 'SELF_UPDATE_HOLD_OVERRIDE',
    protection_id: 'SELF_UPDATE.AMBIGUOUS_INSTALL_HOLD',
  });
  assert.equal(plan.scope, 'SELF_UPDATE_HOLD_OVERRIDE');
  assert.equal(plan.one_shot, true);
  assert.equal(plan.automatic_reclose, true);
  assert.equal(plan.replay_fence_required_before_effect, true);
  assert.equal(plan.audit_receipt_required_after_effect, true);
  assert.equal(plan.arbitrary_execution_allowed, false);
  assert.equal(plan.blind_retry_allowed, false);
  assert.equal(plan.page_model_text_authority, false);
  assert.equal(plan.authority_effect, false);

  assert.throws(() => planEmergencyMaintenanceBypass({
    verified_grant: verified,
    scope: 'FLEET_LIVENESS_OVERRIDE',
    protection_id: 'FLEET.RESTART_HOLD',
  }), /scope_not_granted/);
});

test('policy contract makes normal protections break-glass capable without making core trust invariants bypassable', () => {
  const contract = emergencyMaintenancePolicyContract();
  assert.deepEqual(contract.bypassable_scopes, EMERGENCY_MAINTENANCE_SCOPES);
  assert.deepEqual(contract.non_bypassable_invariants, EMERGENCY_NON_BYPASSABLE_INVARIANTS);
  assert.equal(contract.exact_build_binding_required, true);
  assert.equal(contract.ed25519_signature_required, true);
  assert.equal(contract.one_shot_nonce_required, true);
  assert.equal(contract.durable_replay_fence_required_before_effect, true);
  assert.equal(contract.durable_audit_receipt_required_after_effect, true);
  assert.equal(contract.automatic_reclose_required, true);
  assert.equal(contract.arbitrary_execution_allowed, false);
  assert.equal(contract.blind_retry_after_ambiguous_effect_allowed, false);
  assert.equal(contract.authority_effect, false);
});
