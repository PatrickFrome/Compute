import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  ENROLLMENT_SIGNATURE_PROFILE,
  SUPERVISOR_DEVICE_PROFILE,
  SupervisorDeviceIdentity,
} from '../src/supervisor-device-identity.mjs';

function testStorage() {
  const calls = { encrypt: 0, decrypt: 0 };
  return {
    calls,
    isEncryptionAvailable: () => true,
    encryptString(value) {
      calls.encrypt += 1;
      return Buffer.from(`test-only:${value}`);
    },
    decryptString(value) {
      calls.decrypt += 1;
      return Buffer.from(value).toString().replace(/^test-only:/, '');
    },
  };
}

async function temporaryState(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-device-concurrency-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return path.join(dir, 'device.json');
}

async function assertEnrollmentSignature(identity, snapshot) {
  const bodyText = JSON.stringify({
    profile: snapshot.profile,
    public_jwk: snapshot.public_jwk,
    key_fingerprint_sha256: snapshot.key_fingerprint_sha256,
  });
  const headers = await identity.enrollmentHeaders(bodyText);
  const material = [
    ENROLLMENT_SIGNATURE_PROFILE,
    `client_id:${snapshot.client_id}`,
    `profile:${SUPERVISOR_DEVICE_PROFILE}`,
    `fingerprint:${snapshot.key_fingerprint_sha256}`,
    `timestamp:${headers['x-metaengine-enroll-timestamp']}`,
    `nonce:${headers['x-metaengine-enroll-nonce']}`,
    `body_sha256:${crypto.createHash('sha256').update(bodyText).digest('hex')}`,
  ].join('\n');
  assert.equal(crypto.verify('sha256', Buffer.from(material), {
    key: crypto.createPublicKey({ key: snapshot.public_jwk, format: 'jwk' }),
    dsaEncoding: 'ieee-p1363',
  }, Buffer.from(headers['x-metaengine-enroll-signature'], 'base64url')), true);
}

test('parallel fresh startup persists one identity and every enrollment signature verifies', async (t) => {
  const statePath = await temporaryState(t);
  const secureStorage = testStorage();
  const identity = new SupervisorDeviceIdentity({ statePath, secureStorage });
  const snapshots = await Promise.all(Array.from({ length: 16 }, () => identity.ensure()));
  assert.equal(secureStorage.calls.encrypt, 1);
  for (const snapshot of snapshots) {
    assert.deepEqual(snapshot, snapshots[0]);
    assert.equal(Object.hasOwn(snapshot, 'encrypted_private_key_b64'), false);
  }
  await Promise.all(snapshots.map((snapshot) => assertEnrollmentSignature(identity, snapshot)));
  const stored = JSON.parse(await fs.readFile(statePath, 'utf8'));
  assert.equal(stored.client_id, snapshots[0].client_id);
  assert.deepEqual(stored.public_jwk, snapshots[0].public_jwk);
  assert.equal(stored.key_fingerprint_sha256, snapshots[0].key_fingerprint_sha256);
  assert.equal(stored.encrypted_private_key_b64.includes('PRIVATE KEY'), false);

  const restarted = new SupervisorDeviceIdentity({ statePath, secureStorage });
  const restored = await restarted.ensure();
  assert.deepEqual(restored.public_jwk, snapshots[0].public_jwk);
  assert.equal(restored.client_id, snapshots[0].client_id);
  await assertEnrollmentSignature(restarted, restored);
});

test('parallel cold loads decrypt the existing identity once without rotating its key', async (t) => {
  const statePath = await temporaryState(t);
  const secureStorage = testStorage();
  const original = new SupervisorDeviceIdentity({ statePath, secureStorage });
  const initial = await original.ensure();
  const restarted = new SupervisorDeviceIdentity({ statePath, secureStorage });
  const snapshots = await Promise.all(Array.from({ length: 16 }, () => restarted.ensure()));
  assert.equal(secureStorage.calls.encrypt, 1);
  assert.equal(secureStorage.calls.decrypt, 1);
  for (const snapshot of snapshots) assert.deepEqual(snapshot, snapshots[0]);
  assert.equal(snapshots[0].client_id, initial.client_id);
  assert.deepEqual(snapshots[0].public_jwk, initial.public_jwk);
  assert.equal(snapshots[0].key_fingerprint_sha256, initial.key_fingerprint_sha256);
  await Promise.all(snapshots.map((snapshot) => assertEnrollmentSignature(restarted, snapshot)));
});

test('failed shared initialization can recover after secure storage becomes available', async (t) => {
  const statePath = await temporaryState(t);
  const secureStorage = testStorage();
  let available = false;
  secureStorage.isEncryptionAvailable = () => available;
  const identity = new SupervisorDeviceIdentity({ statePath, secureStorage });
  const failed = await Promise.allSettled(Array.from({ length: 16 }, () => identity.ensure()));
  for (const result of failed) {
    assert.equal(result.status, 'rejected');
    assert.equal(result.reason.message, 'supervisor_secure_storage_unavailable');
  }
  assert.equal(identity.snapshot(), null);
  assert.equal(secureStorage.calls.encrypt, 0);
  await assert.rejects(fs.stat(statePath), { code: 'ENOENT' });
  available = true;
  const recovered = await Promise.all(Array.from({ length: 16 }, () => identity.ensure()));
  assert.equal(secureStorage.calls.encrypt, 1);
  await assertEnrollmentSignature(identity, recovered[0]);
});
