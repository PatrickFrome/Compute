import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import {
  CLIENT_C5_SUPERVISOR_TRUST_ROOT_SCHEMA,
  CLIENT_C5_SUPERVISOR_TRUST_ROOT_SIGNATURE_SCHEMA,
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
    version: '1.0.0',
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

test('bootstrap requires an externally pinned root key exact to the manifest entry', () => {
  const ok = verifyClientC5SupervisorTrustRootBootstrap({
    manifest: v1,
    signature_envelope: v1Signature,
    pinned_root_public_keys: { 'root:a': rootA.publicKey },
    now: new Date('2026-10-06T00:00:00Z'),
    production_bootstrap: false,
  });
  assert.equal(ok.action, 'TRUST_ROOT_ACCEPTED');
  assert.equal(ok.reason, 'CONTROLLED_BOOTSTRAP_EXACT');
  assert.equal(ok.production_bootstrap_proven, false);
  assert.deepEqual(ok.verified_root_key_ids, ['root:a']);

  const missing = verifyClientC5SupervisorTrustRootBootstrap({
    manifest: v1,
    signature_envelope: v1Signature,
    pinned_root_public_keys: {},
    now: new Date('2026-10-06T00:00:00Z'),
  });
  assert.equal(missing.action, 'HOLD_TRUST_ROOT');
  assert.equal(missing.reason, 'PINNED_BOOTSTRAP_THRESHOLD_NOT_MET');

  const wrong = verifyClientC5SupervisorTrustRootBootstrap({
    manifest: v1,
    signature_envelope: v1Signature,
    pinned_root_public_keys: { 'root:a': rootB.publicKey },
    now: new Date('2026-10-06T00:00:00Z'),
  });
  assert.equal(wrong.action, 'HOLD_TRUST_ROOT');
  assert.equal(wrong.reason, 'PINNED_BOOTSTRAP_THRESHOLD_NOT_MET');
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
  assert.deepEqual(accepted.old_verified_root_key_ids, ['root:a']);
  assert.deepEqual(accepted.new_verified_root_key_ids, ['root:b']);

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

test('expired or future trust roots are rejected', () => {
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
});

test('key ids must be unique and canonically ordered', () => {
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

test('private or unknown key material cannot be smuggled into the exact schema', () => {
  const injected = structuredClone(v1);
  injected.keys[0].private_key = 'forbidden';
  assert.throws(
    () => normalizeClientC5SupervisorTrustRoot(injected, { now: new Date('2026-10-06T00:00:00Z') }),
    /key_invalid/,
  );
});

test('active Supervisor readback key resolves only inside its cryptoperiod', () => {
  const ok = resolveClientC5SupervisorReadbackKey({
    manifest: v1,
    key_id: 'supervisor:a',
    evidence_issued_at: '2026-10-06T00:00:00Z',
    now: new Date('2026-10-06T00:01:00Z'),
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.key_state, 'ACTIVE');

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
  assert.equal(historical.reason, 'SUPERVISOR_READBACK_HISTORICAL_SIGNATURE_ALLOWED');

  const late = resolveClientC5SupervisorReadbackKey({
    manifest: m,
    key_id: 'supervisor:a',
    evidence_issued_at: '2026-10-05T12:00:00Z',
    now: new Date('2026-10-06T00:00:00Z'),
  });
  assert.equal(late.ok, false);
  assert.equal(late.reason, 'SUPERVISOR_READBACK_KEY_RETIRED');
});

test('revoked key verifies only evidence strictly before recorded revocation time', () => {
  const revokedEntry = keyEntry(supervisorA, {
    key_id: 'supervisor:a',
    role: 'SUPERVISOR_READBACK',
    state: 'REVOKED',
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
    evidence_issued_at: '2026-10-05T11:00:00Z',
    now: new Date('2026-10-06T00:00:00Z'),
  });
  assert.equal(historical.ok, true);
  assert.equal(historical.reason, 'SUPERVISOR_READBACK_HISTORICAL_SIGNATURE_ALLOWED');

  const revoked = resolveClientC5SupervisorReadbackKey({
    manifest: m,
    key_id: 'supervisor:a',
    evidence_issued_at: '2026-10-05T12:00:00Z',
    now: new Date('2026-10-06T00:00:00Z'),
  });
  assert.equal(revoked.ok, false);
  assert.equal(revoked.reason, 'SUPERVISOR_READBACK_KEY_REVOKED');
});

test('trust-root contract remains PREPARE_ONLY and cannot grant live or C2 authority', () => {
  const contract = clientC5SupervisorTrustRootContract();
  assert.equal(contract.monotonic_generation_required, true);
  assert.equal(contract.transition_requires_old_root_threshold, true);
  assert.equal(contract.transition_requires_new_root_threshold, true);
  assert.equal(contract.supervisor_keys_separate_from_root_role, true);
  assert.equal(contract.private_key_material_allowed, false);
  assert.equal(contract.live_effect_authorized, false);
  assert.equal(contract.canonical_c2_promotion_authorized, false);
  assert.equal(contract.authority_effect, false);
});
