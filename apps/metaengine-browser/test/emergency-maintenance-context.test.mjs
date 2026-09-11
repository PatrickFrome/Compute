import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  EmergencyMaintenanceContext,
  createEmergencyMaintenanceContextForUnitTest,
} from '../src/emergency-maintenance-context.mjs';
import { EMERGENCY_MAINTENANCE_TRUST_ROOT_SCHEMA } from '../src/emergency-maintenance-trust-root.mjs';
import {
  EMERGENCY_MAINTENANCE_GRANT_SCHEMA,
  GLOBAL_OPERATIONAL_OVERRIDE,
  canonicalEmergencyMaintenancePayload,
} from '../src/emergency-maintenance-policy.mjs';
import { OwnerSafetyGateRegistry } from '../src/owner-safety-gate-registry.mjs';

const BUILD_SHA = '8bda0d977a96cbba423aa8303064f87dd032bff3';
const START_MS = Date.parse('2026-09-09T16:00:00.000Z');

function signedGrant(privateKey, {
  grant_id = '22222222-2222-4222-8222-222222222222',
  nonce = 'b'.repeat(64),
  subject_build_sha = BUILD_SHA,
  issued_at = '2026-09-09T15:59:30.000Z',
  expires_at = '2026-09-09T16:03:30.000Z',
  scopes = [GLOBAL_OPERATIONAL_OVERRIDE],
} = {}) {
  const grant = {
    schema: EMERGENCY_MAINTENANCE_GRANT_SCHEMA,
    grant_id,
    nonce,
    subject_build_sha,
    issued_at,
    expires_at,
    reason: 'Recover verified runtime liveness without carrying operational holds',
    scopes,
  };
  grant.signature_base64 = crypto.sign(
    null,
    Buffer.from(canonicalEmergencyMaintenancePayload(grant), 'utf8'),
    privateKey,
  ).toString('base64');
  return grant;
}

function trustRoot(publicKey, buildSha = BUILD_SHA) {
  const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const der = publicKey.export({ type: 'spki', format: 'der' });
  return {
    schema: EMERGENCY_MAINTENANCE_TRUST_ROOT_SCHEMA,
    build_sha: buildSha,
    ed25519_public_key_pem: pem,
    public_key_spki_sha256: crypto.createHash('sha256').update(der).digest('hex'),
  };
}

async function harness() {
  let now = START_MS;
  let gateState = null;
  let runtimeState = null;
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const registry = new OwnerSafetyGateRegistry({
    loadState: async () => gateState,
    saveState: async (value) => { gateState = structuredClone(value); },
    clock: () => now,
  });
  await registry.init();
  const context = createEmergencyMaintenanceContextForUnitTest({
    ownerGateRegistry: registry,
    loadState: async () => runtimeState,
    saveState: async (value) => { runtimeState = structuredClone(value); },
    clock: () => now,
  }, trustRoot(publicKey));
  await context.init();
  return {
    registry,
    context,
    publicKey,
    privateKey,
    advance(ms) { now += ms; },
    runtimeState: () => structuredClone(runtimeState),
    gateState: () => structuredClone(gateState),
  };
}

test('runtime constructor rejects legacy mutable public key and build identity authority', () => {
  const registry = {
    snapshot: () => ({ wildcard_disabled: false, overrides: [] }),
    disable: async () => ({ disabled: true }),
    enable: async () => ({ disabled: false }),
  };
  const { publicKey } = crypto.generateKeyPairSync('ed25519');
  assert.throws(() => new EmergencyMaintenanceContext({
    ownerGateRegistry: registry,
    loadState: async () => null,
    saveState: async () => {},
    publicKey,
    expectedBuildSha: BUILD_SHA,
  }), /mutable_trust_root_forbidden/);
});

test('signed global grant durably consumes nonce before wildcard gate effect and leaves exact readback', async () => {
  const h = await harness();
  const grant = signedGrant(h.privateKey);
  const receipt = await h.context.activateGlobal(grant);

  assert.equal(receipt.state, 'ACTIVE');
  assert.equal(receipt.signature_verified, true);
  assert.equal(receipt.replay_fence_persisted_before_effect, true);
  assert.equal(receipt.audit_receipt_persisted, true);
  assert.equal(receipt.automatic_reclose, true);
  assert.equal(receipt.arbitrary_execution_allowed, false);
  assert.equal(receipt.blind_retry_allowed, false);
  assert.equal(await h.registry.isDisabled('self_update.restart_safety'), true);
  assert.equal(await h.registry.isDisabled('authority.armed'), true);
  assert.equal(h.registry.snapshot().wildcard_disabled, true);

  const persisted = h.runtimeState();
  assert.equal(persisted.consumed.length, 1);
  assert.match(persisted.consumed[0].nonce_sha256, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(persisted).includes(grant.nonce), false);
  assert.equal(JSON.stringify(persisted).includes(grant.signature_base64), false);
  assert.ok(Date.parse(receipt.expires_at) <= Date.parse(grant.expires_at));
});

