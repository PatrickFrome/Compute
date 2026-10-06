import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import {
  CLIENT_C5_SUPERVISOR_TRUST_ROOT_SCHEMA,
  CLIENT_C5_SUPERVISOR_TRUST_ROOT_SIGNATURE_SCHEMA,
  buildClientC5SupervisorTrustResolutionReceipt,
  clientC5SupervisorTrustRootContract,
  clientC5SupervisorTrustRootDigest,
  clientC5SupervisorTrustRootSigningBytes,
  normalizeClientC5SupervisorTrustRoot,
  resolveClientC5SupervisorReadbackKey,
  verifyClientC5SupervisorTrustRootBootstrap,
  verifyClientC5SupervisorTrustRootTransition,
} from './client-c5-supervisor-trust-root.mjs';
import { sha256ClientC5 } from './client-c5-live-readiness.mjs';

function keyEntry(pair, {
  key_id,
  role,
  state = 'ACTIVE',
  valid_from = '2026-10-01T00:00:00Z',
  valid_until = '2027-10-01T00:00:00Z',
  retired_at = null,
  revoked_at = null,
  invalid_since = null,
} = {}) {
  const der = pair.publicKey.export({ type: 'spki', format: 'der' });
  return {
    key_id,
    role,
    alg: 'EdDSA',
    public_key_spki_base64: der.toString('base64'),
    public_key_spki_sha256: sha256ClientC5(der),
    state,
    valid_from,
    valid_until,
    retired_at,
    revoked_at,
    invalid_since,
  };
}

function manifest({
  generation,
  previous = null,
  keys,
  threshold = 1,
  issued_at,
  expires_at = '2027-01-01T00:00:00Z',
} = {}) {
  return {
    schema: CLIENT_C5_SUPERVISOR_TRUST_ROOT_SCHEMA,
    version: '2.0.0',
    generation,
    issued_at,
    expires_at,
    previous_manifest_sha256: previous,
    root_signature_threshold: threshold,
    usage: 'CLIENT_C5_SUPERVISOR_READBACK',
    keys: [...keys].sort((a, b) => a.key_id.localeCompare(b.key_id)),
    automatic_retry_allowed: false,
    authority_effect: false,
  };
}

function signatureEnvelope(target, signers) {
  return {
    schema: CLIENT_C5_SUPERVISOR_TRUST_ROOT_SIGNATURE_SCHEMA,
    manifest_sha256: clientC5SupervisorTrustRootDigest(target),
    signatures: signers
      .map(({ key_id, privateKey }) => ({
        key_id,
        alg: 'EdDSA',
        signature: crypto.sign(
          null,
          clientC5SupervisorTrustRootSigningBytes(target),
          privateKey,
        ).toString('base64url'),
      }))
      .sort((a, b) => a.key_id.localeCompare(b.key_id)),
  };
}

const rootA = crypto.generateKeyPairSync('ed25519');
const rootB = crypto.generateKeyPairSync('ed25519');
const rootC = crypto.generateKeyPairSync('ed25519');
const supervisorA = crypto.generateKeyPairSync('ed25519');
const supervisorB = crypto.generateKeyPairSync('ed25519');

const rootAEntry = keyEntry(rootA, { key_id: 'root:a', role: 'ROOT' });
const rootBEntry = keyEntry(rootB, { key_id: 'root:b', role: 'ROOT' });
const rootCEntry = keyEntry(rootC, { key_id: 'root:c', role: 'ROOT' });
const supervisorAEntry = keyEntry(supervisorA, { key_id: 'supervisor:a', role: 'SUPERVISOR_READBACK' });
const supervisorBEntry = keyEntry(supervisorB, { key_id: 'supervisor:b', role: 'SUPERVISOR_READBACK' });

const v1 = manifest({
  generation: 1,
  issued_at: '2026-10-05T00:00:00Z',
  threshold: 1,
  keys: [rootAEntry, supervisorAEntry],
});
const v1Signature = signatureEnvelope(v1, [{ key_id: 'root:a', privateKey: rootA.privateKey }]);