test('same emergency grant cannot be replayed while its signed validity window is active', async () => {
  const h = await harness();
  const grant = signedGrant(h.privateKey);
  await h.context.activateGlobal(grant);
  await assert.rejects(() => h.context.activateGlobal(grant), /grant_replay/);
  assert.equal(h.runtimeState().consumed.length, 1);
});

test('scoped grant cannot enter the global operational runtime bridge', async () => {
  const h = await harness();
  const grant = signedGrant(h.privateKey, { scopes: ['SELF_UPDATE_HOLD_OVERRIDE'] });
  await assert.rejects(() => h.context.activateGlobal(grant), /global_override_required/);
  assert.equal(h.runtimeState().consumed.length, 0);
  assert.equal(h.registry.snapshot().wildcard_disabled, false);
});

test('wrong build and tampered grants fail before durable replay consumption', async () => {
  const h = await harness();
  const wrongBuild = signedGrant(h.privateKey, { subject_build_sha: '1'.repeat(40) });
  await assert.rejects(() => h.context.activateGlobal(wrongBuild), /build_binding_mismatch/);
  assert.equal(h.runtimeState().consumed.length, 0);

  const valid = signedGrant(h.privateKey);
  const tampered = { ...valid, reason: 'Tampered after signature' };
  await assert.rejects(() => h.context.activateGlobal(tampered), /signature_mismatch/);
  assert.equal(h.runtimeState().consumed.length, 0);
});

test('emergency wildcard expires no later than signed grant and becomes inactive without restart', async () => {
  const h = await harness();
  const grant = signedGrant(h.privateKey, {
    issued_at: '2026-09-09T15:59:59.000Z',
    expires_at: '2026-09-09T16:00:05.000Z',
  });
  const receipt = await h.context.activateGlobal(grant);
  assert.equal(await h.registry.isDisabled('fleet.ambiguous_compensating_fanout'), true);
  assert.ok(Date.parse(receipt.expires_at) <= Date.parse(grant.expires_at));

  h.advance(6_000);
  assert.equal(await h.registry.isDisabled('fleet.ambiguous_compensating_fanout'), false);
  assert.equal(h.context.snapshot().active, false);
  assert.ok(h.registry.snapshot().audit.some((row) => row.event === 'EXPIRED' && row.gate_id === '*'));
});

test('explicit emergency reclose removes only emergency wildcard and preserves independent owner gate overrides', async () => {
  const h = await harness();
  await h.registry.disable({
    gate_id: 'browser.navigation_policy',
    ttl_seconds: 60,
    reason: 'INDEPENDENT_OWNER_OVERRIDE',
    override_id: 'owner.independent.navigation',
  });
  const grant = signedGrant(h.privateKey);
  await h.context.activateGlobal(grant);
  assert.equal(h.registry.snapshot().wildcard_disabled, true);

  const closed = await h.context.reclose();
  assert.equal(closed.reclosed, true);
  assert.equal(h.registry.snapshot().wildcard_disabled, false);
  assert.equal(await h.registry.isDisabled('browser.navigation_policy'), true);
  assert.equal(await h.registry.isDisabled('self_update.restart_safety'), false);
});

test('post-fence registry failure consumes one-shot grant and forbids blind retry', async () => {
  let runtimeState = null;
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const registry = {
    snapshot: () => ({ wildcard_disabled: false, overrides: [] }),
    disable: async () => { throw new Error('synthetic_registry_write_failure'); },
    enable: async () => ({ disabled: false }),
  };
  const context = createEmergencyMaintenanceContextForUnitTest({
    ownerGateRegistry: registry,
    loadState: async () => runtimeState,
    saveState: async (value) => { runtimeState = structuredClone(value); },
    clock: () => START_MS,
  }, trustRoot(publicKey));
  await context.init();
  const grant = signedGrant(privateKey);

  await assert.rejects(() => context.activateGlobal(grant), /synthetic_registry_write_failure/);
  assert.equal(runtimeState.consumed.length, 1);
  assert.equal(runtimeState.last_receipt.state, 'EFFECT_UNCONFIRMED');
  assert.equal(runtimeState.last_receipt.automatic_retry_allowed, false);
  await assert.rejects(() => context.activateGlobal(grant), /grant_replay/);
});