test('controlled bootstrap requires a pinned root key exact to the manifest entry', () => {
  const ok = verifyClientC5SupervisorTrustRootBootstrap({
    manifest: v1,
    signature_envelope: v1Signature,
    pinned_root_public_keys: { 'root:a': rootA.publicKey },
    pin_mode: 'CONTROLLED_TEST_VECTOR',
    now: new Date('2026-10-06T00:00:00Z'),
  });
  assert.equal(ok.action, 'TRUST_ROOT_ACCEPTED');
  assert.equal(ok.reason, 'CONTROLLED_BOOTSTRAP_EXACT');
  assert.equal(ok.bootstrap_material_verified, true);
  assert.equal(ok.live_development_pin_verified, false);
  assert.equal(ok.production_bootstrap_proven, false);

  const missing = verifyClientC5SupervisorTrustRootBootstrap({
    manifest: v1,
    signature_envelope: v1Signature,
    pinned_root_public_keys: {},
    pin_mode: 'CONTROLLED_TEST_VECTOR',
    now: new Date('2026-10-06T00:00:00Z'),
  });
  assert.equal(missing.action, 'HOLD_TRUST_ROOT');
  assert.equal(missing.reason, 'CONTROLLED_BOOTSTRAP_THRESHOLD_NOT_MET');

  const wrong = verifyClientC5SupervisorTrustRootBootstrap({
    manifest: v1,
    signature_envelope: v1Signature,
    pinned_root_public_keys: { 'root:a': rootB.publicKey },
    pin_mode: 'CONTROLLED_TEST_VECTOR',
    now: new Date('2026-10-06T00:00:00Z'),
  });
  assert.equal(wrong.action, 'HOLD_TRUST_ROOT');
  assert.equal(wrong.reason, 'CONTROLLED_BOOTSTRAP_THRESHOLD_NOT_MET');
});

test('LIVE development pin requires exact external SPKI digest but never claims production bootstrap', () => {
  const der = rootA.publicKey.export({ type: 'spki', format: 'der' });
  const digest = sha256ClientC5(der);

  const accepted = verifyClientC5SupervisorTrustRootBootstrap({
    manifest: v1,
    signature_envelope: v1Signature,
    pinned_root_public_keys: { 'root:a': rootA.publicKey },
    expected_pinned_root_spki_sha256: { 'root:a': digest },
    pin_mode: 'LIVE_DEVELOPMENT_PIN',
    now: new Date('2026-10-06T00:00:00Z'),
  });
  assert.equal(accepted.action, 'TRUST_ROOT_ACCEPTED');
  assert.equal(accepted.reason, 'LIVE_DEVELOPMENT_PIN_MATERIAL_EXACT');
  assert.equal(accepted.bootstrap_material_verified, true);
  assert.equal(accepted.live_development_pin_verified, true);
  assert.equal(accepted.production_bootstrap_proven, false);

  for (const expected of [{ 'root:a': '0'.repeat(64) }, {}]) {
    const held = verifyClientC5SupervisorTrustRootBootstrap({
      manifest: v1,
      signature_envelope: v1Signature,
      pinned_root_public_keys: { 'root:a': rootA.publicKey },
      expected_pinned_root_spki_sha256: expected,
      pin_mode: 'LIVE_DEVELOPMENT_PIN',
      now: new Date('2026-10-06T00:00:00Z'),
    });
    assert.equal(held.action, 'HOLD_TRUST_ROOT');
    assert.equal(held.reason, 'LIVE_DEVELOPMENT_PIN_THRESHOLD_NOT_MET');
    assert.equal(held.production_bootstrap_proven, false);
  }
});

test('no caller mode can manufacture production bootstrap proof from raw material', () => {
  const invalid = verifyClientC5SupervisorTrustRootBootstrap({
    manifest: v1,
    signature_envelope: v1Signature,
    pinned_root_public_keys: { 'root:a': rootA.publicKey },
    expected_pinned_root_spki_sha256: {
      'root:a': sha256ClientC5(rootA.publicKey.export({ type: 'spki', format: 'der' })),
    },
    pin_mode: 'PINNED_PRODUCTION',
    now: new Date('2026-10-06T00:00:00Z'),
  });
  assert.equal(invalid.action, 'HOLD_TRUST_ROOT');
  assert.equal(invalid.reason, 'TRUST_ROOT_PIN_MODE_INVALID');
  assert.equal(invalid.production_bootstrap_proven, false);
});

test('root rotation requires exact lineage and both old and new root thresholds', () => {
  const v2 = manifest({
    generation: 2,
    previous: clientC5SupervisorTrustRootDigest(v1),
    issued_at: '2026-10-06T00:10:00Z',
    threshold: 1,
    keys: [rootBEntry, supervisorBEntry],
  });
  const both = signatureEnvelope(v2, [
    { key_id: 'root:a', privateKey: rootA.privateKey },
    { key_id: 'root:b', privateKey: rootB.privateKey },
  ]);
  const accepted = verifyClientC5SupervisorTrustRootTransition({
    current_manifest: v1,
    candidate_manifest: v2,
    candidate_signature_envelope: both,
    now: new Date('2026-10-06T00:20:00Z'),
  });
  assert.equal(accepted.action, 'TRUST_ROOT_ACCEPTED');
  assert.equal(accepted.reason, 'OLD_AND_NEW_ROOT_THRESHOLDS_EXACT');

  const oldOnly = verifyClientC5SupervisorTrustRootTransition({
    current_manifest: v1,
    candidate_manifest: v2,
    candidate_signature_envelope: signatureEnvelope(v2, [
      { key_id: 'root:a', privateKey: rootA.privateKey },
    ]),
    now: new Date('2026-10-06T00:20:00Z'),
  });
  assert.equal(oldOnly.reason, 'NEW_ROOT_THRESHOLD_NOT_MET');

  const newOnly = verifyClientC5SupervisorTrustRootTransition({
    current_manifest: v1,
    candidate_manifest: v2,
    candidate_signature_envelope: signatureEnvelope(v2, [
      { key_id: 'root:b', privateKey: rootB.privateKey },
    ]),
    now: new Date('2026-10-06T00:20:00Z'),
  });
  assert.equal(newOnly.reason, 'OLD_ROOT_THRESHOLD_NOT_MET');
});

test('threshold rotation supports multiple offline root holders', () => {
  const current = manifest({
    generation: 1,
    issued_at: '2026-10-05T00:00:00Z',
    threshold: 2,
    keys: [rootAEntry, rootCEntry, supervisorAEntry],
  });
  const candidate = manifest({
    generation: 2,
    previous: clientC5SupervisorTrustRootDigest(current),
    issued_at: '2026-10-06T01:00:00Z',
    threshold: 2,
    keys: [rootBEntry, rootCEntry, supervisorBEntry],
  });
  const signatures = signatureEnvelope(candidate, [
    { key_id: 'root:a', privateKey: rootA.privateKey },
    { key_id: 'root:b', privateKey: rootB.privateKey },
    { key_id: 'root:c', privateKey: rootC.privateKey },
  ]);
  const out = verifyClientC5SupervisorTrustRootTransition({
    current_manifest: current,
    candidate_manifest: candidate,
    candidate_signature_envelope: signatures,
    now: new Date('2026-10-06T02:00:00Z'),
  });
  assert.equal(out.action, 'TRUST_ROOT_ACCEPTED');
  assert.equal(out.old_verified_root_signature_count, 2);
  assert.equal(out.new_verified_root_signature_count, 2);
});

test('rollback, skipped generations and wrong previous digest fail closed', () => {
  for (const candidate of [
    manifest({
      generation: 1,
      previous: null,
      issued_at: '2026-10-06T01:00:00Z',
      keys: [rootBEntry, supervisorBEntry],
    }),
    manifest({
      generation: 3,
      previous: clientC5SupervisorTrustRootDigest(v1),
      issued_at: '2026-10-06T01:00:00Z',
      keys: [rootBEntry, supervisorBEntry],
    }),
    manifest({
      generation: 2,
      previous: 'a'.repeat(64),
      issued_at: '2026-10-06T01:00:00Z',
      keys: [rootBEntry, supervisorBEntry],
    }),
  ]) {
    const out = verifyClientC5SupervisorTrustRootTransition({
      current_manifest: v1,
      candidate_manifest: candidate,
      candidate_signature_envelope: signatureEnvelope(candidate, [
        { key_id: 'root:a', privateKey: rootA.privateKey },
        { key_id: 'root:b', privateKey: rootB.privateKey },
      ]),
      now: new Date('2026-10-06T02:00:00Z'),
    });
    assert.equal(out.action, 'HOLD_TRUST_ROOT');
    assert.equal(out.reason, 'TRUST_ROOT_LINEAGE_OR_ROLLBACK_INVALID');
  }
});

test('expired, future, duplicate and unordered roots are rejected', () => {
  const expired = manifest({
    generation: 1,
    issued_at: '2026-10-01T00:00:00Z',
    expires_at: '2026-10-05T00:00:00Z',
    keys: [rootAEntry, supervisorAEntry],
  });
  assert.throws(
    () => normalizeClientC5SupervisorTrustRoot(expired, { now: new Date('2026-10-06T00:00:00Z') }),
    /client_c5_supervisor_trust_root_time_invalid/,
  );

  const future = manifest({
    generation: 1,
    issued_at: '2026-10-07T00:00:00Z',
    keys: [rootAEntry, supervisorAEntry],
  });
  assert.throws(
    () => normalizeClientC5SupervisorTrustRoot(future, { now: new Date('2026-10-06T00:00:00Z') }),
    /client_c5_supervisor_trust_root_time_invalid/,
  );

  const duplicate = { ...v1, keys: [rootAEntry, rootAEntry] };
  assert.throws(
    () => normalizeClientC5SupervisorTrustRoot(duplicate, { now: new Date('2026-10-06T00:00:00Z') }),
    /key_order_invalid|threshold_invalid/,
  );

  const unsorted = { ...v1, keys: [supervisorAEntry, rootAEntry] };
  assert.throws(
    () => normalizeClientC5SupervisorTrustRoot(unsorted, { now: new Date('2026-10-06T00:00:00Z') }),
    /key_order_invalid/,
  );
});

test('private or unknown key material cannot be smuggled into exact schema', () => {
  const injected = structuredClone(v1);
  injected.keys[0].private_key = 'forbidden';
  assert.throws(
    () => normalizeClientC5SupervisorTrustRoot(injected, { now: new Date('2026-10-06T00:00:00Z') }),
    /key_invalid/,
  );
});

test('active Supervisor key resolves only inside its cryptoperiod', () => {
  const ok = resolveClientC5SupervisorReadbackKey({
    manifest: v1,
    key_id: 'supervisor:a',
    evidence_issued_at: '2026-10-06T00:00:00Z',
    now: new Date('2026-10-06T00:01:00Z'),
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.key_state, 'ACTIVE');
  assert.match(ok.public_key_spki_sha256, /^[0-9a-f]{64}$/);

  const before = resolveClientC5SupervisorReadbackKey({
    manifest: v1,
    key_id: 'supervisor:a',
    evidence_issued_at: '2026-09-30T23:59:59Z',
    now: new Date('2026-10-06T00:01:00Z'),
  });
  assert.equal(before.ok, false);
  assert.equal(before.reason, 'SUPERVISOR_READBACK_KEY_OUTSIDE_CRYPTOPERIOD');
});

test('retired key verifies historical evidence only before retirement', () => {
  const retiredEntry = keyEntry(supervisorA, {
    key_id: 'supervisor:a',
    role: 'SUPERVISOR_READBACK',
    state: 'RETIRED',
    retired_at: '2026-10-05T12:00:00Z',
  });
  const m = manifest({
    generation: 1,
    issued_at: '2026-10-05T00:00:00Z',
    keys: [rootAEntry, retiredEntry, supervisorBEntry],
  });

  const historical = resolveClientC5SupervisorReadbackKey({
    manifest: m,
    key_id: 'supervisor:a',
    evidence_issued_at: '2026-10-05T11:59:59Z',
    now: new Date('2026-10-06T00:00:00Z'),
  });
  assert.equal(historical.ok, true);

  const late = resolveClientC5SupervisorReadbackKey({
    manifest: m,
    key_id: 'supervisor:a',
    evidence_issued_at: '2026-10-05T12:00:00Z',
    now: new Date('2026-10-06T00:00:00Z'),
  });
  assert.equal(late.ok, false);
  assert.equal(late.reason, 'SUPERVISOR_READBACK_KEY_RETIRED');
});

test('revoked key uses invalid_since rather than administrative revocation time', () => {
  const revokedEntry = keyEntry(supervisorA, {
    key_id: 'supervisor:a',
    role: 'SUPERVISOR_READBACK',
    state: 'REVOKED',
    invalid_since: '2026-10-05T10:00:00Z',
    revoked_at: '2026-10-05T12:00:00Z',
  });
  const m = manifest({
    generation: 1,
    issued_at: '2026-10-05T00:00:00Z',
    keys: [rootAEntry, revokedEntry, supervisorBEntry],
  });

  const historical = resolveClientC5SupervisorReadbackKey({
    manifest: m,
    key_id: 'supervisor:a',
    evidence_issued_at: '2026-10-05T09:59:59Z',
    now: new Date('2026-10-06T00:00:00Z'),
  });
  assert.equal(historical.ok, true);

  for (const evidence_issued_at of ['2026-10-05T10:00:00Z', '2026-10-05T11:00:00Z', '2026-10-05T12:00:00Z']) {
    const rejected = resolveClientC5SupervisorReadbackKey({
      manifest: m,
      key_id: 'supervisor:a',
      evidence_issued_at,
      now: new Date('2026-10-06T00:00:00Z'),
    });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.reason, 'SUPERVISOR_READBACK_KEY_REVOKED_OR_COMPROMISED');
  }
});

test('revoked key schema requires invalid_since no later than revoked_at', () => {
  for (const invalid_since of [null, '2026-10-05T13:00:00Z']) {
    const bad = keyEntry(supervisorA, {
      key_id: 'supervisor:a',
      role: 'SUPERVISOR_READBACK',
      state: 'REVOKED',
      invalid_since,
      revoked_at: '2026-10-05T12:00:00Z',
    });
    const m = manifest({
      generation: 1,
      issued_at: '2026-10-05T00:00:00Z',
      keys: [rootAEntry, bad, supervisorBEntry],
    });
    assert.throws(
      () => normalizeClientC5SupervisorTrustRoot(m, { now: new Date('2026-10-06T00:00:00Z') }),
      /key_state_invalid/,
    );
  }
});

test('trust resolution receipt carries key digest and cannot claim production', () => {
  const liveBootstrap = verifyClientC5SupervisorTrustRootBootstrap({
    manifest: v1,
    signature_envelope: v1Signature,
    pinned_root_public_keys: { 'root:a': rootA.publicKey },
    expected_pinned_root_spki_sha256: {
      'root:a': sha256ClientC5(rootA.publicKey.export({ type: 'spki', format: 'der' })),
    },
    pin_mode: 'LIVE_DEVELOPMENT_PIN',
    now: new Date('2026-10-06T00:00:00Z'),
  });
  const v2 = manifest({
    generation: 2,
    previous: clientC5SupervisorTrustRootDigest(v1),
    issued_at: '2026-10-06T00:10:00Z',
    keys: [rootBEntry, supervisorBEntry],
  });
  const transition = verifyClientC5SupervisorTrustRootTransition({
    current_manifest: v1,
    candidate_manifest: v2,
    candidate_signature_envelope: signatureEnvelope(v2, [
      { key_id: 'root:a', privateKey: rootA.privateKey },
      { key_id: 'root:b', privateKey: rootB.privateKey },
    ]),
    now: new Date('2026-10-06T00:20:00Z'),
  });
  const resolved = resolveClientC5SupervisorReadbackKey({
    manifest: v2,
    key_id: 'supervisor:b',
    evidence_issued_at: '2026-10-06T00:15:00Z',
    now: new Date('2026-10-06T00:20:00Z'),
  });
  const receipt = buildClientC5SupervisorTrustResolutionReceipt({
    pin_mode: 'LIVE_DEVELOPMENT_PIN',
    bootstrap_receipt: liveBootstrap,
    transition_receipt: transition,
    resolved_key: resolved,
  });
  assert.equal(receipt.live_development_pin_verified, true);
  assert.equal(receipt.production_bootstrap_proven, false);
  assert.equal(receipt.supervisor_key_id, 'supervisor:b');
  assert.match(receipt.supervisor_public_key_spki_sha256, /^[0-9a-f]{64}$/);
});

test('trust-root contract remains non-authoritative and production proof is external', () => {
  const contract = clientC5SupervisorTrustRootContract();
  assert.equal(contract.monotonic_generation_required, true);
  assert.equal(contract.transition_requires_old_root_threshold, true);
  assert.equal(contract.transition_requires_new_root_threshold, true);
  assert.equal(contract.raw_material_cannot_claim_production_bootstrap, true);
  assert.equal(contract.revoked_key_invalid_since_required, true);
  assert.equal(contract.private_key_material_allowed, false);
  assert.equal(contract.live_effect_authorized, false);
  assert.equal(contract.canonical_c2_promotion_authorized, false);
  assert.equal(contract.authority_effect, false);
});
